/**
 * DILLERLAR (2026-11-29) — hamkor, mobil ilovada agent kabi ishlaydi, lekin O'ZI UCHUN.
 *
 *  • Diller = agent yozuvi, agent.diller = true. Ombori "Diller: <ism>" (+ " (brak)") — kompaniya zaxirasi EMAS
 *    (tovar_register defaultScope, xom SQL'da DILLER_OMBOR_EMAS).
 *  • Kompaniya → diller: web "berish" = kompaniya SOTUVI. Asosiy ombordan chiqadi (register 'sotuv', manba_id = ariza),
 *    hisobotlar uchun ariza yaratiladi (turi='sotish', kanal='diller', mijoz_id NULL, mijoz_nomi "Diller: <ism>"),
 *    diller omboriga kiradi ('diller_berish'). To'langan qismi — kompaniya kassasiga kirim (kategoriya 'diller_tolov').
 *  • Diller qarzi = Σ berish (jami − tolangan) − Σ tolov − Σ qaytarish (diller_hujjat'dan). To'lov web'da, kassaga.
 *  • Dillerdan qaytarish: asosiy omborga 'qaytarma_kirim', qarz dillerning shu tovar bo'yicha OXIRGI berish narxida kamayadi.
 *  • Dillerning o'z sotuvi: ariza turi='diller_sotuv' (kompaniya hisobotlari turi='sotish' ni oladi), kassa/agent_register/
 *    plastik navbati/reyting YO'Q; puli diller_pul daftarida; mijozlari (mijoz.agent_id = diller) qarzi mijoz.balans'da,
 *    kompaniya debitorligidan DILLER_MIJOZ_EMAS bilan chiqariladi.
 *  • Hujjatlar tahrirlanmaydi — tuzatish teskari hujjat bilan.
 */
const { Op } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const HttpException = require('./HttpException.utils');
const AgentModel = require('../models/agent.model');
const TovarModel = require('../models/tovar.model');
const TerritoriyaModel = require('../models/territoriya.model');
const TovarRegisterModel = require('../models/tovar_register.model');
const KassaModel = require('../models/kassa.model');
const { MijozModel } = require('../models/mijoz.model');
const { ArizaModel, ArizaQatorModel } = require('../models/ariza.model');
const { DillerHujjatModel, DillerHujjatQatorModel, DillerNarxModel, DillerPulModel } = require('../models/diller.model');
const { ASOSIY_OMBOR, dillerOmbori, dillerBrakOmbori } = require('./ombor.utils');
const { mavjudQoldiq } = require('./zaxira.utils');
const { qulflabOl, tovarlarniQulfla, keyingiTartib, maksRaqam } = require('./qulf.utils');
const { kunParam, kunBoshi, kunOxiri } = require('./sana.utils');
const { generateRaqam } = require('./arizaRaqam.utils');
const { kassaQulfla, kassaUsul } = require('./agentPul.utils');
const { turkumToldir } = require('./turkum.utils');

const SELECT = sequelize.QueryTypes.SELECT;
const EPS = 0.0005;
const n = v => parseFloat(v) || 0;
const r2 = v => Math.round(n(v) * 100) / 100;
const r3 = v => Math.round(n(v) * 1000) / 1000;
const userNomi = u => (u ? (u.fullname || u.username || `user#${u.id}`) : null);
const PREFIKS = 'DL';
const MAX_NARX = 1e12;

/* ── Kompaniya hisobotlari uchun SQL bo'laklari ───────── */
/** Diller omborlari kompaniya zaxirasi emas (xom SQL) */
const DILLER_OMBOR_EMAS = (ustun = 'ombor') => `(${ustun} IS NULL OR ${ustun} NOT LIKE 'Diller: %')`;
/** Diller mijozlari (va qarzi) kompaniya debitorligi emas */
const DILLER_MIJOZ_EMAS = (alias = 'm') => `(${alias}.agent_id IS NULL OR ${alias}.agent_id NOT IN (SELECT id FROM agent WHERE diller = 1))`;
/** Sequelize where: mijoz diller mijozi emas */
const dillerMijozEmasWhere = () => ({ [Op.or]: [{ agent_id: null }, { agent_id: { [Op.notIn]: sequelize.literal('(SELECT id FROM agent WHERE diller = 1)') } }] });

