/**
 * KASSALAR (web) — /api/v1/kassalar (2026-11-22)
 *   Kassalar CRUD (naqd / plastik, plastik — viloyatlarga biriktiriladi), balanslar,
 *   plastik to'lovlar navbati (tasdiqlash / rad / tahrir + audit),
 *   agent naqd topshiruvlari navbati (naqd kassaga tasdiqlash / rad), agentlar majburiyati.
 * Biznes mantiqi: utils/agentPul.utils.js
 */
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const HttpException = require('../../utils/HttpException.utils');
const { KassalarModel, KassaViloyatModel, PlastikTolovModel, PulTopshiruvModel } = require('../../models/kassalar.model');
const TerritoriyaModel = require('../../models/territoriya.model');
const AgentModel = require('../../models/agent.model');
const KassaModel = require('../../models/kassa.model');
const P = require('../../utils/agentPul.utils');
const { sanaTogrimi } = require('../../utils/tahlil.utils');

const n = (v) => parseFloat(v) || 0;
const TURLAR = ['naqd', 'plastik'];
const HOLATLAR = ['kutilmoqda', 'tasdiqlangan', 'rad_etildi'];

function idOl(v, nomi = 'id') {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0) throw new HttpException(400, `${nomi} noto'g'ri`);
  return x;
}
function boolOl(v, nomi) {
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  throw new HttpException(400, `${nomi} true yoki false bo'lishi kerak`);
}
/* ?dan=YYYY-MM-DD&gacha=YYYY-MM-DD → lokal kun chegaralari */
function davrOl(q) {
  const out = {};
  if (q.dan) { if (!sanaTogrimi(String(q.dan))) throw new HttpException(400, "dan sanasi noto'g'ri (YYYY-MM-DD)"); out.dan = new Date(`${q.dan}T00:00:00`); }
  if (q.gacha) { if (!sanaTogrimi(String(q.gacha))) throw new HttpException(400, "gacha sanasi noto'g'ri (YYYY-MM-DD)"); out.gacha = new Date(new Date(`${q.gacha}T00:00:00`).getTime() + 864e5); }
  if (out.dan && out.gacha && out.gacha <= out.dan) throw new HttpException(400, "Davr noto'g'ri: dan > gacha");
  return out;
}
function sahifa(q, maks = 500) {
  const limit = Math.min(maks, Math.max(1, parseInt(q.limit, 10) || 100));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  return { limit, offset: (page - 1) * limit, page };
}

/* Viloyat id ro'yxati: mavjud territoriyalar, takrorsiz */
async function viloyatlarOl(v, transaction) {
  if (!Array.isArray(v)) throw new HttpException(400, "viloyatlar — territoriya id'lari massivi bo'lishi kerak");
  const ids = [...new Set(v.map(x => idOl(x, 'viloyat id')))];
  if (!ids.length) return [];
  const bor = await TerritoriyaModel.findAll({ where: { id: ids }, attributes: ['id'], raw: true, transaction });
  const yoq = ids.filter(id => !bor.some(b => b.id === id));
  if (yoq.length) throw new HttpException(400, `Viloyat topilmadi: ${yoq.join(', ')}`);
  return ids;
}

const RUXSAT = ['nomi', 'tur', 'faol', 'izoh', 'viloyatlar'];
function maydonTekshir(body) {
  const ortiqcha = Object.keys(body || {}).filter(k => !RUXSAT.includes(k));
  if (ortiqcha.length) throw new HttpException(400, `Noma'lum maydon: ${ortiqcha.join(', ')}`);
}

