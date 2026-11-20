/**
 * KASSALAR, PLASTIK TASDIG'I VA AGENT NAQD MAJBURIYATI (2026-11-22).
 *
 * Pul qayerda turadi:
 *   - `kassa` jadvali — pul harakatlari JURNALI (kirim/chiqim). Yangi ustunlar:
 *       kassa_id — yozuv qaysi kassaga (kassalar) tegishli;
 *       agent_id — pul shu agent qo'lida. kassa_id NULL + agent_id + tolov_usul='naqt' = agent MAJBURIYATI.
 *   - `kassalar` — naqd kassalar va plastik kartalar (to'lov turi nomi sifatida ko'rinadi).
 *
 * Oqimlar:
 *   NAQD (sotuv yoki qarz undirish)  → jurnal kirim {agent_id, kassa_id NULL, 'naqt'} → majburiyat oshadi
 *   NAQD QAYTARISH (savdoQaytarish)   → jurnal chiqim {agent_id, kassa_id NULL, 'naqt'} → majburiyat kamayadi
 *   PLASTIK                           → plastik_tolov 'kutilmoqda' (jurnalga ham, mijoz balansiga ham tegmaydi)
 *        tasdiq                       → jurnal kirim {kassa_id = plastik kassa, agent_id, 'karta'} + mijoz balansi
 *                                        (+ sotuv bo'lsa ariza.tolangan_summa). Majburiyatga kirmaydi (kassa_id bor).
 *        rad                          → faqat holat; mijoz qarzi joyida qoladi
 *   TOPSHIRUV (pulTopshirish)         → pul_topshiruv 'kutilmoqda'
 *        tasdiq (naqd kassa tanlanadi) → majburiyat −summa, kassa balansi +summa. Jurnalga yozilmaydi: pul jurnalda
 *                                        allaqachon kirim (agent qo'lida) — bu ichki ko'chirish, aks holda kassa
 *                                        sahifasi/KPI uni ikki marta sanardi (dostavchik inkassatsiyasi bilan bir xil qoida).
 *
 * Majburiyat = Σ(naqd kirim − naqd chiqim | agent_id, kassa_id NULL) − Σ(tasdiqlangan topshiruv).
 * Eski yozuvlarda agent_id yo'q — majburiyat migratsiyadan keyin boshlanadi; eski kunlik
 * inkassatsiya (hisobot/inkassatsiya, kunniYopish) faqat eski ma'lumot uchun qoladi.
 *
 * Kassa balansi = Σ(jurnal kirim − chiqim | kassa_id) + Σ(tasdiqlangan topshiruv | kassa_id).
 */
const { Op } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const HttpException = require('./HttpException.utils');
const { qulflabOl } = require('./qulf.utils');
const KassaModel = require('../models/kassa.model');
const { KassalarModel, KassaViloyatModel, PlastikTolovModel, PulTopshiruvModel, PulAuditModel } = require('../models/kassalar.model');
const { MijozModel } = require('../models/mijoz.model');
const { ArizaModel } = require('../models/ariza.model');
const AgentModel = require('../models/agent.model');

