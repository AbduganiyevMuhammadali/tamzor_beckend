/**
 * MOLIYA → QARZ OLDI-BERDI: uchinchi shaxslarga qarz berish va ulardan qarz olish.
 * Har pulli harakat kassaga yoziladi (kassa_id), shuning uchun kassa qoldig'i to'g'ri.
 * Foyda-zarar hisobotida bu harakatlar daromad ham, xarajat ham emas (tahlil.controller XARAJAT_EMAS),
 * biznes balansida esa "Berilgan qarzlar" (aktiv) va "Olingan qarzlar" (majburiyat).
 *
 * Qoldiq ishorasi: musbat — shaxs bizga qarzdor, manfiy — biz shaxsga qarzdormiz.
 */
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const KassaModel = require('../../models/kassa.model');
const { UchinchiShaxsModel, UchinchiShaxsHarakatModel, HARAKAT_TUR } = require('../../models/uchinchiShaxs.model');
const HttpException = require('../../utils/HttpException.utils');
const { ixtiyoriyKassa, kassaKirimKamayTekshir } = require('../../utils/agentPul.utils');
const { qulflabOl } = require('../../utils/qulf.utils');

const n = v => Number(v) || 0;
const yax = v => Math.round(n(v) * 100) / 100;
const PULLI = ['qarz_berdik', 'qaytardi', 'qarz_oldik', 'qaytardik'];
const USUL = ['naqt', 'karta', 'bank'];
const ISHORA_SQL = `CASE h.tur WHEN 'qarz_berdik' THEN 1 WHEN 'qaytardik' THEN 1 WHEN 'bosh_qarzdor' THEN 1 ELSE -1 END`;