async function kassaJson(ids = null) {
  const where = ids ? { id: ids } : {};
  const rows = await KassalarModel.findAll({ where, order: [['tur', 'ASC'], ['nomi', 'ASC']], raw: true });
  const bog = rows.length ? await sequelize.query(
    `SELECT v.kassa_id, t.id, t.nomi FROM kassa_viloyat v JOIN territoriya t ON t.id = v.territoriya_id WHERE v.kassa_id IN (:ids) ORDER BY t.nomi`,
    { replacements: { ids: rows.map(r => r.id) }, type: sequelize.QueryTypes.SELECT }) : [];
  const b = await P.kassaBalanslari();
  return {
    rows: rows.map(k => {
      const x = b.kassalar.get(k.id) || { kirim: 0, chiqim: 0, topshiruv: 0, balans: 0, kutilmoqda_plastik: 0, kutilmoqda_soni: 0 };
      return {
        id: k.id, nomi: k.nomi, tur: k.tur, faol: !!k.faol, izoh: k.izoh,
        viloyatlar: bog.filter(v => v.kassa_id === k.id).map(v => ({ id: v.id, nomi: v.nomi })),
        balans: x.balans, kirim: x.kirim, chiqim: x.chiqim, topshiruv_kirim: x.topshiruv,
        kutilmoqda_plastik: x.kutilmoqda_plastik, kutilmoqda_soni: x.kutilmoqda_soni,
        createdAt: k.createdAt, updatedAt: k.updatedAt,
      };
    }),
    b,
  };
}

/* Plastik to'lov / topshiruv javob shakli */
const plastikJson = (p) => ({
  id: p.id, tur: p.tur, holat: p.holat, summa: n(p.summa), sana: p.sana,
  agent_id: p.agent_id, agent_nomi: p.agent_nomi, territoriya_id: p.territoriya_id, territoriya_nomi: p.territoriya_nomi || null,
  mijoz_id: p.mijoz_id, mijoz_nomi: p.mijoz_nomi, ariza_id: p.ariza_id, ariza_raqam: p.ariza_raqam,
  kassa_id: p.kassa_id, kassa_nomi: p.kassa_nomi || null, izoh: p.izoh, chek_rasm: p.chek_rasm,
  tasdiqlagan_id: p.tasdiqlagan_id, tasdiqlagan_nomi: p.tasdiqlagan_nomi, tasdiq_vaqt: p.tasdiq_vaqt, rad_sababi: p.rad_sababi,
  kassa_yozuv_id: p.kassa_yozuv_id, createdAt: p.createdAt,
});
const topshiruvJson = (x) => ({
  id: x.id, holat: x.holat, summa: n(x.summa), sana: x.sana, agent_id: x.agent_id, agent_nomi: x.agent_nomi, izoh: x.izoh,
  kassa_id: x.kassa_id, kassa_nomi: x.kassa_nomi || null,
  tasdiqlagan_id: x.tasdiqlagan_id, tasdiqlagan_nomi: x.tasdiqlagan_nomi, tasdiq_vaqt: x.tasdiq_vaqt, rad_sababi: x.rad_sababi,
  createdAt: x.createdAt,
});

async function plastikBitta(id) {
  const [p] = await sequelize.query(`SELECT p.*, k.nomi kassa_nomi, t.nomi territoriya_nomi FROM plastik_tolov p
      LEFT JOIN kassalar k ON k.id = p.kassa_id LEFT JOIN territoriya t ON t.id = p.territoriya_id WHERE p.id = :id`,
  { replacements: { id }, type: sequelize.QueryTypes.SELECT });
  if (!p) throw new HttpException(404, "Plastik to'lov topilmadi");
  return { ...plastikJson(p), audit: await P.auditRoyxat('plastik_tolov', id) };
}
async function topshiruvBitta(id) {
  const [x] = await sequelize.query(`SELECT t.*, k.nomi kassa_nomi FROM pul_topshiruv t LEFT JOIN kassalar k ON k.id = t.kassa_id WHERE t.id = :id`,
    { replacements: { id }, type: sequelize.QueryTypes.SELECT });
  if (!x) throw new HttpException(404, 'Topshiruv topilmadi');
  const m = await P.majburiyat(x.agent_id);
  return { ...topshiruvJson(x), agent_qolda: m.qolda, audit: await P.auditRoyxat('pul_topshiruv', id) };
}

