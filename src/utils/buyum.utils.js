/**
 * BUYUMLAR (2026-11-28) — sotilmaydigan jihozlar (muzlatkich, stend, banner...).
 *
 * Faqat SONI hisoblanadi (butun son, narx/seriya/holat yo'q). Uch joy: kompaniya, agent, mijoz (do'kon).
 * Qoldiq — o'zgarmas harakat jurnalidan (buyum_harakat + buyum_harakat_qator) SQL bilan hisoblanadi:
 *   kompaniya = kirim − agentga + agentdan
 *   agent X   = agentga(ga=X) + agentdan_agentga(ga=X) + mijozdan(agent=X)
 *             − agentdan(dan=X) − agentdan_agentga(dan=X) − mijozga(agent=X)
 *   mijoz M   = mijozga(M) − mijozdan(M)
 * Hisobdan chiqarish yo'q, shuning uchun kompaniya + agentlar + mijozlar = jami kirim.
 *
 * Qoidalar:
 *   • Harakat tahrirlanmaydi va bekor qilinmaydi — xato teskari harakat bilan tuzatiladi.
 *   • Qoldiq hech qachon manfiy bo'lmaydi: tranzaksiyaning BIRINCHI so'rovi — harakatdagi buyum qatorlari
 *     `FOR UPDATE` (id tartibida, deadlock yo'q), keyin qoldiq o'qiladi (REPEATABLE READ snapshot qulfdan
 *     keyin olinadi). Bir buyum bo'yicha parallel harakatlar navbatma-navbat bajariladi.
 *   • Faol emas buyum faqat kompaniyaga qaytishi mumkin (agentdan); mobil mijozdan (do'kondan olib ketish) ham
 *     ruxsat — bu ham kompaniyaga qaytish yo'li.
 *   • Takror: web sorov_id, mobil mobilId (ikkalasi UNIQUE).
 */
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const { BuyumModel, BuyumHarakatModel, BuyumHarakatQatorModel } = require('../models/buyum.model');
const AgentModel = require('../models/agent.model');
const TerritoriyaModel = require('../models/territoriya.model');
const { MijozModel } = require('../models/mijoz.model');
const HttpException = require('./HttpException.utils');
const { keyingiTartib, maksRaqam } = require('./qulf.utils');
const { kunParam, kunBoshi, kunOxiri } = require('./sana.utils');
const { KASSA_DIR } = require('../middleware/uploadKassa.middleware');

const PREFIKS = 'BH';
const SELECT = sequelize.QueryTypes.SELECT;
const TURLAR = ['kirim', 'agentga', 'agentdan', 'agentdan_agentga', 'mijozga', 'mijozdan'];
const WEB_TURLAR = ['kirim', 'agentga', 'agentdan', 'agentdan_agentga'];
const MOBIL_TURLAR = ['mijozga', 'mijozdan'];
const MAKS_DONA = 1000000;
const int = v => Number(v) || 0;
const userNomi = u => (u ? (u.fullname || u.username || `user#${u.id}`) : null);
const Q = (sql, replacements = {}, transaction = null) => sequelize.query(sql, { replacements, type: SELECT, ...(transaction ? { transaction } : {}) });

/* ── Kiruvchi ma'lumot tekshiruvi ─────────────────────── */

function maydonTekshir(body, ruxsat) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new HttpException(400, "So'rov tanasi obyekt bo'lishi kerak");
  const ortiqcha = Object.keys(body).filter(k => !ruxsat.includes(k));
  if (ortiqcha.length) throw new HttpException(400, `Noma'lum maydon: ${ortiqcha.join(', ')}`);
}

function idOl(v, nom) {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(x) || x <= 0) throw new HttpException(400, `${nom} noto'g'ri (musbat butun son)`);
  return x;
}

const bosmi = v => v === undefined || v === null || v === '';

function matnOl(v, nom, maks = 500) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new HttpException(400, `${nom} matn bo'lishi kerak`);
  const s = v.trim();
  if (s.length > maks) throw new HttpException(400, `${nom} ${maks} belgidan oshmasin`);
  return s || null;
}

function sorovIdOl(v) {
  if (bosmi(v) || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(s)) throw new HttpException(400, "sorov_id noto'g'ri (8–64 belgi: harf, raqam, - _ . :)");
  return s;
}

/** qatorlar → Map(buyum_id → dona). Bir buyum bir necha qatorda kelsa — qo'shiladi. dona — musbat butun son. */
function qatorlarOl(v, { idKey = 'buyum_id' } = {}) {
  if (!Array.isArray(v) || !v.length) throw new HttpException(400, 'qatorlar: kamida bitta buyum kerak');
  if (v.length > 200) throw new HttpException(400, "qatorlar: ko'pi bilan 200 ta");
  const map = new Map();
  v.forEach((q, i) => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new HttpException(400, `qatorlar[${i}] obyekt bo'lishi kerak`);
    const ort = Object.keys(q).filter(k => ![idKey, 'dona'].includes(k));
    if (ort.length) throw new HttpException(400, `qatorlar[${i}]: noma'lum maydon: ${ort.join(', ')}`);
    const id = idOl(q[idKey], `qatorlar[${i}].${idKey}`);
    const raw = typeof q.dona === 'string' && q.dona.trim() !== '' ? Number(q.dona) : q.dona;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new HttpException(400, `qatorlar[${i}].dona son bo'lishi kerak`);
    if (!Number.isInteger(raw)) throw new HttpException(400, `qatorlar[${i}].dona butun son bo'lishi kerak`);
    if (raw <= 0) throw new HttpException(400, `qatorlar[${i}].dona noldan katta bo'lishi kerak`);
    const jami = (map.get(id) || 0) + raw;
    if (jami > MAKS_DONA) throw new HttpException(400, `qatorlar[${i}].dona juda katta`);
    map.set(id, jami);
  });
  return map;
}