/* ── Kiruvchi ma'lumot ────────────────────────────────── */
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
function sonOl(v, nom, { min = 0, max = MAX_NARX, bosh = undefined } = {}) {
  if ((v === undefined || v === null || v === '') && bosh !== undefined) return bosh;
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : v;
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new HttpException(400, `${nom} son bo'lishi kerak`);
  if (x < min) throw new HttpException(400, `${nom} ${min} dan kichik bo'lmasin`);
  if (x > max) throw new HttpException(400, `${nom} juda katta`);
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
/** qatorlar: [{ tovar_id, dona, narx? }] → [{ tovar_id, dona, narx|null }] (bir tovar bir narxda bir qatorga qo'shiladi) */
function qatorlarOl(v, { narxBor = false } = {}) {
  if (!Array.isArray(v) || !v.length) throw new HttpException(400, 'qatorlar: kamida bitta tovar kerak');
  if (v.length > 500) throw new HttpException(400, "qatorlar: ko'pi bilan 500 ta");
  const ruxsat = narxBor ? ['tovar_id', 'dona', 'narx'] : ['tovar_id', 'dona'];
  const map = new Map();
  v.forEach((q, i) => {
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new HttpException(400, `qatorlar[${i}] obyekt bo'lishi kerak`);
    const ort = Object.keys(q).filter(k => !ruxsat.includes(k));
    if (ort.length) throw new HttpException(400, `qatorlar[${i}]: noma'lum maydon: ${ort.join(', ')}`);
    const id = idOl(q.tovar_id, `qatorlar[${i}].tovar_id`);
    const dona = r3(sonOl(q.dona, `qatorlar[${i}].dona`, { max: 1e9 }));
    if (dona <= 0) throw new HttpException(400, `qatorlar[${i}].dona noldan katta bo'lishi kerak`);
    const narx = narxBor && q.narx !== undefined && q.narx !== null && q.narx !== '' ? r2(sonOl(q.narx, `qatorlar[${i}].narx`)) : null;
    const kalit = `${id}|${narx === null ? '' : narx}`;
    const x = map.get(kalit) || { tovar_id: id, dona: 0, narx };
    x.dona = r3(x.dona + dona);
    map.set(kalit, x);
  });
  return [...map.values()];
}

/* ── Diller, qarz, ombor ──────────────────────────────── */
async function dillerOl(id, { transaction = null, lock = false, paranoid = true } = {}) {
  const did = idOl(id, 'id');
  const d = lock && transaction
    ? await qulflabOl(AgentModel, did, transaction, { paranoid })
    : await AgentModel.findByPk(did, { paranoid, ...(transaction ? { transaction } : {}) });
  if (!d || !d.diller) throw new HttpException(404, 'Diller topilmadi');
  return d;
}

/** Diller qarzlari: Map(id → qarz) */
async function dillerQarzlari(ids, transaction = null) {
  const list = [...new Set((ids || []).map(Number).filter(x => x > 0))];
  const out = new Map(list.map(id => [id, 0]));
  if (!list.length) return out;
  const rows = await sequelize.query(`
    SELECT diller_id, COALESCE(SUM(CASE WHEN tur = 'berish' THEN jami - tolangan ELSE -jami END), 0) q
    FROM diller_hujjat WHERE diller_id IN (:ids) GROUP BY diller_id`, { replacements: { ids: list }, type: SELECT, transaction });
  rows.forEach(r => out.set(Number(r.diller_id), r2(r.q)));
  return out;
}
const dillerQarz = async (id, t = null) => (await dillerQarzlari([id], t)).get(Number(id)) || 0;

/** Ombordagi qoldiq (xom SQL — defaultScope chetlab o'tiladi): Map(tovar_id → { dona, nomi }) */
async function omborQoldiq(ombor, transaction = null, tovarIds = null) {
  const rows = await sequelize.query(`
    SELECT tovar_id, SUM(donada) q, MAX(tovar_nomi) nomi FROM tovar_register
    WHERE ombor = :ombor ${tovarIds ? 'AND tovar_id IN (:ids)' : ''} GROUP BY tovar_id`,
  { replacements: { ombor, ids: tovarIds }, type: SELECT, transaction });
  return new Map(rows.map(r => [Number(r.tovar_id), { dona: r3(r.q), nomi: r.nomi }]));
}

/** Dillerning har tovar bo'yicha OXIRGI berish narxi (qaytarish narxi qoidasi, ombor qiymati) */
async function oxirgiNarxlar(dillerId, transaction = null) {
  const rows = await sequelize.query(`
    SELECT q.tovar_id, q.narx FROM diller_hujjat_qator q JOIN diller_hujjat h ON h.id = q.hujjat_id
    WHERE h.diller_id = :d AND h.tur = 'berish' ORDER BY h.sana DESC, h.id DESC, q.id DESC`,
  { replacements: { d: dillerId }, type: SELECT, transaction });
  const m = new Map();
  rows.forEach(r => { if (!m.has(Number(r.tovar_id))) m.set(Number(r.tovar_id), r2(r.narx)); });
  return m;
}

async function dillerOmbor(diller, transaction = null) {
  const [q, narx] = await Promise.all([omborQoldiq(dillerOmbori(diller.fullname), transaction), oxirgiNarxlar(diller.id, transaction)]);
  const ids = [...q.entries()].filter(([, x]) => x.dona > EPS).map(([id]) => id);
  const tovarlar = ids.length ? await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'nomi'], raw: true, paranoid: false }) : [];
  const nom = new Map(tovarlar.map(t => [Number(t.id), t.nomi]));
  return ids.map(id => ({ tovar_id: id, nomi: nom.get(id) || q.get(id).nomi, dona: q.get(id).dona, narx: narx.get(id) || 0 }))
    .sort((a, b) => String(a.nomi).localeCompare(String(b.nomi)));
}

/* ── Agent bayrog'i qoidalari (agent.controller) ──────── */
/** diller bayrog'i o'zgarishi. agent — mavjud (null — yangi), body — sanitize qilingan */
async function bayroqTekshir(agent, body, transaction) {
  const eski = !!(agent && agent.diller);
  const yangi = body.diller === undefined || body.diller === null ? eski : !!body.diller;
  if (body.diller !== undefined) body.diller = yangi;
  const superYangi = body.super_agent === undefined || body.super_agent === null ? !!(agent && agent.super_agent) : !!body.super_agent;
  const supIdYangi = body.super_agent_id === undefined ? (agent ? agent.super_agent_id : null) : body.super_agent_id;
  if (yangi) {
    if (superYangi) throw new HttpException(400, "Diller super agent bo'la olmaydi — avval \"Super agent\" belgisini olib tashlang");
    if (supIdYangi) throw new HttpException(400, "Dillerni super agentga biriktirib bo'lmaydi — avval super agent biriktirishini olib tashlang (super_agent_id: null)");
  }
  if (!agent || eski === yangi) return;
  const nom = agent.fullname;
  if (yangi) {
    // Agent → diller: agentlik izlari tozalangan bo'lishi kerak (ombor, naqd majburiyati, kutilayotgan to'lovlar, bo'ysunuvchilar)
    const [[o]] = await sequelize.query(`SELECT COALESCE(SUM(ABS(x.q)), 0) q FROM (SELECT SUM(donada) q FROM tovar_register
        WHERE ombor IN (:o) GROUP BY ombor, tovar_id) x`, { replacements: { o: [`Agent: ${nom}`.slice(0, 80), `Agent: ${nom}`.slice(0, 73) + ' (brak)'] }, transaction });
    if (n(o.q) > EPS) throw new HttpException(400, `"Agent: ${nom}" omborida tovar bor — dillerga o'tkazishdan oldin uni asosiy omborga qaytaring (Won Sell → Qabul)`);
    const { majburiyat } = require('./agentPul.utils');
    const m = await majburiyat(agent.id, transaction);
    if (Math.abs(m.qolda) > 0.005) throw new HttpException(400, `${nom}ning qo'lida ${m.qolda} so'm naqd majburiyati bor — avval topshiruv bilan yoping`);
    if (m.kutilmoqda_topshiruv > 0.005 || m.kutilmoqda_plastik > 0.005) throw new HttpException(400, `${nom}ning tasdiq kutilayotgan topshiruv/plastik to'lovlari bor — avval tasdiqlang yoki rad eting`);
    const soni = await AgentModel.count({ where: { super_agent_id: agent.id }, transaction });
    if (soni) throw new HttpException(400, `${nom}ga ${soni} ta agent biriktirilgan — avval ularni boshqa super agentga o'tkazing`);
    const qarzdor = await MijozModel.count({ where: { agent_id: agent.id, balans: { [Op.lt]: -0.5 } }, transaction });
    if (qarzdor) throw new HttpException(400, `${nom}ga biriktirilgan ${qarzdor} ta mijozning kompaniyaga qarzi bor — avval mijozlarni boshqa agentga o'tkazing yoki qarzni yoping`);
  } else {
    // Diller → agent: diller ombori bo'sh va qarzi 0 bo'lishi kerak
    const [[o]] = await sequelize.query(`SELECT COALESCE(SUM(ABS(x.q)), 0) q FROM (SELECT SUM(donada) q FROM tovar_register
        WHERE ombor IN (:o) GROUP BY ombor, tovar_id) x`, { replacements: { o: [dillerOmbori(nom), dillerBrakOmbori(nom)] }, transaction });
    if (n(o.q) > EPS) throw new HttpException(400, `"${dillerOmbori(nom)}" omborida tovar bor — avval dillerdan qaytarish bilan bo'shating`);
    const q = await dillerQarz(agent.id, transaction);
    if (Math.abs(q) > 0.005) throw new HttpException(400, `Diller qarzi ${q} — dillerlikni olishdan oldin qarz 0 bo'lishi kerak`);
    const qarzdor = await MijozModel.count({ where: { agent_id: agent.id, balans: { [Op.ne]: 0 } }, transaction });
    if (qarzdor) throw new HttpException(400, `Dillerning ${qarzdor} ta mijozida ochiq hisob (qarz/haq) bor — bu dillerning o'z hisobi; avval yoping yoki mijozlarni boshqa dillerga o'tkazing`);
  }
}

