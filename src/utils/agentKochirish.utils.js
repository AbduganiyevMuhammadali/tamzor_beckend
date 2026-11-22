/**
 * AGENTDAN AGENTGA KO'CHIRISH (2026-11-26)
 *
 * Operator web'da bir agentning SOTILADIGAN omboridan ("Agent: <ism>") boshqa agentning
 * sotiladigan omboriga tovar o'tkazadi. Brak omborlari, asosiy sklad ishtirok etmaydi.
 *   • Darhol amal qiladi (qabul qiluvchi tasdiqlamaydi).
 *   • Har qator — ikki register yozuvi tannarxda (chiqim + kirim), manba_tur 'agent_kochirish',
 *     manba_id = hujjat id. Jami ombor qiymati o'zgarmaydi; savdo, KPI, agent_register, kassa,
 *     plan-fakt — hech biriga ta'sir qilmaydi (tahlil.utils KOCHIRISH_MANBA — ichki harakat).
 *   • Tahrirlash — faqat farq (delta) yoziladi: oshgani yuboruvchidan yana chiqadi (yuboruvchida
 *     yetarli bo'lishi kerak), kamaygani qabul qiluvchidan qaytadi (unda yetarli bo'lishi kerak).
 *   • Bekor qilish — teskari yozuv; qabul qiluvchida har tovardan yetarli bo'lishi shart.
 *   • Yozuvlar o'chirilmaydi (jurnal to'liq qoladi), hamma narsa bitta tranzaksiyada, tovar
 *     qatorlari qulf ostida (qulf.utils tovarlarniQulfla) — parallel sotuv/yuklash bilan to'qnashmaydi.
 *   • Audit: agent_kochirish_audit (yaratildi / tahrirlandi / bekor_qilindi, eski → yangi, sabab).
 */
const { Op } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const { AgentKochirishModel, AgentKochirishQatorModel, AgentKochirishAuditModel } = require('../models/agentKochirish.model');
const AgentModel = require('../models/agent.model');
const TovarModel = require('../models/tovar.model');
const TovarRegisterModel = require('../models/tovar_register.model');
const HttpException = require('./HttpException.utils');
const { agentOmbori } = require('./ombor.utils');
const { mavjudQoldiq } = require('./zaxira.utils');
const { tannarxXaritasi } = require('./tahlil.utils');
const { qulflabOl, tovarlarniQulfla, keyingiTartib, maksRaqam } = require('./qulf.utils');
const { kunParam, kunBoshi, kunOxiri } = require('./sana.utils');

const MANBA = 'agent_kochirish';
const PREFIKS = 'KO';
const EPS = 0.0005;
const SELECT = sequelize.QueryTypes.SELECT;
const n = v => parseFloat(v) || 0;
const r2 = v => Math.round(n(v) * 100) / 100;
const r3 = v => Math.round(n(v) * 1000) / 1000;
const userNomi = u => (u ? (u.fullname || u.username || `user#${u.id}`) : null);
const QABUL_IZOH = " — qabul qilgan agent tovarni sotgan yoki boshqa joyga o'tkazgan";

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