/* Rasm yo'li (mobil chekYuklash/ qaytargan): faqat rasm kengaytmasi, '/uploads/kassa/<nom>', diskda bo'lishi shart */
const RASM_YOL = /^\/uploads\/kassa\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,200}\.(?:jpg|jpeg|png|webp|gif|heic|heif))$/i;
function rasmOl(v) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new HttpException(400, "rasm noto'g'ri (chekYuklash/ qaytargan rasm yo'li bo'lishi kerak)");
  const s = v.trim();
  if (!s) return null;
  const m = s.length <= 255 && !s.includes('..') ? RASM_YOL.exec(s) : null;
  if (!m) throw new HttpException(400, "rasm noto'g'ri (chekYuklash/ qaytargan rasm yo'li bo'lishi kerak)");
  let bor = false;
  try { bor = fs.statSync(path.join(KASSA_DIR, m[1])).isFile(); } catch (e) { bor = false; }
  if (!bor) throw new HttpException(400, 'Rasm topilmadi — qaytadan yuklang');
  return s;
}

/* ── Qoldiq (jurnaldan) ───────────────────────────────── */

const inShart = (ust, kalit, qiymat) => (qiymat ? ` AND ${ust} IN (:${kalit})` : '');
const toMap2 = (rows, k1, k2) => {
  const m = new Map();
  for (const r of rows) {
    const a = Number(r[k1]), b = Number(r[k2]), d = int(r.dona);
    if (!d) continue;
    if (!m.has(a)) m.set(a, new Map());
    m.get(a).set(b, d);
  }
  return m;
};

/** Kompaniya ombori: Map(buyum_id → dona) */
async function kompaniyaQoldiq(buyumIds = null, t = null) {
  const rows = await Q(`
    SELECT q.buyum_id, SUM(CASE h.tur WHEN 'kirim' THEN q.dona WHEN 'agentga' THEN -q.dona WHEN 'agentdan' THEN q.dona ELSE 0 END) dona
    FROM buyum_harakat h JOIN buyum_harakat_qator q ON q.harakat_id = h.id
    WHERE h.tur IN ('kirim', 'agentga', 'agentdan')${inShart('q.buyum_id', 'b', buyumIds)}
    GROUP BY q.buyum_id`, { b: buyumIds || [] }, t);
  return new Map(rows.map(r => [Number(r.buyum_id), int(r.dona)]));
}

/** Agentlar qo'lida: Map(agent_id → Map(buyum_id → dona)), faqat noldan farqlilar */
async function agentQoldiqlari({ agentIds = null, buyumIds = null } = {}, t = null) {
  const b = inShart('q.buyum_id', 'b', buyumIds);
  const rows = await Q(`
    SELECT x.a agent_id, x.buyum_id, SUM(x.d) dona FROM (
      SELECT h.ga_agent_id a, q.buyum_id, q.dona d FROM buyum_harakat h JOIN buyum_harakat_qator q ON q.harakat_id = h.id
        WHERE h.tur IN ('agentga', 'agentdan_agentga')${inShart('h.ga_agent_id', 'a', agentIds)}${b}
      UNION ALL
      SELECT h.dan_agent_id, q.buyum_id, -q.dona FROM buyum_harakat h JOIN buyum_harakat_qator q ON q.harakat_id = h.id
        WHERE h.tur IN ('agentdan', 'agentdan_agentga')${inShart('h.dan_agent_id', 'a', agentIds)}${b}
      UNION ALL
      SELECT h.agent_id, q.buyum_id, CASE WHEN h.tur = 'mijozdan' THEN q.dona ELSE -q.dona END FROM buyum_harakat h JOIN buyum_harakat_qator q ON q.harakat_id = h.id
        WHERE h.tur IN ('mijozga', 'mijozdan')${inShart('h.agent_id', 'a', agentIds)}${b}
    ) x GROUP BY x.a, x.buyum_id HAVING SUM(x.d) <> 0`, { a: agentIds || [], b: buyumIds || [] }, t);
  return toMap2(rows, 'agent_id', 'buyum_id');
}

/** Mijozlarda: Map(mijoz_id → Map(buyum_id → dona)), faqat noldan farqlilar. oxirgi: Map(`m:b` → sana) */
async function mijozQoldiqlari({ mijozIds = null, buyumIds = null, oxirgi = false } = {}, t = null) {
  const rows = await Q(`
    SELECT h.mijoz_id, q.buyum_id, SUM(CASE WHEN h.tur = 'mijozga' THEN q.dona ELSE -q.dona END) dona, MAX(h.sana) oxirgi_sana
    FROM buyum_harakat h JOIN buyum_harakat_qator q ON q.harakat_id = h.id
    WHERE h.tur IN ('mijozga', 'mijozdan')${inShart('h.mijoz_id', 'm', mijozIds)}${inShart('q.buyum_id', 'b', buyumIds)}
    GROUP BY h.mijoz_id, q.buyum_id HAVING SUM(CASE WHEN h.tur = 'mijozga' THEN q.dona ELSE -q.dona END) <> 0`,
  { m: mijozIds || [], b: buyumIds || [] }, t);
  const m = toMap2(rows, 'mijoz_id', 'buyum_id');
  if (oxirgi) m.oxirgi = new Map(rows.map(r => [`${r.mijoz_id}:${r.buyum_id}`, r.oxirgi_sana]));
  return m;
}