/** Diller ombori bo'shmi (o'chirish / ism o'zgarishi) — jami qoldiq */
async function dillerOmborJami(agent, transaction) {
  const [[o]] = await sequelize.query(`SELECT COALESCE(SUM(GREATEST(x.q, 0)), 0) q FROM (SELECT SUM(donada) q FROM tovar_register
      WHERE ombor IN (:o) GROUP BY ombor, tovar_id) x`, { replacements: { o: [dillerOmbori(agent.fullname), dillerBrakOmbori(agent.fullname)] }, transaction });
  return n(o.q);
}

/* ── Hujjat shakli ────────────────────────────────────── */
const hujjatJson = (h, kassaNomi = null) => ({
  id: h.id, raqam: h.raqam, tur: h.tur, sana: h.sana, jami: r2(h.jami), tolangan: r2(h.tolangan),
  kassa_id: h.kassa_id || null, kassa_nomi: kassaNomi, ariza_id: h.ariza_id || null,
  izoh: h.izoh || null, user_nomi: h.user_nomi || null,
  diller: { id: h.diller_id, nomi: h.diller_nomi },
});
async function kassaNomlari(ids) {
  const list = [...new Set(ids.filter(Boolean).map(Number))];
  if (!list.length) return new Map();
  const rows = await sequelize.query('SELECT id, nomi FROM kassalar WHERE id IN (:ids)', { replacements: { ids: list }, type: SELECT });
  return new Map(rows.map(r => [Number(r.id), r.nomi]));
}
async function hujjatBitta(hid) {
  const h = await DillerHujjatModel.findByPk(idOl(hid, 'id'), { include: [{ model: DillerHujjatQatorModel, as: 'qatorlar' }] });
  if (!h) throw new HttpException(404, 'Diller hujjati topilmadi');
  const kn = await kassaNomlari([h.kassa_id]);
  return {
    ...hujjatJson(h, kn.get(Number(h.kassa_id)) || null),
    qatorlar: (h.qatorlar || []).sort((a, b) => a.id - b.id)
      .map(q => ({ id: q.id, tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, dona: r3(q.dona), narx: r2(q.narx), summa: r2(q.summa) })),
  };
}

async function raqamOl(t) {
  const tartib = await keyingiTartib(PREFIKS, () => maksRaqam('diller_hujjat', PREFIKS, t), t);
  return `${PREFIKS}-${String(tartib).padStart(6, '0')}`;
}

/* sorov_id takrori: shu kalit bilan hujjat bor — mazmuni mos bo'lsa 200 takror, aks holda 409 */
async function takrorTekshir(sorovId, { dillerId, tur, imzo }) {
  const bor = await DillerHujjatModel.findOne({ where: { sorov_id: sorovId }, include: [{ model: DillerHujjatQatorModel, as: 'qatorlar' }] });
  if (!bor) return null;
  if (Number(bor.diller_id) !== Number(dillerId) || bor.tur !== tur || !imzo(bor)) throw new HttpException(409, 'Bu sorov_id boshqa hujjatga tegishli');
  return { ...(await hujjatBitta(bor.id)), takror: true };
}
const qatorImzo = (list) => list.map(q => `${q.tovar_id}:${r3(q.dona)}`).sort().join(',');
const borQatorlari = (h) => {
  const m = new Map();
  (h.qatorlar || []).forEach(q => m.set(Number(q.tovar_id), r3((m.get(Number(q.tovar_id)) || 0) + n(q.dona))));
  return [...m].map(([tovar_id, dona]) => ({ tovar_id, dona }));
};
const yigQator = (list) => {
  const m = new Map();
  list.forEach(q => m.set(q.tovar_id, r3((m.get(q.tovar_id) || 0) + q.dona)));
  return [...m].map(([tovar_id, dona]) => ({ tovar_id, dona }));
};
const unikXato = e => !!e && (e.name === 'SequelizeUniqueConstraintError' || (e.parent && e.parent.code === 'ER_DUP_ENTRY'));

async function idempotent(sorovId, meta, ish) {
  if (sorovId) { const t = await takrorTekshir(sorovId, meta); if (t) return { status: 200, body: t }; }
  try {
    const id = await ish();
    return { status: 201, body: await hujjatBitta(id) };
  } catch (e) {
    if (sorovId && unikXato(e)) { const t = await takrorTekshir(sorovId, meta); if (t) return { status: 200, body: t }; }
    throw e;
  }
}

async function tovarlarOl(ids) {
  const rows = await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'nomi', 'turkum', 'turi', 'diller_narx'] });
  const by = new Map(rows.map(t => [Number(t.id), t]));
  for (const id of ids) if (!by.has(Number(id))) throw new HttpException(400, `Tovar topilmadi: #${id}`);
  return by;
}

/** Kassaga kirim (berishdagi to'lov yoki diller to'lovi) */
async function kassaKirim({ kassa, summa, hujjat, diller, user, t }) {
  return KassaModel.create({
    tur: 'kirim', kategoriya: 'diller_tolov', summa, tolov_usul: kassaUsul(kassa),
    manba_tur: 'diller_hujjat', manba_id: hujjat.id, mijoz_id: null, mijoz_nomi: `Diller: ${diller.fullname}`.slice(0, 150),
    izoh: `${hujjat.raqam} — ${hujjat.tur === 'berish' ? 'dillerga berish, to\'lov' : 'diller to\'lovi'}`.slice(0, 255),
    sana: hujjat.sana, user_id: user ? user.id || null : null, kassa_id: kassa.id, agent_id: null,
  }, { transaction: t });
}