const n = (v) => parseFloat(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;
const Q = (sql, replacements, transaction) => sequelize.query(sql, {
  replacements, type: sequelize.QueryTypes.SELECT, ...(transaction ? { transaction } : {}),
});

/* Web foydalanuvchi nomi (audit va tasdiqlagan_nomi uchun) */
const userNomi = (u) => (u ? (u.fullname || u.username || `user#${u.id}`) : null);

/* Sabab: majburiy, 3..500 belgi */
function sababOl(v, majburiy = true) {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (!s) {
    if (majburiy) throw new HttpException(400, 'Sababni yozing (kamida 3 ta belgi)');
    return null;
  }
  if (s.length < 3) throw new HttpException(400, 'Sababni yozing (kamida 3 ta belgi)');
  if (s.length > 500) throw new HttpException(400, 'Sabab 500 belgidan oshmasin');
  return s;
}

async function auditYoz({ obyekt, obyekt_id, amal, eski = null, yangi = null, sabab = null, user = null }, transaction) {
  await PulAuditModel.create({
    obyekt, obyekt_id, amal,
    eski: eski ? JSON.stringify(eski) : null,
    yangi: yangi ? JSON.stringify(yangi) : null,
    sabab: sabab ? String(sabab).slice(0, 500) : null,
    user_id: user ? user.id || null : null,
    user_nomi: user ? (user.nomi || userNomi(user)) : null,
  }, { transaction });
}

async function auditRoyxat(obyekt, obyektId) {
  const rows = await PulAuditModel.findAll({ where: { obyekt, obyekt_id: obyektId }, order: [['id', 'ASC']], raw: true });
  const json = (s) => { try { return s ? JSON.parse(s) : null; } catch (e) { return null; } };
  return rows.map(r => ({
    id: r.id, amal: r.amal, eski: json(r.eski), yangi: json(r.yangi), sabab: r.sabab,
    user_id: r.user_id, user_nomi: r.user_nomi, vaqt: r.createdAt,
  }));
}

/* Kassani tekshirish: mavjud, faol, kerakli tur; agent berilsa plastik kassa agent viloyatini qamrashi shart */
async function kassaTekshir(kassaId, { tur = null, agent = null, transaction = null, xabar = null } = {}) {
  const id = Number(kassaId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpException(400, xabar || "kassaId noto'g'ri");
  const k = await KassalarModel.findByPk(id, { ...(transaction ? { transaction } : {}) });
  if (!k || !k.faol) throw new HttpException(400, xabar || 'Kassa topilmadi yoki faol emas');
  if (tur && k.tur !== tur) throw new HttpException(400, tur === 'naqd' ? 'Naqd kassa tanlang' : 'Plastik kassa tanlang');
  if (agent && k.tur === 'plastik') {
    const bor = agent.territoriya_id && await KassaViloyatModel.findOne({
      where: { kassa_id: k.id, territoriya_id: agent.territoriya_id }, ...(transaction ? { transaction } : {}),
    });
    if (!bor) throw new HttpException(400, 'Bu plastik kassa sizning viloyatingizga biriktirilmagan');
  }
  return k;
}

/* Agent viloyatini qamraydigan faol plastik kassalar (mobil sinxron) */
async function agentPlastikKassalar(agent) {
  if (!agent || !agent.territoriya_id) return [];
  return Q(`SELECT k.id, k.nomi FROM kassalar k JOIN kassa_viloyat v ON v.kassa_id = k.id
     WHERE k.faol = 1 AND k.tur = 'plastik' AND v.territoriya_id = :t ORDER BY k.nomi`, { t: agent.territoriya_id });
}

/* Agent majburiyati va kutilayotgan summalar. ids — bitta yoki bir nechta agent; Map(agentId → {...}) */
async function majburiyatlar(ids, transaction = null) {
  const list = [...new Set((ids || []).map(Number).filter(x => x > 0))];
  const out = new Map(list.map(id => [id, { qolda: 0, naqd_kirim: 0, naqd_chiqim: 0, topshirildi: 0, kutilmoqda_topshiruv: 0, kutilmoqda_plastik: 0 }]));
  if (!list.length) return out;
  const [jurnal, tops, plas] = await Promise.all([
    Q(`SELECT agent_id, COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE 0 END), 0) kirim,
              COALESCE(SUM(CASE WHEN tur = 'chiqim' THEN summa ELSE 0 END), 0) chiqim
       FROM kassa WHERE agent_id IN (:ids) AND kassa_id IS NULL AND tolov_usul = 'naqt' GROUP BY agent_id`, { ids: list }, transaction),
    Q(`SELECT agent_id, COALESCE(SUM(CASE WHEN holat = 'tasdiqlangan' THEN summa ELSE 0 END), 0) t,
              COALESCE(SUM(CASE WHEN holat = 'kutilmoqda' THEN summa ELSE 0 END), 0) k
       FROM pul_topshiruv WHERE agent_id IN (:ids) GROUP BY agent_id`, { ids: list }, transaction),
    Q(`SELECT agent_id, COALESCE(SUM(summa), 0) k FROM plastik_tolov
       WHERE agent_id IN (:ids) AND holat = 'kutilmoqda' GROUP BY agent_id`, { ids: list }, transaction),
  ]);
  jurnal.forEach(r => { const x = out.get(Number(r.agent_id)); if (x) { x.naqd_kirim = r2(n(r.kirim)); x.naqd_chiqim = r2(n(r.chiqim)); } });
  tops.forEach(r => { const x = out.get(Number(r.agent_id)); if (x) { x.topshirildi = r2(n(r.t)); x.kutilmoqda_topshiruv = r2(n(r.k)); } });
  plas.forEach(r => { const x = out.get(Number(r.agent_id)); if (x) x.kutilmoqda_plastik = r2(n(r.k)); });
  for (const x of out.values()) x.qolda = r2(x.naqd_kirim - x.naqd_chiqim - x.topshirildi);
  return out;
}
async function majburiyat(agentId, transaction = null) {
  return (await majburiyatlar([agentId], transaction)).get(Number(agentId));
}

/* Agent pul tarixi: naqd olindi, naqd qaytarildi, plastik, topshiruv — yangisi birinchi */
async function agentPulTarix(agentId, { dan = null, gacha = null, limit = 500 } = {}) {
  const shart = (u) => `${dan ? ` AND ${u} >= :dan` : ''}${gacha ? ` AND ${u} < :gacha` : ''}`;
  const R = { id: agentId, dan, gacha, limit };
  const [jurnal, plas, tops] = await Promise.all([
    Q(`SELECT k.id, k.tur, k.kategoriya, k.summa, k.sana, k.mijoz_id, k.mijoz_nomi, k.izoh, k.manba_tur, k.manba_id
       FROM kassa k WHERE k.agent_id = :id AND k.kassa_id IS NULL AND k.tolov_usul = 'naqt' ${shart('k.sana')}
       ORDER BY k.sana DESC, k.id DESC LIMIT :limit`, R),
    Q(`SELECT p.*, ks.nomi kassa_nomi FROM plastik_tolov p LEFT JOIN kassalar ks ON ks.id = p.kassa_id
       WHERE p.agent_id = :id ${shart('p.sana')} ORDER BY p.sana DESC, p.id DESC LIMIT :limit`, R),
    Q(`SELECT t.*, ks.nomi kassa_nomi FROM pul_topshiruv t LEFT JOIN kassalar ks ON ks.id = t.kassa_id
       WHERE t.agent_id = :id ${shart('t.sana')} ORDER BY t.sana DESC, t.id DESC LIMIT :limit`, R),
  ]);
  const rows = [
    ...jurnal.map(k => ({
      id: `k${k.id}`, sana: k.sana, tur: k.tur === 'chiqim' ? 'qaytarish' : 'naqd', summa: n(k.summa),
      klient: k.mijoz_nomi || null, mijoz_id: k.mijoz_id, kassa: null, holat: null, sabab: null,
      kategoriya: k.kategoriya, izoh: k.izoh || null,
      ariza_id: k.manba_tur === 'avtolavka' ? k.manba_id : null,
    })),
    ...plas.map(p => ({
      id: `p${p.id}`, sana: p.sana, tur: 'plastik', summa: n(p.summa), klient: p.mijoz_nomi || null, mijoz_id: p.mijoz_id,
      kassa: p.kassa_nomi || null, kassa_id: p.kassa_id, holat: p.holat, sabab: p.rad_sababi || null,
      kategoriya: p.tur === 'sotuv' ? 'sotuv' : 'mijoz_tolov', izoh: p.izoh || null, ariza_id: p.ariza_id || null,
    })),
    ...tops.map(t => ({
      id: `t${t.id}`, sana: t.sana, tur: 'topshiruv', summa: n(t.summa), klient: null, kassa: t.kassa_nomi || null, kassa_id: t.kassa_id,
      holat: t.holat, sabab: t.rad_sababi || null, kategoriya: 'topshiruv', izoh: t.izoh || null,
    })),
  ];
  rows.sort((a, b) => new Date(b.sana) - new Date(a.sana) || String(b.id).localeCompare(String(a.id)));
  return rows.slice(0, limit);
}

/* Har kassa balansi (jurnal + tasdiqlangan topshiruvlar) va kutilayotgan plastik */
async function kassaBalanslari() {
  const [jurnal, tops, plas, [umumiy]] = await Promise.all([
    Q(`SELECT kassa_id, COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE 0 END), 0) kirim,
              COALESCE(SUM(CASE WHEN tur = 'chiqim' THEN summa ELSE 0 END), 0) chiqim
       FROM kassa WHERE kassa_id IS NOT NULL GROUP BY kassa_id`, {}),
    Q(`SELECT kassa_id, COALESCE(SUM(summa), 0) s FROM pul_topshiruv WHERE holat = 'tasdiqlangan' AND kassa_id IS NOT NULL GROUP BY kassa_id`, {}),
    Q(`SELECT kassa_id, COALESCE(SUM(summa), 0) s, COUNT(*) c FROM plastik_tolov WHERE holat = 'kutilmoqda' GROUP BY kassa_id`, {}),
    Q(`SELECT COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END), 0) jami,
              COALESCE(SUM(CASE WHEN kassa_id IS NULL AND agent_id IS NULL THEN (CASE WHEN tur = 'kirim' THEN summa ELSE -summa END) ELSE 0 END), 0) taqsimlanmagan
       FROM kassa`, {}),
  ]);
  const m = new Map();
  const ol = (id) => { if (!m.has(id)) m.set(id, { kirim: 0, chiqim: 0, topshiruv: 0, kutilmoqda_plastik: 0, kutilmoqda_soni: 0 }); return m.get(id); };
  jurnal.forEach(r => { const x = ol(Number(r.kassa_id)); x.kirim = n(r.kirim); x.chiqim = n(r.chiqim); });
  tops.forEach(r => { ol(Number(r.kassa_id)).topshiruv = n(r.s); });
  plas.forEach(r => { const x = ol(Number(r.kassa_id)); x.kutilmoqda_plastik = n(r.s); x.kutilmoqda_soni = Number(r.c) || 0; });
  for (const x of m.values()) x.balans = r2(x.kirim - x.chiqim + x.topshiruv);
  return { kassalar: m, jurnalJami: r2(n(umumiy && umumiy.jami)), taqsimlanmagan: r2(n(umumiy && umumiy.taqsimlanmagan)) };
}

/* ── Plastik to'lov amallari (web) ─────────────────────────────────── */
const plastikShakli = (p) => ({
  holat: p.holat, summa: n(p.summa), kassa_id: p.kassa_id,
});

/* Tasdiqlash: mijoz balansi (+ sotuv bo'lsa tolangan_summa), jurnalga plastik kassa kirimi.
   QULF TARTIBI: ariza → plastik_tolov → mijoz (sotuvBekor / savdoQaytarish bilan mos). */
async function plastikTasdiqla(id, user, { izoh = null } = {}) {
  const { reytingYoz } = require('./reyting.utils');
  return sequelize.transaction(async (t) => {
    const bosh = await PlastikTolovModel.findByPk(id, { transaction: t });
    if (!bosh) throw new HttpException(404, "Plastik to'lov topilmadi");
    const ariza = bosh.ariza_id ? await qulflabOl(ArizaModel, bosh.ariza_id, t) : null;
    const p = await qulflabOl(PlastikTolovModel, id, t);
    if (p.holat !== 'kutilmoqda') throw new HttpException(400, `To'lov allaqachon ${p.holat === 'tasdiqlangan' ? 'tasdiqlangan' : 'rad etilgan'}`);
    const kassa = await KassalarModel.findByPk(p.kassa_id, { transaction: t });
    if (!kassa || kassa.tur !== 'plastik') throw new HttpException(400, 'Plastik kassa topilmadi — avval to\'lovni tahrirlab kassani tanlang');
    if (p.tur === 'sotuv' && (!ariza || ariza.turi !== 'sotish' || ariza.holat !== 'yetkazildi')) {
      throw new HttpException(400, "Sotuv bekor qilingan yoki topilmadi — bu to'lovni rad eting");
    }
    const mijoz = await qulflabOl(MijozModel, p.mijoz_id, t);
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    const eskiBalans = n(mijoz.balans);
    const summa = n(p.summa);

    const yozuv = await KassaModel.create({
      tur: 'kirim', kategoriya: p.tur === 'sotuv' ? 'sotuv' : 'mijoz_tolov', summa, tolov_usul: 'karta',
      manba_tur: 'plastik_tolov', manba_id: p.id, mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
      izoh: (p.tur === 'sotuv' ? `${p.ariza_raqam || p.ariza_id} — plastik (${kassa.nomi})` : `Qarz to'lovi — plastik (${kassa.nomi})`).slice(0, 255),
      sana: p.sana, user_id: p.agent_id, agent_id: p.agent_id, kassa_id: kassa.id, chek_rasm: p.chek_rasm || null,
    }, { transaction: t });
    await MijozModel.increment('balans', { by: summa, where: { id: mijoz.id }, transaction: t });
    if (ariza) {
      const jami = n(ariza.jami_summa);
      await ariza.update({ tolangan_summa: Math.min(jami, r2(n(ariza.tolangan_summa) + summa)) }, { transaction: t });
    }
    if (p.tur === 'qarz_tolov' && eskiBalans < -0.5) {
      await reytingYoz(mijoz.id, {
        tur: 'tolov_qabul', sabab: "Qarz to'lovi (plastik) tasdiqlandi", summa, manba_tur: 'kassa', manba_id: yozuv.id,
        qarzYopildi: eskiBalans + summa >= -0.5, xodim: { rol: 'agent', id: p.agent_id, nomi: p.agent_nomi }, sana: p.sana,
      }, t);
    }
    const eski = plastikShakli(p);
    await p.update({
      holat: 'tasdiqlangan', tasdiqlagan_id: user ? user.id : null, tasdiqlagan_nomi: userNomi(user),
      tasdiq_vaqt: new Date(), kassa_yozuv_id: yozuv.id,
    }, { transaction: t });
    await auditYoz({ obyekt: 'plastik_tolov', obyekt_id: p.id, amal: 'tasdiqlandi', eski, yangi: plastikShakli(p), sabab: izoh, user }, t);
    return p;
  });
}

async function plastikRad(id, user, sababRaw) {
  const sabab = sababOl(sababRaw);
  return sequelize.transaction(async (t) => {
    const p = await qulflabOl(PlastikTolovModel, id, t);
    if (!p) throw new HttpException(404, "Plastik to'lov topilmadi");
    if (p.holat !== 'kutilmoqda') throw new HttpException(400, `To'lov allaqachon ${p.holat === 'tasdiqlangan' ? 'tasdiqlangan' : 'rad etilgan'}`);
    const eski = plastikShakli(p);
    await p.update({
      holat: 'rad_etildi', rad_sababi: sabab, tasdiqlagan_id: user ? user.id : null, tasdiqlagan_nomi: userNomi(user), tasdiq_vaqt: new Date(),
    }, { transaction: t });
    await auditYoz({ obyekt: 'plastik_tolov', obyekt_id: p.id, amal: 'rad_etildi', eski, yangi: plastikShakli(p), sabab, user }, t);
    return p;
  });
}

/* Kutilayotgan to'lovni tahrirlash: summa va/yoki kassa. Sabab majburiy. */
async function plastikTahrir(id, user, body = {}) {
  const { summaOl } = require('../controllers/mobile/shared');
  const sabab = sababOl(body.sabab);
  const yangiSumma = body.summa === undefined ? null : summaOl(body.summa, { xabar: "Summa noto'g'ri" });
  if (yangiSumma !== null && !(yangiSumma > 0)) throw new HttpException(400, "Summa 0 dan katta bo'lishi kerak");
  const kassaId = body.kassa_id === undefined || body.kassa_id === null || body.kassa_id === '' ? null : body.kassa_id;
  if (yangiSumma === null && kassaId === null) throw new HttpException(400, "O'zgartirish uchun summa yoki kassa_id bering");
  return sequelize.transaction(async (t) => {
    const p = await qulflabOl(PlastikTolovModel, id, t);
    if (!p) throw new HttpException(404, "Plastik to'lov topilmadi");
    if (p.holat !== 'kutilmoqda') throw new HttpException(400, "Faqat kutilayotgan to'lovni tahrirlash mumkin");
    const ozgar = {};
    if (yangiSumma !== null && Math.abs(yangiSumma - n(p.summa)) > 0.005) ozgar.summa = r2(yangiSumma);
    if (kassaId !== null) {
      const k = await kassaTekshir(kassaId, { tur: 'plastik', transaction: t });
      if (k.id !== p.kassa_id) ozgar.kassa_id = k.id;
    }
    if (!Object.keys(ozgar).length) throw new HttpException(400, "Hech narsa o'zgarmadi");
    const eski = plastikShakli(p);
    await p.update(ozgar, { transaction: t });
    await auditYoz({ obyekt: 'plastik_tolov', obyekt_id: p.id, amal: 'tahrirlandi', eski, yangi: plastikShakli(p), sabab, user }, t);
    return p;
  });
}

/* Sotuv bekor qilinganda (sotuvBekor) — kutilayotgan plastik to'lovi avtomatik rad etiladi */
async function sotuvPlastikRad(arizaId, user, transaction) {
  const p = await PlastikTolovModel.findOne({ where: { ariza_id: arizaId, holat: 'kutilmoqda' }, transaction, lock: transaction.LOCK.UPDATE });
  if (!p) return null;
  const eski = plastikShakli(p);
  await p.update({ holat: 'rad_etildi', rad_sababi: 'Sotuv bekor qilindi', tasdiqlagan_id: user ? user.id : null, tasdiqlagan_nomi: userNomi(user), tasdiq_vaqt: new Date() }, { transaction });
  await auditYoz({ obyekt: 'plastik_tolov', obyekt_id: p.id, amal: 'rad_etildi', eski, yangi: plastikShakli(p), sabab: 'Sotuv bekor qilindi', user }, transaction);
  return p;
}

/* ── Topshiruv amallari ────────────────────────────────────────────── */
const topshiruvShakli = (x) => ({ holat: x.holat, summa: n(x.summa), kassa_id: x.kassa_id });

/* Mobil: agent naqd topshiradi. Agent qatori qulflanadi — parallel topshiruvlar mavjud summadan oshmaydi. */
async function topshiruvYarat(agent, { summa, izoh, mobilId, vaqt }) {
  return sequelize.transaction(async (t) => {
    await qulflabOl(AgentModel, agent.id, t);
    if (mobilId) {
      const bor = await PulTopshiruvModel.findOne({ where: { mobil_id: mobilId }, transaction: t });
      if (bor) return { takror: bor };
    }
    const m = await majburiyat(agent.id, t);
    const mavjud = r2(m.qolda - m.kutilmoqda_topshiruv);
    if (summa > mavjud + 0.005) {
      throw new HttpException(400, mavjud > 0
        ? `Topshirish mumkin bo'lgan summa: ${mavjud} (qo'lingizda ${m.qolda}, tasdiq kutilayotgan topshiruv ${m.kutilmoqda_topshiruv})`
        : "Qo'lingizda topshiriladigan naqd yo'q");
    }
    const row = await PulTopshiruvModel.create({
      mobil_id: mobilId, agent_id: agent.id, agent_nomi: agent.fullname, summa: r2(summa), izoh, sana: vaqt, holat: 'kutilmoqda',
    }, { transaction: t });
    await auditYoz({ obyekt: 'pul_topshiruv', obyekt_id: row.id, amal: 'yaratildi', yangi: topshiruvShakli(row), sabab: izoh,
      user: { id: null, nomi: `Agent: ${agent.fullname}` } }, t);
    return { row };
  });
}

async function topshiruvTasdiqla(id, user, { kassa_id, izoh = null } = {}) {
  if (kassa_id === undefined || kassa_id === null || kassa_id === '') throw new HttpException(400, 'kassa_id majburiy (naqd kassa)');
  return sequelize.transaction(async (t) => {
    const bosh = await PulTopshiruvModel.findByPk(id, { transaction: t });
    if (!bosh) throw new HttpException(404, 'Topshiruv topilmadi');
    // QULF TARTIBI: agent → topshiruv (topshiruvYarat bilan bir xil)
    await qulflabOl(AgentModel, bosh.agent_id, t, { paranoid: false });
    const x = await qulflabOl(PulTopshiruvModel, id, t);
    if (x.holat !== 'kutilmoqda') throw new HttpException(400, `Topshiruv allaqachon ${x.holat === 'tasdiqlangan' ? 'tasdiqlangan' : 'rad etilgan'}`);
    const kassa = await kassaTekshir(kassa_id, { tur: 'naqd', transaction: t });
    const m = await majburiyat(x.agent_id, t);
    if (n(x.summa) > m.qolda + 0.5) {
      throw new HttpException(400, `Agent qo'lidagi naqd (${m.qolda}) topshiruv summasidan (${n(x.summa)}) kam — rad eting va agent qaytadan yuborsin`);
    }
    const eski = topshiruvShakli(x);
    await x.update({ holat: 'tasdiqlangan', kassa_id: kassa.id, tasdiqlagan_id: user ? user.id : null, tasdiqlagan_nomi: userNomi(user), tasdiq_vaqt: new Date() }, { transaction: t });
    await auditYoz({ obyekt: 'pul_topshiruv', obyekt_id: x.id, amal: 'tasdiqlandi', eski, yangi: topshiruvShakli(x), sabab: izoh, user }, t);
    return x;
  });
}

async function topshiruvRad(id, user, sababRaw) {
  const sabab = sababOl(sababRaw);
  return sequelize.transaction(async (t) => {
    const x = await qulflabOl(PulTopshiruvModel, id, t);
    if (!x) throw new HttpException(404, 'Topshiruv topilmadi');
    if (x.holat !== 'kutilmoqda') throw new HttpException(400, `Topshiruv allaqachon ${x.holat === 'tasdiqlangan' ? 'tasdiqlangan' : 'rad etilgan'}`);
    const eski = topshiruvShakli(x);
    await x.update({ holat: 'rad_etildi', rad_sababi: sabab, tasdiqlagan_id: user ? user.id : null, tasdiqlagan_nomi: userNomi(user), tasdiq_vaqt: new Date() }, { transaction: t });
    await auditYoz({ obyekt: 'pul_topshiruv', obyekt_id: x.id, amal: 'rad_etildi', eski, yangi: topshiruvShakli(x), sabab, user }, t);
    return x;
  });
}

module.exports = {
  kassaTekshir, agentPlastikKassalar, majburiyat, majburiyatlar, agentPulTarix, kassaBalanslari,
  plastikTasdiqla, plastikRad, plastikTahrir, sotuvPlastikRad,
  topshiruvYarat, topshiruvTasdiqla, topshiruvRad, auditYoz, auditRoyxat, sababOl, userNomi, Op,
};