/** Har buyum bo'yicha jami: Map(buyum_id → { kompaniyada, agentlarda, mijozlarda, jami }) */
async function jamiQoldiq() {
  const rows = await Q(`
    SELECT q.buyum_id,
      SUM(CASE h.tur WHEN 'kirim' THEN q.dona WHEN 'agentga' THEN -q.dona WHEN 'agentdan' THEN q.dona ELSE 0 END) kompaniyada,
      SUM(CASE h.tur WHEN 'agentga' THEN q.dona WHEN 'agentdan' THEN -q.dona WHEN 'mijozga' THEN -q.dona WHEN 'mijozdan' THEN q.dona ELSE 0 END) agentlarda,
      SUM(CASE h.tur WHEN 'mijozga' THEN q.dona WHEN 'mijozdan' THEN -q.dona ELSE 0 END) mijozlarda
    FROM buyum_harakat h JOIN buyum_harakat_qator q ON q.harakat_id = h.id
    GROUP BY q.buyum_id`);
  return new Map(rows.map(r => {
    const x = { kompaniyada: int(r.kompaniyada), agentlarda: int(r.agentlarda), mijozlarda: int(r.mijozlarda) };
    x.jami = x.kompaniyada + x.agentlarda + x.mijozlarda;
    return [Number(r.buyum_id), x];
  }));
}
const BOSH = { kompaniyada: 0, agentlarda: 0, mijozlarda: 0, jami: 0 };

/* ── Katalog ──────────────────────────────────────────── */

const katalogJson = (b, q) => ({
  id: b.id, nomi: b.nomi, birlik: b.birlik, izoh: b.izoh || null, faol: !!b.faol, ...(q || BOSH),
});

function faolParam(v) {
  if (bosmi(v)) return null;
  const s = String(v).toLowerCase();
  if (['1', 'true'].includes(s)) return true;
  if (['0', 'false'].includes(s)) return false;
  throw new HttpException(400, "faol faqat 1|0 (true|false)");
}

async function katalog(q = {}) {
  const faol = faolParam(q.faol);
  const [rows, jami] = await Promise.all([
    BuyumModel.findAll({ where: faol === null ? {} : { faol }, order: [['nomi', 'ASC'], ['id', 'ASC']], raw: true }),
    jamiQoldiq(),
  ]);
  return rows.map(b => katalogJson(b, jami.get(b.id)));
}

async function katalogBitta(id) {
  const b = await BuyumModel.findByPk(id, { raw: true });
  if (!b) throw new HttpException(404, 'Buyum topilmadi');
  return katalogJson(b, (await jamiQoldiq()).get(b.id));
}

function nomiOl(v, majburiy) {
  if (v === undefined && !majburiy) return undefined;
  if (typeof v !== 'string' || !v.trim()) throw new HttpException(400, 'nomi majburiy (matn)');
  const s = v.trim().replace(/\s+/g, ' ');
  if (s.length > 120) throw new HttpException(400, 'nomi 120 belgidan oshmasin');
  return s;
}
function birlikOl(v) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return 'dona';
  if (typeof v !== 'string' || !v.trim()) throw new HttpException(400, "birlik matn bo'lishi kerak");
  const s = v.trim();
  if (s.length > 20) throw new HttpException(400, 'birlik 20 belgidan oshmasin');
  return s;
}
async function nomBandmi(nomi, exceptId = null) {
  const bor = await BuyumModel.findOne({ where: { nomi, ...(exceptId ? { id: { [Op.ne]: exceptId } } : {}) }, attributes: ['id'], raw: true });
  if (bor) throw new HttpException(400, `"${nomi}" nomli buyum allaqachon bor`);
}
const unikalXato = e => !!e && (e.name === 'SequelizeUniqueConstraintError' || (e.parent && e.parent.code === 'ER_DUP_ENTRY'));

async function katalogYarat(b) {
  maydonTekshir(b, ['nomi', 'birlik', 'izoh']);
  const nomi = nomiOl(b.nomi, true);
  const birlik = birlikOl(b.birlik) || 'dona';
  const izoh = matnOl(b.izoh, 'izoh');
  await nomBandmi(nomi);
  try {
    const r = await BuyumModel.create({ nomi, birlik, izoh, faol: true });
    return katalogBitta(r.id);
  } catch (e) {
    if (unikalXato(e)) throw new HttpException(400, `"${nomi}" nomli buyum allaqachon bor`);
    throw e;
  }
}

async function katalogTahrir(idRaw, b) {
  const id = idOl(idRaw, 'id');
  maydonTekshir(b, ['nomi', 'birlik', 'izoh', 'faol']);
  const r = await BuyumModel.findByPk(id);
  if (!r) throw new HttpException(404, 'Buyum topilmadi');
  const u = {};
  const nomi = nomiOl(b.nomi, false);
  if (nomi !== undefined && nomi !== r.nomi) { await nomBandmi(nomi, id); u.nomi = nomi; }
  const birlik = birlikOl(b.birlik);
  if (birlik !== undefined) u.birlik = birlik;
  if (b.izoh !== undefined) u.izoh = matnOl(b.izoh, 'izoh');
  if (b.faol !== undefined) {
    if (typeof b.faol === 'boolean') u.faol = b.faol;
    else if ([0, 1, '0', '1'].includes(b.faol)) u.faol = Number(b.faol) === 1;
    else throw new HttpException(400, "faol true yoki false bo'lishi kerak");
  }
  if (!Object.keys(u).length) throw new HttpException(400, "O'zgartirish uchun nomi, birlik, izoh yoki faol yuboring");
  try {
    await r.update(u);
  } catch (e) {
    if (unikalXato(e)) throw new HttpException(400, `"${u.nomi}" nomli buyum allaqachon bor`);
    throw e;
  }
  return katalogBitta(id);
}

