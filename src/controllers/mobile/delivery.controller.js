const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel = require('../../models/agent.model');
const TovarRegisterModel = require('../../models/tovar_register.model');
const { TripSheetModel, YetkazishQaytarishModel } = require('../../models/tripSheet.model');
const HttpException = require('../../utils/HttpException.utils');
const { ok, dostavchiIdOl } = require('./shared');
const { shapeDoc } = require('./docShape');
const { arizaYetkazildiEffektlari } = require('../../utils/arizaYetkazildi.utils');
const { qulflabOl } = require('../../utils/qulf.utils');

const BRAK_OMBOR = 'Brak ombori';

const INCLUDE = [
  { model: ArizaQatorModel, as: 'qatorlar' },
  { model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'telefon', 'manzil', 'lat', 'lng'] },
  { model: AgentModel, as: 'agent', attributes: ['id', 'fullname', 'telefon'] },
];

// Dostavchik faqat O'ZIga biriktirilgan hujjatlarni ko'radi; oddiy agent
// hammasini ko'radi. dual_role agent (linked_dostavchi_id bor) esa — xuddi
// haqiqiy dostavchik kabi — faqat shu dostavchi_id'ga tayinlangan hujjatlarni
// ko'radi, chunki uning mobil "Yetkazish" oynasi shu rolni bajarish uchun.
// Dostavchik esa faqat yo'lga chiqarilgan ('yolda') buyurtmani ko'radi — tasdiqlangan /
// yig'ilmoqda buyurtma hali omborda (dostavchik.controller.js bilan bir xil qoida).
function deliveryWhere(req, extra = {}) {
  const where = { turi: 'sotish', holat: { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] }, ...extra };
  const dostavchiId = currentDostavchiId(req);
  if (dostavchiId) {
    where.dostavchi_id = dostavchiId;
    where.holat = 'yolda';
  }
  return where;
}

// Joriy foydalanuvchining "dostavchi" sifatidagi ID'si: haqiqiy dostavchik
// bo'lsa o'z ID'si, dual_role agent bo'lsa unga bog'langan dostavchi qatori,
// oddiy agent bo'lsa null (hech narsani filtrlamaydi — "hammasini ko'radi").
function currentDostavchiId(req) {
  return dostavchiIdOl(req);
}

// Holat o'zgartiruvchi delivery amallari uchun: dostavchik (yoki dual_role agent) bo'lishi shart
function talabDostavchi(req) {
  const id = currentDostavchiId(req);
  if (!id) throw new HttpException(403, 'Bu amal faqat dostavchik uchun');
  return id;
}

const n = (v) => parseFloat(v) || 0;
const r3 = (v) => Math.round(v * 1000) / 1000;

/* ── Delivery (hujjat 9.x) ────────────────────────────────────────────────── */
class MobileDeliveryController {
  // 9.1 getDokDelivery/ → DocumentDeliveryModel massivi
  getDokDelivery = async (req, res, next) => {
    const list = await ArizaModel.findAll({
      where: deliveryWhere(req),
      include: INCLUDE, order: [['createdAt', 'DESC']],
    });
    ok(res, list.map(shapeDoc));
  };