/* ── POST /dillerlar/:id/berish ───────────────────────── */
async function berish(dillerIdRaw, b, user) {
  maydonTekshir(b, ['qatorlar', 'tolangan', 'kassa_id', 'izoh', 'sorov_id']);
  const sorovId = sorovIdOl(b.sorov_id);
  const dillerId = idOl(dillerIdRaw, 'id');
  const qatorlar = qatorlarOl(b.qatorlar, { narxBor: true });
  const tolanganRaw = sonOl(b.tolangan, 'tolangan', { bosh: 0 });
  const izoh = matnOl(b.izoh, 'izoh');
  const imzo = h => qatorImzo(borQatorlari(h)) === qatorImzo(yigQator(qatorlar)) && Math.abs(r2(h.tolangan) - r2(tolanganRaw)) < 0.005
    && (r2(tolanganRaw) > 0 ? Number(h.kassa_id) === Number(b.kassa_id) : true);
  return idempotent(sorovId, { dillerId, tur: 'berish', imzo }, async () => {
    const diller = await dillerOl(dillerId);
    if (!diller.faol) throw new HttpException(400, `${diller.fullname} faol emas — unga tovar berib bo'lmaydi`);
    const ids = [...new Set(qatorlar.map(q => q.tovar_id))];
    const tovarBy = await tovarlarOl(ids);
    const tayyor = qatorlar.map(q => {
      const t = tovarBy.get(q.tovar_id);
      if (t.turi !== 'tovar') throw new HttpException(400, `"${t.nomi}" — savdo tovari emas (xom ashyo)`);
      const narx = q.narx !== null ? q.narx : (t.diller_narx !== null && t.diller_narx !== undefined ? r2(t.diller_narx) : null);
      if (narx === null) throw new HttpException(400, `"${t.nomi}": diller narxi belgilanmagan — tovar kartasida diller narxini qo'ying yoki qatorda narx kiriting`);
      return { tovar_id: q.tovar_id, tovar_nomi: t.nomi, turkum: t.turkum || null, dona: q.dona, narx, summa: r2(q.dona * narx) };
    });
    const jami = r2(tayyor.reduce((s, q) => s + q.summa, 0));
    const tolangan = r2(tolanganRaw);
    if (tolangan > jami + 0.005) throw new HttpException(400, `tolangan (${tolangan}) hujjat jamisidan (${jami}) oshmasin`);
    if (tolangan > 0 && (b.kassa_id === undefined || b.kassa_id === null || b.kassa_id === '')) throw new HttpException(400, "To'lov kiritilgan — kassa_id majburiy");
    return sequelize.transaction(async (t) => {
      await tovarlarniQulfla(ids, t);
      const kassa = tolangan > 0 ? await kassaQulfla(b.kassa_id, t) : null;
      const m = await mavjudQoldiq({ tovarIds: ids, ombor: ASOSIY_OMBOR, transaction: t });
      const kerak = new Map();
      tayyor.forEach(q => kerak.set(q.tovar_id, r3((kerak.get(q.tovar_id) || 0) + q.dona)));
      for (const [id, dona] of kerak) {
        const bor = (m.get(Number(id)) || { mavjud: 0 }).mavjud;
        if (dona > bor + EPS) throw new HttpException(400, `"${tovarBy.get(id).nomi}": asosiy omborda yetarli emas (mavjud ${r3(bor)})`);
      }
      const sana = new Date();
      const raqam = await raqamOl(t);
      const dOmbor = dillerOmbori(diller.fullname);
      // Kompaniya sotuvi hisobotlari uchun ariza (dillerga sotuv): darhol yetkazildi, mijozsiz
      const ariza = await ArizaModel.create({
        turi: 'sotish', raqam: await generateRaqam(t), manba: 'web', kanal: 'diller', holat: 'yetkazildi', ombor: ASOSIY_OMBOR,
        yetkazilgan_sana: sana, jonatish_sana: sana.toISOString().slice(0, 10),
        mijoz_id: null, mijoz_nomi: `Diller: ${diller.fullname}`.slice(0, 150), agent_id: null, agent_nomi: null,
        jami_summa: jami, chegirma_summa: 0,
        tolov_turi: tolangan >= jami - 0.005 && jami > 0 ? (kassa.tur === 'plastik' ? 'plastik' : 'naqt') : 'qarz',
        tolangan_summa: tolangan, izoh: `Dillerga berish ${raqam}${izoh ? ' · ' + izoh : ''}`.slice(0, 2000),
      }, { transaction: t });
      const arizaQ = await turkumToldir(tayyor.map(q => ({ tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum, narx: q.narx, dona: q.dona, jami_dona: q.dona, summa: q.summa })), t);
      await ArizaQatorModel.bulkCreate(arizaQ.map(q => ({ ...q, ariza_id: ariza.id })), { transaction: t });
      const hujjat = await DillerHujjatModel.create({
        raqam, diller_id: diller.id, diller_nomi: diller.fullname, tur: 'berish', sana, jami, tolangan,
        kassa_id: kassa ? kassa.id : null, ariza_id: ariza.id, izoh, sorov_id: sorovId,
        user_id: user ? user.id || null : null, user_nomi: userNomi(user),
      }, { transaction: t });
      await DillerHujjatQatorModel.bulkCreate(tayyor.map(q => ({ hujjat_id: hujjat.id, tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, dona: q.dona, narx: q.narx, summa: q.summa })), { transaction: t });
      const reg = [];
      for (const q of tayyor) {
        const asos = { tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum, bloklarda: 0, qutilarda: 0, hajm: 0, kirim_narx: 0, sotuv_narx: q.narx, sana };
        reg.push({ ...asos, ombor: ASOSIY_OMBOR, tur: 'chiqim', manba_tur: 'sotuv', manba_id: ariza.id, donada: -q.dona, summa: -q.summa });
        reg.push({ ...asos, ombor: dOmbor, tur: 'kirim', manba_tur: 'diller_berish', manba_id: hujjat.id, donada: q.dona, summa: q.summa });
      }
      await TovarRegisterModel.bulkCreate(reg, { transaction: t });
      if (kassa) {
        const k = await kassaKirim({ kassa, summa: tolangan, hujjat, diller, user, t });
        await hujjat.update({ kassa_yozuv_id: k.id }, { transaction: t });
      }
      return hujjat.id;
    });
  });
}

/* ── POST /dillerlar/:id/tolov ────────────────────────── */
async function tolov(dillerIdRaw, b, user) {
  maydonTekshir(b, ['summa', 'kassa_id', 'izoh', 'sorov_id']);
  const sorovId = sorovIdOl(b.sorov_id);
  const dillerId = idOl(dillerIdRaw, 'id');
  const summa = r2(sonOl(b.summa, 'summa'));
  if (!(summa > 0)) throw new HttpException(400, "summa 0 dan katta bo'lishi kerak");
  if (b.kassa_id === undefined || b.kassa_id === null || b.kassa_id === '') throw new HttpException(400, 'Kassani tanlang (kassa_id majburiy)');
  const izoh = matnOl(b.izoh, 'izoh');
  const imzo = h => Math.abs(r2(h.jami) - summa) < 0.005 && Number(h.kassa_id) === Number(b.kassa_id);
  return idempotent(sorovId, { dillerId, tur: 'tolov', imzo }, async () => {
    await dillerOl(dillerId);
    return sequelize.transaction(async (t) => {
      // Diller qatori qulfi — parallel to'lovlar qarzdan oshib ketmasin
      const diller = await dillerOl(dillerId, { transaction: t, lock: true });
      const kassa = await kassaQulfla(b.kassa_id, t);
      const qarz = await dillerQarz(diller.id, t);
      if (summa > qarz + 0.005) throw new HttpException(400, `Diller qarzi ${qarz} — undan ko'p to'lov kiritib bo'lmaydi`);
      const sana = new Date();
      const hujjat = await DillerHujjatModel.create({
        raqam: await raqamOl(t), diller_id: diller.id, diller_nomi: diller.fullname, tur: 'tolov', sana, jami: summa, tolangan: summa,
        kassa_id: kassa.id, izoh, sorov_id: sorovId, user_id: user ? user.id || null : null, user_nomi: userNomi(user),
      }, { transaction: t });
      const k = await kassaKirim({ kassa, summa, hujjat, diller, user, t });
      await hujjat.update({ kassa_yozuv_id: k.id }, { transaction: t });
      return hujjat.id;
    });
  });
}