async function katalogOchir(idRaw) {
  const id = idOl(idRaw, 'id');
  await sequelize.transaction(async (t) => {
    const r = await BuyumModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
    if (!r) throw new HttpException(404, 'Buyum topilmadi');
    const soni = await BuyumHarakatQatorModel.count({ where: { buyum_id: id }, transaction: t });
    if (soni) throw new HttpException(400, 'Harakatlari bor — faolsizlantiring');
    await r.destroy({ transaction: t });
  });
  return { message: "O'chirildi" };
}

/* ── Harakat yozish (umumiy yadro) ────────────────────── */

/**
 * Bitta harakatni yozadi (tranzaksiya, qulf, qoldiq tekshiruvi).
 *   p: { tur, dan (agent|null), ga (agent|null), agent (agent|null), mijoz (mijoz|null), kerak: Map, izoh, rasm, mobilId, sorovId,
 *        userId, userNomi, sana }
 * @returns harakat id
 */
async function harakatYoz(p) {
  const ids = [...p.kerak.keys()].sort((a, b) => a - b);
  return sequelize.transaction(async (t) => {
    // 1) Buyum qatorlari qulfi — BIRINCHI so'rov (snapshot qulfdan keyin)
    const buyumlar = await Q('SELECT id, nomi, faol FROM buyum WHERE id IN (:ids) ORDER BY id FOR UPDATE', { ids }, t);
    const by = new Map(buyumlar.map(b => [Number(b.id), b]));
    for (const id of ids) if (!by.has(id)) throw new HttpException(400, `Buyum topilmadi: #${id}`);
    // Faol emas buyum — faqat kompaniyaga qaytish yo'nalishida (agentdan; mobil mijozdan)
    if (!['agentdan', 'mijozdan'].includes(p.tur)) {
      const nofaol = ids.map(id => by.get(id)).find(b => !Number(b.faol));
      if (nofaol) throw new HttpException(400, `"${nofaol.nomi}" faol emas — faqat kompaniyaga qaytarish mumkin`);
    }
    // 2) Manba joyda yetarlimi
    let mavjud = null, joy = null;
    if (p.tur === 'agentga') { mavjud = await kompaniyaQoldiq(ids, t); joy = 'kompaniya'; }
    else if (p.tur === 'agentdan' || p.tur === 'agentdan_agentga') {
      mavjud = (await agentQoldiqlari({ agentIds: [p.dan.id], buyumIds: ids }, t)).get(Number(p.dan.id)) || new Map();
      joy = p.dan.fullname;
    } else if (p.tur === 'mijozga') {
      mavjud = (await agentQoldiqlari({ agentIds: [p.agent.id], buyumIds: ids }, t)).get(Number(p.agent.id)) || new Map();
      joy = p.agent.fullname;
    } else if (p.tur === 'mijozdan') {
      mavjud = (await mijozQoldiqlari({ mijozIds: [p.mijoz.id], buyumIds: ids }, t)).get(Number(p.mijoz.id)) || new Map();
      joy = p.mijoz.nomi;
    }
    if (mavjud) {
      for (const id of ids) {
        const bor = mavjud.get(id) || 0;
        if (p.kerak.get(id) > bor) throw new HttpException(400, `"${by.get(id).nomi}": ${joy}da yetarli emas (mavjud ${bor})`);
      }
    }
    // 3) Yozuv
    const tartib = await keyingiTartib(PREFIKS, () => maksRaqam('buyum_harakat', PREFIKS, t), t);
    const h = await BuyumHarakatModel.create({
      raqam: `${PREFIKS}-${String(tartib).padStart(6, '0')}`, tur: p.tur,
      dan_agent_id: p.dan ? p.dan.id : null, ga_agent_id: p.ga ? p.ga.id : null, agent_id: p.agent ? p.agent.id : null,
      mijoz_id: p.mijoz ? p.mijoz.id : null, mijoz_nomi: p.mijoz ? p.mijoz.nomi : null,
      sana: p.sana || new Date(), izoh: p.izoh || null, rasm: p.rasm || null,
      mobil_id: p.mobilId || null, sorov_id: p.sorovId || null, user_id: p.userId || null, user_nomi: p.userNomi || null,
    }, { transaction: t });
    await BuyumHarakatQatorModel.bulkCreate(ids.map(id => ({
      harakat_id: h.id, buyum_id: id, buyum_nomi: by.get(id).nomi, dona: p.kerak.get(id),
    })), { transaction: t });
    return h.id;
  });
}

/* ── Harakat o'qish ───────────────────────────────────── */

async function agentNomlari(ids) {
  const u = [...new Set(ids.filter(Boolean).map(Number))];
  if (!u.length) return new Map();
  const rows = await AgentModel.findAll({ where: { id: u }, attributes: ['id', 'fullname'], raw: true, paranoid: false });
  return new Map(rows.map(a => [Number(a.id), a.fullname]));
}

async function qatorlarMap(harakatIds) {
  const m = new Map();
  if (!harakatIds.length) return m;
  const rows = await BuyumHarakatQatorModel.findAll({ where: { harakat_id: harakatIds }, order: [['buyum_nomi', 'ASC'], ['id', 'ASC']], raw: true });
  for (const q of rows) {
    if (!m.has(q.harakat_id)) m.set(q.harakat_id, []);
    m.get(q.harakat_id).push(q);
  }
  return m;
}

