/**
 * DOSTAVCHIK — mobil ilova (pre-sale yetkazish).
 *
 * Dostavchikning kuni:
 *   1. dostavchikHolat    — "Mening kunim": bugungi marshrut, nechta yetkazildi, naqd qo'lda
 *   2. marshrut           — tartiblangan buyurtmalar (mijoz, manzil, GPS masofa, tovar ro'yxati)
 *   3. reysBoshla         — mashina chiqdi (trip sheet 'yolda', GPS nuqta)
 *   4. yetkazdim          — mijozda: qisman qaytarish/brak + naqd to'lov + GPS, bitta so'rovda
 *      yetkazilmadi       — do'kon yopiq / mijoz yo'q / rad etdi — buyurtma navbatda qoladi
 *   5. qarzTolov          — eski qarzni undirish (savePayment, user_id = dostavchik)
 *   6. kunYakuni          — nima qaytadi (tovar), nima topshiriladi (naqd)
 *      reysYakunla        — kun yopildi, kassir inkassatsiya qiladi
 *
 * Dostavchik faqat YO'LGA CHIQARILGAN buyurtmani ko'radi: web Buyurtmalar'da dostavchi
 * tanlanib "Yo'lda" qilingach (tovar ombordan chiqqan). Tasdiqlangan / yig'ilmoqda
 * buyurtma — trip sheet'da unga biriktirilgan bo'lsa ham — hali omborda, ko'rinmaydi.
 * Marshrut trip sheet'ga emas, dostavchi_id ga qaraydi: reys boshlangandan keyin
 * jo'natilgan zakaz ham ro'yxatga tushadi.
 */
const { Op } = require('sequelize');
const { reytingYoz } = require('../../utils/reyting.utils');
const sequelize = require('../../db/db-sequelize');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel = require('../../models/agent.model');
const TovarRegisterModel = require('../../models/tovar_register.model');
const KassaModel = require('../../models/kassa.model');
const { TripSheetModel, YetkazishQaytarishModel, YetkazishUrinishModel } = require('../../models/tripSheet.model');
const { ok, fail, mobilVaqt, mobilKalit, summaOl } = require('./shared');
const { arizaYetkazildiEffektlari } = require('../../utils/arizaYetkazildi.utils');
const { masofaMetr, koordinata, SOTUV_RADIUS_M } = require('../../utils/geo.utils');
const { qulflabOl, keyingiTartib, maksRaqam } = require('../../utils/qulf.utils');
const DostavchiModel = require('../../models/dostavchi.model');

const BRAK_OMBOR = 'Brak ombori';
const AKTIV = ['yolda'];
const SABABLAR = [
  { id: 'yopiq',     nom: "Do'kon yopiq" },
  { id: 'mijoz_yoq', nom: 'Mijoz joyida yo‘q' },
  { id: 'pul_yoq',   nom: 'Mijozda pul yo‘q' },
  { id: 'rad_etdi',  nom: 'Mijoz tovarni rad etdi' },
  { id: 'manzil',    nom: 'Manzil topilmadi' },
  { id: 'boshqa',    nom: 'Boshqa sabab' },
];
const INCLUDE = [
  { model: ArizaQatorModel, as: 'qatorlar' },
  { model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'telefon', 'telefon2', 'manzil', 'mo_ljal', 'lat', 'lng', 'balans'] },
  { model: AgentModel, as: 'agent', attributes: ['id', 'fullname', 'telefon'] },
];
const n = (v) => parseFloat(v) || 0;
const pad2 = (x) => String(x).padStart(2, '0');
const bugunKey = (d = new Date()) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const sanaMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/* Joriy foydalanuvchining dostavchi ID'si: haqiqiy dostavchik yoki dual_role agent */
function dostavchiId(req) {
  if (req.currentRole === 'dostavchi') return Number(req.currentAgent.id);
  if (req.currentRole === 'agent' && req.currentAgent.linked_dostavchi_id) return Number(req.currentAgent.linked_dostavchi_id);
  return null;
}
/* Buyurtma aynan shu dostavchiga tayinlanganmi (tayinlanmagan — null — ham rad etiladi) */
const meniki = (ariza, dId) => !!ariza.dostavchi_id && Number(ariza.dostavchi_id) === Number(dId);
function talab(req, res) {
  const id = dostavchiId(req);
  if (!id) { fail(res, 'Bu amal faqat dostavchik uchun', 403); return null; }
  return id;
}

const takrorXato = (e) => e && (e.name === 'SequelizeUniqueConstraintError' || e.parent?.code === 'ER_DUP_ENTRY');