class KassalarController {
  /* GET /kassalar?tur=&faol=&territoriya_id= */
  royxat = async (req, res) => {
    const { tur, faol, territoriya_id } = req.query;
    if (tur && !TURLAR.includes(tur)) throw new HttpException(400, "tur: 'naqd' yoki 'plastik'");
    let { rows, b } = await kassaJson();
    if (tur) rows = rows.filter(k => k.tur === tur);
    if (faol !== undefined && faol !== '') { const f = boolOl(faol, 'faol'); rows = rows.filter(k => k.faol === f); }
    if (territoriya_id) { const t = idOl(territoriya_id, 'territoriya_id'); rows = rows.filter(k => k.tur === 'naqd' || k.viloyatlar.some(v => v.id === t)); }
    const [[ag]] = await sequelize.query(`SELECT
        (SELECT COALESCE(SUM(CASE WHEN tur='kirim' THEN summa ELSE -summa END),0) FROM kassa WHERE agent_id IS NOT NULL AND kassa_id IS NULL AND tolov_usul='naqt')
        - (SELECT COALESCE(SUM(summa),0) FROM pul_topshiruv WHERE holat='tasdiqlangan') qolda,
        (SELECT COALESCE(SUM(summa),0) FROM pul_topshiruv WHERE holat='kutilmoqda') kt,
        (SELECT COALESCE(SUM(summa),0) FROM plastik_tolov WHERE holat='kutilmoqda') kp`);
    const kassalarda = [...b.kassalar.values()].reduce((s, x) => s + x.balans, 0);
    res.send({
      kassalar: rows,
      jami: {
        kassalarda: +kassalarda.toFixed(2),
        agentlar_qolida: +n(ag.qolda).toFixed(2),
        kutilmoqda_topshiruv: +n(ag.kt).toFixed(2),
        kutilmoqda_plastik: +n(ag.kp).toFixed(2),
        // Kassaga ham, agentga ham bog'lanmagan (eski / qo'lda kassa_id siz) jurnal qoldig'i
        taqsimlanmagan: b.taqsimlanmagan,
        jurnal_qoldiq: b.jurnalJami,
      },
    });
  };

  /* GET /kassalar/viloyatlar — multi-select uchun */
  viloyatlar = async (req, res) => {
    res.send(await TerritoriyaModel.findAll({ attributes: ['id', 'nomi'], order: [['nomi', 'ASC']], raw: true }));
  };

  /* GET /kassalar/:id */
  bitta = async (req, res) => {
    const id = idOl(req.params.id);
    const { rows } = await kassaJson([id]);
    if (!rows.length) throw new HttpException(404, 'Kassa topilmadi');
    res.send(rows[0]);
  };

  /* POST /kassalar { nomi, tur, viloyatlar:[id], faol?, izoh? } */
  create = async (req, res) => {
    const b = req.body || {};
    maydonTekshir(b);
    const nomi = String(b.nomi || '').trim();
    if (nomi.length < 2 || nomi.length > 100) throw new HttpException(400, 'Nomi 2–100 belgi bo\'lishi kerak');
    if (!TURLAR.includes(b.tur)) throw new HttpException(400, "tur: 'naqd' yoki 'plastik'");
    const faol = b.faol === undefined ? true : boolOl(b.faol, 'faol');
    const izoh = b.izoh == null || b.izoh === '' ? null : String(b.izoh).slice(0, 255);
    const id = await sequelize.transaction(async (t) => {
      if (await KassalarModel.findOne({ where: { nomi }, transaction: t })) throw new HttpException(400, `"${nomi}" nomli kassa bor`);
      let vil = [];
      if (b.tur === 'plastik') {
        vil = await viloyatlarOl(b.viloyatlar === undefined ? [] : b.viloyatlar, t);
        if (!vil.length) throw new HttpException(400, 'Plastik kassa uchun kamida bitta viloyat tanlang');
      } else if (Array.isArray(b.viloyatlar) && b.viloyatlar.length) {
        throw new HttpException(400, 'Naqd kassa viloyatga biriktirilmaydi');
      }
      const k = await KassalarModel.create({ nomi, tur: b.tur, faol, izoh }, { transaction: t });
      if (vil.length) await KassaViloyatModel.bulkCreate(vil.map(v => ({ kassa_id: k.id, territoriya_id: v })), { transaction: t });
      return k.id;
    }).catch((e) => {
      if (e && (e.name === 'SequelizeUniqueConstraintError')) throw new HttpException(400, `"${nomi}" nomli kassa bor`);
      throw e;
    });
    const { rows } = await kassaJson([id]);
    res.status(201).send(rows[0]);
  };