function sanaOl(v) {
  if (!v) return new Date();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T12:00:00` : v);
  if (isNaN(d)) throw new HttpException(400, "Sana noto'g'ri");
  return d;
}
/* Qaytarish muddati: YYYY-MM-DD va haqiqiy sana (aks holda 400). Bo'sh — null */
function muddatOl(v) {
  if (v === undefined || v === null || v === '') return null;
  const m = String(v).slice(0, 10);
  const d = new Date(`${m}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(m) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== m) {
    throw new HttpException(400, "Muddat sanasi noto'g'ri (YYYY-MM-DD)");
  }
  return m;
}
/* Shaxs izohi (TEXT) — juda uzun matn rad etiladi */
function shaxsIzoh(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  if (s.length > 2000) throw new HttpException(400, 'Izoh 2000 belgidan oshmasin');
  return s;
}
const bugunISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* Bitta shaxs bo'yicha yig'indilar (ro'yxat va kartochka uchun) */
async function yigindilar(ids) {
  if (ids && !ids.length) return new Map();
  const rows = await sequelize.query(`
    SELECT h.shaxs_id,
      COALESCE(SUM(${ISHORA_SQL} * h.summa), 0) AS qoldiq,
      COALESCE(SUM(CASE WHEN h.tur IN ('qarz_berdik', 'bosh_qarzdor') THEN h.summa END), 0) AS berilgan,
      COALESCE(SUM(CASE WHEN h.tur = 'qaytardi'  THEN h.summa END), 0) AS qaytgan,
      COALESCE(SUM(CASE WHEN h.tur IN ('qarz_oldik', 'bosh_haqdor') THEN h.summa END), 0) AS olingan,
      COALESCE(SUM(CASE WHEN h.tur = 'qaytardik' THEN h.summa END), 0) AS qaytarilgan,
      MAX(h.sana) AS oxirgi_sana, COUNT(*) AS soni,
      MIN(CASE WHEN h.tur IN ('qarz_berdik', 'bosh_qarzdor') THEN h.muddat END) AS muddat_bizga,
      MIN(CASE WHEN h.tur IN ('qarz_oldik', 'bosh_haqdor') THEN h.muddat END) AS muddat_bizdan
    FROM uchinchi_shaxs_harakat h ${ids ? 'WHERE h.shaxs_id IN (:ids)' : ''}
    GROUP BY h.shaxs_id`, { replacements: { ids: ids || [] }, type: sequelize.QueryTypes.SELECT });
  const bugun = bugunISO();
  return new Map(rows.map(r => {
    const qoldiq = yax(r.qoldiq);
    // Muddat: ochiq qarz yo'nalishidagi eng erta qaytarish sanasi
    const muddat = qoldiq > 0.5 ? r.muddat_bizga : qoldiq < -0.5 ? r.muddat_bizdan : null;
    return [r.shaxs_id, {
      qoldiq, berilgan: yax(r.berilgan), qaytgan: yax(r.qaytgan), olingan: yax(r.olingan), qaytarilgan: yax(r.qaytarilgan),
      oxirgi_sana: r.oxirgi_sana, soni: n(r.soni), muddat, muddati_otgan: !!(muddat && String(muddat).slice(0, 10) < bugun),
    }];
  }));
}
const BOSH = { qoldiq: 0, berilgan: 0, qaytgan: 0, olingan: 0, qaytarilgan: 0, oxirgi_sana: null, soni: 0, muddat: null, muddati_otgan: false };

/* Pulli harakat: harakat + kassa yozuvi bitta tranzaksiyada */
async function harakatYoz(shaxs, b, userId, t) {
  const tur = b.tur;
  const T = HARAKAT_TUR[tur];
  if (!T) throw new HttpException(400, "Amal turi noto'g'ri");
  const summa = yax(b.summa);
  if (!(summa > 0)) throw new HttpException(400, "Summa noto'g'ri");
  const sana = sanaOl(b.sana);
  let usul = USUL.includes(b.tolov_usul) ? b.tolov_usul : 'naqt';
  const muddat = (tur === 'qarz_berdik' || tur === 'qarz_oldik' || tur.startsWith('bosh_')) ? muddatOl(b.muddat) : null;
  if (b.izoh && String(b.izoh).trim().length > 255) throw new HttpException(400, 'Izoh 255 belgidan oshmasin');
  const izoh = b.izoh ? String(b.izoh).trim().slice(0, 255) : null;
  let kassa = null;
  if (T.kassa) {
    // 2026-11-27: ixtiyoriy b.kassa_id (kassalar) — faol kassa, tolov_usul kassa turiga mos; chiqim (qarz_berdik,
    // qaytardik) kassa balansidan oshmasin. Qulf — tranzaksiyadagi birinchi o'qish. Yuborilmasa — avvalgidek.
    const kx = await ixtiyoriyKassa(b.kassa_id, t, { tur: T.kassa, summa, tolovUsul: USUL.includes(b.tolov_usul) ? b.tolov_usul : null });
    if (kx) usul = kx.tolov_usul;
    kassa = await KassaModel.create({
      tur: T.kassa, kategoriya: T.kategoriya, summa, tolov_usul: usul, kassa_id: kx ? kx.kassa.id : null,
      manba_tur: 'uchinchi_shaxs', manba_id: null, mijoz_id: null, mijoz_nomi: shaxs.ism,
      izoh: `${T.nom}: ${shaxs.ism}${izoh ? ' — ' + izoh : ''}`.slice(0, 255), sana, user_id: userId || null,
    }, { transaction: t });
  }
  const h = await UchinchiShaxsHarakatModel.create({
    shaxs_id: shaxs.id, tur, summa, tolov_usul: T.kassa ? usul : null, sana, muddat, izoh, kassa_id: kassa ? kassa.id : null, user_id: userId || null,
  }, { transaction: t });
  if (kassa) await kassa.update({ manba_id: h.id }, { transaction: t });
  return h;
}

class UchinchiShaxsController {

  /* GET /uchinchi-shaxslar?search&holat=hammasi|bizga|bizdan|teng */
  getAll = async (req, res) => {
    const { search, holat } = req.query;
    const where = {};
    if (search) where[Op.or] = [{ ism: { [Op.like]: `%${search}%` } }, { telefon: { [Op.like]: `%${search}%` } }];
    const shaxslar = await UchinchiShaxsModel.findAll({ where, order: [['ism', 'ASC']], raw: true });
    const yig = await yigindilar(shaxslar.map(s => s.id));
    let rows = shaxslar.map(s => ({ ...s, ...(yig.get(s.id) || BOSH) }));
    // Umumiy jami (filtrlashdan oldin)
    const jami = {
      bizga: yax(rows.filter(r => r.qoldiq > 0.5).reduce((a, r) => a + r.qoldiq, 0)),
      bizgaSoni: rows.filter(r => r.qoldiq > 0.5).length,
      bizdan: yax(rows.filter(r => r.qoldiq < -0.5).reduce((a, r) => a - r.qoldiq, 0)),
      bizdanSoni: rows.filter(r => r.qoldiq < -0.5).length,
      tengSoni: rows.filter(r => Math.abs(r.qoldiq) <= 0.5).length,
      muddatiOtgan: rows.filter(r => r.muddati_otgan).length,
      shaxslar: rows.length,
    };
    if (holat === 'bizga') rows = rows.filter(r => r.qoldiq > 0.5);
    else if (holat === 'bizdan') rows = rows.filter(r => r.qoldiq < -0.5);
    else if (holat === 'teng') rows = rows.filter(r => Math.abs(r.qoldiq) <= 0.5);
    // Avval muddati o'tganlar, keyin katta qoldiq
    rows.sort((a, b) => (b.muddati_otgan - a.muddati_otgan) || (Math.abs(b.qoldiq) - Math.abs(a.qoldiq)) || a.ism.localeCompare(b.ism));
    res.send({ rows, jami });
  };

  /* GET /uchinchi-shaxslar/:id — shaxs + harakatlar (yuguruvchi qoldiq bilan) */
  getById = async (req, res) => {
    const s = await UchinchiShaxsModel.findByPk(req.params.id, { raw: true });
    if (!s) throw new HttpException(404, 'Shaxs topilmadi');
    const harakatlar = await UchinchiShaxsHarakatModel.findAll({ where: { shaxs_id: s.id }, order: [['sana', 'ASC'], ['id', 'ASC']], raw: true });
    let qoldiq = 0;
    const qatorlar = harakatlar.map(h => {
      const T = HARAKAT_TUR[h.tur];
      const tasir = yax(T.ishora * n(h.summa));
      qoldiq = yax(qoldiq + tasir);
      return { ...h, summa: n(h.summa), nom: T.nom, kassa: T.kassa, tasir, qoldiq };
    }).reverse();
    const yig = (await yigindilar([s.id])).get(s.id) || BOSH;
    res.send({ shaxs: { ...s, ...yig }, harakatlar: qatorlar });
  };

  /* POST /uchinchi-shaxslar { ism, telefon, izoh, boshlangich: { yon: 'qarzdor'|'haqdor', summa, sana, muddat, izoh } } */
  create = async (req, res) => {
    const ism = String(req.body.ism || '').trim();
    if (!ism) throw new HttpException(400, 'Ism kiritilmagan');
    const bosh = req.body.boshlangich;
    const izoh = shaxsIzoh(req.body.izoh);
    const s = await sequelize.transaction(async (t) => {
      const s = await UchinchiShaxsModel.create({ ism: ism.slice(0, 150), telefon: req.body.telefon ? String(req.body.telefon).trim().slice(0, 30) : null, izoh }, { transaction: t });
      if (bosh && n(bosh.summa) > 0 && (bosh.yon === 'qarzdor' || bosh.yon === 'haqdor')) {
        await harakatYoz(s, { tur: bosh.yon === 'qarzdor' ? 'bosh_qarzdor' : 'bosh_haqdor', summa: bosh.summa, sana: bosh.sana, muddat: bosh.muddat, izoh: bosh.izoh || "Tizimga o'tishdagi qoldiq" }, req.currentUser?.id, t);
      }
      return s;
    });
    res.status(201).send(s);
  };

  /* PATCH /uchinchi-shaxslar/:id { ism, telefon, izoh, faol } */
  update = async (req, res) => {
    const s = await UchinchiShaxsModel.findByPk(req.params.id);
    if (!s) throw new HttpException(404, 'Shaxs topilmadi');
    const u = {};
    if (req.body.ism !== undefined) { const ism = String(req.body.ism || '').trim(); if (!ism) throw new HttpException(400, 'Ism kiritilmagan'); u.ism = ism.slice(0, 150); }
    if (req.body.telefon !== undefined) u.telefon = req.body.telefon ? String(req.body.telefon).trim().slice(0, 30) : null;
    if (req.body.izoh !== undefined) u.izoh = shaxsIzoh(req.body.izoh);
    if (req.body.faol !== undefined) u.faol = !!req.body.faol;
    await s.update(u);
    res.send(s);
  };

  /* DELETE /uchinchi-shaxslar/:id — faqat harakatsiz shaxs (tarix yo'qolmasin) */
  delete = async (req, res) => {
    const s = await UchinchiShaxsModel.findByPk(req.params.id);
    if (!s) throw new HttpException(404, 'Shaxs topilmadi');
    const soni = await UchinchiShaxsHarakatModel.count({ where: { shaxs_id: s.id } });
    if (soni) throw new HttpException(400, `${s.ism} bilan ${soni} ta oldi-berdi yozuvi bor — o'chirib bo'lmaydi. Kerak bo'lmasa, nofaol qiling.`);
    await s.destroy();
    res.send({ message: "O'chirildi" });
  };

  /* POST /uchinchi-shaxslar/:id/harakat { tur, summa, tolov_usul, sana, muddat, izoh, kassa_id? } */
  harakat = async (req, res) => {
    const s = await UchinchiShaxsModel.findByPk(req.params.id);
    if (!s) throw new HttpException(404, 'Shaxs topilmadi');
    if (!PULLI.includes(req.body.tur)) throw new HttpException(400, "Amal turi noto'g'ri");
    const h = await sequelize.transaction(t => harakatYoz(s, req.body, req.currentUser?.id, t));
    const yig = (await yigindilar([s.id])).get(s.id) || BOSH;
    res.status(201).send({ harakat: h, qoldiq: yig.qoldiq });
  };

  /* DELETE /uchinchi-shaxslar/harakat/:hid — harakat va uning kassa yozuvi birga o'chadi */
  harakatOchir = async (req, res) => {
    const hid = Number(req.params.hid);
    if (!Number.isInteger(hid) || hid <= 0) throw new HttpException(404, 'Yozuv topilmadi');
    await sequelize.transaction(async (t) => {
      // Qulflar — tranzaksiyadagi birinchi o'qishlar: harakat → kassa yozuvi → kassa (parallel o'chirish/chiqim bilan navbat)
      const h = await qulflabOl(UchinchiShaxsHarakatModel, hid, t);
      if (!h) throw new HttpException(404, 'Yozuv topilmadi');
      if (h.kassa_id) {
        const rec = await qulflabOl(KassaModel, h.kassa_id, t);
        // 2026-11-28 (egasi qarori 25): kassa_id li kirim (qaytardi, qarz_oldik) o'chsa kassa balansi minusga tushmasin
        if (rec && rec.tur === 'kirim' && rec.kassa_id) await kassaKirimKamayTekshir(rec.kassa_id, rec.summa, t);
        if (rec) await rec.destroy({ transaction: t });
      }
      await h.destroy({ transaction: t });
    });
    res.send({ message: "O'chirildi" });
  };
}

module.exports = new UchinchiShaxsController();
module.exports.yigindilar = yigindilar;