  // 9.2 getDokDeliveryLocation/ → [{ klientId, klientLat, klientLong, klient }]
  getDokDeliveryLocation = async (req, res, next) => {
    const list = await ArizaModel.findAll({
      where: deliveryWhere(req),
      include: [{ model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'lat', 'lng'] }],
      order: [['createdAt', 'DESC']],
    });
    const data = list
      .filter(a => a.mijoz && a.mijoz.lat != null && a.mijoz.lng != null)
      .map(a => ({
        klientId: String(a.mijoz.id),
        klientLat: String(a.mijoz.lat),
        klientLong: String(a.mijoz.lng),
        klient: a.mijoz.nomi || '',
      }));
    ok(res, data);
  };

  // 9.3 orderDelivery/ → data: { docId, date1, date2 }  (offline kontrakt)
  // Web changeHolat() bilan bir xil "yetkazildi" yon-effektlarini (kassa/qarz/
  // agent plan-fakt) bajaradi — aks holda mobil orqali yetkazilgan buyurtmalar
  // agent statistikasi va oylik plandan tushib qolib qoladi.
  orderDelivery = async (req, res, next) => {
    const { docId, date1, date2 } = req.body;
    const dId = talabDostavchi(req);
    let vaqt = date2 ? new Date(date2) : new Date();
    if (isNaN(vaqt.getTime())) vaqt = new Date();

    // Qulf + qayta tekshiruv tranzaksiya ichida: oflayn qayta yuborish yoki ikki marta
    // bosish effektlarni (kassa/qarz/bonus) ikkinchi marta qo'llamaydi.
    await sequelize.transaction(async (t) => {
      const ariza = await qulflabOl(ArizaModel, docId, t);
      if (!ariza) throw new HttpException(404, req.mf('Not found'));
      if (!ariza.dostavchi_id || Number(ariza.dostavchi_id) !== dId) {
        throw new HttpException(403, 'Bu buyurtma sizga tayinlanmagan');
      }
      if (ariza.holat === 'yetkazildi') return;   // takror — allaqachon yetkazilgan
      if (ariza.turi !== 'sotish' || ariza.holat !== 'yolda') {
        throw new HttpException(400, `Buyurtma "${ariza.holat}" holatida — yetkazib bo'lmaydi`);
      }
      await ariza.update(
        { holat: 'yetkazildi', yetkazilgan_sana: vaqt, yetkazgan_dostavchi_id: dId },
        { transaction: t },
      );
      await arizaYetkazildiEffektlari(ariza, { transaction: t, userId: null });
    });

    ok(res, { docId: String(docId), date1: date1 || '', date2: date2 || '' }, 'Yetkazildi');
  };

  // 9.4 returnDeliveryProducts/ → data: { data, products }  (offline kontrakt)
  // Yetkazish vaqtida qisman qaytarish yoki brak: ariza bekor bo'lmaydi, faqat
  // ko'rsatilgan tovarlar DB'ga yoziladi va omborga mos effekt beriladi:
  //   tur='qaytarma' → sotiladigan qoldiqqa qaytadi (asosiy ombor, kirim)
  //   tur='brak'     → alohida "Brak ombori"ga tushadi (sotuvga qaytmaydi)
  // products: [{ tovarId, count, tur, sabab }]  (tur berilmasa 'qaytarma')
  returnDeliveryProducts = async (req, res, next) => {
    const { docId, data: sana, products = [] } = req.body;
    const dostavchiId = talabDostavchi(req);
    const list = Array.isArray(products) ? products : [];

    // So'rovni avval tekshirib olamiz (tovar va miqdor) — noto'g'ri qator jim o'tkazib yuborilmaydi
    const sorov = [];
    for (const p of list) {
      const dona = n(p && p.count);
      if (!(dona > 0)) continue;
      sorov.push({ tovarId: String(p.tovarId), dona: r3(dona), tur: p.tur === 'brak' ? 'brak' : 'qaytarma', sabab: p.sabab || null });
    }

    await sequelize.transaction(async (t) => {
      const ariza = await qulflabOl(ArizaModel, docId, t);
      if (!ariza) throw new HttpException(404, req.mf('Not found'));
      if (!ariza.dostavchi_id || Number(ariza.dostavchi_id) !== dostavchiId) {
        throw new HttpException(403, 'Bu buyurtma sizga tayinlanmagan');
      }
      if (ariza.turi !== 'sotish' || !['yolda', 'yetkazildi'].includes(ariza.holat)) {
        throw new HttpException(400, `Buyurtma "${ariza.holat}" holatida — qaytarib bo'lmaydi`);
      }
      if (!sorov.length) return;

      const qatorlar = await ArizaQatorModel.findAll({ where: { ariza_id: ariza.id }, transaction: t });
      const avvalgi = await YetkazishQaytarishModel.findAll({ where: { ariza_id: ariza.id }, transaction: t });

      // Idempotentlik: oflayn navbat AYNAN shu so'rovni qayta yuborsa (har bir qator uchun
      // shu dostavchikning bir xil tovar/tur/miqdor yozuvi bor) — ikkinchi marta yozilmaydi.
      // (yetkazish_qaytarish jadvalida mobil_id ustuni yo'q — shuning uchun mazmun bo'yicha)
      const ishlatilgan = new Set();
      const takror = sorov.every(q => {
        const y = avvalgi.find(a => !ishlatilgan.has(a.id) && String(a.tovar_id) === q.tovarId && a.tur === q.tur
          && Number(a.dostavchi_id) === dostavchiId && Math.abs(n(a.dona) - q.dona) < 0.0005);
        if (y) ishlatilgan.add(y.id);
        return !!y;
      });
      if (takror) return;

      const qaytgan = {};   // tovar_id → shu buyurtmadan allaqachon qaytarilgan miqdor
      for (const a of avvalgi) qaytgan[String(a.tovar_id)] = (qaytgan[String(a.tovar_id)] || 0) + n(a.dona);

      for (const p of sorov) {
        const qator = qatorlar.find(q => String(q.tovar_id) === p.tovarId);
        if (!qator) throw new HttpException(400, `Tovar #${p.tovarId} bu buyurtmada yo'q`);
        const qoldi = r3(n(qator.jami_dona) - (qaytgan[p.tovarId] || 0));
        if (p.dona > qoldi + 0.0005) {
          throw new HttpException(400, `"${qator.tovar_nomi || `#${p.tovarId}`}" — qaytarish miqdori buyurtmadagidan ko'p. Mumkin: ${Math.max(0, qoldi)}, so'raldi: ${p.dona}`);
        }
        qaytgan[p.tovarId] = (qaytgan[p.tovarId] || 0) + p.dona;

        const dona = p.dona;
        const narx = n(qator.narx);
        const summa = +(narx * dona).toFixed(2);
        const tur = p.tur;

        await YetkazishQaytarishModel.create({
          ariza_id: ariza.id,
          tovar_id: qator.tovar_id,
          tovar_nomi: qator.tovar_nomi || '',
          dona, summa, tur,
          sabab: p.sabab,
          dostavchi_id: dostavchiId,
          sana: new Date(),
        }, { transaction: t });

        // Ombor effekti: qaytarma -> asosiy ombordagi qoldiqqa qaytadi (kirim),
        // brak -> alohida Brak ombori'ga kirim bo'ladi (sotuvga aralashmaydi)
        await TovarRegisterModel.create({
          tovar_id: qator.tovar_id,
          tovar_nomi: qator.tovar_nomi || '',
          turkum: qator.turkum || null,
          ombor: tur === 'brak' ? BRAK_OMBOR : (ariza.ombor || 'Основной склад'),
          tur: 'qaytarma_kirim',
          manba_tur: 'qaytarma',
          manba_id: ariza.id,
          donada: dona,
          bloklarda: 0,
          qutilarda: 0,
          hajm: 0,
          kirim_narx: 0,
          sotuv_narx: narx,
          summa,
          sana: new Date(),
        }, { transaction: t });
      }
    });

    ok(res, { data: sana || '', products: list });
  };

  // 9.5 getReturnDocDelivery/ → DocumentDeliveryModel massivi
  getReturnDocDelivery = async (req, res, next) => {
    const where = { turi: 'qaytarish' };
    const dostavchiId = currentDostavchiId(req);
    if (dostavchiId) where.dostavchi_id = dostavchiId;
    const list = await ArizaModel.findAll({
      where,
      include: INCLUDE, order: [['createdAt', 'DESC']],
    });
    ok(res, list.map(shapeDoc));
  };

  /* ══ TRIP SHEET (yangi maxsus endpoint — asl API hujjatida yo'q) ═══════ */

  // GET getTripSheet/ — dostavchikning bugungi (yoki so'ralgan sana) marshrut varag'i
  getTripSheet = async (req, res, next) => {
    if (req.currentRole !== 'dostavchi') throw new HttpException(403, 'Faqat dostavchik uchun');
    const sana = /^\d{4}-\d{2}-\d{2}$/.test(req.query.sana || '') ? req.query.sana : new Date().toISOString().slice(0, 10);

    const trip = await TripSheetModel.findOne({ where: { dostavchi_id: req.currentAgent.id, sana } });
    if (!trip) { ok(res, null); return; }

    const arizalar = await ArizaModel.findAll({
      where: { trip_sheet_id: trip.id },
      include: INCLUDE, order: [['trip_tartib', 'ASC'], ['id', 'ASC']],
    });

    ok(res, {
      tripId: trip.id, raqam: trip.raqam, holat: trip.holat, sana: trip.sana,
      boshlanganVaqt: trip.boshlangan_vaqt, tugaganVaqt: trip.tugagan_vaqt,
      hujjatlar: arizalar.map(shapeDoc),
    });
  };

  // POST startTrip/ — dostavchik marshrutni boshladi (faqat o'z marshrut varag'i)
  startTrip = async (req, res, next) => {
    const { tripId } = req.body;
    const dId = talabDostavchi(req);
    const trip = await TripSheetModel.findByPk(tripId);
    if (!trip) throw new HttpException(404, req.mf('Not found'));
    if (Number(trip.dostavchi_id) !== dId) throw new HttpException(403, 'Bu marshrut varag\'i sizga tegishli emas');
    if (trip.holat === 'yakunlandi') throw new HttpException(400, 'Marshrut allaqachon yakunlangan');
    if (trip.holat !== 'yolda') await trip.update({ holat: 'yolda', boshlangan_vaqt: new Date() });
    ok(res, { tripId: trip.id }, 'Marshrut boshlandi');
  };

  // POST finishTrip/ — dostavchik marshrutni yakunladi (faqat o'z marshrut varag'i)
  finishTrip = async (req, res, next) => {
    const { tripId } = req.body;
    const dId = talabDostavchi(req);
    const trip = await TripSheetModel.findByPk(tripId);
    if (!trip) throw new HttpException(404, req.mf('Not found'));
    if (Number(trip.dostavchi_id) !== dId) throw new HttpException(403, 'Bu marshrut varag\'i sizga tegishli emas');
    if (trip.holat !== 'yakunlandi') await trip.update({ holat: 'yakunlandi', tugagan_vaqt: new Date() });
    ok(res, { tripId: trip.id }, 'Marshrut yakunlandi');
  };
}

module.exports = new MobileDeliveryController();