async function harakatlarShakli(rows) {
  const [qm, an] = await Promise.all([
    qatorlarMap(rows.map(r => r.id)),
    agentNomlari(rows.flatMap(r => [r.dan_agent_id, r.ga_agent_id, r.agent_id])),
  ]);
  const ag = id => (id ? { id: Number(id), nomi: an.get(Number(id)) || null } : null);
  return rows.map(h => ({
    id: h.id, raqam: h.raqam, tur: h.tur, sana: h.sana,
    dan_agent: ag(h.dan_agent_id), ga_agent: ag(h.ga_agent_id), agent: ag(h.agent_id),
    mijoz: h.mijoz_id ? { id: Number(h.mijoz_id), nomi: h.mijoz_nomi || null } : null,
    qatorlar: (qm.get(h.id) || []).map(q => ({ buyum_id: q.buyum_id, buyum_nomi: q.buyum_nomi, dona: q.dona })),
    izoh: h.izoh || null, rasm: h.rasm || null, manba: h.mobil_id || MOBIL_TURLAR.includes(h.tur) ? 'mobil' : 'web',
    user_nomi: h.user_nomi || null,
  }));
}

async function harakatBitta(idRaw) {
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) throw new HttpException(404, 'Harakat topilmadi');
  const h = await BuyumHarakatModel.findByPk(id, { raw: true });
  if (!h) throw new HttpException(404, 'Harakat topilmadi');
  return (await harakatlarShakli([h]))[0];
}

async function harakatlar(q = {}) {
  const w = ['1=1'], R = {};
  const dan = kunParam(q.dan, 'dan'), gacha = kunParam(q.gacha, 'gacha');
  if (dan && gacha && dan > gacha) throw new HttpException(400, "dan gacha'dan katta bo'lmasligi kerak");
  if (dan) { w.push('h.sana >= :dan'); R.dan = kunBoshi(dan); }
  if (gacha) { w.push('h.sana <= :gacha'); R.gacha = kunOxiri(gacha); }
  if (!bosmi(q.tur)) {
    if (!TURLAR.includes(q.tur)) throw new HttpException(400, `tur noto'g'ri (${TURLAR.join(', ')})`);
    w.push('h.tur = :tur'); R.tur = q.tur;
  }
  if (!bosmi(q.agent_id)) { w.push('(h.dan_agent_id = :ag OR h.ga_agent_id = :ag OR h.agent_id = :ag)'); R.ag = idOl(q.agent_id, 'agent_id'); }
  if (!bosmi(q.mijoz_id)) { w.push('h.mijoz_id = :mj'); R.mj = idOl(q.mijoz_id, 'mijoz_id'); }
  if (!bosmi(q.buyum_id)) {
    w.push('EXISTS (SELECT 1 FROM buyum_harakat_qator q WHERE q.harakat_id = h.id AND q.buyum_id = :bu)');
    R.bu = idOl(q.buyum_id, 'buyum_id');
  }
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const shart = w.join(' AND ');
  const [rows, [j]] = await Promise.all([
    Q(`SELECT h.* FROM buyum_harakat h WHERE ${shart} ORDER BY h.sana DESC, h.id DESC LIMIT :limit OFFSET :offset`, { ...R, limit, offset: (page - 1) * limit }),
    Q(`SELECT COUNT(*) c FROM buyum_harakat h WHERE ${shart}`, R),
  ]);
  return { data: await harakatlarShakli(rows), page, limit, jami: Number(j.c) || 0 };
}

/* ── Web harakat ──────────────────────────────────────── */

async function agentOl(id, nom) {
  const a = await AgentModel.findByPk(id);
  if (!a) throw new HttpException(400, `${nom}: agent topilmadi`);
  return a;
}