/* ── POST /dillerlar/:id/qaytarish ────────────────────── */
async function qaytarish(dillerIdRaw, b, user) {
  maydonTekshir(b, ['qatorlar', 'izoh', 'sorov_id']);
  const sorovId = sorovIdOl(b.sorov_id);
  const dillerId = idOl(dillerIdRaw, 'id');
  const qatorlar = yigQator(qatorlarOl(b.qatorlar));
  const izoh = matnOl(b.izoh, 'izoh');
  const imzo = h => qatorImzo(borQatorlari(h)) === qatorImzo(qatorlar);
  return idempotent(sorovId, { dillerId, tur: 'qaytarish', imzo }, async () => {
    await dillerOl(dillerId, { paranoid: false });
    const ids = qatorlar.map(q => q.tovar_id);
    const tovarBy = await tovarlarOl(ids);
    return sequelize.transaction(async (t) => {
      const diller = await dillerOl(dillerId, { transaction: t, lock: true, paranoid: false });
      await tovarlarniQulfla(ids, t);
      const dOmbor = dillerOmbori(diller.fullname);
      const [q, narx] = await Promise.all([omborQoldiq(dOmbor, t, ids), oxirgiNarxlar(diller.id, t)]);
      for (const x of qatorlar) {
        const bor = (q.get(x.tovar_id) || { dona: 0 }).dona;
        if (x.dona > bor + EPS) throw new HttpException(400, `"${tovarBy.get(x.tovar_id).nomi}": diller omborida yetarli emas (mavjud ${r3(bor)})`);
      }
      const tayyor = qatorlar.map(x => {
        const tv = tovarBy.get(x.tovar_id), nx = narx.get(x.tovar_id) || 0;
        return { tovar_id: x.tovar_id, tovar_nomi: tv.nomi, turkum: tv.turkum || null, dona: x.dona, narx: nx, summa: r2(x.dona * nx) };
      });
      const jami = r2(tayyor.reduce((s, x) => s + x.summa, 0));
      const sana = new Date();
      const hujjat = await DillerHujjatModel.create({
        raqam: await raqamOl(t), diller_id: diller.id, diller_nomi: diller.fullname, tur: 'qaytarish', sana, jami, tolangan: 0,
        izoh, sorov_id: sorovId, user_id: user ? user.id || null : null, user_nomi: userNomi(user),
      }, { transaction: t });
      await DillerHujjatQatorModel.bulkCreate(tayyor.map(x => ({ hujjat_id: hujjat.id, tovar_id: x.tovar_id, tovar_nomi: x.tovar_nomi, dona: x.dona, narx: x.narx, summa: x.summa })), { transaction: t });
      const reg = [];
      for (const x of tayyor) {
        const asos = { tovar_id: x.tovar_id, tovar_nomi: x.tovar_nomi, turkum: x.turkum, bloklarda: 0, qutilarda: 0, hajm: 0, kirim_narx: 0, sotuv_narx: x.narx, manba_tur: 'diller_qaytarish', manba_id: hujjat.id, sana };
        reg.push({ ...asos, ombor: dOmbor, tur: 'chiqim', donada: -x.dona, summa: -x.summa });
        reg.push({ ...asos, ombor: ASOSIY_OMBOR, tur: 'qaytarma_kirim', donada: x.dona, summa: x.summa });
      }
      await TovarRegisterModel.bulkCreate(reg, { transaction: t });
      return hujjat.id;
    });
  });
}

/* ── O'qish (web) ─────────────────────────────────────── */
const terJson = d => (d.territoriya ? { id: d.territoriya.id, nomi: d.territoriya.nomi } : null);

async function royxat(q = {}) {
  const where = { diller: true };
  if (q.territoriya_id !== undefined && q.territoriya_id !== '') where.territoriya_id = idOl(q.territoriya_id, 'territoriya_id');
  if (q.qidiruv) where.fullname = { [Op.like]: `%${String(q.qidiruv).trim()}%` };
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const hammasi = await AgentModel.findAll({ where, include: [{ model: TerritoriyaModel, as: 'territoriya', attributes: ['id', 'nomi'] }], order: [['fullname', 'ASC']] });
  const qarzlar = await dillerQarzlari(hammasi.map(d => d.id));
  const sahifa = hammasi.slice((page - 1) * limit, page * limit);
  const ids = sahifa.map(d => d.id);
  const [mijozlar, oxirgi] = ids.length ? await Promise.all([
    sequelize.query('SELECT agent_id, COUNT(*) s FROM mijoz WHERE agent_id IN (:ids) AND deletedAt IS NULL GROUP BY agent_id', { replacements: { ids }, type: SELECT }),
    sequelize.query("SELECT diller_id, MAX(sana) s FROM diller_hujjat WHERE diller_id IN (:ids) AND tur = 'berish' GROUP BY diller_id", { replacements: { ids }, type: SELECT }),
  ]) : [[], []];
  const mS = new Map(mijozlar.map(r => [Number(r.agent_id), Number(r.s)]));
  const oS = new Map(oxirgi.map(r => [Number(r.diller_id), r.s]));
  const data = [];
  for (const d of sahifa) {
    const ombor = await dillerOmbor(d);
    data.push({
      id: d.id, fullname: d.fullname, territoriya: terJson(d), faol: !!d.faol,
      qarz: qarzlar.get(d.id) || 0, ombor_summa: r2(ombor.reduce((s, x) => s + x.dona * x.narx, 0)),
      mijozlar_soni: mS.get(d.id) || 0, oxirgi_berish_sana: oS.get(d.id) || null,
    });
  }
  return { data, jami: { qarz: r2([...qarzlar.values()].reduce((s, x) => s + x, 0)), soni: hammasi.length }, page, limit };
}

