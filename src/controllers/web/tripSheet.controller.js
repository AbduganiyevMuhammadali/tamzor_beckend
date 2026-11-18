const { Op } = require('sequelize');
const { TripSheetModel, YetkazishQaytarishModel } = require('../../models/tripSheet.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const DostavchiModel = require('../../models/dostavchi.model');
const HttpException = require('../../utils/HttpException.utils');
const sequelize = require('../../db/db-sequelize');

const INCLUDE = [
  { model: ArizaQatorModel, as: 'qatorlar' },
  { model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'telefon', 'manzil'] },
];

class TripSheetController {
  // Trip sheetlar ro'yxati (sana/dostavchi filtri bilan)
  getAll = async (req, res) => {
    const { dostavchi_id, sana, date_from, date_to } = req.query;
    const where = {};
    if (dostavchi_id) where.dostavchi_id = dostavchi_id;
    if (sana) where.sana = sana;
    else if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = date_from;
      if (date_to) where.sana[Op.lte] = date_to;
    }
    const trips = await TripSheetModel.findAll({ where, order: [['sana', 'DESC'], ['id', 'DESC']] });
    const tripIds = trips.map(t => t.id);
    const counts = tripIds.length
      ? await ArizaModel.findAll({
          where: { trip_sheet_id: { [Op.in]: tripIds } },
          attributes: ['trip_sheet_id', [sequelize.fn('COUNT', sequelize.col('id')), 'soni']],
          group: ['trip_sheet_id'], raw: true,
        })
      : [];
    const countMap = {};
    counts.forEach(c => { countMap[c.trip_sheet_id] = Number(c.soni); });
    res.send(trips.map(t => ({ ...t.toJSON(), hujjat_soni: countMap[t.id] || 0 })));
  };

  // Bitta trip sheet to'liq (hujjatlari bilan)
  getById = async (req, res) => {
    const trip = await TripSheetModel.findByPk(req.params.id);
    if (!trip) throw new HttpException(404, 'Topilmadi');
    const arizalar = await ArizaModel.findAll({
      where: { trip_sheet_id: trip.id },
      include: INCLUDE, order: [['trip_tartib', 'ASC'], ['id', 'ASC']],
    });
    res.send({ ...trip.toJSON(), arizalar });
  };

  // Yangi trip sheet yaratish + arizalarni tayinlash
  // body: { dostavchi_id, sana, ariza_idlar: [1,2,3] }
  create = async (req, res) => {
    const { dostavchi_id, sana, ariza_idlar } = req.body;
    if (!dostavchi_id || !sana) throw new HttpException(400, 'dostavchi_id va sana majburiy');

    const dostavchi = await DostavchiModel.findByPk(dostavchi_id);
    if (!dostavchi) throw new HttpException(404, 'Dostavchik topilmadi');

    const t = await sequelize.transaction();
    try {
      const count = await TripSheetModel.count({ where: { sana } }, { transaction: t });
      const trip = await TripSheetModel.create({
        raqam: `TS-${sana}-${String(count + 1).padStart(3, '0')}`,
        dostavchi_id, dostavchi_nomi: dostavchi.ism, sana,
      }, { transaction: t });

      if (Array.isArray(ariza_idlar) && ariza_idlar.length) {
        for (let i = 0; i < ariza_idlar.length; i++) {
          await ArizaModel.update(
            { trip_sheet_id: trip.id, trip_tartib: i + 1, dostavchi_id, dostavchi_nomi: dostavchi.ism },
            { where: { id: ariza_idlar[i] }, transaction: t },
          );
        }
      }
      await t.commit();
      res.status(201).send(trip);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  };

  // Trip sheetga qo'shimcha ariza(lar) qo'shish
  addArizalar = async (req, res) => {
    const trip = await TripSheetModel.findByPk(req.params.id);
    if (!trip) throw new HttpException(404, 'Topilmadi');
    const { ariza_idlar } = req.body;
    if (!Array.isArray(ariza_idlar) || !ariza_idlar.length) throw new HttpException(400, 'ariza_idlar majburiy');

    const mavjud = await ArizaModel.count({ where: { trip_sheet_id: trip.id } });
    for (let i = 0; i < ariza_idlar.length; i++) {
      await ArizaModel.update(
        { trip_sheet_id: trip.id, trip_tartib: mavjud + i + 1, dostavchi_id: trip.dostavchi_id, dostavchi_nomi: trip.dostavchi_nomi },
        { where: { id: ariza_idlar[i] } },
      );
    }
    res.send({ success: true });
  };

  // Hujjatni trip sheetdan olib tashlash
  removeAriza = async (req, res) => {
    await ArizaModel.update(
      { trip_sheet_id: null, trip_tartib: null },
      { where: { id: req.params.arizaId, trip_sheet_id: req.params.id } },
    );
    res.send({ success: true });
  };

  // Dostavchikga hali trip sheetga tushmagan, tayinlanishi mumkin bo'lgan arizalar
  tayinlanmaganArizalar = async (req, res) => {
    const { dostavchi_id } = req.query;
    const where = { turi: 'sotish', holat: { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] }, trip_sheet_id: null };
    if (dostavchi_id) where.dostavchi_id = dostavchi_id;
    const rows = await ArizaModel.findAll({ where, include: INCLUDE, order: [['createdAt', 'ASC']] });
    res.send(rows);
  };

  /* ── Qaytarish / Brak ro'yxati (yetkazishda) ── */
  qaytarishRuyxat = async (req, res) => {
    const { tur, dostavchi_id, date_from, date_to } = req.query;
    const where = {};
    if (tur) where.tur = tur;
    if (dostavchi_id) where.dostavchi_id = dostavchi_id;
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to) where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }
    const rows = await YetkazishQaytarishModel.findAll({ where, order: [['sana', 'DESC']], limit: 300 });
    res.send(rows);
  };
}

module.exports = new TripSheetController();