const kerakKalit = (m) => [...m.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}:${v}`).join(',');

async function webTakror(sorovId, p) {
  const bor = await BuyumHarakatModel.findOne({ where: { sorov_id: sorovId }, raw: true });
  if (!bor) return null;
  const qatorlar = await BuyumHarakatQatorModel.findAll({ where: { harakat_id: bor.id }, raw: true });
  const eski = new Map(qatorlar.map(q => [Number(q.buyum_id), q.dona]));
  const mos = bor.tur === p.tur && Number(bor.dan_agent_id || 0) === Number(p.danId || 0)
    && Number(bor.ga_agent_id || 0) === Number(p.gaId || 0) && kerakKalit(eski) === kerakKalit(p.kerak);
  if (!mos) throw new HttpException(409, 'Bu sorov_id boshqa harakatga tegishli');
  return { ...(await harakatBitta(bor.id)), takror: true };
}

/** POST /buyumlar/harakat → { status, body } */
async function webHarakat(b, user) {
  maydonTekshir(b, ['tur', 'dan_agent_id', 'ga_agent_id', 'qatorlar', 'izoh', 'sorov_id']);
  if (!WEB_TURLAR.includes(b.tur)) throw new HttpException(400, `tur noto'g'ri (${WEB_TURLAR.join(', ')})`);
  const tur = b.tur;
  const sorovId = sorovIdOl(b.sorov_id);
  const kerak = qatorlarOl(b.qatorlar);
  const izoh = matnOl(b.izoh, 'izoh');
  const danBor = !bosmi(b.dan_agent_id), gaBor = !bosmi(b.ga_agent_id);
  const kerakDan = tur === 'agentdan' || tur === 'agentdan_agentga';
  const kerakGa = tur === 'agentga' || tur === 'agentdan_agentga';
  if (kerakDan && !danBor) throw new HttpException(400, 'dan_agent_id majburiy');
  if (kerakGa && !gaBor) throw new HttpException(400, 'ga_agent_id majburiy');
  if (!kerakDan && danBor) throw new HttpException(400, `${tur}: dan_agent_id yuborilmaydi`);
  if (!kerakGa && gaBor) throw new HttpException(400, `${tur}: ga_agent_id yuborilmaydi`);
  const danId = kerakDan ? idOl(b.dan_agent_id, 'dan_agent_id') : null;
  const gaId = kerakGa ? idOl(b.ga_agent_id, 'ga_agent_id') : null;
  if (danId && gaId && danId === gaId) throw new HttpException(400, "Beruvchi va oluvchi agent bir xil bo'lmasligi kerak");

  if (sorovId) { const tk = await webTakror(sorovId, { tur, danId, gaId, kerak }); if (tk) return { status: 200, body: tk }; }
  const [dan, ga] = await Promise.all([danId ? agentOl(danId, 'dan_agent_id') : null, gaId ? agentOl(gaId, 'ga_agent_id') : null]);
  // Beruvchi faol bo'lmasa ham bo'ladi (ishdan ketgan agentdan qaytarib olish), oluvchi — faqat faol
  if (ga && !ga.faol) throw new HttpException(400, `${ga.fullname} faol emas — unga buyum berib bo'lmaydi`);

  let id;
  try {
    id = await harakatYoz({ tur, dan, ga, kerak, izoh, sorovId, userId: user ? user.id : null, userNomi: userNomi(user), sana: new Date() });
  } catch (e) {
    if (sorovId && unikalXato(e)) {
      const tk = await webTakror(sorovId, { tur, danId, gaId, kerak });
      if (tk) return { status: 200, body: tk };
    }
    throw e;
  }
  return { status: 201, body: await harakatBitta(id) };
}

/* ── Mobil harakat ────────────────────────────────────── */

/**
 * POST buyumHarakat { mobilId, tur: 'mijozga'|'mijozdan', mijozId, qatorlar:[{buyumId, dona}], izoh?, rasm?, vaqt }
 * ruxsatFn(mijoz) — mijozga ruxsat (saveSell bilan bir xil). @returns { harakatId, raqam, takror? }
 */
async function mobilHarakat(agent, b, { ruxsatFn, mobilKalit, mobilVaqt }) {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new HttpException(400, "So'rov tanasi obyekt bo'lishi kerak");
  const mobilId = mobilKalit(b.mobilId);
  if (!mobilId) throw new HttpException(400, 'mobilId majburiy');
  const takror = async () => {
    const bor = await BuyumHarakatModel.findOne({ where: { mobil_id: mobilId }, attributes: ['id', 'raqam', 'agent_id'], raw: true });
    if (!bor) return null;
    if (Number(bor.agent_id) !== Number(agent.id)) throw new HttpException(409, 'Bu mobilId boshqa harakatga tegishli');
    return { harakatId: bor.id, raqam: bor.raqam, takror: true };
  };
  // Oflayn navbat takrori — tekshiruvlardan oldin (holat o'zgargan bo'lsa ham bir xil javob)
  const t0 = await takror(); if (t0) return t0;
  if (!MOBIL_TURLAR.includes(b.tur)) throw new HttpException(400, "tur noto'g'ri (mijozga, mijozdan)");
  const mijozId = idOl(b.mijozId, 'mijozId');
  const kerak = qatorlarOl(b.qatorlar, { idKey: 'buyumId' });
  const izoh = matnOl(b.izoh, 'izoh');
  const rasm = rasmOl(b.rasm);
  // 2026-11-27: mijozga berishda rasm majburiy (mijozdan qaytarishda — ixtiyoriy)
  if (b.tur === 'mijozga' && !rasm) throw new HttpException(400, "Buyumni mijozga berishda rasm majburiy — rasmga olib qayta yuboring");
  const mijoz = await MijozModel.findByPk(mijozId);
  if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
  if (!await ruxsatFn(mijoz)) throw new HttpException(403, 'Bu mijoz sizga biriktirilmagan');
  if (b.tur === 'mijozga' && !mijoz.faol) throw new HttpException(400, `${mijoz.nomi} faol emas — unga buyum berib bo'lmaydi`);
  let id;
  try {
    id = await harakatYoz({
      tur: b.tur, agent, mijoz, kerak, izoh, rasm, mobilId, userId: null, userNomi: agent.fullname, sana: mobilVaqt(b.vaqt),
    });
  } catch (e) {
    if (unikalXato(e)) { const tk = await takror(); if (tk) return tk; }
    throw e;
  }
  const h = await BuyumHarakatModel.findByPk(id, { attributes: ['id', 'raqam'], raw: true });
  return { harakatId: h.id, raqam: h.raqam };
}

/* ── Mobil sinxron bloki ──────────────────────────────── */

