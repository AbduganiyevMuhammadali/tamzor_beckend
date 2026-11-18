/**
 * TURKUMLAR (Sozlamalar → Turkumlar) — tovar turkumlari va ularga tovar biriktirish.
 *   GET    /turkumlar?faol=&search=        ro'yxat (+ tovar_soni)
 *   GET    /turkumlar/:id                  turkum + tovarlari
 *   GET    /turkumlar/:id/tanlash?search=  biriktirish uchun boshqa / turkumsiz tovarlar
 *   POST   /turkumlar                      { nomi, kod, izoh }
 *   PATCH  /turkumlar/tartib               { idlar: [] } — ro'yxat tartibi
 *   PATCH  /turkumlar/:id                  { nomi, kod, izoh, faol } — nom o'zgarsa hujjatlarga tarqaladi
 *   PATCH  /turkumlar/:id/faol             ko'rsatish / yashirish
 *   PATCH  /turkumlar/:id/tovarlar         { qoshish: [tovar_id], olib_tashlash: [tovar_id] }
 *   DELETE /turkumlar/:id?kochir=ID        tovarlari bo'lsa — faqat boshqa turkumga ko'chirib
 */
const { Op, literal } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const TurkumModel = require('../../models/turkum.model');
const TovarModel = require('../../models/tovar.model');
const HttpException = require('../../utils/HttpException.utils');
const { turkumNominiYangila, tovarTurkuminiTarqat, nomBoyicha } = require('../../utils/turkum.utils');

const TOVAR_SONI = literal('(SELECT COUNT(*) FROM tovar t WHERE t.turkum_id = `TurkumModel`.`id` AND t.deletedAt IS NULL)');
const TOVAR_ATTR = ['id', 'nomi', 'shtrix_kod', 'olchov_birligi', 'faol', 'turi', 'turkum', 'turkum_id'];
const nomTozala = (v) => String(v ?? '').trim().slice(0, 80);
const idlar = (v) => (Array.isArray(v) ? v : []).map(Number).filter(Boolean);

async function topish(id) {
  const t = await TurkumModel.findByPk(id);
  if (!t) throw new HttpException(404, 'Turkum topilmadi');
  return t;
}
async function nomBandmi(nomi, oziId = null, transaction) {
  const bor = await nomBoyicha(nomi, transaction);
  if (bor && bor.id !== oziId) throw new HttpException(400, `"${bor.nomi}" nomli turkum allaqachon bor`);
}
const shakl = (r) => ({ ...r.toJSON(), tovar_soni: Number(r.get('tovar_soni') || 0) });

class TurkumController {
  getAll = async (req, res) => {
    const { faol, search } = req.query;
    const where = {};
    if (faol === 'true') where.faol = true;
    if (faol === 'false') where.faol = false;
    if (search) where.nomi = { [Op.like]: `%${search}%` };
    const rows = await TurkumModel.findAll({
      where, attributes: { include: [[TOVAR_SONI, 'tovar_soni']] },
      order: [['tartib', 'ASC'], ['nomi', 'ASC']],
    });
    res.send(rows.map(shakl));
  };

  getById = async (req, res) => {
    const t = await TurkumModel.findByPk(req.params.id, { attributes: { include: [[TOVAR_SONI, 'tovar_soni']] } });
    if (!t) throw new HttpException(404, 'Turkum topilmadi');
    const tovarlar = await TovarModel.findAll({ where: { turkum_id: t.id }, attributes: TOVAR_ATTR, order: [['nomi', 'ASC']] });
    res.send({ ...shakl(t), tovarlar });
  };

  // Biriktirish uchun: shu turkumda bo'lmagan tovarlar (turkumsizlar birinchi)
  tanlash = async (req, res) => {
    const t = await topish(req.params.id);
    const where = { [Op.or]: [{ turkum_id: null }, { turkum_id: { [Op.ne]: t.id } }] };
    if (req.query.search) where.nomi = { [Op.like]: `%${req.query.search}%` };
    const rows = await TovarModel.findAll({
      where, attributes: TOVAR_ATTR,
      order: [[literal('turkum_id IS NULL'), 'DESC'], ['nomi', 'ASC']],
    });
    res.send(rows);
  };

  create = async (req, res) => {
    const nomi = nomTozala(req.body.nomi);
    if (!nomi) throw new HttpException(400, 'Turkum nomi majburiy');
    await nomBandmi(nomi);
    const max = await TurkumModel.max('tartib');
    const t = await TurkumModel.create({
      nomi, kod: nomTozala(req.body.kod) || null, izoh: nomTozala(req.body.izoh) || null,
      tartib: (Number(max) || 0) + 1, faol: req.body.faol === undefined ? true : !!req.body.faol,
    });
    res.status(201).send({ ...t.toJSON(), tovar_soni: 0 });
  };