/* Kun holati: bosqich, jami, pul — dostavchikHolat va dostavchikSinxron bir xil hisoblaydi */
function kunHolati(trip, arizalar, pul) {
  const yetk = arizalar.filter(a => a.holat === 'yetkazildi');
  const qoldi = arizalar.filter(a => AKTIV.includes(a.holat));
  const urinilgan = qoldi.filter(a => Number(a.yetkazish_urinish || 0) > 0);
  // Bosqich: 0 — reys boshlanmagan, 1 — yo'lda, 2 — hammasi yetkazildi/topshirish, 3 — yopildi
  let bosqich = 0, holat = 'tayyor';
  if (trip?.holat === 'yakunlandi') { bosqich = 3; holat = 'yopiq'; }
  else if (trip?.holat === 'yolda' || (!trip && yetk.length)) { bosqich = qoldi.length ? 1 : 2; holat = qoldi.length ? 'yolda' : 'topshirish'; }
  else if (!arizalar.length) { holat = 'bosh'; }
  return {
    bosqich, holat, qoldi,
    holatNomi: { bosh: 'Bugunga buyurtma yo‘q', tayyor: 'Reys tayyor', yolda: "Yo'lda", topshirish: 'Topshirish kutilmoqda', yopiq: 'Kun yopildi' }[holat],
    trip: trip ? { tripId: trip.id, raqam: trip.raqam, holat: trip.holat, boshlanganVaqt: trip.boshlangan_vaqt, tugaganVaqt: trip.tugagan_vaqt } : null,
    jami: {
      buyurtma: arizalar.length, yetkazildi: yetk.length, qoldi: qoldi.length, urinilgan: urinilgan.length,
      summa: arizalar.reduce((s, a) => s + n(a.jami_summa), 0),
      yetkazildiSumma: yetk.reduce((s, a) => s + n(a.jami_summa), 0),
      dona: arizalar.reduce((s, a) => s + (a.qatorlar || []).reduce((x, q) => x + n(q.jami_dona), 0), 0),
    },
    pul: { naqdQolda: Math.max(0, pul.yigildi - pul.topshirildi), yigildi: pul.yigildi, topshirildi: pul.topshirildi, tolovSoni: pul.soni },
    naqdElon: trip && trip.naqd_elon != null ? n(trip.naqd_elon) : null,
  };
}

/* Bugungi trip sheet (bo'lmasa null) */
const tripBugun = (dId, sana) => TripSheetModel.findOne({ where: { dostavchi_id: dId, sana } });

/* Marshrut: dostavchiga tayinlangan yo'ldagi buyurtmalar (reys tartibida, reysga hali
   qo'shilmaganlari oxirida). Shu kuni yetkazilganlar ham qaytadi ("bajarildi" bo'lib turishi uchun). */
async function marshrutArizalar(dId, sana) {
  const where = { dostavchi_id: dId, turi: 'sotish', [Op.or]: [
    { holat: { [Op.in]: AKTIV } },
    { holat: 'yetkazildi', yetkazilgan_sana: { [Op.gte]: new Date(sana + 'T00:00:00'), [Op.lt]: new Date(sana + 'T23:59:59.999') } },
  ] };
  return ArizaModel.findAll({
    where, include: INCLUDE,
    order: [[sequelize.literal('trip_tartib IS NULL'), 'ASC'], ['trip_tartib', 'ASC'], ['id', 'ASC']],
  });
}

function qatorShakli(q) {
  return {
    tovarId: String(q.tovar_id || ''), tovar: q.tovar_nomi || '', turkum: q.turkum || '',
    dona: n(q.jami_dona), blok: n(q.blok), narx: n(q.narx), summa: n(q.summa),
  };
}
function buyurtmaShakli(a, pos) {
  const m = a.mijoz || {};
  const lat = m.lat != null ? parseFloat(m.lat) : null, lng = m.lng != null ? parseFloat(m.lng) : null;
  const yetkazildi = a.holat === 'yetkazildi';
  return {
    docId: String(a.id), docNumber: a.raqam || String(a.id),
    tartib: a.trip_tartib,
    holat: a.holat,                                     // tasdiqlangan | yigilmoqda | yolda | yetkazildi | bekor
    klientId: String(a.mijoz_id || ''), klient: a.mijoz_nomi || m.nomi || '',
    klientTel: m.telefon || '', klientTel2: m.telefon2 || '',
    klientAdres: m.manzil || '', moljal: m.mo_ljal || '',
    klientLat: lat, klientLong: lng,
    masofa: pos && lat != null ? masofaMetr(pos.lat, pos.lng, lat, lng) : null,
    klientQarz: m.balans != null && parseFloat(m.balans) < 0 ? -parseFloat(m.balans) : 0,
    agent: a.agent_nomi || (a.agent && a.agent.fullname) || '',
    summa: n(a.jami_summa),
    tolovTuri: a.tolov_turi || '',                      // naqt | qarz | plastik | …
    naqdKutiladi: a.tolov_turi === 'naqt' || a.tolov_turi === 'naqd',
    tolangan: n(a.tolangan_summa),
    izoh: a.izoh || '',
    urinish: Number(a.yetkazish_urinish || 0),
    urinishIzoh: a.yetkazish_izoh || '',
    yetkazilganVaqt: yetkazildi ? a.yetkazilgan_sana : null,
    products: (a.qatorlar || []).map(qatorShakli),
  };
}

