const sequelize = require('../../db/db-sequelize');
const KassaModel = require('../../models/kassa.model');
const DostavchiModel = require('../../models/dostavchi.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const { AgentLocationModel } = require('../../models/hisobot.model');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { Op } = require('sequelize');
const bcrypt = require('bcryptjs');
const { dostavchiYigildi, dostavchiTopshirildi, dostavchiTopshir } = require('../../utils/dostavchiInkassatsiya.utils');
const { kunKey, tzOffset } = require('../../utils/tahlil.utils');

// Ikki koordinata orasidagi masofa (km), Yer sharining egriligini hisobga oladi
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371, d2r = Math.PI / 180;
  const dLat = (lat2 - lat1) * d2r;
  const dLng = (lng2 - lng1) * d2r;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * d2r) * Math.cos(lat2 * d2r) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Hudud klasteri radiusi (km) — bundan yaqin zakazlar bitta hudud hisoblanadi.
// ~15 km bitta shahar/tuman doirasini qamraydi: Farg'ona va Andijon alohida
// klasterga tushadi, lekin Farg'ona ichidagi mahallalar birlashadi.
const KLASTER_RADIUS_KM = 15;

// Yo'lga chiqarishga tayyor zakazlarni koordinatasi bo'yicha guruhlaymiz.
// Oddiy ochko'z (greedy) klasterlash: eng ko'p zakaz to'plangan nuqtadan
// boshlab radius ichidagilarni bitta hududga yig'amiz, so'ng qolganidan
// yana shunday — natijada "Farg'ona tarafi", "Andijon tarafi" kabi
// tabiiy to'plamlar hosil bo'ladi.
function klasterla(nuqtalar, radiusKm = KLASTER_RADIUS_KM) {
  const qolgan = [...nuqtalar];
  const klasterlar = [];

  while (qolgan.length) {
    // Har bir nomzod uchun radius ichiga nechta zakaz tushishini sanaymiz
    let eng = { idx: 0, ichida: [] };
    for (let i = 0; i < qolgan.length; i++) {
      const ichida = qolgan.filter(p =>
        haversineKm(qolgan[i].lat, qolgan[i].lng, p.lat, p.lng) <= radiusKm
      );
      if (ichida.length > eng.ichida.length) eng = { idx: i, ichida };
    }
    if (!eng.ichida.length) eng = { idx: 0, ichida: [qolgan[0]] };

    const azolar = eng.ichida;
    const markaz = {
      lat: azolar.reduce((s, p) => s + p.lat, 0) / azolar.length,
      lng: azolar.reduce((s, p) => s + p.lng, 0) / azolar.length,
    };
    klasterlar.push({ markaz, azolar });

    const azoIds = new Set(azolar.map(p => p.ariza_id));
    for (let i = qolgan.length - 1; i >= 0; i--) {
      if (azoIds.has(qolgan[i].ariza_id)) qolgan.splice(i, 1);
    }
  }

  return klasterlar;
}

class DostavchiController extends BaseController {

  // ── GET /dostavchilar ──────────────────────────────────────
  getAll = async (req, res) => {
    const { search, faol } = req.query;
    const where = {};
    if (search) where.ism = { [Op.like]: `%${search}%` };
    if (faol !== undefined) where.faol = faol === 'true' || faol === '1';

    const rows = await DostavchiModel.findAll({
      where,
      order: [['ism', 'ASC']],
    });

    // Har bir dostavchi uchun aktiv buyurtmalar soni
    const result = await Promise.all(rows.map(async (d) => {
      const aktivCount = await ArizaModel.count({
        where: {
          dostavchi_id: d.id,
          holat: { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] },
        },
      });
      return { ...d.toJSON(), aktiv_buyurtma: aktivCount };
    }));

