const { Op } = require('sequelize');
const { TripSheetModel, YetkazishQaytarishModel } = require('../../models/tripSheet.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const DostavchiModel = require('../../models/dostavchi.model');
const HttpException = require('../../utils/HttpException.utils');
const sequelize = require('../../db/db-sequelize');
const { keyingiTartib, maksRaqam } = require('../../utils/qulf.utils');

/* Trip sheetga tayinlash mumkin bo'lgan holatlar (tayinlanmaganArizalar bilan bir xil) */
const TAYINLASH_HOLAT = ['tasdiqlangan', 'yigilmoqda', 'yolda'];

/* ariza_idlar ni tozalaydi: musbat butun sonlar, takrorsiz, tartib saqlanadi */
function idlarniTozala(arr) {
  const ids = (arr || []).map(Number);
  if (ids.some(x => !Number.isInteger(x) || x <= 0)) throw new HttpException(400, "ariza_idlar noto'g'ri");
  return [...new Set(ids)];
}

/**
 * Arizalarni tranzaksiya ichida qulflab tekshiradi: mavjud, sotish arizasi, tayinlanadigan
 * holatda va boshqa FAOL (yakunlanmagan) trip sheetda emas. Xato bo'lsa 400/404.
 */
async function arizalarniTekshir(ids, tripId, t) {
  const arizalar = await ArizaModel.findAll({
    where: { id: { [Op.in]: ids } }, attributes: ['id', 'raqam', 'turi', 'holat', 'trip_sheet_id'],
    order: [['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE,
  });
  const byId = new Map(arizalar.map(a => [a.id, a]));
  const yoq = ids.filter(id => !byId.has(id));
  if (yoq.length) throw new HttpException(404, `Ariza topilmadi: ${yoq.join(', ')}`);
  const nomi = a => a.raqam || `#${a.id}`;
  const notogri = arizalar.filter(a => a.turi !== 'sotish' || !TAYINLASH_HOLAT.includes(a.holat));
  if (notogri.length) {
    throw new HttpException(400, `Bu arizalarni trip sheetga qo'shib bo'lmaydi (holati mos emas): ${notogri.map(nomi).join(', ')}`);
  }
  const boshqaTripIds = [...new Set(arizalar.map(a => a.trip_sheet_id).filter(x => x && x !== tripId))];
  if (boshqaTripIds.length) {
    const faollar = await TripSheetModel.findAll({
      where: { id: { [Op.in]: boshqaTripIds }, holat: { [Op.ne]: 'yakunlandi' } }, attributes: ['id', 'raqam'], transaction: t,
    });
    if (faollar.length) {
      const faolSet = new Set(faollar.map(x => x.id));
      const band = arizalar.filter(a => faolSet.has(a.trip_sheet_id));
      throw new HttpException(400, `Ariza boshqa faol trip sheetda: ${band.map(nomi).join(', ')}`);
    }
  }
}

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
    const { dostavchi_id, sana } = req.body;
    if (!dostavchi_id || !sana) throw new HttpException(400, 'dostavchi_id va sana majburiy');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(sana)) || Number.isNaN(new Date(sana + 'T00:00:00Z').getTime())) {
      throw new HttpException(400, "Sana noto'g'ri (YYYY-MM-DD)");
    }
    const ariza_idlar = Array.isArray(req.body.ariza_idlar) ? idlarniTozala(req.body.ariza_idlar) : [];

    const dostavchi = await DostavchiModel.findByPk(dostavchi_id);
    if (!dostavchi) throw new HttpException(404, 'Dostavchik topilmadi');

    const t = await sequelize.transaction();
    try {
      // Raqam hisoblagichdan: parallel yaratishda ham takrorlanmaydi
      const prefiks = `TS-${sana}`;
      const tartib = await keyingiTartib(prefiks, () => maksRaqam('trip_sheet', prefiks, t), t);
      const trip = await TripSheetModel.create({
        raqam: `${prefiks}-${String(tartib).padStart(3, '0')}`,
        dostavchi_id, dostavchi_nomi: dostavchi.ism, sana,
      }, { transaction: t });

      if (ariza_idlar.length) {
        await arizalarniTekshir(ariza_idlar, trip.id, t);
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
    if (!Array.isArray(req.body.ariza_idlar) || !req.body.ariza_idlar.length) throw new HttpException(400, 'ariza_idlar majburiy');
    const ariza_idlar = idlarniTozala(req.body.ariza_idlar);

    await sequelize.transaction(async (t) => {
      // Trip sheet qulflanadi: parallel qo'shishlarda trip_tartib takrorlanmaydi
      const trip = await TripSheetModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!trip) throw new HttpException(404, 'Topilmadi');
      if (trip.holat === 'yakunlandi') throw new HttpException(400, "Yakunlangan trip sheetga ariza qo'shib bo'lmaydi");
      await arizalarniTekshir(ariza_idlar, trip.id, t);

      // Shu tripdagilar qayta qo'shilsa — tartibi o'zgarmaydi, faqat yangilari oxiriga
      const allaqachon = new Set((await ArizaModel.findAll({
        where: { trip_sheet_id: trip.id }, attributes: ['id'], transaction: t,
      })).map(a => a.id));
      const yangilar = ariza_idlar.filter(id => !allaqachon.has(id));
      const mavjud = allaqachon.size;
      for (let i = 0; i < yangilar.length; i++) {
        await ArizaModel.update(
          { trip_sheet_id: trip.id, trip_tartib: mavjud + i + 1, dostavchi_id: trip.dostavchi_id, dostavchi_nomi: trip.dostavchi_nomi },
          { where: { id: yangilar[i] }, transaction: t },
        );
      }
    });
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
