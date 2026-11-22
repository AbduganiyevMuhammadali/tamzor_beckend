const { YetkazuvchiModel, YetkazuvchiHarakatlarModel } = require('../../models/yetkazuvchi.model');
const KassaModel = require('../../models/kassa.model');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { ixtiyoriyKassa } = require('../../utils/agentPul.utils');

class YetkazuvchiController extends BaseController {

  getAll = async (req, res) => {
    const { search } = req.query;
    // NaN / manfiy / haddan katta qiymatlardan himoya (standart 100, maksimum 1000)
    const limRaw = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(limRaw) && limRaw > 0 ? Math.min(1000, limRaw) : 100;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const where = {};
    if (search) where.ism = { [Op.like]: `%${search}%` };
    const offset = (page - 1) * limit;
    const { count, rows } = await YetkazuvchiModel.findAndCountAll({
      where,
      order: [['ism', 'ASC']],
      limit,
      offset,
    });
    res.send({ data: rows, total: count, page, pages: Math.ceil(count / limit) });
  };

  /* GET /yetkazuvchilar/qoldiqlar — sahifa tepasidagi ikki ro'yxat.
     balans < 0 → yetkazuvchi HAQDOR (biz unga qarzmiz: prixod olingan, to'lanmagan);
     balans > 0 → yetkazuvchi QARZDOR (biz ortiqcha/oldindan to'laganmiz — avans). */
  qoldiqlar = async (req, res) => {
    const rows = await sequelize.query(`
      SELECT y.id, y.ism, y.telefon, y.balans,
             (SELECT MAX(h.sana) FROM yetkazuvchi_harakatlar h WHERE h.yetkazuvchi_id = y.id) AS oxirgi_harakat,
             (SELECT MAX(h.sana) FROM yetkazuvchi_harakatlar h WHERE h.yetkazuvchi_id = y.id AND h.tur = 'tolov') AS oxirgi_tolov
      FROM yetkazuvchi y
      WHERE y.balans <> 0
      ORDER BY ABS(y.balans) DESC`, { type: sequelize.QueryTypes.SELECT });
    const shakl = r => ({ id: r.id, ism: r.ism, telefon: r.telefon || '', summa: Math.abs(parseFloat(r.balans) || 0), oxirgi_harakat: r.oxirgi_harakat, oxirgi_tolov: r.oxirgi_tolov });
    const haqdor  = rows.filter(r => parseFloat(r.balans) < 0).map(shakl);
    const qarzdor = rows.filter(r => parseFloat(r.balans) > 0).map(shakl);
    res.send({
      haqdor, qarzdor,
      jami: {
        haqdor:  +haqdor.reduce((s, r) => s + r.summa, 0).toFixed(2),  haqdorSoni:  haqdor.length,
        qarzdor: +qarzdor.reduce((s, r) => s + r.summa, 0).toFixed(2), qarzdorSoni: qarzdor.length,
      },
    });
  };

  getById = async (req, res) => {
    const y = await YetkazuvchiModel.findByPk(req.params.id);
    if (!y) throw new HttpException(404, 'Yetkazuvchi topilmadi');
    res.send(y);
  };

  create = async (req, res) => {
    this.checkValidation(req);
    const { ism, telefon, manzil, izoh } = req.body;
    const y = await YetkazuvchiModel.create({ ism, telefon: telefon || null, manzil: manzil || null, izoh: izoh || null, balans: 0 });
    res.status(201).send(y);
  };

  update = async (req, res) => {
    this.checkValidation(req);
    const y = await YetkazuvchiModel.findByPk(req.params.id);
    if (!y) throw new HttpException(404, 'Yetkazuvchi topilmadi');
    const { ism, telefon, manzil, izoh } = req.body;
    await y.update({ ism: ism ?? y.ism, telefon: telefon ?? y.telefon, manzil: manzil ?? y.manzil, izoh: izoh ?? y.izoh });
    res.send(y);
  };