async function hujjatlarRoyxat(dillerId, q = {}, { limitMax = 200 } = {}) {
  const w = ['h.diller_id = :d'], R = { d: dillerId };
  if (q.tur !== undefined && q.tur !== '') {
    if (!['berish', 'tolov', 'qaytarish'].includes(q.tur)) throw new HttpException(400, "tur faqat 'berish', 'tolov' yoki 'qaytarish'");
    w.push('h.tur = :tur'); R.tur = q.tur;
  }
  const dan = kunParam(q.dan, 'dan'), gacha = kunParam(q.gacha, 'gacha');
  if (dan && gacha && dan > gacha) throw new HttpException(400, "dan gacha'dan katta bo'lmasligi kerak");
  if (dan) { w.push('h.sana >= :dan'); R.dan = kunBoshi(dan); }
  if (gacha) { w.push('h.sana <= :gacha'); R.gacha = kunOxiri(gacha); }
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(limitMax, Math.max(1, parseInt(q.limit, 10) || 50));
  const shart = w.join(' AND ');
  const [rows, [j]] = await Promise.all([
    sequelize.query(`SELECT h.*, k.nomi kassa_nomi FROM diller_hujjat h LEFT JOIN kassalar k ON k.id = h.kassa_id
      WHERE ${shart} ORDER BY h.sana DESC, h.id DESC LIMIT :limit OFFSET :off`, { replacements: { ...R, limit, off: (page - 1) * limit }, type: SELECT }),
    sequelize.query(`SELECT COUNT(*) soni FROM diller_hujjat h WHERE ${shart}`, { replacements: R, type: SELECT }),
  ]);
  return {
    data: rows.map(h => ({ id: h.id, raqam: h.raqam, tur: h.tur, sana: h.sana, jami: r2(h.jami), tolangan: r2(h.tolangan),
      kassa_nomi: h.kassa_nomi || null, izoh: h.izoh || null, user_nomi: h.user_nomi || null })),
    jami: { soni: Number(j.soni) || 0 }, page, limit,
  };
}

const dillerJson = d => ({
  id: d.id, fullname: d.fullname, telefon: d.telefon || null, login: d.login || null, faol: !!d.faol,
  territoriya_id: d.territoriya_id || null, territoriya: terJson(d), izoh: d.izoh || null, diller: true,
});

async function karta(idRaw) {
  const d = await AgentModel.findByPk(idOl(idRaw, 'id'), { include: [{ model: TerritoriyaModel, as: 'territoriya', attributes: ['id', 'nomi'] }] });
  if (!d || !d.diller) throw new HttpException(404, 'Diller topilmadi');
  const [qarz, ombor, h] = await Promise.all([dillerQarz(d.id), dillerOmbor(d), hujjatlarRoyxat(d.id, { limit: 50 })]);
  return { diller: dillerJson(d), qarz, ombor, hujjatlar: h.data };
}

async function sotuvlar(idRaw, q = {}) {
  const d = await dillerOl(idRaw, { paranoid: false });
  const w = ["a.agent_id = :d", "a.turi = 'diller_sotuv'", 'a.deletedAt IS NULL'], R = { d: d.id };
  const dan = kunParam(q.dan, 'dan'), gacha = kunParam(q.gacha, 'gacha');
  if (dan && gacha && dan > gacha) throw new HttpException(400, "dan gacha'dan katta bo'lmasligi kerak");
  if (dan) { w.push('a.yetkazilgan_sana >= :dan'); R.dan = kunBoshi(dan); }
  if (gacha) { w.push('a.yetkazilgan_sana <= :gacha'); R.gacha = kunOxiri(gacha); }
  if (q.mijoz_id !== undefined && q.mijoz_id !== '') { w.push('a.mijoz_id = :m'); R.m = idOl(q.mijoz_id, 'mijoz_id'); }
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
  const shart = w.join(' AND ');
  const [rows, [j]] = await Promise.all([
    sequelize.query(`SELECT a.id, a.raqam, a.yetkazilgan_sana sana, a.mijoz_id, a.mijoz_nomi, a.jami_summa, a.tolangan_summa, a.tolov_turi,
        EXISTS (SELECT 1 FROM savdo_qaytarish s WHERE s.ariza_id = a.id) qaytarish_bor
      FROM ariza a WHERE ${shart} ORDER BY a.yetkazilgan_sana DESC, a.id DESC LIMIT :limit OFFSET :off`,
    { replacements: { ...R, limit, off: (page - 1) * limit }, type: SELECT }),
    sequelize.query(`SELECT COUNT(*) soni, COALESCE(SUM(a.jami_summa), 0) jami, COALESCE(SUM(a.tolangan_summa), 0) tolangan FROM ariza a WHERE ${shart}`, { replacements: R, type: SELECT }),
  ]);
  return {
    data: rows.map(a => ({ id: a.id, raqam: a.raqam, sana: a.sana, mijoz: a.mijoz_id ? { id: a.mijoz_id, nomi: a.mijoz_nomi } : null,
      jami: r2(a.jami_summa), tolangan: r2(a.tolangan_summa), tolov_usuli: a.tolov_turi || null, qaytarish_bor: !!Number(a.qaytarish_bor) })),
    jami: { soni: Number(j.soni) || 0, jami: r2(j.jami), tolangan: r2(j.tolangan) }, page, limit,
  };
}

async function mijozlar(idRaw) {
  const d = await dillerOl(idRaw, { paranoid: false });
  const rows = await MijozModel.findAll({ where: { agent_id: d.id }, attributes: ['id', 'nomi', 'telefon', 'manzil', 'faol', 'balans'], order: [['nomi', 'ASC']], raw: true });
  const data = rows.map(m => ({ id: m.id, nomi: m.nomi, telefon: m.telefon || null, manzil: m.manzil || null, faol: !!m.faol,
    balans: r2(m.balans), qarz: n(m.balans) < 0 ? r2(-n(m.balans)) : 0 }));
  return { data, jami: { soni: data.length, qarz: r2(data.reduce((s, x) => s + x.qarz, 0)) } };
}

/* ── Mobil ────────────────────────────────────────────── */
/** Dillerning narx ro'yxati { "<tovarId>": narx } */
async function narxlarOl(dillerId) {
  const rows = await DillerNarxModel.findAll({ where: { diller_id: dillerId }, raw: true });
  return Object.fromEntries(rows.map(r => [String(r.tovar_id), r2(r.narx)]));
}
async function narxlarSaqla(diller, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpException(400, "So'rov tanasi obyekt bo'lishi kerak");
  const ortiqcha = Object.keys(body).filter(k => !['narxlar', 'token', 'userToken'].includes(k));
  if (ortiqcha.length) throw new HttpException(400, `Noma'lum maydon: ${ortiqcha.join(', ')}`);
  const x = body.narxlar;
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new HttpException(400, 'narxlar — { "<tovarId>": narx | null } obyekt bo\'lishi kerak');
  const keys = Object.keys(x);
  if (keys.length > 5000) throw new HttpException(400, "narxlar: ko'pi bilan 5000 ta");
  const qoy = [], ochir = [];
  for (const k of keys) {
    const id = Number(k);
    if (!Number.isInteger(id) || id <= 0) throw new HttpException(400, `narxlar: tovarId noto'g'ri (${k})`);
    if (x[k] === null) { ochir.push(id); continue; }
    qoy.push({ id, narx: r2(sonOl(x[k], `narxlar["${k}"]`)) });
  }
  if (qoy.length) await tovarlarOl(qoy.map(q => q.id));
  await sequelize.transaction(async (t) => {
    if (ochir.length) await DillerNarxModel.destroy({ where: { diller_id: diller.id, tovar_id: ochir }, transaction: t });
    if (qoy.length) {
      await DillerNarxModel.bulkCreate(qoy.map(q => ({ diller_id: diller.id, tovar_id: q.id, narx: q.narx })),
        { updateOnDuplicate: ['narx', 'updatedAt'], transaction: t });
    }
  });
  return { narxlar: await narxlarOl(diller.id) };
}