    res.send(result);
  };

  // ── GET /dostavchilar/:id ──────────────────────────────────
  getById = async (req, res) => {
    const d = await DostavchiModel.findByPk(req.params.id);
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
    res.send(d);
  };

  // ── GET /dostavchilar/hudud-tavsiya?ariza_id=.. ────────────
  // "Yo'lga chiqarish" bosqichining asosiy endpointi.
  //
  // Mantiq: dostavchining hozir qayerdaligi emas, QAYSI HUDUDDA ISHLAYOTGANI
  // muhim. Bir dostavchi bir tarafga chiqsa — o'sha tarafdagi hamma zakazni
  // olib ketishi kerak, aks holda Andijon va Farg'ona bitta odamga tushib
  // qoladi. Shuning uchun:
  //   1. Yo'lga tayyor (yigilmoqda/tasdiqlangan) barcha zakazni koordinatasi
  //      bo'yicha hududlarga klasterlaymiz;
  //   2. Ochilgan ariza qaysi hududga tushsa — o'sha hududdagi BARCHA zakazni
  //      birga yuborish uchun tavsiya qilamiz;
  //   3. Dostavchilarni shu hududga bandligi bo'yicha baholaymiz: allaqachon
  //      shu tarafda aktiv zakazi bori — eng mos; boshqa hududda bandi —
  //      tavsiya qilinmaydi (band, chunki u boshqa tarafga ketgan).
  hududTavsiya = async (req, res) => {
    const arizaId = parseInt(req.query.ariza_id, 10);
    if (!arizaId) throw new HttpException(400, 'ariza_id kerak');

    const joriy = await ArizaModel.findByPk(arizaId, {
      include: [{ model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'lat', 'lng', 'manzil'] }],
      attributes: ['id', 'raqam', 'mijoz_nomi', 'jami_summa', 'holat', 'jonatish_sana'],
    });
    if (!joriy) throw new HttpException(404, 'Ariza topilmadi');

    // Yo'lga chiqarishga tayyor barcha zakazlar (joriysi ham shu ro'yxatda)
    const tayyorlar = await ArizaModel.findAll({
      where: {
        holat: { [Op.in]: ['yigilmoqda', 'tasdiqlangan'] },
        [Op.or]: [{ dostavchi_id: null }, { id: joriy.id }],
      },
      include: [{ model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'lat', 'lng', 'manzil'] }],
      attributes: ['id', 'raqam', 'mijoz_nomi', 'jami_summa', 'holat', 'jonatish_sana'],
      order: [['id', 'ASC']],
      limit: 300,
    });

    const koordBilan = tayyorlar.filter(a => a.mijoz?.lat != null && a.mijoz?.lng != null);
    const koordsiz   = tayyorlar.filter(a => !(a.mijoz?.lat != null && a.mijoz?.lng != null));

    const arizaToJSON = (a, masofaKm = null) => ({
      ariza_id:   a.id,
      raqam:      a.raqam,
      mijoz_nomi: a.mijoz?.nomi || a.mijoz_nomi,
      manzil:     a.mijoz?.manzil || null,
      jami_summa: parseFloat(a.jami_summa || 0),
      holat:      a.holat,
      lat:        a.mijoz?.lat != null ? Number(a.mijoz.lat) : null,
      lng:        a.mijoz?.lng != null ? Number(a.mijoz.lng) : null,
      masofa_km:  masofaKm,
      joriy:      a.id === joriy.id,
    });

    // ── Hududlarni ajratamiz ──
    const nuqtalar = koordBilan.map(a => ({
      ariza_id: a.id, lat: Number(a.mijoz.lat), lng: Number(a.mijoz.lng), row: a,
    }));
    const klasterlar = klasterla(nuqtalar);

    const joriyKoordBor = joriy.mijoz?.lat != null && joriy.mijoz?.lng != null;
    const hududlar = klasterlar.map((k, i) => {
      const azolar = k.azolar.map(p =>
        arizaToJSON(p.row, +haversineKm(k.markaz.lat, k.markaz.lng, p.lat, p.lng).toFixed(1))
      ).sort((a, b) => a.masofa_km - b.masofa_km);
      return {
        kod:          `hudud-${i + 1}`,
        markaz:       { lat: +k.markaz.lat.toFixed(6), lng: +k.markaz.lng.toFixed(6) },
        arizalar:     azolar,
        soni:         azolar.length,
        jami_summa:   azolar.reduce((s, a) => s + a.jami_summa, 0),
        joriy_hudud:  azolar.some(a => a.joriy),
      };
    }).sort((a, b) => (b.joriy_hudud ? 1 : 0) - (a.joriy_hudud ? 1 : 0) || b.soni - a.soni);

    const joriyHudud = hududlar.find(h => h.joriy_hudud) || null;

    // ── Dostavchilarni shu hududga moslik bo'yicha baholaymiz ──
    const dostavchilar = await DostavchiModel.findAll({
      where: { faol: true },
      order: [['ism', 'ASC']],
    });

    const dRes = await Promise.all(dostavchilar.map(async (d) => {
      const aktivlar = await ArizaModel.findAll({
        where: { dostavchi_id: d.id, holat: { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] } },
        include: [{ model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'lat', 'lng'] }],
        attributes: ['id', 'raqam'],
        limit: 50,
      });

      // Dostavchining aktiv zakazlari qaysi hududlarda — shu uning "joriy tarafi"
      const aktivNuqta = aktivlar
        .filter(a => a.mijoz?.lat != null && a.mijoz?.lng != null)
        .map(a => ({ ariza_id: a.id, raqam: a.raqam, mijoz_nomi: a.mijoz.nomi, lat: Number(a.mijoz.lat), lng: Number(a.mijoz.lng) }));

      let shuHududdaSoni = 0;
      let boshqaHududdaSoni = 0;
      let markazgaMasofa = null;

      if (joriyHudud) {
        const { lat: hLat, lng: hLng } = joriyHudud.markaz;
        aktivNuqta.forEach(p => {
          const km = haversineKm(hLat, hLng, p.lat, p.lng);
          if (km <= KLASTER_RADIUS_KM) shuHududdaSoni++;
          else boshqaHududdaSoni++;
        });
        if (aktivNuqta.length) {
          markazgaMasofa = +Math.min(
            ...aktivNuqta.map(p => haversineKm(hLat, hLng, p.lat, p.lng))
          ).toFixed(1);
        }
      }

      const bosh = aktivNuqta.length === 0 && aktivlar.length === 0;

      return {
        id: d.id,
        ism: d.ism,
        telefon: d.telefon,
        transport: d.transport,
        mashina_raqam: d.mashina_raqam,
        aktiv_buyurtma: aktivlar.length,
        shu_hududda: shuHududdaSoni,
        boshqa_hududda: boshqaHududdaSoni,
        markazga_km: markazgaMasofa,
        bosh,
        // Boshqa tarafda bandi — bu hududga yubormaslik kerak
        band_boshqa_tarafda: boshqaHududdaSoni > 0 && shuHududdaSoni === 0,
        aktiv_nuqtalar: aktivNuqta,
      };
    }));

    // Tartib: shu hududda ishlayotgan > bo'sh > boshqa tarafda band
    const daraja = (r) => r.shu_hududda > 0 ? 0 : (r.bosh ? 1 : (r.band_boshqa_tarafda ? 3 : 2));
    dRes.sort((a, b) =>
      daraja(a) - daraja(b) ||
      b.shu_hududda - a.shu_hududda ||
      a.aktiv_buyurtma - b.aktiv_buyurtma ||
      a.ism.localeCompare(b.ism)
    );

    const tavsiyaId = dRes.length ? dRes[0].id : null;
    const tavsiyaSabab = !dRes.length ? null
      : dRes[0].shu_hududda > 0
        ? `Shu hududda allaqachon ${dRes[0].shu_hududda} ta zakazi bor`
        : dRes[0].bosh
          ? "Hozir bo'sh — butun hududni olishi mumkin"
          : 'Eng kam band dostavchi';

    res.send({
      ariza: arizaToJSON(joriy),
      hudud: joriyHudud,
      hududlar,
      koordinatasiz: koordsiz.map(a => arizaToJSON(a)),
      dostavchilar: dRes,
      tavsiya_id: tavsiyaId,
      tavsiya_sabab: tavsiyaSabab,
      radius_km: KLASTER_RADIUS_KM,
    });
  };

  // ── GET /dostavchilar/tavsiya?lat=..&lng=.. ────────────────
  // Eski, masofaga asoslangan tavsiya. hududTavsiya bilan almashtirildi,
  // lekin boshqa joylarda ishlatilishi mumkinligi uchun saqlanmoqda.
  tavsiya = async (req, res) => {
    const mLat = parseFloat(req.query.lat);
    const mLng = parseFloat(req.query.lng);
    const hasMijozKoord = !isNaN(mLat) && !isNaN(mLng);

    const dostavchilar = await DostavchiModel.findAll({
      where: { faol: true },
      order: [['ism', 'ASC']],
    });

    const result = await Promise.all(dostavchilar.map(async (d) => {
      const [aktivBuyurtma, oxirgiNuqta, yoldaMijozlar] = await Promise.all([
        ArizaModel.count({
          where: { dostavchi_id: d.id, holat: { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] } },
        }),
        AgentLocationModel.findOne({
          where: { agent_id: d.id, rol: 'dostavchi' },
          order: [['sana', 'DESC']],
          attributes: ['lat', 'lng', 'sana'],
        }),
        // Hozir "yo'lda" holatidagi buyurtmalari — joriy marshrutini ko'rsatish uchun
        ArizaModel.findAll({
          where: { dostavchi_id: d.id, holat: 'yolda' },
          include: [{ model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'lat', 'lng'] }],
          attributes: ['id', 'raqam'],
          limit: 20,
        }),
      ]);

      const marshrut = yoldaMijozlar
        .filter(a => a.mijoz && a.mijoz.lat != null && a.mijoz.lng != null)
        .map(a => ({
          ariza_id: a.id, raqam: a.raqam,
          mijoz_nomi: a.mijoz.nomi, lat: Number(a.mijoz.lat), lng: Number(a.mijoz.lng),
        }));

      // Asosiy: haqiqiy GPS nuqtasidan masofa (eng aniq)
      let masofaKm = null;
      let masofaTaxminiy = false;
      if (hasMijozKoord && oxirgiNuqta && oxirgiNuqta.lat != null && oxirgiNuqta.lng != null) {
        masofaKm = +haversineKm(mLat, mLng, Number(oxirgiNuqta.lat), Number(oxirgiNuqta.lng)).toFixed(1);
      }
      // Zaxira: GPS yo'q bo'lsa, hozir yo'lda ketayotgan marshrutidagi eng yaqin
      // bekatdan hisoblaymiz — bu taxminiy, chunki dostavchi shu bekatlar orasida
      // biror joyda bo'lishi mumkin, lekin GPS bo'lmaganda yo'nalishni bilish
      // uchun yagona mavjud signal shu.
      if (masofaKm === null && hasMijozKoord && marshrut.length) {
        const engYaqinBekat = marshrut.reduce((min, m) => {
          const d = haversineKm(mLat, mLng, m.lat, m.lng);
          return d < min.d ? { d, m } : min;
        }, { d: Infinity, m: null });
        if (engYaqinBekat.m) {
          masofaKm = +engYaqinBekat.d.toFixed(1);
          masofaTaxminiy = true;
        }
      }

      return {
        id: d.id,
        ism: d.ism,
        telefon: d.telefon,
        transport: d.transport,
        mashina_raqam: d.mashina_raqam,
        aktiv_buyurtma: aktivBuyurtma,
        joriy_joylashuv: oxirgiNuqta ? {
          lat: Number(oxirgiNuqta.lat), lng: Number(oxirgiNuqta.lng), sana: oxirgiNuqta.sana,
        } : null,
        masofa_km: masofaKm,
        masofa_taxminiy: masofaTaxminiy,
        marshrut,
      };
    }));

    // Tavsiya: masofasi bor (real yoki taxminiy) va eng yaqin + eng kam band
    // bo'lgan birinchi. Real GPS masofasi taxminiydan doim ustun turadi.
    const bilaMasofa = result.filter(r => r.masofa_km !== null);
    let tavsiyaId = null;
    if (bilaMasofa.length) {
      const eng = [...bilaMasofa].sort((a, b) =>
        (a.masofa_taxminiy ? 1 : 0) - (b.masofa_taxminiy ? 1 : 0) ||
        a.masofa_km - b.masofa_km ||
        a.aktiv_buyurtma - b.aktiv_buyurtma
      )[0];
      tavsiyaId = eng.id;
    } else if (result.length) {
      // Hech kimda masofa ma'lumoti yo'q — eng kam band bo'lganni tavsiya qilamiz
      const engBosh = [...result].sort((a, b) => a.aktiv_buyurtma - b.aktiv_buyurtma)[0];
      tavsiyaId = engBosh.id;
    }

    res.send({ dostavchilar: result, tavsiya_id: tavsiyaId });
  };

  // ── GET /dostavchilar/:id/reja ─────────────────────────────
  // Dostavchining kunlik marshruti (sana bo'yicha buyurtmalar)
  // ?turi=aktiv (default) | tarix | barcha
  reja = async (req, res) => {
    const d = await DostavchiModel.findByPk(req.params.id);
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');

    const turi = req.query.turi || 'aktiv';
    const where = { dostavchi_id: d.id };

    if (turi === 'aktiv') {
      where.holat = { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] };
    } else if (turi === 'tarix') {
      where.holat = { [Op.in]: ['yetkazildi', 'bekor'] };
    } // 'barcha' — filtr yo'q

    if (req.query.sana) where.jonatish_sana = req.query.sana;

    const arizalar = await ArizaModel.findAll({
      where,
      include: [
        { model: ArizaQatorModel, as: 'qatorlar' },
        { model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'telefon', 'manzil', 'lat', 'lng'] },
      ],
      order: [['jonatish_sana', turi === 'tarix' ? 'DESC' : 'ASC'], ['id', 'ASC']],
    });

    res.send({ dostavchi: d, arizalar });
  };

  // ── GET /dostavchilar/:id/statistika ───────────────────────
  statistika = async (req, res) => {
    const d = await DostavchiModel.findByPk(req.params.id);
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');

    const base = { dostavchi_id: d.id };
    const [aktiv, yetkazildi, bekor, jami] = await Promise.all([
      ArizaModel.count({ where: { ...base, holat: { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] } } }),
      ArizaModel.count({ where: { ...base, holat: 'yetkazildi' } }),
      ArizaModel.count({ where: { ...base, holat: 'bekor' } }),
      ArizaModel.count({ where: base }),
    ]);

    // Yetkazilgan buyurtmalar umumiy summasi
    const yetkazilganlar = await ArizaModel.findAll({
      where: { ...base, holat: 'yetkazildi' },
      attributes: ['jami_summa'],
      raw: true,
    });
    const jami_summa = yetkazilganlar.reduce((s, a) => s + parseFloat(a.jami_summa || 0), 0);

    res.send({ aktiv, yetkazildi, bekor, jami, jami_summa });
  };

  // ── GET /dostavchilar/:id/kassa?sana= ──────────────────────
  // Dostavchik shu kuni yetkazishda va qarz undirishda yig'gan naqd (kassa.kirim,
  // user_id = dostavchi), kassir qabul qilgani (inkassatsiya yozuvi) va farq.
  // Dostavchik ilovadagi "reysYakunla" da o'zi sanagan summani ham ko'rsatadi.
  kassa = async (req, res) => {
    const d = await DostavchiModel.findByPk(req.params.id);
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
    const sana = /^\d{4}-\d{2}-\d{2}$/.test(req.query.sana || '') ? req.query.sana : kunKey(new Date());
    const Q = sequelize.QueryTypes.SELECT;
    const [yig, top, [trip], tolovlar] = await Promise.all([
      dostavchiYigildi(d.id, sana),
      dostavchiTopshirildi(d.id, sana),
      sequelize.query(`SELECT id, raqam, holat, boshlangan_vaqt, tugagan_vaqt, naqd_elon FROM trip_sheet WHERE dostavchi_id=:id AND sana=:sana LIMIT 1`, { replacements: { id: d.id, sana }, type: Q }),
      sequelize.query(`SELECT id, mijoz_nomi, summa, manba_tur, izoh, sana FROM kassa
        WHERE tur='kirim' AND tolov_usul='naqt' AND user_id=:id AND manba_tur IN ('dostavchik','mijoz_dostavchik') AND DATE(CONVERT_TZ(sana, '+00:00', :tz))=:sana ORDER BY sana`, { replacements: { id: d.id, sana, tz: tzOffset() }, type: Q }),
    ]);
    const yigildi = yig.summa, topshirildi = top.summa;
    res.send({
      dostavchi: { id: d.id, ism: d.ism }, sana,
      yigildi, yetkazish: yig.yetkazish, qarz_undirish: yig.qarz_undirish, tolov_soni: yig.soni,
      topshirildi, topshirish_vaqt: top.vaqt || null,
      kerak: Math.max(0, +(yigildi - topshirildi).toFixed(2)),
      trip: trip || null,
      naqd_elon: trip && trip.naqd_elon != null ? Number(trip.naqd_elon) : null,
      tolovlar: tolovlar.map(t => ({ ...t, summa: Number(t.summa) })),
    });
  };

  // ── POST /dostavchilar/:id/kassa-qabul { sana, summa, izoh } ──
  // Kassir dostavchikdan naqdni qabul qildi: inkassatsiya yozuvi (agentlardagi kabi),
  // summa avvalgisiga qo'shiladi. Kassaga chiqim YOZILMAYDI — pul kassaga kirgan,
  // faqat "kim qo'lida" o'zgaradi (utils/dostavchiInkassatsiya.utils.js).
  kassaQabul = async (req, res) => {
    const d = await DostavchiModel.findByPk(req.params.id);
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
    const sana = /^\d{4}-\d{2}-\d{2}$/.test(req.body.sana || '') ? req.body.sana : kunKey(new Date());
    const summa = Number(req.body.summa);
    if (!(summa >= 0)) throw new HttpException(400, "Summa noto'g'ri");
    // Ixtiyoriy optimistik tekshiruv: klient ko'rgan "topshirildi" summasi. Bazadagidan farq
    // qilsa (boshqa kassir parallel qabul qilgan) — 409, ikki marta qo'shilmaydi.
    let kutilganTopshirilgan;
    const kt = req.body.kutilgan_topshirilgan;
    if (kt !== undefined && kt !== null && kt !== '') {
      kutilganTopshirilgan = Number(kt);
      if (!Number.isFinite(kutilganTopshirilgan) || kutilganTopshirilgan < 0) {
        throw new HttpException(400, "kutilgan_topshirilgan noto'g'ri");
      }
    }
    if (req.body.izoh != null && String(req.body.izoh).length > 2000) throw new HttpException(400, 'Izoh juda uzun');
    const natija = await dostavchiTopshir(d, sana, {
      summa, jami: false, izoh: req.body.izoh || null, userId: req.currentUser?.id || null,
      kutilganTopshirilgan,
    });
    res.status(201).send({ ...natija.row.toJSON(), yigildi: natija.yigildi, topshirildi: natija.topshirildi, kerak: natija.kerak });
  };

  // ── POST /dostavchilar ─────────────────────────────────────
  create = async (req, res) => {
    this.checkValidation(req);
    const { ism, telefon, transport, mashina_raqam, izoh, login, parol } = req.body;
    if (login) {
      const mavjud = await DostavchiModel.findOne({ where: { login } });
      if (mavjud) throw new HttpException(400, "Bu login band — boshqa dostavchi tomonidan ishlatilmoqda");
    }
    const d = await DostavchiModel.create({
      ism,
      telefon:       telefon || null,
      transport:     transport || null,
      mashina_raqam: mashina_raqam || null,
      izoh:          izoh || null,
      faol:          true,
      login:         login || null,
      parol:         parol ? await bcrypt.hash(parol, 10) : null,
    });
    res.status(201).send(d);
  };

  // ── PATCH /dostavchilar/:id ────────────────────────────────
  update = async (req, res) => {
    this.checkValidation(req);
    const d = await DostavchiModel.findByPk(req.params.id);
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
    const { ism, telefon, transport, mashina_raqam, izoh, faol, login, parol } = req.body;
    if (login && login !== d.login) {
      const mavjud = await DostavchiModel.findOne({ where: { login, id: { [Op.ne]: d.id } } });
      if (mavjud) throw new HttpException(400, "Bu login band — boshqa dostavchi tomonidan ishlatilmoqda");
    }
    await d.update({
      ism:           ism ?? d.ism,
      telefon:       telefon ?? d.telefon,
      transport:     transport ?? d.transport,
      mashina_raqam: mashina_raqam ?? d.mashina_raqam,
      izoh:          izoh ?? d.izoh,
      faol:          faol ?? d.faol,
      login:         login !== undefined ? (login || null) : d.login,
      parol:         parol ? await bcrypt.hash(parol, 10) : d.parol,
    });
    res.send(d);
  };

  // ── DELETE /dostavchilar/:id ───────────────────────────────
  // Butunlay o'chirish faqat TARIXI YO'Q dostavchi uchun: buyurtmalar (istalgan holat),
  // kassa yozuvlari, inkassatsiya, reyslar, yetkazish urinish/qaytarishlari yoki unga bog'langan
  // agent bo'lsa — hisobotlar va hisob-kitob buzilmasin, o'rniga nofaol qilinadi.
  // Tekshiruv va o'chirish bitta tranzaksiyada, dostavchi qatori qulflangan holda.
  delete = async (req, res) => {
    await sequelize.transaction(async (t) => {
      const d = await DostavchiModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
      const [r] = await sequelize.query(`
        SELECT
          (SELECT COUNT(*) FROM ariza WHERE dostavchi_id = :id OR yetkazgan_dostavchi_id = :id) AS ariza,
          (SELECT COUNT(*) FROM kassa WHERE user_id = :id AND manba_tur IN ('dostavchik','mijoz_dostavchik')) AS kassa,
          (SELECT COUNT(*) FROM inkassatsiya WHERE dostavchi_id = :id) AS inkassatsiya,
          (SELECT COUNT(*) FROM trip_sheet WHERE dostavchi_id = :id) AS trip,
          (SELECT COUNT(*) FROM yetkazish_urinish WHERE dostavchi_id = :id) AS urinish,
          (SELECT COUNT(*) FROM yetkazish_qaytarish WHERE dostavchi_id = :id) AS qaytarish,
          (SELECT COUNT(*) FROM agent WHERE linked_dostavchi_id = :id) AS agent`,
      { replacements: { id: d.id }, type: sequelize.QueryTypes.SELECT, transaction: t });
      const tarix = Object.values(r || {}).some(v => Number(v) > 0);
      if (tarix) {
        throw new HttpException(400, "Bu dostavchining tarixi bor (buyurtmalar, kassa, inkassatsiya yoki reyslar) — o'chirib bo'lmaydi, o'rniga nofaol qiling");
      }
      await d.destroy({ transaction: t });
    });
    res.send({ message: "O'chirildi" });
  };

  // ── PATCH /dostavchilar/:id/faol ───────────────────────────
  toggleFaol = async (req, res) => {
    const d = await DostavchiModel.findByPk(req.params.id);
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
    await d.update({ faol: !d.faol });
    res.send(d);
  };
}

module.exports = new DostavchiController();