/** avtolavkaSinxron / agentSinxron `buyumlar`. mijozIds — sinxrondagi mijozlar (shu to'plam bo'yicha mijozlarda). */
async function mobilBuyumlar(agent, mijozIds, kun = 30) {
  const aId = Number(agent.id);
  const dan = new Date(Date.now() - kun * 86400000);
  const ids = [...new Set((mijozIds || []).map(Number).filter(Boolean))];
  const [katalogRows, qolMap, mijMap, tarixRows] = await Promise.all([
    BuyumModel.findAll({ order: [['nomi', 'ASC'], ['id', 'ASC']], raw: true }),
    agentQoldiqlari({ agentIds: [aId] }),
    ids.length ? mijozQoldiqlari({ mijozIds: ids }) : new Map(),
    Q(`SELECT h.* FROM buyum_harakat h
       WHERE (h.ga_agent_id = :a OR h.dan_agent_id = :a OR h.agent_id = :a) AND h.sana >= :dan
       ORDER BY h.sana DESC, h.id DESC LIMIT 300`, { a: aId, dan }),
  ]);
  const qolda = [...(qolMap.get(aId) || new Map())].filter(([, d]) => d > 0).map(([buyumId, dona]) => ({ buyumId, dona }));
  const mijozlarda = [];
  for (const [mijozId, m] of mijMap) for (const [buyumId, dona] of m) if (dona > 0) mijozlarda.push({ mijozId, buyumId, dona });
  // Katalog: faol buyumlar + qo'lda/mijozlarda turgan faol emaslari (nomini ko'rsatish uchun; faol=false — berib bo'lmaydi)
  const kerakli = new Set([...qolda.map(x => x.buyumId), ...mijozlarda.map(x => x.buyumId)]);
  const katalogList = katalogRows.filter(b => b.faol || kerakli.has(b.id)).map(b => ({ id: b.id, nomi: b.nomi, birlik: b.birlik, faol: !!b.faol }));
  const [qm, an] = await Promise.all([
    qatorlarMap(tarixRows.map(r => r.id)),
    agentNomlari(tarixRows.flatMap(r => [r.dan_agent_id, r.ga_agent_id])),
  ]);
  const tarix = tarixRows.map(h => {
    let yonalish, boshqa = null;
    if (h.tur === 'agentga') yonalish = 'kirim';
    else if (h.tur === 'agentdan') yonalish = 'chiqim';
    else if (h.tur === 'mijozdan') yonalish = 'kirim';
    else if (h.tur === 'mijozga') yonalish = 'chiqim';
    else {   // agentdan_agentga
      const kirim = Number(h.ga_agent_id) === aId;
      yonalish = kirim ? 'kirim' : 'chiqim';
      const bId = kirim ? h.dan_agent_id : h.ga_agent_id;
      boshqa = { id: Number(bId), ism: an.get(Number(bId)) || null };
    }
    return {
      id: h.id, raqam: h.raqam, tur: h.tur, sana: h.sana,
      mijozId: h.mijoz_id ? Number(h.mijoz_id) : null, mijozNomi: h.mijoz_nomi || null,
      boshqaAgent: boshqa,
      qatorlar: (qm.get(h.id) || []).map(q => ({ buyumId: q.buyum_id, nomi: q.buyum_nomi, dona: q.dona })),
      izoh: h.izoh || null, rasm: h.rasm || null, yonalish,
    };
  });
  return { katalog: katalogList, qolda, mijozlarda, tarix };
}

/* ── Hisobotlar ───────────────────────────────────────── */

async function buyumNomlari() {
  const rows = await BuyumModel.findAll({ attributes: ['id', 'nomi'], raw: true });
  return new Map(rows.map(b => [Number(b.id), b.nomi]));
}
const nomTartib = (a, b) => String(a.nomi).localeCompare(String(b.nomi));

/** Mijozlar → mas'ul agent (mijoz.agent_id) */
async function mijozAgentlari(mijozIds) {
  if (!mijozIds.length) return new Map();
  const rows = await MijozModel.findAll({ where: { id: mijozIds }, attributes: ['id', 'nomi', 'manzil', 'agent_id'], raw: true, paranoid: false });
  return new Map(rows.map(m => [Number(m.id), m]));
}

/** GET /hisobot/agentlar?agent_id=&territoriya_id= */
async function hisobotAgentlar(q = {}) {
  const agentWhere = {};
  if (!bosmi(q.agent_id)) agentWhere.id = idOl(q.agent_id, 'agent_id');
  if (!bosmi(q.territoriya_id)) agentWhere.territoriya_id = idOl(q.territoriya_id, 'territoriya_id');
  const agentlar = await AgentModel.findAll({ where: agentWhere, attributes: ['id', 'fullname', 'territoriya_id', 'faol', 'deletedAt'], raw: true, paranoid: false });
  if (!agentlar.length) return [];
  const aIds = agentlar.map(a => Number(a.id));
  const filtr = Object.keys(agentWhere).length > 0;
  const [qolMap, mijMap, nomlar] = await Promise.all([
    agentQoldiqlari(filtr ? { agentIds: aIds } : {}),
    mijozQoldiqlari(),
    buyumNomlari(),
  ]);
  const mInfo = await mijozAgentlari([...mijMap.keys()]);
  // agent → buyum → mijozlarda
  const agMij = new Map();
  for (const [mId, m] of mijMap) {
    const aId = mInfo.get(mId) ? Number(mInfo.get(mId).agent_id) || null : null;
    if (!aId) continue;
    if (!agMij.has(aId)) agMij.set(aId, new Map());
    const x = agMij.get(aId);
    for (const [bId, d] of m) x.set(bId, (x.get(bId) || 0) + d);
  }
  const tIds = [...new Set(agentlar.map(a => a.territoriya_id).filter(Boolean))];
  const ter = new Map(tIds.length ? (await TerritoriyaModel.findAll({ where: { id: tIds }, attributes: ['id', 'nomi'], raw: true })).map(t => [t.id, t]) : []);
  const natija = [];
  for (const a of agentlar) {
    const qol = qolMap.get(Number(a.id)) || new Map(), mij = agMij.get(Number(a.id)) || new Map();
    const bIds = new Set([...qol.keys(), ...mij.keys()]);
    // Egasi qarori (2026-11-22): buyumsiz agentlar ham ko'rinadi. O'chirilgan/faolsiz agent — faqat buyumi qolgan bo'lsa
    if (!bIds.size && !agentWhere.id && (a.deletedAt || !a.faol)) continue;
    const t = a.territoriya_id ? ter.get(a.territoriya_id) : null;
    natija.push({
      agent: { id: a.id, nomi: a.fullname },
      territoriya: t ? { id: t.id, nomi: t.nomi } : null,
      buyumlar: [...bIds].map(bId => ({ buyum_id: bId, nomi: nomlar.get(bId) || null, qolda: qol.get(bId) || 0, mijozlarda: mij.get(bId) || 0 })).sort(nomTartib),
    });
  }
  return natija.sort((x, y) => String(x.agent.nomi).localeCompare(String(y.agent.nomi)));
}