function matnOl(v, nom) {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') throw new HttpException(400, `${nom} matn bo'lishi kerak`);
  const s = v.trim();
  if (s.length > 500) throw new HttpException(400, `${nom} 500 belgidan oshmasin`);
  return s || null;
}

function sorovIdOl(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  const s = String(v).trim();
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(s)) throw new HttpException(400, "sorov_id noto'g'ri (8–64 belgi: harf, raqam, - _ . :)");
  return s;
}

/** qatorlar → Map(tovar_id → dona). Bir tovar bir necha qatorda kelsa — qo'shiladi. dona 3 xonagacha yaxlitlanadi. */
function qatorlarOl(v) {
  if (!Array.isArray(v) || !v.length) throw new HttpException(400, 'qatorlar: kamida bitta tovar kerak');
  if (v.length > 500) throw new HttpException(400, "qatorlar: ko'pi bilan 500 ta");
  const map = new Map();
  v.forEach((q, i) => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new HttpException(400, `qatorlar[${i}] obyekt bo'lishi kerak`);
    const ort = Object.keys(q).filter(k => !['tovar_id', 'dona'].includes(k));
    if (ort.length) throw new HttpException(400, `qatorlar[${i}]: noma'lum maydon: ${ort.join(', ')}`);
    const id = idOl(q.tovar_id, `qatorlar[${i}].tovar_id`);
    const raw = typeof q.dona === 'string' && q.dona.trim() !== '' ? Number(q.dona) : q.dona;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) throw new HttpException(400, `qatorlar[${i}].dona son bo'lishi kerak`);
    const dona = r3(raw);
    if (dona <= 0) throw new HttpException(400, `qatorlar[${i}].dona noldan katta bo'lishi kerak`);
    if (dona > 1e9) throw new HttpException(400, `qatorlar[${i}].dona juda katta`);
    map.set(id, r3((map.get(id) || 0) + dona));
  });
  return map;
}

async function agentOl(id, nom) {
  const a = await AgentModel.findByPk(id);
  if (!a) throw new HttpException(400, `${nom}: agent topilmadi`);
  return a;
}

/** Tovarlar (id → { id, nomi, turkum, turi }); topilmasa 400 */
async function tovarlarOl(ids) {
  if (!ids.length) return new Map();
  const rows = await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'nomi', 'turkum', 'turi'], raw: true });
  const by = new Map(rows.map(t => [Number(t.id), t]));
  for (const id of ids) if (!by.has(Number(id))) throw new HttpException(400, `Tovar topilmadi: #${id}`);
  return by;
}

function turiTekshir(ids, tovarBy) {
  for (const id of ids) {
    const t = tovarBy.get(Number(id));
    if (t && t.turi !== 'tovar') throw new HttpException(400, `"${t.nomi}" — savdo tovari emas (xom ashyo), agentlar orasida ko'chirilmaydi`);
  }
}