  /* PATCH /kassalar/:id { nomi?, tur?, viloyatlar?, faol?, izoh? } */
  update = async (req, res) => {
    const id = idOl(req.params.id);
    const b = req.body || {};
    maydonTekshir(b);
    await sequelize.transaction(async (t) => {
      const k = await KassalarModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!k) throw new HttpException(404, 'Kassa topilmadi');
      const yangi = {};
      if (b.nomi !== undefined) {
        const nomi = String(b.nomi || '').trim();
        if (nomi.length < 2 || nomi.length > 100) throw new HttpException(400, 'Nomi 2–100 belgi bo\'lishi kerak');
        if (await KassalarModel.findOne({ where: { nomi, id: { [Op.ne]: id } }, transaction: t })) throw new HttpException(400, `"${nomi}" nomli kassa bor`);
        yangi.nomi = nomi;
      }
      if (b.tur !== undefined && b.tur !== k.tur) {
        if (!TURLAR.includes(b.tur)) throw new HttpException(400, "tur: 'naqd' yoki 'plastik'");
        if (await kassaIshlatilgan(id, t)) throw new HttpException(400, "Kassada harakatlar bor — turini o'zgartirib bo'lmaydi (yangi kassa oching)");
        yangi.tur = b.tur;
      }
      if (b.faol !== undefined) yangi.faol = boolOl(b.faol, 'faol');
      if (b.izoh !== undefined) yangi.izoh = b.izoh == null || b.izoh === '' ? null : String(b.izoh).slice(0, 255);
      const tur = yangi.tur || k.tur;
      if (tur === 'naqd') {
        if (Array.isArray(b.viloyatlar) && b.viloyatlar.length) throw new HttpException(400, 'Naqd kassa viloyatga biriktirilmaydi');
        if (yangi.tur) await KassaViloyatModel.destroy({ where: { kassa_id: id }, transaction: t });
      } else if (b.viloyatlar !== undefined || yangi.tur) {
        const vil = await viloyatlarOl(b.viloyatlar === undefined ? [] : b.viloyatlar, t);
        if (!vil.length) throw new HttpException(400, 'Plastik kassa uchun kamida bitta viloyat tanlang');
        await KassaViloyatModel.destroy({ where: { kassa_id: id }, transaction: t });
        await KassaViloyatModel.bulkCreate(vil.map(v => ({ kassa_id: id, territoriya_id: v })), { transaction: t });
      }
      if (Object.keys(yangi).length) await k.update(yangi, { transaction: t });
    });
    const { rows } = await kassaJson([id]);
    res.send(rows[0]);
  };

  /* PATCH /kassalar/:id/faol { faol } */
  faol = async (req, res) => {
    const id = idOl(req.params.id);
    const k = await KassalarModel.findByPk(id);
    if (!k) throw new HttpException(404, 'Kassa topilmadi');
    await k.update({ faol: req.body && req.body.faol !== undefined ? boolOl(req.body.faol, 'faol') : !k.faol });
    res.send({ id: k.id, faol: !!k.faol });
  };

  /* DELETE /kassalar/:id — faqat ishlatilmagan kassa (aks holda faolsizlantiring) */
  delete = async (req, res) => {
    const id = idOl(req.params.id);
    await sequelize.transaction(async (t) => {
      const k = await KassalarModel.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!k) throw new HttpException(404, 'Kassa topilmadi');
      if (await kassaIshlatilgan(id, t)) throw new HttpException(400, "Kassada harakatlar bor — o'chirib bo'lmaydi, faolsizlantiring");
      await KassaViloyatModel.destroy({ where: { kassa_id: id }, transaction: t });
      await k.destroy({ transaction: t });
    });
    res.send({ message: "O'chirildi" });
  };

  /* ── Plastik to'lovlar ── */
  // GET /kassalar/plastik-tolovlar?holat=&agent_id=&territoriya_id=&kassa_id=&tur=&mijoz_id=&dan=&gacha=&page=&limit=
  plastikRoyxat = async (req, res) => {
    const q = req.query;
    const w = ['1=1'], R = {};
    if (q.holat) { if (!HOLATLAR.includes(q.holat)) throw new HttpException(400, `holat: ${HOLATLAR.join(', ')}`); w.push('p.holat = :holat'); R.holat = q.holat; }
    if (q.tur) { if (!['qarz_tolov', 'sotuv'].includes(q.tur)) throw new HttpException(400, "tur: 'qarz_tolov' yoki 'sotuv'"); w.push('p.tur = :tur'); R.tur = q.tur; }
    if (q.agent_id) { w.push('p.agent_id = :agent'); R.agent = idOl(q.agent_id, 'agent_id'); }
    if (q.territoriya_id) { w.push('p.territoriya_id = :ter'); R.ter = idOl(q.territoriya_id, 'territoriya_id'); }
    if (q.kassa_id) { w.push('p.kassa_id = :kassa'); R.kassa = idOl(q.kassa_id, 'kassa_id'); }
    if (q.mijoz_id) { w.push('p.mijoz_id = :mijoz'); R.mijoz = idOl(q.mijoz_id, 'mijoz_id'); }
    const d = davrOl(q);
    if (d.dan) { w.push('p.sana >= :dan'); R.dan = d.dan; }
    if (d.gacha) { w.push('p.sana < :gacha'); R.gacha = d.gacha; }
    const { limit, offset, page } = sahifa(q);
    const W = w.join(' AND ');
    const [[jami], rows] = await Promise.all([
      sequelize.query(`SELECT COUNT(*) soni, COALESCE(SUM(p.summa),0) summa FROM plastik_tolov p WHERE ${W}`, { replacements: R }),
      sequelize.query(`SELECT p.*, k.nomi kassa_nomi, t.nomi territoriya_nomi FROM plastik_tolov p
          LEFT JOIN kassalar k ON k.id = p.kassa_id LEFT JOIN territoriya t ON t.id = p.territoriya_id
          WHERE ${W} ORDER BY (p.holat = 'kutilmoqda') DESC, p.sana DESC, p.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { ...R, limit, offset }, type: sequelize.QueryTypes.SELECT }),
    ]);
    res.send({ data: rows.map(plastikJson), jami: { soni: Number(jami.soni) || 0, summa: n(jami.summa) }, page, limit });
  };
  plastikBitta = async (req, res) => res.send(await plastikBitta(idOl(req.params.id)));
  plastikAudit = async (req, res) => { const id = idOl(req.params.id); await plastikBitta(id); res.send(await P.auditRoyxat('plastik_tolov', id)); };
  plastikTasdiqla = async (req, res) => {
    const id = idOl(req.params.id);
    await P.plastikTasdiqla(id, req.currentUser, { izoh: req.body && req.body.izoh ? String(req.body.izoh).slice(0, 500) : null });
    res.send(await plastikBitta(id));
  };
  plastikRad = async (req, res) => {
    const id = idOl(req.params.id);
    await P.plastikRad(id, req.currentUser, req.body && req.body.sabab);
    res.send(await plastikBitta(id));
  };
  plastikTahrir = async (req, res) => {
    const id = idOl(req.params.id);
    const b = req.body || {};
    const ortiqcha = Object.keys(b).filter(k => !['summa', 'kassa_id', 'sabab'].includes(k));
    if (ortiqcha.length) throw new HttpException(400, `Noma'lum maydon: ${ortiqcha.join(', ')}`);
    await P.plastikTahrir(id, req.currentUser, b);
    res.send(await plastikBitta(id));
  };

  /* ── Agent naqd topshiruvlari ── */
  // GET /kassalar/topshiruvlar?holat=&agent_id=&kassa_id=&dan=&gacha=&page=&limit=
  topshiruvRoyxat = async (req, res) => {
    const q = req.query;
    const w = ['1=1'], R = {};
    if (q.holat) { if (!HOLATLAR.includes(q.holat)) throw new HttpException(400, `holat: ${HOLATLAR.join(', ')}`); w.push('x.holat = :holat'); R.holat = q.holat; }
    if (q.agent_id) { w.push('x.agent_id = :agent'); R.agent = idOl(q.agent_id, 'agent_id'); }
    if (q.kassa_id) { w.push('x.kassa_id = :kassa'); R.kassa = idOl(q.kassa_id, 'kassa_id'); }
    if (q.territoriya_id) { w.push('x.agent_id IN (SELECT id FROM agent WHERE territoriya_id = :ter)'); R.ter = idOl(q.territoriya_id, 'territoriya_id'); }
    const d = davrOl(q);
    if (d.dan) { w.push('x.sana >= :dan'); R.dan = d.dan; }
    if (d.gacha) { w.push('x.sana < :gacha'); R.gacha = d.gacha; }
    const { limit, offset, page } = sahifa(q);
    const W = w.join(' AND ');
    const [[jami], rows] = await Promise.all([
      sequelize.query(`SELECT COUNT(*) soni, COALESCE(SUM(x.summa),0) summa FROM pul_topshiruv x WHERE ${W}`, { replacements: R }),
      sequelize.query(`SELECT x.*, k.nomi kassa_nomi FROM pul_topshiruv x LEFT JOIN kassalar k ON k.id = x.kassa_id
          WHERE ${W} ORDER BY (x.holat = 'kutilmoqda') DESC, x.sana DESC, x.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { ...R, limit, offset }, type: sequelize.QueryTypes.SELECT }),
    ]);
    const pul = await P.majburiyatlar(rows.map(r => r.agent_id));
    res.send({
      data: rows.map(r => ({ ...topshiruvJson(r), agent_qolda: (pul.get(Number(r.agent_id)) || {}).qolda ?? 0 })),
      jami: { soni: Number(jami.soni) || 0, summa: n(jami.summa) }, page, limit,
    });
  };
  topshiruvBitta = async (req, res) => res.send(await topshiruvBitta(idOl(req.params.id)));
  topshiruvTasdiqla = async (req, res) => {
    const id = idOl(req.params.id);
    const b = req.body || {};
    await P.topshiruvTasdiqla(id, req.currentUser, { kassa_id: b.kassa_id, izoh: b.izoh ? String(b.izoh).slice(0, 500) : null });
    res.send(await topshiruvBitta(id));
  };
  topshiruvRad = async (req, res) => {
    const id = idOl(req.params.id);
    await P.topshiruvRad(id, req.currentUser, req.body && req.body.sabab);
    res.send(await topshiruvBitta(id));
  };

  /* GET /kassalar/agentlar?territoriya_id=&faol= — har agent majburiyati */
  agentlar = async (req, res) => {
    const where = {};
    if (req.query.territoriya_id) where.territoriya_id = idOl(req.query.territoriya_id, 'territoriya_id');
    if (req.query.faol !== undefined && req.query.faol !== '') where.faol = boolOl(req.query.faol, 'faol');
    const agentlar = await AgentModel.findAll({ where, attributes: ['id', 'fullname', 'territoriya_id', 'super_agent_id', 'faol'], order: [['fullname', 'ASC']], raw: true });
    const pul = await P.majburiyatlar(agentlar.map(a => a.id));
    res.send(agentlar.map(a => ({ ...a, faol: !!a.faol, pul: pul.get(a.id) })));
  };
}

/* Kassada har qanday harakat bormi (jurnal, plastik, topshiruv) */
async function kassaIshlatilgan(id, transaction) {
  const [a, b, c] = await Promise.all([
    KassaModel.count({ where: { kassa_id: id }, transaction }),
    PlastikTolovModel.count({ where: { kassa_id: id }, transaction }),
    PulTopshiruvModel.count({ where: { kassa_id: id }, transaction }),
  ]);
  return a + b + c > 0;
}

module.exports = new KassalarController();