/** GET /hisobot/mijozlar?agent_id=&mijoz_id=&buyum_id=&page=&limit= — faqat buyumi bor (>0) mijozlar */
async function hisobotMijozlar(q = {}) {
  const agentId = bosmi(q.agent_id) ? null : idOl(q.agent_id, 'agent_id');
  const mijozId = bosmi(q.mijoz_id) ? null : idOl(q.mijoz_id, 'mijoz_id');
  const buyumId = bosmi(q.buyum_id) ? null : idOl(q.buyum_id, 'buyum_id');
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const [mijMap, nomlar] = await Promise.all([
    mijozQoldiqlari({ mijozIds: mijozId ? [mijozId] : null, buyumIds: buyumId ? [buyumId] : null, oxirgi: true }),
    buyumNomlari(),
  ]);
  const mInfo = await mijozAgentlari([...mijMap.keys()]);
  const aIds = [...new Set([...mInfo.values()].map(m => m.agent_id).filter(Boolean))];
  const an = await agentNomlari(aIds);
  let rows = [];
  for (const [mId, m] of mijMap) {
    const info = mInfo.get(mId) || { id: mId, nomi: null, manzil: null, agent_id: null };
    if (agentId && Number(info.agent_id) !== agentId) continue;
    const buyumlar = [...m].filter(([, d]) => d > 0).map(([bId, dona]) => ({
      buyum_id: bId, nomi: nomlar.get(bId) || null, dona, oxirgi_sana: mijMap.oxirgi.get(`${mId}:${bId}`) || null,
    })).sort(nomTartib);
    if (!buyumlar.length) continue;
    rows.push({
      mijoz: { id: mId, nomi: info.nomi, manzil: info.manzil || null },
      agent: info.agent_id ? { id: Number(info.agent_id), nomi: an.get(Number(info.agent_id)) || null } : null,
      buyumlar,
    });
  }
  rows = rows.sort((x, y) => String(x.mijoz.nomi).localeCompare(String(y.mijoz.nomi)) || x.mijoz.id - y.mijoz.id);
  return { data: rows.slice((page - 1) * limit, page * limit), page, limit, jami: rows.length };
}

/** GET /hisobot/buyumlar — har buyum bo'yicha jami */
async function hisobotBuyumlar() {
  const [rows, jami] = await Promise.all([
    BuyumModel.findAll({ order: [['nomi', 'ASC'], ['id', 'ASC']], raw: true }),
    jamiQoldiq(),
  ]);
  return rows.map(b => ({ buyum_id: b.id, nomi: b.nomi, ...(jami.get(b.id) || BOSH) }));
}

/** GET /agent/:id — agent formasi/kartasi uchun */
async function agentBuyumlari(idRaw) {
  const id = idOl(idRaw, 'id');
  const agent = await AgentModel.findByPk(id, { attributes: ['id'], paranoid: false });
  if (!agent) throw new HttpException(404, 'Agent topilmadi');
  const [qolMap, nomlar, mijozlar] = await Promise.all([
    agentQoldiqlari({ agentIds: [id] }),
    buyumNomlari(),
    MijozModel.findAll({ where: { agent_id: id }, attributes: ['id', 'nomi'], raw: true }),
  ]);
  const qolda = [...(qolMap.get(id) || new Map())].filter(([, d]) => d > 0)
    .map(([bId, dona]) => ({ buyum_id: bId, nomi: nomlar.get(bId) || null, dona })).sort(nomTartib);
  const mNom = new Map(mijozlar.map(m => [Number(m.id), m.nomi]));
  const mijMap = mNom.size ? await mijozQoldiqlari({ mijozIds: [...mNom.keys()] }) : new Map();
  const mijozlarda = [];
  for (const [mId, m] of mijMap) for (const [bId, dona] of m) {
    if (dona > 0) mijozlarda.push({ mijoz_id: mId, mijoz_nomi: mNom.get(mId) || null, buyum_id: bId, nomi: nomlar.get(bId) || null, dona });
  }
  mijozlarda.sort((a, b) => String(a.mijoz_nomi).localeCompare(String(b.mijoz_nomi)) || String(a.nomi).localeCompare(String(b.nomi)));
  return { qolda, mijozlarda };
}

module.exports = {
  TURLAR, katalog, katalogYarat, katalogTahrir, katalogOchir, webHarakat, harakatlar, harakatBitta, mobilHarakat, mobilBuyumlar,
  hisobotAgentlar, hisobotMijozlar, hisobotBuyumlar, agentBuyumlari, kompaniyaQoldiq, agentQoldiqlari, mijozQoldiqlari, jamiQoldiq, rasmOl,
};