/** Ombordagi mavjud qoldiq yetadimi. kerak: Map(tovar_id → dona). Tovar qatorlari oldindan qulflangan bo'lishi kerak. */
async function yetarliTekshir(kerak, ombor, agentNomi, nomBy, transaction, qoshimcha = '') {
  if (!kerak.size) return;
  const m = await mavjudQoldiq({ tovarIds: [...kerak.keys()], ombor, transaction });
  for (const [id, dona] of kerak) {
    const bor = (m.get(Number(id)) || { mavjud: 0 }).mavjud;
    if (dona > bor + EPS) {
      throw new HttpException(400, `"${nomBy.get(Number(id)) || `#${id}`}": ${agentNomi} omborida yetarli emas (mavjud ${r3(bor)})${qoshimcha}`);
    }
  }
}

/* Oxirgi chakana narx (mashina qiymati boshqa yozuvlar bilan bir xil ko'rinishi uchun sotuv_narx'ga) */
async function chakanaMap(ids, transaction) {
  if (!ids.length) return {};
  const rows = await sequelize.query(`
    SELECT r.tovar_id, (SELECT r2.chakana_narx FROM tovar_register r2 WHERE r2.tovar_id = r.tovar_id AND r2.chakana_narx > 0
                        ORDER BY r2.sana DESC, r2.id DESC LIMIT 1) AS chakana
    FROM (SELECT DISTINCT tovar_id FROM tovar_register WHERE tovar_id IN (:ids)) r`,
  { replacements: { ids }, type: SELECT, transaction });
  return Object.fromEntries(rows.map(r => [Number(r.tovar_id), n(r.chakana)]));
}

/** Bitta harakat — ikki register yozuvi: `dan` omboridan chiqim, `ga` omboriga kirim (tannarxda) */
function harakat({ hujjatId, tovar, dan, ga, dona, tannarx, chakana, sana }) {
  const summa = r2(dona * tannarx);
  const asos = {
    tovar_id: tovar.id, tovar_nomi: tovar.nomi, turkum: tovar.turkum || null,
    manba_tur: MANBA, manba_id: hujjatId, bloklarda: 0, qutilarda: 0, hajm: 0,
    kirim_narx: tannarx, sotuv_narx: chakana || 0, optom_narx: 0, chakana_narx: 0, sana,
  };
  return [
    { ...asos, ombor: dan, tur: 'chiqim', donada: -dona, summa: -summa },
    { ...asos, ombor: ga, tur: 'kirim', donada: dona, summa },
  ];
}

async function auditYoz(kochirishId, amal, { eski = null, yangi = null, sabab = null, user = null }, transaction) {
  await AgentKochirishAuditModel.create({
    kochirish_id: kochirishId, amal,
    eski: eski ? JSON.stringify(eski) : null, yangi: yangi ? JSON.stringify(yangi) : null,
    sabab: sabab ? String(sabab).slice(0, 500) : null,
    user_id: user ? user.id || null : null, user_nomi: userNomi(user), vaqt: new Date(),
  }, { transaction });
}

async function raqamOl(t) {
  const tartib = await keyingiTartib(PREFIKS, () => maksRaqam('agent_kochirish', PREFIKS, t), t);
  return `${PREFIKS}-${String(tartib).padStart(6, '0')}`;
}

const qatorJson = q => ({ tovar_id: Number(q.tovar_id), tovar_nomi: q.tovar_nomi, dona: r3(q.dona) });

/* ── O'qish ───────────────────────────────────────────── */

const ITEM_SQL = `
  SELECT k.*, COALESCE(x.soni, 0) tovar_soni, COALESCE(x.dona, 0) jami_dona, COALESCE(x.summa, 0) jami_summa,
         EXISTS (SELECT 1 FROM agent_kochirish_audit a WHERE a.kochirish_id = k.id AND a.amal = 'tahrirlandi') tahrirlangan
  FROM agent_kochirish k
  LEFT JOIN (SELECT kochirish_id, COUNT(*) soni, SUM(dona) dona, SUM(summa) summa
             FROM agent_kochirish_qator GROUP BY kochirish_id) x ON x.kochirish_id = k.id`;

const itemJson = k => ({
  id: k.id, raqam: k.raqam, sana: k.sana,
  dan_agent: { id: k.dan_agent_id, nomi: k.dan_agent_nomi },
  ga_agent: { id: k.ga_agent_id, nomi: k.ga_agent_nomi },
  tovar_soni: Number(k.tovar_soni) || 0, jami_dona: r3(k.jami_dona), jami_summa: r2(k.jami_summa),
  izoh: k.izoh || null, sabab: k.sabab || null, holat: k.holat, user_nomi: k.user_nomi || null,
  createdAt: k.createdAt, tahrirlangan: !!Number(k.tahrirlangan),
});

async function bitta(id) {
  const [k] = await sequelize.query(`${ITEM_SQL} WHERE k.id = :id`, { replacements: { id }, type: SELECT });
  if (!k) throw new HttpException(404, "Ko'chirish hujjati topilmadi");
  const [qatorlar, audit] = await Promise.all([
    AgentKochirishQatorModel.findAll({ where: { kochirish_id: id }, order: [['tovar_nomi', 'ASC'], ['id', 'ASC']] }),
    AgentKochirishAuditModel.findAll({ where: { kochirish_id: id }, order: [['id', 'ASC']], raw: true }),
  ]);
  const json = s => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  return {
    ...itemJson(k),
    qatorlar: qatorlar.map(q => ({ id: q.id, tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, dona: r3(q.dona), tannarx: r2(q.tannarx), summa: r2(q.summa) })),
    audit: audit.map(a => ({ amal: a.amal, eski: json(a.eski), yangi: json(a.yangi), sabab: a.sabab || null, user_nomi: a.user_nomi || null, vaqt: a.vaqt })),
  };
}

async function royxat(q = {}) {
  const w = ['1=1'], R = {};
  const dan = kunParam(q.dan, 'dan'), gacha = kunParam(q.gacha, 'gacha');
  if (dan && gacha && dan > gacha) throw new HttpException(400, "dan gacha'dan katta bo'lmasligi kerak");
  if (dan) { w.push('k.sana >= :dan'); R.dan = kunBoshi(dan); }
  if (gacha) { w.push('k.sana <= :gacha'); R.gacha = kunOxiri(gacha); }
  const bor = v => v !== undefined && v !== null && v !== '';
  if (bor(q.agent_id)) { w.push('(k.dan_agent_id = :agent OR k.ga_agent_id = :agent)'); R.agent = idOl(q.agent_id, 'agent_id'); }
  if (bor(q.dan_agent_id)) { w.push('k.dan_agent_id = :danAgent'); R.danAgent = idOl(q.dan_agent_id, 'dan_agent_id'); }
  if (bor(q.ga_agent_id)) { w.push('k.ga_agent_id = :gaAgent'); R.gaAgent = idOl(q.ga_agent_id, 'ga_agent_id'); }
  if (bor(q.holat)) {
    if (!['faol', 'bekor'].includes(q.holat)) throw new HttpException(400, "holat faqat 'faol' yoki 'bekor'");
    w.push('k.holat = :holat'); R.holat = q.holat;
  }
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const shart = w.join(' AND ');
  const [rows, [j]] = await Promise.all([
    sequelize.query(`${ITEM_SQL} WHERE ${shart} ORDER BY k.sana DESC, k.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { ...R, limit, offset: (page - 1) * limit }, type: SELECT }),
    // jami: soni — filtrga tushgan hamma hujjat; dona/summa — faqat faol (bekor qilingani ombor harakati emas)
    sequelize.query(`SELECT COUNT(*) soni,
        COALESCE(SUM(CASE WHEN k.holat = 'faol' THEN x.dona END), 0) jami_dona,
        COALESCE(SUM(CASE WHEN k.holat = 'faol' THEN x.summa END), 0) jami_summa
      FROM agent_kochirish k
      LEFT JOIN (SELECT kochirish_id, SUM(dona) dona, SUM(summa) summa FROM agent_kochirish_qator GROUP BY kochirish_id) x
        ON x.kochirish_id = k.id
      WHERE ${shart}`, { replacements: R, type: SELECT }),
  ]);
  return {
    data: rows.map(itemJson),
    jami: { soni: Number(j.soni) || 0, jami_dona: r3(j.jami_dona), jami_summa: r2(j.jami_summa) },
    page, limit,
  };
}

/** Forma uchun: agentning sotiladigan omboridagi mavjud qoldiq [{ tovar_id, nomi, turkum, dona, tannarx }] */
async function agentQoldiq(agentId) {
  const agent = await AgentModel.findByPk(idOl(agentId, 'agent_id'));
  if (!agent) throw new HttpException(404, 'Agent topilmadi');
  const m = await mavjudQoldiq({ ombor: agentOmbori(agent.fullname) });
  const ids = [...m.entries()].filter(([, x]) => x.mavjud > EPS).map(([id]) => id);
  if (!ids.length) return [];
  const [tovarlar, narx] = await Promise.all([
    TovarModel.findAll({ where: { id: ids, turi: 'tovar' }, attributes: ['id', 'nomi', 'turkum'], raw: true }),
    tannarxXaritasi(new Date()),
  ]);
  return tovarlar.map(t => ({
    tovar_id: t.id, nomi: t.nomi, turkum: t.turkum || null, dona: r3(m.get(Number(t.id)).mavjud), tannarx: r2(narx[t.id] || 0),
  })).sort((a, b) => String(a.nomi).localeCompare(String(b.nomi)));
}

/* ── Yaratish ─────────────────────────────────────────── */

async function takrorJavob(sorovId, b) {
  const bor = await AgentKochirishModel.findOne({ where: { sorov_id: sorovId }, raw: true });
  if (!bor) return null;
  if (Number(bor.dan_agent_id) !== Number(b.dan_agent_id) || Number(bor.ga_agent_id) !== Number(b.ga_agent_id)) {
    throw new HttpException(409, 'Bu sorov_id boshqa hujjatga tegishli');
  }
  return { ...(await bitta(bor.id)), takror: true };
}

/** @returns { status, body } */
async function yarat(b, user) {
  maydonTekshir(b, ['dan_agent_id', 'ga_agent_id', 'qatorlar', 'izoh', 'sabab', 'sorov_id']);
  const sorovId = sorovIdOl(b.sorov_id);
  if (sorovId) { const t = await takrorJavob(sorovId, b); if (t) return { status: 200, body: t }; }
  const danId = idOl(b.dan_agent_id, 'dan_agent_id');
  const gaId = idOl(b.ga_agent_id, 'ga_agent_id');
  if (danId === gaId) throw new HttpException(400, "Yuboruvchi va qabul qiluvchi agent bir xil bo'lmasligi kerak");
  const kerak = qatorlarOl(b.qatorlar);
  const izoh = matnOl(b.izoh, 'izoh'), sabab = matnOl(b.sabab, 'sabab');

  const [dan, ga] = await Promise.all([agentOl(danId, 'dan_agent_id'), agentOl(gaId, 'ga_agent_id')]);
  // Yuboruvchi faol bo'lmasa ham bo'ladi (ishdan ketgan agent omborini bo'shatish), qabul qiluvchi — faqat faol
  if (!ga.faol) throw new HttpException(400, `${ga.fullname} faol emas — unga tovar ko'chirib bo'lmaydi`);
  const danOmbor = agentOmbori(dan.fullname), gaOmbor = agentOmbori(ga.fullname);
  if (danOmbor === gaOmbor) throw new HttpException(400, `Ikki agentning ombori bir xil nomda ("${danOmbor}") — avval birining ismini o'zgartiring`);

  const ids = [...kerak.keys()];
  const tovarBy = await tovarlarOl(ids);
  turiTekshir(ids, tovarBy);
  const nomBy = new Map([...tovarBy].map(([id, t]) => [id, t.nomi]));
  const narx = await tannarxXaritasi(new Date());

  let id;
  try {
    id = await sequelize.transaction(async (t) => {
      // Qoldiq o'qilishidan OLDIN tovar qatorlari qulflanadi (REPEATABLE READ snapshot qulfdan keyin)
      await tovarlarniQulfla(ids, t);
      await yetarliTekshir(kerak, danOmbor, dan.fullname, nomBy, t);
      const chakana = await chakanaMap(ids, t);
      const sana = new Date();
      const hujjat = await AgentKochirishModel.create({
        raqam: await raqamOl(t), dan_agent_id: dan.id, dan_agent_nomi: dan.fullname, ga_agent_id: ga.id, ga_agent_nomi: ga.fullname,
        sana, izoh, sabab, holat: 'faol', sorov_id: sorovId, user_id: user ? user.id || null : null, user_nomi: userNomi(user),
      }, { transaction: t });
      const qatorlar = ids.map(tid => {
        const tannarx = r2(narx[tid] || 0), dona = kerak.get(tid);
        return { kochirish_id: hujjat.id, tovar_id: tid, tovar_nomi: tovarBy.get(tid).nomi, dona, tannarx, summa: r2(dona * tannarx) };
      });
      await AgentKochirishQatorModel.bulkCreate(qatorlar, { transaction: t });
      const reg = [];
      for (const q of qatorlar) {
        reg.push(...harakat({ hujjatId: hujjat.id, tovar: tovarBy.get(q.tovar_id), dan: danOmbor, ga: gaOmbor, dona: q.dona, tannarx: q.tannarx, chakana: chakana[q.tovar_id], sana }));
      }
      await TovarRegisterModel.bulkCreate(reg, { transaction: t });
      await auditYoz(hujjat.id, 'yaratildi', {
        yangi: { dan_agent: { id: dan.id, nomi: dan.fullname }, ga_agent: { id: ga.id, nomi: ga.fullname }, qatorlar: qatorlar.map(qatorJson), izoh, sabab },
        user,
      }, t);
      return hujjat.id;
    });
  } catch (e) {
    // Parallel takror (bir xil sorov_id) — UNIQUE indeks ushladi
    if (sorovId && e && (e.name === 'SequelizeUniqueConstraintError' || (e.parent && e.parent.code === 'ER_DUP_ENTRY'))) {
      const t = await takrorJavob(sorovId, b);
      if (t) return { status: 200, body: t };
    }
    throw e;
  }
  return { status: 201, body: await bitta(id) };
}

/* ── Tahrirlash (delta) ───────────────────────────────── */

async function hujjatAgentlari(k, t) {
  const [dan, ga] = await Promise.all([
    AgentModel.findByPk(k.dan_agent_id, { paranoid: false, transaction: t }),
    AgentModel.findByPk(k.ga_agent_id, { paranoid: false, transaction: t }),
  ]);
  if (!dan || !ga) throw new HttpException(400, 'Hujjat agenti topilmadi');
  return { dan, ga, danOmbor: agentOmbori(dan.fullname), gaOmbor: agentOmbori(ga.fullname) };
}

async function tahrirla(idRaw, b, user) {
  const id = idOl(idRaw, 'id');
  maydonTekshir(b, ['qatorlar', 'izoh', 'sabab', 'tahrir_sababi']);
  const yangiQ = b.qatorlar !== undefined ? qatorlarOl(b.qatorlar) : null;
  const izohBor = Object.hasOwn(b, 'izoh'), sababBor = Object.hasOwn(b, 'sabab');
  const izoh = izohBor ? matnOl(b.izoh, 'izoh') : null;
  const sabab = sababBor ? matnOl(b.sabab, 'sabab') : null;
  const tahrirSababi = matnOl(b.tahrir_sababi, 'tahrir_sababi');
  if (!yangiQ && !izohBor && !sababBor) throw new HttpException(400, "O'zgartirish uchun qatorlar, izoh yoki sabab yuboring");

  const oldin = await AgentKochirishModel.findByPk(id, { raw: true });
  if (!oldin) throw new HttpException(404, "Ko'chirish hujjati topilmadi");
  const yangiIds = yangiQ ? [...yangiQ.keys()] : [];
  const tovarBy = await tovarlarOl(yangiIds);
  const narx = yangiQ ? await tannarxXaritasi(new Date()) : {};

  await sequelize.transaction(async (t) => {
    const k = await qulflabOl(AgentKochirishModel, id, t);
    if (!k) throw new HttpException(404, "Ko'chirish hujjati topilmadi");
    if (k.holat !== 'faol') throw new HttpException(400, "Bekor qilingan ko'chirishni tahrirlab bo'lmaydi");
    const eskiQ = await AgentKochirishQatorModel.findAll({ where: { kochirish_id: id }, transaction: t, lock: t.LOCK.UPDATE });
    const eskiBy = new Map(eskiQ.map(q => [Number(q.tovar_id), q]));
    const ids = [...new Set([...eskiBy.keys(), ...yangiIds])];
    if (yangiQ) await tovarlarniQulfla(ids, t);

    const oshdi = new Map(), kamaydi = new Map();
    if (yangiQ) {
      for (const tid of ids) {
        const d = r3((yangiQ.get(tid) || 0) - (eskiBy.has(tid) ? eskiBy.get(tid).dona : 0));
        if (d > EPS) oshdi.set(tid, d);
        else if (d < -EPS) kamaydi.set(tid, -d);
      }
    }
    const izohOzgardi = izohBor && izoh !== (k.izoh || null);
    const sababOzgardi = sababBor && sabab !== (k.sabab || null);
    const qatorOzgardi = oshdi.size > 0 || kamaydi.size > 0;
    if (!qatorOzgardi && !izohOzgardi && !sababOzgardi) throw new HttpException(400, "Hech narsa o'zgarmadi");

    const eskiJson = eskiQ.map(qatorJson).sort((a, c) => a.tovar_id - c.tovar_id);
    if (qatorOzgardi) {
      turiTekshir([...oshdi.keys()], tovarBy);
      const { dan, ga, danOmbor, gaOmbor } = await hujjatAgentlari(k, t);
      if (oshdi.size && !ga.faol) throw new HttpException(400, `${ga.fullname} faol emas — unga qo'shimcha tovar ko'chirib bo'lmaydi`);
      const nomBy = new Map(ids.map(tid => [tid, eskiBy.has(tid) ? eskiBy.get(tid).tovar_nomi : tovarBy.get(tid).nomi]));
      await yetarliTekshir(oshdi, danOmbor, dan.fullname, nomBy, t);
      await yetarliTekshir(kamaydi, gaOmbor, ga.fullname, nomBy, t, QABUL_IZOH);

      const chakana = await chakanaMap(ids, t);
      const sana = new Date();
      const tovarOf = tid => {
        const tv = tovarBy.get(tid);
        return { id: tid, nomi: eskiBy.has(tid) ? eskiBy.get(tid).tovar_nomi : tv.nomi, turkum: tv ? tv.turkum : null };
      };
      const tannarxOf = tid => (eskiBy.has(tid) ? r2(eskiBy.get(tid).tannarx) : r2(narx[tid] || 0));
      const reg = [];
      for (const [tid, d] of oshdi) reg.push(...harakat({ hujjatId: id, tovar: tovarOf(tid), dan: danOmbor, ga: gaOmbor, dona: d, tannarx: tannarxOf(tid), chakana: chakana[tid], sana }));
      for (const [tid, d] of kamaydi) reg.push(...harakat({ hujjatId: id, tovar: tovarOf(tid), dan: gaOmbor, ga: danOmbor, dona: d, tannarx: tannarxOf(tid), chakana: chakana[tid], sana }));
      await TovarRegisterModel.bulkCreate(reg, { transaction: t });

      for (const tid of ids) {
        const yangi = yangiQ.get(tid) || 0, eski = eskiBy.get(tid);
        if (eski && yangi <= EPS) await eski.destroy({ transaction: t });
        else if (eski && Math.abs(yangi - eski.dona) > EPS) await eski.update({ dona: yangi, summa: r2(yangi * eski.tannarx) }, { transaction: t });
        else if (!eski && yangi > EPS) {
          const tannarx = tannarxOf(tid);
          await AgentKochirishQatorModel.create({ kochirish_id: id, tovar_id: tid, tovar_nomi: tovarBy.get(tid).nomi, dona: yangi, tannarx, summa: r2(yangi * tannarx) }, { transaction: t });
        }
      }
    }

    const eskiIzoh = k.izoh || null, eskiSabab = k.sabab || null;
    const ozg = {};
    if (izohOzgardi) ozg.izoh = izoh;
    if (sababOzgardi) ozg.sabab = sabab;
    if (Object.keys(ozg).length) await k.update(ozg, { transaction: t });
    else { k.changed('updatedAt', true); await k.save({ transaction: t }); }

    const eski = {}, yangi = {};
    if (qatorOzgardi) {
      eski.qatorlar = eskiJson;
      const hozir = await AgentKochirishQatorModel.findAll({ where: { kochirish_id: id }, transaction: t });
      yangi.qatorlar = hozir.map(qatorJson).sort((a, c) => a.tovar_id - c.tovar_id);
    }
    if (izohOzgardi) { eski.izoh = eskiIzoh; yangi.izoh = izoh; }
    if (sababOzgardi) { eski.sabab = eskiSabab; yangi.sabab = sabab; }
    await auditYoz(id, 'tahrirlandi', { eski, yangi, sabab: tahrirSababi, user }, t);
  });
  return bitta(id);
}

/* ── Bekor qilish (teskari harakat) ───────────────────── */

async function bekorQil(idRaw, b, user) {
  const id = idOl(idRaw, 'id');
  maydonTekshir(b, ['sabab']);
  const sabab = matnOl(b.sabab, 'sabab');
  await sequelize.transaction(async (t) => {
    const k = await qulflabOl(AgentKochirishModel, id, t);
    if (!k) throw new HttpException(404, "Ko'chirish hujjati topilmadi");
    if (k.holat === 'bekor') throw new HttpException(400, "Ko'chirish allaqachon bekor qilingan");
    const qatorlar = await AgentKochirishQatorModel.findAll({ where: { kochirish_id: id }, transaction: t, lock: t.LOCK.UPDATE });
    const ids = qatorlar.map(q => Number(q.tovar_id));
    await tovarlarniQulfla(ids, t);
    const { ga, danOmbor, gaOmbor } = await hujjatAgentlari(k, t);
    const kerak = new Map(qatorlar.map(q => [Number(q.tovar_id), r3(q.dona)]));
    const nomBy = new Map(qatorlar.map(q => [Number(q.tovar_id), q.tovar_nomi]));
    await yetarliTekshir(kerak, gaOmbor, ga.fullname, nomBy, t, QABUL_IZOH);
    const [chakana, tovarlar] = await Promise.all([
      chakanaMap(ids, t),
      ids.length ? TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'turkum'], raw: true, paranoid: false, transaction: t }) : [],
    ]);
    const turkum = new Map(tovarlar.map(x => [Number(x.id), x.turkum]));
    const sana = new Date();
    const reg = [];
    for (const q of qatorlar) {
      const tid = Number(q.tovar_id);
      reg.push(...harakat({ hujjatId: id, tovar: { id: tid, nomi: q.tovar_nomi, turkum: turkum.get(tid) }, dan: gaOmbor, ga: danOmbor, dona: r3(q.dona), tannarx: r2(q.tannarx), chakana: chakana[tid], sana }));
    }
    if (reg.length) await TovarRegisterModel.bulkCreate(reg, { transaction: t });
    await k.update({ holat: 'bekor', bekor_user_id: user ? user.id || null : null, bekor_vaqt: sana, bekor_sababi: sabab }, { transaction: t });
    await auditYoz(id, 'bekor_qilindi', { eski: { holat: 'faol' }, yangi: { holat: 'bekor' }, sabab, user }, t);
  });
  return bitta(id);
}

/* ── Mobil: agentning oxirgi 30 kundagi ko'chirishlari (ikki yo'nalish) ── */
async function agentKochirishlari(agentId, kun = 30) {
  const dan = new Date(Date.now() - kun * 86400000);
  const rows = await sequelize.query(`${ITEM_SQL}
    WHERE (k.dan_agent_id = :a OR k.ga_agent_id = :a) AND k.sana >= :dan
    ORDER BY k.sana DESC, k.id DESC LIMIT 300`, { replacements: { a: agentId, dan }, type: SELECT });
  if (!rows.length) return [];
  const qatorlar = await AgentKochirishQatorModel.findAll({
    where: { kochirish_id: { [Op.in]: rows.map(r => r.id) } }, order: [['tovar_nomi', 'ASC'], ['id', 'ASC']],
  });
  const qBy = new Map();
  qatorlar.forEach(q => { if (!qBy.has(q.kochirish_id)) qBy.set(q.kochirish_id, []); qBy.get(q.kochirish_id).push(q); });
  return rows.map(k => {
    const kirim = Number(k.ga_agent_id) === Number(agentId);
    return {
      id: k.id, raqam: k.raqam, sana: k.sana, yonalish: kirim ? 'kirim' : 'chiqim',
      boshqaAgent: kirim ? { id: k.dan_agent_id, ism: k.dan_agent_nomi } : { id: k.ga_agent_id, ism: k.ga_agent_nomi },
      qatorlar: (qBy.get(k.id) || []).map(q => ({ tovarId: String(q.tovar_id), nomi: q.tovar_nomi, dona: r3(q.dona) })),
      izoh: k.izoh || null, sabab: k.sabab || null, holat: k.holat, tahrirlangan: !!Number(k.tahrirlangan),
    };
  });
}

module.exports = { MANBA_AGENT_KOCHIRISH: MANBA, yarat, tahrirla, bekorQil, bitta, royxat, agentQoldiq, agentKochirishlari };