  /* O'chirish faqat "toza" yetkazuvchi uchun: balans 0 va hech qanday prixod / harakat (qarz, to'lov) yo'q.
     Aks holda ledger va prixodlar egasiz qolib, qarz hisoboti buziladi. Tekshiruv tranzaksiya ichida,
     yetkazuvchi qatori qulflangan holda (parallel to'lov / prixod bilan poyga yo'q). */
  delete = async (req, res) => {
    await sequelize.transaction(async (t) => {
      const y = await YetkazuvchiModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!y) throw new HttpException(404, 'Yetkazuvchi topilmadi');
      if (Math.abs(parseFloat(y.balans) || 0) > 0.005) {
        throw new HttpException(400, `Yetkazuvchini o'chirib bo'lmaydi: balansi 0 emas (${parseFloat(y.balans)}). Avval hisob-kitobni yoping`);
      }
      const [r] = await sequelize.query(`
        SELECT (SELECT COUNT(*) FROM prixod WHERE yetkazuvchi_id = :id) AS prixod,
               (SELECT COUNT(*) FROM yetkazuvchi_harakatlar WHERE yetkazuvchi_id = :id) AS harakat`,
      { replacements: { id: y.id }, type: sequelize.QueryTypes.SELECT, transaction: t });
      if (Number(r.prixod) > 0 || Number(r.harakat) > 0) {
        throw new HttpException(400, `Yetkazuvchini o'chirib bo'lmaydi: unga bog'langan ${Number(r.prixod)} ta prixod va ${Number(r.harakat)} ta harakat (qarz/to'lov) bor`);
      }
      await y.destroy({ transaction: t });
    });
    res.send({ message: "O'chirildi" });
  };

  // To'lov qilish: balans oshadi (manfiy qarzni kamaytiradi). Body: summa, tolov_turi, izoh?, sana?, kassa_id? (2026-11-27)
  tolov = async (req, res) => {
    this.checkValidation(req);
    const y = await YetkazuvchiModel.findByPk(req.params.id);
    if (!y) throw new HttpException(404, 'Yetkazuvchi topilmadi');

    const { summa, tolov_turi, izoh, sana } = req.body;
    if (!Number.isFinite(Number(summa)) || Number(summa) <= 0) throw new HttpException(400, "Summa noto'g'ri");
    // Sana tekshiruvi: Invalid Date bazaga yozilib 500 bermasin
    const sanaQiymat = sana ? new Date(sana) : new Date();
    if (Number.isNaN(sanaQiymat.getTime())) throw new HttpException(400, "Sana noto'g'ri (YYYY-MM-DD)");
    const t = await sequelize.transaction();
    try {
      // 2026-11-27: ixtiyoriy kassa_id — to'lov shu kassadan (faol; tolov_usul kassa turidan), summa kassa
      // balansidan oshmasin. Kassa qulfi — tranzaksiyadagi birinchi o'qish. kassa_id siz — avvalgidek (naqt, kassasiz).
      const kx = await ixtiyoriyKassa(req.body.kassa_id, t, { tur: 'chiqim', summa: Number(summa) });
      await y.increment('balans', { by: Number(summa), transaction: t });
      await YetkazuvchiHarakatlarModel.create({
        yetkazuvchi_id: y.id,
        prixod_id:  null,
        tur:        'tolov',
        summa:      Number(summa),
        tolov_turi: tolov_turi || null,
        izoh:       izoh || null,
        sana:       sanaQiymat,
      }, { transaction: t });

      // Kassadan CHIQIM — yetkazuvchiga to'lov
      await KassaModel.create({
        tur:        'chiqim',
        kategoriya: 'yetkazuvchi_tolov',
        summa:      Number(summa),
        tolov_usul: kx ? kx.tolov_usul : 'naqt',
        kassa_id:   kx ? kx.kassa.id : null,
        manba_tur:  'yetkazuvchi',
        manba_id:   y.id,
        izoh:       izoh || `${y.ism} ga to'lov`,
        sana:       sanaQiymat,
      }, { transaction: t });

      await t.commit();
      await y.reload();
      res.send(y);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  };

  // Ledger tarixi
  harakatlar = async (req, res) => {
    // NaN / haddan katta qiymatlar cheklanadi
    const lim = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
    const pg  = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (pg - 1) * lim;
    const { count, rows } = await YetkazuvchiHarakatlarModel.findAndCountAll({
      where: { yetkazuvchi_id: req.params.id },
      order: [['sana', 'DESC'], ['id', 'DESC']],
      limit: lim,
      offset,
    });
    res.send({ data: rows, total: count, page: pg, pages: Math.ceil(count / lim) });
  };
}

module.exports = new YetkazuvchiController();