  update = async (req, res) => {
    const t = await topish(req.params.id);
    const tr = await sequelize.transaction();
    try {
      if (req.body.nomi !== undefined) {
        const nomi = nomTozala(req.body.nomi);
        if (!nomi) throw new HttpException(400, 'Turkum nomi majburiy');
        await nomBandmi(nomi, t.id, tr);
        await turkumNominiYangila(t, nomi, tr);   // tovar + hujjat qatorlari
        t.nomi = nomi;
      }
      if (req.body.kod !== undefined)  t.kod  = nomTozala(req.body.kod) || null;
      if (req.body.izoh !== undefined) t.izoh = nomTozala(req.body.izoh) || null;
      if (req.body.faol !== undefined) t.faol = !!req.body.faol;
      if (req.body.tartib !== undefined) t.tartib = Number(req.body.tartib) || 0;
      await t.save({ transaction: tr });
      await tr.commit();
    } catch (e) { await tr.rollback(); throw e; }
    const soni = await TovarModel.count({ where: { turkum_id: t.id } });
    res.send({ ...t.toJSON(), tovar_soni: soni });
  };

  faol = async (req, res) => {
    const t = await topish(req.params.id);
    await t.update({ faol: !t.faol });
    res.send(t);
  };

  tartib = async (req, res) => {
    const list = idlar(req.body.idlar);
    if (!list.length) throw new HttpException(400, 'idlar majburiy');
    await sequelize.transaction(async (tr) => {
      for (const [i, id] of list.entries()) await TurkumModel.update({ tartib: i + 1 }, { where: { id }, transaction: tr });
    });
    res.send({ ok: true });
  };

  // Tovarlarni biriktirish / ajratish — tovar.turkum (nom) ham sinxron
  tovarlar = async (req, res) => {
    const t = await topish(req.params.id);
    const qoshish = idlar(req.body.qoshish), olibTashlash = idlar(req.body.olib_tashlash);
    await sequelize.transaction(async (tr) => {
      if (qoshish.length) {
        await TovarModel.update({ turkum_id: t.id, turkum: t.nomi }, { where: { id: { [Op.in]: qoshish } }, transaction: tr });
        await tovarTurkuminiTarqat(qoshish, t.nomi, tr);     // hujjat qatorlari (register, ariza…) ham
      }
      if (olibTashlash.length) {
        await TovarModel.update({ turkum_id: null, turkum: null }, { where: { id: { [Op.in]: olibTashlash }, turkum_id: t.id }, transaction: tr });
        await tovarTurkuminiTarqat(olibTashlash, null, tr);
      }
    });
    const tovarlar = await TovarModel.findAll({ where: { turkum_id: t.id }, attributes: TOVAR_ATTR, order: [['nomi', 'ASC']] });
    res.send({ ...t.toJSON(), tovar_soni: tovarlar.length, tovarlar });
  };

  delete = async (req, res) => {
    const t = await topish(req.params.id);
    const soni = await TovarModel.count({ where: { turkum_id: t.id } });
    const kochir = Number(req.query.kochir) || null;
    await sequelize.transaction(async (tr) => {
      if (soni > 0) {
        if (!kochir) throw new HttpException(400, `"${t.nomi}"da ${soni} ta tovar bor — avval ularni boshqa turkumga ko'chiring yoki turkumni yashiring`);
        if (kochir === t.id) throw new HttpException(400, 'Tovarlarni o\'sha turkumning o\'ziga ko\'chirib bo\'lmaydi');
        const yangi = await TurkumModel.findByPk(kochir, { transaction: tr });
        if (!yangi) throw new HttpException(404, 'Ko\'chiriladigan turkum topilmadi');
        const kochadi = (await TovarModel.findAll({ where: { turkum_id: t.id }, attributes: ['id'], raw: true, transaction: tr })).map(x => x.id);
        await TovarModel.update({ turkum_id: yangi.id, turkum: yangi.nomi }, { where: { turkum_id: t.id }, transaction: tr });
        await tovarTurkuminiTarqat(kochadi, yangi.nomi, tr);
      }
      await t.destroy({ transaction: tr });
    });
    res.send({ ok: true, kochirildi: soni });
  };
}

module.exports = new TurkumController();