/* Bugungi naqd: dostavchik yig'gan (yetkazish + qarz undirish) va kassirga topshirgani
   (inkassatsiya.dostavchi_id yozuvi — utils/dostavchiInkassatsiya.utils.js) */
const { dostavchiYigildi, dostavchiTopshirildi } = require('../../utils/dostavchiInkassatsiya.utils');
async function bugungiPul(dId, sana) {
  const [r, t] = await Promise.all([dostavchiYigildi(dId, sana), dostavchiTopshirildi(dId, sana)]);
  return { yigildi: r.summa, soni: r.soni, topshirildi: t.summa };
}

class MobileDostavchikController {
  // GET dostavchikHolat/?sana= — "Mening kunim"
  dostavchikHolat = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugunKey();
    const pos = koordinata(req.query);
    const trip = await tripBugun(dId, sana);
    const arizalar = await marshrutArizalar(dId, sana);
    const pul = await bugungiPul(dId, sana);
    const { qoldi, ...k } = kunHolati(trip, arizalar, pul);
    const keyingi = qoldi.find(a => Number(a.yetkazish_urinish || 0) === 0) || qoldi[0] || null;
    ok(res, {
      sana, bosqich: k.bosqich, holat: k.holat, holatNomi: k.holatNomi, trip: k.trip, jami: k.jami, pul: k.pul,
      keyingi: keyingi ? buyurtmaShakli(keyingi, pos) : null,
      naqdElon: k.naqdElon,
    });
  };

  // GET dostavchikSinxron/?lat=&long= — oflayn ilova uchun bitta so'rovda hamma narsa:
  // kun holati, buyurtmalar (tovarlari va urinishlari bilan), sabablar, bugungi qaytarma/brak.
  dostavchikSinxron = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const sana = bugunKey();
    const pos = koordinata(req.query);
    const trip = await tripBugun(dId, sana);
    const arizalar = await marshrutArizalar(dId, sana);
    const [pul, qaytarishlar, urinishlar] = await Promise.all([
      bugungiPul(dId, sana),
      YetkazishQaytarishModel.findAll({ where: { dostavchi_id: dId, sana: { [Op.gte]: new Date(sana + 'T00:00:00'), [Op.lt]: new Date(sana + 'T23:59:59.999') } } }),
      arizalar.length
        ? YetkazishUrinishModel.findAll({ where: { ariza_id: { [Op.in]: arizalar.map(a => a.id) } }, order: [['sana', 'DESC']] })
        : [],
    ]);
    const uMap = {};
    for (const u of urinishlar) (uMap[u.ariza_id] = uMap[u.ariza_id] || []).push(u);
    const { qoldi: _q, ...k } = kunHolati(trip, arizalar, pul); void _q;
    const d = req.currentRole === 'dostavchi' ? req.currentAgent : null;
    ok(res, {
      serverVaqt: new Date().toISOString(), sana,
      dostavchi: { id: dId, ism: d ? d.ism : (req.currentAgent.fullname || ''), mashina: d ? (d.mashina_raqam || '') : '', transport: d ? (d.transport || '') : '' },
      holat: k,
      sabablar: SABABLAR,
      buyurtmalar: arizalar.map(a => ({
        ...buyurtmaShakli(a, pos),
        urinishlar: (uMap[a.id] || []).slice(0, 5).map(u => ({ sabab: u.sabab, sababNomi: (SABABLAR.find(s => s.id === u.sabab) || {}).nom || u.sabab, izoh: u.izoh || '', vaqt: u.sana })),
      })),
      qaytarishlar: qaytarishlar.map(q => ({ docId: String(q.ariza_id), tovarId: String(q.tovar_id), tovar: q.tovar_nomi || '', dona: n(q.dona), summa: n(q.summa), tur: q.tur === 'brak' ? 'brak' : 'qaytarma' })),
    });
  };

  // GET marshrut/?sana=&lat=&long= — bugungi buyurtmalar, GPS bo'yicha masofa bilan
  marshrut = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugunKey();
    const pos = koordinata(req.query);
    const trip = await tripBugun(dId, sana);
    const arizalar = await marshrutArizalar(dId, sana);
    ok(res, {
      trip: trip ? { tripId: trip.id, raqam: trip.raqam, holat: trip.holat } : null,
      sabablar: SABABLAR,
      buyurtmalar: arizalar.map(a => buyurtmaShakli(a, pos)),
    });
  };

  // GET buyurtma/?docId= — bitta buyurtma to'liq (mijoz qarzi, urinishlar)
  buyurtma = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const docId = parseInt(req.query.docId, 10);
    if (!Number.isInteger(docId) || docId <= 0) return fail(res, 'docId kerak', 400);
    const a = await ArizaModel.findOne({ where: { id: docId, dostavchi_id: dId }, include: INCLUDE });
    if (!a) return fail(res, 'Buyurtma topilmadi yoki sizga tayinlanmagan', 404);
    const urinishlar = await YetkazishUrinishModel.findAll({ where: { ariza_id: a.id }, order: [['sana', 'DESC']], limit: 5 });
    ok(res, { ...buyurtmaShakli(a, koordinata(req.query)),
      urinishlar: urinishlar.map(u => ({ sabab: u.sabab, sababNomi: (SABABLAR.find(s => s.id === u.sabab) || {}).nom || u.sabab, izoh: u.izoh || '', vaqt: u.sana })) });
  };

  // POST reysBoshla/ { lat, long } — mashina chiqdi
  // Hammasi BITTA tranzaksiyada, dostavchi qatori qulflangan holda: ikki parallel so'rov
  // (ikki marta bosish, oflayn qayta yuborish) shu kun uchun ikkita trip sheet yaratmaydi.
  // Raqam web bilan bir xil hisoblagichdan (hujjat_raqam, keyingiTartib) — COUNT+1 emas.
  reysBoshla = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const vaqt = mobilVaqt(req.body.vaqt);      // oflayn: mashina haqiqatda chiqqan vaqt
    const sana = bugunKey(vaqt);
    const pos = koordinata(req.body);
    const d = req.currentRole === 'dostavchi' ? req.currentAgent : null;
    const natija = await sequelize.transaction(async (t) => {
      const dostavchi = await qulflabOl(DostavchiModel, dId, t, { attributes: ['id', 'ism'] });
      if (!dostavchi) return { xato: ['Dostavchik topilmadi', 404] };
      let trip = await TripSheetModel.findOne({ where: { dostavchi_id: dId, sana }, order: [['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE });
      if (trip?.holat === 'yakunlandi') return { xato: ['Bugungi reys allaqachon yakunlangan', 400] };
      // Yo'ldagi, hali bu reysda bo'lmagan buyurtmalar (web'da trip sheet tuzilmagan yoki
      // reys tuzilgandan keyin jo'natilgan) — reys oxiriga qo'shiladi
      const yangilar = await ArizaModel.findAll({
        where: { dostavchi_id: dId, turi: 'sotish', holat: { [Op.in]: AKTIV }, ...(trip ? { [Op.or]: [{ trip_sheet_id: null }, { trip_sheet_id: { [Op.ne]: trip.id } }] } : {}) },
        // Qulfsiz o'qiladi: qulf tartibi web trip sheet bilan bir xil (hisoblagich → ariza),
        // reysBoshla'ning o'zi dostavchi qatori qulfi bilan navbatma-navbat o'tadi
        order: [['id', 'ASC']], transaction: t,
      });
      if (!trip) {
        if (!yangilar.length) return { xato: ['Sizga bugun buyurtma tayinlanmagan', 400] };
        const prefiks = `TS-${sana}`;
        const tartib = await keyingiTartib(prefiks, () => maksRaqam('trip_sheet', prefiks, t), t);
        trip = await TripSheetModel.create({
          raqam: `${prefiks}-${String(tartib).padStart(3, '0')}`, dostavchi_id: dId,
          dostavchi_nomi: d ? d.ism : (dostavchi.ism || req.currentAgent.fullname), sana,
        }, { transaction: t });
      }
      const oxirgi = (await ArizaModel.max('trip_tartib', { where: { trip_sheet_id: trip.id }, transaction: t })) || 0;
      for (const [i, a] of yangilar.entries()) await a.update({ trip_sheet_id: trip.id, trip_tartib: oxirgi + i + 1 }, { transaction: t });
      if (trip.holat !== 'yolda') {
        await trip.update({ holat: 'yolda', boshlangan_vaqt: vaqt, boshlangan_lat: pos?.lat ?? null, boshlangan_lng: pos?.lng ?? null }, { transaction: t });
      }
      return { trip };
    });
    if (natija.xato) return fail(res, natija.xato[0], natija.xato[1]);
    const { trip } = natija;
    ok(res, { tripId: trip.id, raqam: trip.raqam, holat: trip.holat, boshlanganVaqt: trip.boshlangan_vaqt }, 'Reys boshlandi — yo‘l bo‘lsin!');
  };

  // POST yetkazdim/ { docId, lat, long, naqd, qaytarish:[{tovarId, dona, tur:'qaytarma'|'brak', sabab}], izoh }
  // Bitta so'rovda: qaytarish/brak omborga, buyurtma 'yetkazildi', naqd kassaga, qolgani qarzga.
  yetkazdim = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const { docId, naqd, izoh } = req.body;
    const pos = koordinata(req.body);
    const vaqt = mobilVaqt(req.body.vaqt);      // oflayn: mijozga haqiqatda topshirilgan vaqt
    const oflayn = req.body.oflayn === true || req.body.oflayn === 'true';
    // Tez rad etish (qulfsiz) — yakuniy tekshiruv baribir tranzaksiya ichida qulf bilan
    const oldin = await ArizaModel.findByPk(docId, { attributes: ['id', 'raqam', 'holat', 'dostavchi_id'] });
    if (!oldin) return fail(res, 'Buyurtma topilmadi', 404);
    if (!meniki(oldin, dId)) return fail(res, 'Bu buyurtma sizga tayinlanmagan', 403);
    if (oldin.holat === 'yetkazildi') return ok(res, { docId: String(oldin.id), allaqachon: true }, 'Allaqachon yetkazilgan');

    const qaytarish = (Array.isArray(req.body.qaytarish) ? req.body.qaytarish : [])
      .map(q => ({ tovarId: String(q.tovarId), dona: n(q.dona ?? q.count), tur: q.tur === 'brak' ? 'brak' : 'qaytarma', sabab: q.sabab || null }))
      .filter(q => q.dona > 0);

    // Holat tekshiruvi tranzaksiya ichida, qulflangan qatorda: oflayn qayta yuborish yoki
    // ikki marta bosish ikkinchi marta qaytarish/kassa/qarz yozmaydi.
    let ariza, masofa = null;
    const natija = await sequelize.transaction(async (t) => {
      ariza = await qulflabOl(ArizaModel, docId, t);
      if (!ariza) return { xato: ['Buyurtma topilmadi', 404] };
      if (!meniki(ariza, dId)) return { xato: ['Bu buyurtma sizga tayinlanmagan', 403] };
      if (ariza.holat === 'yetkazildi') return { allaqachon: true };
      if (ariza.turi !== 'sotish' || !AKTIV.includes(ariza.holat)) return { xato: [`Buyurtma "${ariza.holat}" holatida — yetkazib bo'lmaydi`, 400] };

      const qatorlar = await ArizaQatorModel.findAll({ where: { ariza_id: ariza.id }, transaction: t, lock: t.LOCK.UPDATE });
      const mijoz = ariza.mijoz_id ? await MijozModel.findByPk(ariza.mijoz_id, { attributes: ['id', 'lat', 'lng'], transaction: t }) : null;
      masofa = pos && mijoz && mijoz.lat != null ? masofaMetr(mijoz.lat, mijoz.lng, pos.lat, pos.lng) : null;

      // 1. Qisman qaytarish / brak — qatorlar kamayadi, tovar omborga qaytadi
      let qaytSumma = 0;
      for (const q of qaytarish) {
        const qator = qatorlar.find(x => String(x.tovar_id) === q.tovarId);
        if (!qator) continue;
        const dona = Math.min(q.dona, n(qator.jami_dona));
        if (dona <= 0) continue;
        const narx = n(qator.narx), summa = +(narx * dona).toFixed(2);
        qaytSumma += summa;
        await YetkazishQaytarishModel.create({ ariza_id: ariza.id, tovar_id: qator.tovar_id, tovar_nomi: qator.tovar_nomi, dona, summa, tur: q.tur, sabab: q.sabab, dostavchi_id: dId, sana: vaqt }, { transaction: t });
        await TovarRegisterModel.create({
          tovar_id: qator.tovar_id, tovar_nomi: qator.tovar_nomi, turkum: qator.turkum || null,
          ombor: q.tur === 'brak' ? BRAK_OMBOR : (ariza.ombor || 'Основной склад'),
          tur: 'qaytarma_kirim', manba_tur: 'qaytarma', manba_id: ariza.id,
          donada: dona, bloklarda: 0, qutilarda: 0, hajm: 0, kirim_narx: 0, sotuv_narx: narx, summa, sana: vaqt,
        }, { transaction: t });
        // Qator va buyurtma summasi haqiqatda topshirilganga tushadi
        await qator.update({ jami_dona: n(qator.jami_dona) - dona, dona: Math.max(0, n(qator.dona) - dona), summa: +(n(qator.summa) - summa).toFixed(2) }, { transaction: t });
      }
      const jamiSumma = qaytSumma > 0 ? Math.max(0, +(n(ariza.jami_summa) - qaytSumma).toFixed(2)) : n(ariza.jami_summa);

      // 2. Holat + kim/qayerda yetkazgani
      const tolangan = naqd === undefined || naqd === null ? null : Math.max(0, Math.min(jamiSumma, n(naqd)));
      await ariza.update({
        holat: 'yetkazildi', yetkazilgan_sana: vaqt, ...(oflayn ? { oflayn: true } : {}),
        yetkazgan_dostavchi_id: dId, yetkazish_lat: pos?.lat ?? null, yetkazish_lng: pos?.lng ?? null, yetkazish_masofa_m: masofa,
        tolangan_summa: tolangan ?? (ariza.tolov_turi === 'naqt' || ariza.tolov_turi === 'naqd' ? jamiSumma : 0),
        jami_summa: jamiSumma,
        izoh: izoh ? `${ariza.izoh ? ariza.izoh + ' | ' : ''}Dostavchik: ${izoh}`.slice(0, 2000) : ariza.izoh,
      }, { transaction: t });

      // 3. Kassa / qarz / agent bonusi
      return arizaYetkazildiEffektlari(ariza, { transaction: t, userId: dId, kassaManbaTur: 'dostavchik', tolangan, sana: vaqt });
    });

    if (natija && natija.xato) return fail(res, natija.xato[0], natija.xato[1]);
    if (natija && natija.allaqachon) return ok(res, { docId: String(ariza.id), allaqachon: true }, 'Allaqachon yetkazilgan');

    ok(res, {
      docId: String(ariza.id), docNumber: ariza.raqam, summa: n(ariza.jami_summa),
      naqd: natija.naqd, qarzgaYozildi: natija.qarz, qaytarildi: qaytarish.length,
      masofa, uzoqda: masofa != null && masofa > SOTUV_RADIUS_M,
    }, natija.qarz > 0 ? `Yetkazildi · ${Math.round(natija.qarz).toLocaleString('ru-RU')} so'm qarzga yozildi` : 'Yetkazildi');
  };

  // POST yetkazilmadi/ { docId, sabab, izoh, lat, long } — buyurtma navbatda qoladi
  yetkazilmadi = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const { docId, sabab, izoh } = req.body;
    const pos = koordinata(req.body);
    const vaqt = mobilVaqt(req.body.vaqt);
    const mobilId = mobilKalit(req.body.mobilId);
    const takror = async () => {
      const bor = mobilId ? await YetkazishUrinishModel.findOne({ where: { mobil_id: mobilId } }) : null;
      if (!bor) return false;
      const a = await ArizaModel.findByPk(bor.ariza_id, { attributes: ['id', 'yetkazish_urinish'] });
      ok(res, { docId: String(bor.ariza_id), urinish: Number(a?.yetkazish_urinish || 0), takror: true }, 'Allaqachon qayd etilgan');
      return true;
    };
    if (await takror()) return;
    const s = SABABLAR.find(x => x.id === sabab) ? sabab : 'boshqa';
    let natija;
    try {
      natija = await sequelize.transaction(async (t) => {
        const ariza = await qulflabOl(ArizaModel, docId, t);
        if (!ariza) return { xato: ['Buyurtma topilmadi', 404] };
        if (!meniki(ariza, dId)) return { xato: ['Bu buyurtma sizga tayinlanmagan', 403] };
        if (!AKTIV.includes(ariza.holat)) return { xato: [`Buyurtma "${ariza.holat}" holatida`, 400] };
        const mijoz = ariza.mijoz_id ? await MijozModel.findByPk(ariza.mijoz_id, { attributes: ['id', 'lat', 'lng'], transaction: t }) : null;
        const masofa = pos && mijoz && mijoz.lat != null ? masofaMetr(mijoz.lat, mijoz.lng, pos.lat, pos.lng) : null;
        await YetkazishUrinishModel.create({ ariza_id: ariza.id, dostavchi_id: dId, sabab: s, izoh: izoh || null, lat: pos?.lat ?? null, lng: pos?.lng ?? null, masofa_m: masofa, sana: vaqt, mobil_id: mobilId }, { transaction: t });
        const urinish = Number(ariza.yetkazish_urinish || 0) + 1;
        await ariza.update({ yetkazish_urinish: urinish, yetkazish_izoh: `${(SABABLAR.find(x => x.id === s) || {}).nom}${izoh ? ' — ' + izoh : ''}`.slice(0, 255) }, { transaction: t });
        return { id: ariza.id, urinish };
      });
    } catch (e) { if (takrorXato(e) && await takror()) return; throw e; }
    if (natija.xato) return fail(res, natija.xato[0], natija.xato[1]);
    ok(res, { docId: String(natija.id), urinish: natija.urinish }, 'Qayd etildi — buyurtma navbatda qoladi');
  };

  // POST qarzTolov/ { klientId, summa, izoh, docId? } — eski qarzni undirish
  qarzTolov = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const { klientId, izoh } = req.body;
    // Chekli, 0..1e12 (Infinity/NaN — 400)
    const summa = summaOl(req.body.summa, { bosh: 0, xabar: "To'lov summasi noto'g'ri" });
    const vaqt = mobilVaqt(req.body.vaqt);
    const mobilId = mobilKalit(req.body.mobilId);
    const takror = async () => {
      const bor = mobilId ? await KassaModel.findOne({ where: { mobil_id: mobilId } }) : null;
      if (!bor) return false;
      const m = await MijozModel.findByPk(bor.mijoz_id, { attributes: ['id', 'balans'] });
      ok(res, { klientId: String(bor.mijoz_id), summa: n(bor.summa), yangiQarz: m ? Math.max(0, -n(m.balans)) : 0, takror: true }, "To'lov allaqachon qabul qilingan");
      return true;
    };
    if (await takror()) return;
    if (!klientId || summa <= 0) return fail(res, "Mijoz va summa noto'g'ri");
    const mijoz = await MijozModel.findByPk(klientId);
    if (!mijoz) return fail(res, 'Mijoz topilmadi', 404);
    // Faqat dostavchikning mijozidan: unga shu mijozning buyurtmasi tayinlangan bo'lishi kerak
    // (aks holda istalgan dostavchik istalgan mijoz qarzini kamaytira olardi)
    const bogliq = await ArizaModel.count({ where: { mijoz_id: mijoz.id, dostavchi_id: dId } });
    if (!bogliq) return fail(res, 'Bu mijoz sizning marshrutingizda emas', 403);
    const eskiBalans = n(mijoz.balans);
    try {
      await sequelize.transaction(async (t) => {
        const kassa = await KassaModel.create({
          tur: 'kirim', kategoriya: 'mijoz_tolov', summa, tolov_usul: 'naqt',
          manba_tur: 'mijoz_dostavchik', manba_id: mijoz.id, mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
          izoh: izoh || 'Dostavchik qabul qildi', sana: vaqt, user_id: dId, mobil_id: mobilId,
        }, { transaction: t });
        await MijozModel.increment('balans', { by: summa, where: { id: mijoz.id }, transaction: t });
        // Mijoz reytingi: qarzdor mijoz to'ladi (+ball, kuniga bir marta)
        if (eskiBalans < -0.5) {
          await reytingYoz(mijoz.id, {
            tur: 'tolov_qabul', sabab: "Qarz to'lovi (dostavchik)", summa, manba_tur: 'kassa', manba_id: kassa.id,
            qarzYopildi: eskiBalans + summa >= -0.5,
            xodim: { rol: 'dostavchi', id: dId, nomi: req.currentAgent?.ism || req.currentAgent?.fullname || null }, sana: vaqt,
          }, t);
        }
      });
    } catch (e) { if (takrorXato(e) && await takror()) return; throw e; }
    await mijoz.reload({ attributes: ['id', 'balans'] });
    ok(res, { klientId: String(mijoz.id), summa, yangiQarz: Math.max(0, -(n(mijoz.balans))) }, "To'lov qabul qilindi");
  };

  // GET kunYakuni/?sana= — omborga nima qaytadi, kassaga nima topshiriladi
  kunYakuni = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugunKey();
    const trip = await tripBugun(dId, sana);
    const arizalar = await marshrutArizalar(dId, sana);
    const pul = await bugungiPul(dId, sana);
    const qaytarishlar = await YetkazishQaytarishModel.findAll({ where: { dostavchi_id: dId, sana: { [Op.gte]: new Date(sana + 'T00:00:00'), [Op.lt]: new Date(sana + 'T23:59:59.999') } } });
    const yetkazilmagan = arizalar.filter(a => AKTIV.includes(a.holat));
    const yetk = arizalar.filter(a => a.holat === 'yetkazildi');
    // Mashinada qolgan tovar = yetkazilmagan buyurtmalar tovari + qaytarma/brak
    const tovarMap = {};
    const qosh = (k, nom, dona, tur) => { const x = tovarMap[k] || (tovarMap[k] = { tovarId: k, tovar: nom, yetkazilmagan: 0, qaytarma: 0, brak: 0 }); x[tur] += dona; };
    yetkazilmagan.forEach(a => (a.qatorlar || []).forEach(q => qosh(String(q.tovar_id), q.tovar_nomi, n(q.jami_dona), 'yetkazilmagan')));
    qaytarishlar.forEach(q => qosh(String(q.tovar_id), q.tovar_nomi, n(q.dona), q.tur === 'brak' ? 'brak' : 'qaytarma'));
    ok(res, {
      sana, holat: trip?.holat || 'yangi',
      buyurtma: { jami: arizalar.length, yetkazildi: yetk.length, yetkazilmadi: yetkazilmagan.length, summa: yetk.reduce((s, a) => s + n(a.jami_summa), 0) },
      pul: { yigildi: pul.yigildi, topshirildi: pul.topshirildi, topshirishKerak: Math.max(0, pul.yigildi - pul.topshirildi), tolovSoni: pul.soni,
             qarzgaYozildi: yetk.reduce((s, a) => s + Math.max(0, n(a.jami_summa) - n(a.tolangan_summa)), 0) },
      omborgaQaytadi: Object.values(tovarMap).map(x => ({ ...x, jami: x.yetkazilmagan + x.qaytarma + x.brak })).sort((a, b) => b.jami - a.jami),
      yetkazilmaganlar: yetkazilmagan.map(a => ({ docId: String(a.id), docNumber: a.raqam, klient: a.mijoz_nomi, summa: n(a.jami_summa), urinishIzoh: a.yetkazish_izoh || '' })),
      naqdElon: trip && trip.naqd_elon != null ? n(trip.naqd_elon) : null,
      yopishVaqt: trip?.tugagan_vaqt || null,
    });
  };

  // POST reysYakunla/ { naqdSumma, izoh, lat, long } — kun yopildi
  reysYakunla = async (req, res) => {
    const dId = talab(req, res); if (!dId) return;
    const vaqt = mobilVaqt(req.body.vaqt);      // oflayn: kun haqiqatda yopilgan vaqt
    const sana = bugunKey(vaqt);
    const trip = await tripBugun(dId, sana);
    if (!trip) return fail(res, 'Bugun reys boshlanmagan');
    if (trip.holat === 'yakunlandi') {
      // Ilova qayta yuborgan bo'lsa (javob yo'lda yo'qolgan) — xato emas
      const pul = await bugungiPul(dId, sana);
      const kutilgan = Math.max(0, pul.yigildi - pul.topshirildi);
      const elon = trip.naqd_elon != null ? n(trip.naqd_elon) : null;
      return ok(res, { tripId: trip.id, kutilganNaqd: kutilgan, elonNaqd: elon, farq: elon === null ? null : +(elon - kutilgan).toFixed(2), allaqachon: true }, 'Reys allaqachon yakunlangan');
    }
    const pos = koordinata(req.body);
    const naqdRaw = req.body.naqdSumma ?? req.body.naqd;
    const naqdElon = summaOl(naqdRaw, { bosh: null, xabar: "Naqd summa noto'g'ri" });
    await trip.update({ holat: 'yakunlandi', tugagan_vaqt: vaqt, tugagan_lat: pos?.lat ?? null, tugagan_lng: pos?.lng ?? null, naqd_elon: naqdElon, izoh: req.body.izoh || trip.izoh });
    const pul = await bugungiPul(dId, sana);
    const kutilgan = Math.max(0, pul.yigildi - pul.topshirildi);
    ok(res, { tripId: trip.id, kutilganNaqd: kutilgan, elonNaqd: naqdElon, farq: naqdElon === null ? null : +(naqdElon - kutilgan).toFixed(2) }, 'Reys yakunlandi — kassaga naqdni topshiring');
  };
}

module.exports = new MobileDostavchikController();