const TARIX_KUN = 90;
/** Mobil sinxron bloki: qarz, oxirgi 90 kun hujjatlari, narx ro'yxati */
async function mobilBlok(diller) {
  const dan = new Date(Date.now() - TARIX_KUN * 86400000);
  const [qarz, rows, narxlar] = await Promise.all([
    dillerQarz(diller.id),
    DillerHujjatModel.findAll({ where: { diller_id: diller.id, sana: { [Op.gte]: dan } }, include: [{ model: DillerHujjatQatorModel, as: 'qatorlar' }],
      order: [['sana', 'DESC'], ['id', 'DESC']], limit: 500 }),
    narxlarOl(diller.id),
  ]);
  return {
    qarz,
    tarix: rows.map(h => ({
      id: h.id, raqam: h.raqam, tur: h.tur, sana: h.sana, jami: r2(h.jami), tolangan: r2(h.tolangan),
      qatorlar: (h.qatorlar || []).sort((a, b) => a.id - b.id).map(q => ({ tovarId: String(q.tovar_id), nomi: q.tovar_nomi, dona: r3(q.dona), narx: r2(q.narx) })),
      izoh: h.izoh || null,
    })),
    narxlar,
  };
}

/** Diller mobil sotuvi (saveSell): erkin narx, o'z omboridan, kassa/agent_register/plastik navbati yo'q.
    mapQator, jamiHisobla, mobilVaqt, mobilKalit, sanaNormalla — savdo.controller'dan (bir xil qator qoidasi). */
async function mobilSotuv({ body, diller, mapQator, jamiHisobla, mobilVaqt, mobilKalit, sanaNormalla, kunKey, chekRasmOl }) {
  const products = Array.isArray(body.products) ? body.products : [];
  if (!body.klientId || !products.length) throw new HttpException(400, 'klientId va products majburiy');
  if (products.length > 500) throw new HttpException(400, "Bitta hujjatda 500 tadan ortiq tovar qatori bo'lishi mumkin emas");
  const tayyor = products.map(mapQator);
  const { chegirma, jami: itog } = jamiHisobla(tayyor, body.skidkaSum, null);   // diller: chegirma limiti yo'q (narx erkin)
  const vaqt = mobilVaqt(body.vaqt);
  const mobilId = mobilKalit(body.mobilId);
  const naqdMi = body.currency === 'naqt' || body.currency === 'naqd';
  const usulRaw = body.tolovUsuli === undefined || body.tolovUsuli === null || body.tolovUsuli === '' ? (naqdMi ? 'naqd' : null) : String(body.tolovUsuli);
  const usul = usulRaw === null ? (body.tolanganSumma !== undefined && body.tolanganSumma !== null && body.tolanganSumma !== '' ? 'naqd' : 'qarz') : usulRaw;
  if (!['naqd', 'plastik', 'qarz'].includes(usul)) throw new HttpException(400, "tolovUsuli faqat 'naqd', 'plastik' yoki 'qarz' bo'lishi mumkin");
  let tolangan = 0;
  if (usul !== 'qarz') {
    tolangan = body.tolanganSumma !== undefined && body.tolanganSumma !== null && body.tolanganSumma !== ''
      ? Math.max(0, Math.min(itog, parseFloat(body.tolanganSumma) || 0)) : itog;
  }
  tolangan = r2(tolangan);
  const chek = body.chekRasm ? chekRasmOl(body.chekRasm) : null;   // ixtiyoriy (diller puli — kompaniya tekshirmaydi)
  const qarzQism = r2(itog - tolangan);
  let tolovSana = null;
  if (qarzQism > 0.005 && body.tolovSana) { const s = sanaNormalla(body.tolovSana); if (s && s >= kunKey(vaqt)) tolovSana = s; }
  const ombor = dillerOmbori(diller.fullname);

  return sequelize.transaction(async (t) => {
    await tovarlarniQulfla(tayyor.map(q => q.tovar_id), t);
    const mijoz = await qulflabOl(MijozModel, body.klientId, t);
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    const qatorlar = await turkumToldir(tayyor, t);
    const qoldiq = await omborQoldiq(ombor, t, [...new Set(qatorlar.map(q => q.tovar_id))]);
    const kerak = new Map();
    qatorlar.forEach(q => { const x = kerak.get(q.tovar_id) || { nomi: q.tovar_nomi || `#${q.tovar_id}`, dona: 0 }; x.dona += n(q.jami_dona); kerak.set(q.tovar_id, x); });
    for (const [id, x] of kerak) {
      const bor = (qoldiq.get(Number(id)) || { dona: 0 }).dona;
      if (r3(x.dona) > bor + 0.001) throw new HttpException(400, `"${x.nomi}" omboringizda yetarli emas. Kerak: ${r3(x.dona)}, bor: ${bor}`);
    }
    const ariza = await ArizaModel.create({
      turi: 'diller_sotuv', raqam: await generateRaqam(t), manba: 'mobil', kanal: 'diller', holat: 'yetkazildi', ombor,
      yetkazilgan_sana: vaqt, jonatish_sana: sanaNormalla(vaqt), mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
      agent_id: diller.id, agent_nomi: diller.fullname, jami_summa: itog, chegirma_summa: chegirma,
      tolov_turi: usul, tolov_sana: tolovSana, tolangan_summa: tolangan,
      izoh: body.komment ? String(body.komment).slice(0, 2000) : null, mobil_id: mobilId,
      oflayn: body.oflayn === true || body.oflayn === 'true',
    }, { transaction: t });
    await ArizaQatorModel.bulkCreate(qatorlar.map(q => ({ ...q, ariza_id: ariza.id })), { transaction: t });
    await TovarRegisterModel.bulkCreate(qatorlar.map(q => ({
      tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum || null, ombor, tur: 'chiqim', manba_tur: 'diller_sotuv', manba_id: ariza.id,
      donada: -Math.abs(n(q.jami_dona)), bloklarda: -Math.abs(n(q.blok)), qutilarda: 0, hajm: 0, kirim_narx: 0,
      sotuv_narx: n(q.narx), summa: -Math.abs(n(q.summa)), sana: vaqt,
    })), { transaction: t });
    if (qarzQism > 0.005) await MijozModel.decrement('balans', { by: qarzQism, where: { id: mijoz.id }, transaction: t });
    if (tolangan > 0.005) {
      await DillerPulModel.create({
        diller_id: diller.id, tur: 'kirim', kategoriya: 'sotuv', usul: usul === 'plastik' ? 'plastik' : 'naqd', summa: tolangan,
        mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi, ariza_id: ariza.id, izoh: `${ariza.raqam} — sotuv`.slice(0, 255),
        chek_rasm: chek, sana: vaqt,
      }, { transaction: t });
    }
    return ariza;
  });
}

/** Diller mijozining qarz to'lovi (savePayment) — dillerning puli, kompaniya kassasiga tushmaydi */
async function mobilTolov({ diller, klientId, naqd, plastik, komment, mobilId, vaqt, chekRasm }) {
  const kalitlar = mobilId ? [mobilId, `${mobilId.slice(0, 62)}#p`] : [];
  const takror = async (t) => (kalitlar.length ? DillerPulModel.findOne({ where: { mobil_id: kalitlar }, ...(t ? { transaction: t } : {}) }) : null);
  const bor = await takror();
  if (bor) {
    if (Number(bor.diller_id) !== Number(diller.id)) throw new HttpException(409, 'Bu mobilId boshqa amalga tegishli');
    return { takror: true };
  }
  try {
    await sequelize.transaction(async (t) => {
      const mijoz = await qulflabOl(MijozModel, klientId, t);
      if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
      const yoz = (usul, summa, kalit) => DillerPulModel.create({
        diller_id: diller.id, tur: 'kirim', kategoriya: 'mijoz_tolov', usul, summa, mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
        mobil_id: kalit, izoh: komment ? String(komment).slice(0, 255) : null, chek_rasm: usul === 'plastik' ? chekRasm : null, sana: vaqt,
      }, { transaction: t });
      if (naqd > 0) await yoz('naqd', naqd, kalitlar[0] || null);
      if (plastik > 0) await yoz('plastik', plastik, naqd > 0 ? (kalitlar[1] || null) : (kalitlar[0] || null));
      await MijozModel.increment('balans', { by: r2(naqd + plastik), where: { id: mijoz.id }, transaction: t });
    });
  } catch (e) {
    if (unikXato(e) && await takror()) return { takror: true };
    throw e;
  }
  return { takror: false };
}

/** Diller "Mening kunim": bugungi ko'rsatkichlar (agent holatHisobla shakli bilan bir xil kalitlar) */
async function mobilHolat(diller, sana, mashina, { lokalKun, tzOffset }) {
  const R = { d: diller.id, sana, tz: tzOffset() };
  const [[sot], [pul], [ber], [tash], [reja]] = await Promise.all([
    sequelize.query(`SELECT COUNT(*) soni, COALESCE(SUM(jami_summa),0) summa,
        COALESCE(SUM(CASE WHEN tolov_turi = 'naqd' THEN tolangan_summa ELSE 0 END),0) naqd,
        COALESCE(SUM(CASE WHEN tolov_turi = 'plastik' THEN tolangan_summa ELSE 0 END),0) plastik,
        COALESCE((SELECT SUM(q.jami_dona) FROM ariza_qator q JOIN ariza a2 ON a2.id = q.ariza_id WHERE a2.agent_id = :d AND a2.turi = 'diller_sotuv'
          AND a2.deletedAt IS NULL AND ${lokalKun('a2.yetkazilgan_sana')} = :sana),0) dona
      FROM ariza WHERE agent_id = :d AND turi = 'diller_sotuv' AND deletedAt IS NULL AND ${lokalKun('yetkazilgan_sana')} = :sana`, { replacements: R, type: SELECT }),
    sequelize.query(`SELECT COALESCE(SUM(CASE WHEN tur = 'kirim' AND usul = 'naqd' THEN summa ELSE 0 END),0) kirim,
        COALESCE(SUM(CASE WHEN tur = 'chiqim' AND usul = 'naqd' THEN summa ELSE 0 END),0) chiqim
      FROM diller_pul WHERE diller_id = :d AND ${lokalKun('sana')} = :sana`, { replacements: R, type: SELECT }),
    sequelize.query(`SELECT COALESCE(SUM(q.dona),0) dona, COALESCE(SUM(q.summa),0) summa FROM diller_hujjat_qator q JOIN diller_hujjat h ON h.id = q.hujjat_id
      WHERE h.diller_id = :d AND h.tur = 'berish' AND ${lokalKun('h.sana')} = :sana`, { replacements: R, type: SELECT }),
    sequelize.query('SELECT COUNT(*) soni FROM tashrif WHERE agent_id = :d AND sana = :sana', { replacements: R, type: SELECT }),
    sequelize.query('SELECT COUNT(*) soni FROM marshrut_reja WHERE agent_id = :d AND sana = :sana', { replacements: R, type: SELECT }),
  ]);
  const summa = r2(sot.summa), naqd = r2(sot.naqd), plastik = r2(sot.plastik);
  const bosh = mashina.jami.dona <= 0.001;
  return {
    sana, bosqich: 1, holat: 'ochiq', holatNomi: 'Savdoda',
    keyingiQadam: 'savdo', keyingiQadamMatn: bosh ? "Omboringizda tovar yo'q — kompaniyadan tovar oling" : 'Mijozlarga boring va soting',
    mashina: mashina.jami,
    bugun: {
      yuklandiDona: r3(ber.dona), yuklandiSumma: r2(ber.summa),
      sotuvSoni: Number(sot.soni) || 0, sotuvDona: r3(sot.dona), sotuvSumma: summa, naqdSotuv: naqd, plastikSotuv: plastik,
      qarzgaSotuv: r2(summa - naqd - plastik),
      naqdQolda: Math.max(0, r2(n(pul.kirim) - n(pul.chiqim))), qaytarishNaqd: r2(pul.chiqim),
      tashrif: Number(tash.soni) || 0, reja: Number(reja.soni) || 0, uzoqSotuv: 0,
    },
    sorovlar: [], qabulKutilmoqda: [], kunYopish: null,
  };
}

module.exports = {
  DILLER_OMBOR_EMAS, DILLER_MIJOZ_EMAS, dillerMijozEmasWhere,
  dillerOl, dillerQarz, dillerQarzlari, dillerOmbor, dillerOmborJami, oxirgiNarxlar, omborQoldiq, bayroqTekshir,
  berish, tolov, qaytarish, royxat, karta, hujjatlarRoyxat, hujjatBitta, sotuvlar, mijozlar,
  narxlarOl, narxlarSaqla, mobilBlok, mobilSotuv, mobilTolov, mobilHolat,
};
