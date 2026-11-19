const sequelize = require('../../db/db-sequelize');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const KassaModel = require('../../models/kassa.model');
const HttpException = require('../../utils/HttpException.utils');
const { generateRaqam } = require('../../utils/arizaRaqam.utils');
const { kreditTekshir } = require('../../utils/kreditLimit.utils');
const { ok, requireRole, mobilVaqt, mobilKalit, takrorXato } = require('./shared');
const { qulflabOl, tovarlarniQulfla } = require('../../utils/qulf.utils');
const TovarRegisterModel = require('../../models/tovar_register.model');
const { agentOmbori, ASOSIY_OMBOR } = require('../../utils/ombor.utils');
const { zaxiraTekshir } = require('../../utils/zaxira.utils');
const { arizaYetkazildiEffektlari } = require('../../utils/arizaYetkazildi.utils');
const { turkumToldir } = require('../../utils/turkum.utils');
const { reytingYoz } = require('../../utils/reyting.utils');
const { TashrifModel } = require('../../models/marshrut.model');
const { masofaMetr, koordinata, SOTUV_RADIUS_M } = require('../../utils/geo.utils');

/* Avtolavka: agent omboridagi qoldiq, tovar bo'yicha */
async function agentOmborQoldiq(ombor, transaction) {
  const [rows] = await sequelize.query(
    'SELECT tovar_id, SUM(donada) q FROM tovar_register WHERE ombor = ? GROUP BY tovar_id',
    { replacements: [ombor], transaction });
  const map = {};
  rows.forEach(r => { map[r.tovar_id] = parseFloat(r.q) || 0; });
  return map;
}

/* Mobil ilova sanani "24.07.2026" (DD.MM.YYYY) ko'rinishida yuboradi,
   Sequelize DATEONLY esa ISO kutadi. Aks holda moment js Date() ga
   qaytib, "not in a recognized RFC2822 or ISO format" ogohlantirishi
   chiqadi va sana noto'g'ri saqlanadi. */
function sanaNormalla(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(+v) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  // 24.07.2026 yoki 24/07/2026
  const m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const [, d, oy, yil] = m;
    return `${yil}-${oy.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  // Allaqachon ISO (2026-07-24 yoki to'liq timestamp)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // Mobil kontrakt formati 2026.10.19 (yoki 2026/10/19) — `new Date` ga bermaymiz:
  // u mahalliy yarim tunga aylantirib, UTC'da bir kun orqaga surardi (deliveryDate ertaga → bugun)
  const y = s.match(/^(\d{4})[./](\d{1,2})[./](\d{1,2})$/);
  if (y) return `${y[1]}-${y[2].padStart(2, '0')}-${y[3].padStart(2, '0')}`;
  const dt = new Date(s);
  if (isNaN(+dt)) return null;
  // Vaqtli qiymat (timestamp) — mahalliy kun bo'yicha
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const son = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const r2 = (v) => Math.round(v * 100) / 100;

// Mobil mahsulot obyektini ariza qatoriga moslash.
// Miqdor (kolbo = umumiy dona) > 0 va narx >= 0 bo'lishi shart. Qator summasi SERVERDA
// narx × miqdor bo'yicha hisoblanadi; ilova yuborgan summa faqat 1 so'mgacha yaxlitlash
// farqi bo'lsa qabul qilinadi (APK ko'rsatgan raqam bilan mos qolishi uchun).
const mapQator = (p) => {
  if (!p || typeof p !== 'object') throw new HttpException(400, "Tovar qatori noto'g'ri");
  const nomi = p.productName || p.tovar || '';
  const kim = nomi || (p.tovarId ? `#${p.tovarId}` : 'tovar');
  const miqdor = son(p.kolbo ?? p.sht);
  if (!Number.isFinite(miqdor) || miqdor <= 0) throw new HttpException(400, `"${kim}" miqdori noto'g'ri (0 dan katta bo'lishi kerak)`);
  const narx = son(p.yangiNarx ?? p.eskiNarx ?? 0);
  if (!Number.isFinite(narx) || narx < 0) throw new HttpException(400, `"${kim}" narxi noto'g'ri`);
  const blok = son(p.pachka ?? 0);
  const hisob = r2(narx * miqdor);
  const ilova = son(p.yangisumma ?? p.eskisumma);
  const summa = Number.isFinite(ilova) && Math.abs(ilova - hisob) <= 1 ? r2(ilova) : hisob;
  return {
    tovar_id: p.tovarId,
    tovar_nomi: nomi,
    shtrix_kod: p.shtrix_kod || null,
    narx,
    blok: Number.isFinite(blok) && blok > 0 ? blok : 0,
    dona: miqdor,
    jami_dona: miqdor,
    summa,
  };
};

/* Qatorlar jami − chegirma. Chegirma manfiy yoki qatorlar jamidan katta bo'lmaydi;
   agentda max_chegirma (%) belgilangan bo'lsa, undan oshmaydi. */
function jamiHisobla(qatorlar, chegirmaRaw, agent) {
  const qatorJami = r2(qatorlar.reduce((s, q) => s + (Number(q.summa) || 0), 0));
  const chegirma = chegirmaRaw === undefined || chegirmaRaw === null || chegirmaRaw === '' ? 0 : son(chegirmaRaw);
  if (!Number.isFinite(chegirma) || chegirma < 0) throw new HttpException(400, "Chegirma summasi noto'g'ri");
  if (chegirma > qatorJami + 0.005) throw new HttpException(400, 'Chegirma hujjat summasidan katta bo\'lishi mumkin emas');
  const maxFoiz = agent ? parseFloat(agent.max_chegirma) || 0 : 0;
  if (maxFoiz > 0 && qatorJami > 0 && (chegirma / qatorJami) * 100 > maxFoiz + 0.01) {
    throw new HttpException(400, `Chegirma ${maxFoiz}% dan oshmasligi kerak`);
  }
  return { qatorJami, chegirma: r2(chegirma), jami: r2(Math.max(0, qatorJami - chegirma)) };
}

// Ariza (savdo yoki qaytarish) yaratish — umumiy yordamchi.
// Web'dan Won Sell sotuvi ham shu yerdan o'tadi (manba='web', webUser — kim kiritgani),
// shuning uchun mobil va web sotuv mantiqi (qoldiq, kredit, kassa, qarz, bonus) har doim bir xil.
// agent = null → SKLAD sotuvi (Won Sell → Sotuv qilish, xodimsiz): admin asosiy skladdan sotadi —
// tovar asosiy skladdan chiqadi (boshqa zakazlarga band qilingani tekshiriladi), hujjat darhol
// "yetkazildi", naqd to'g'ridan-to'g'ri kassaga (manba_tur='sklad', user_id = web foydalanuvchi —
// inkassatsiya uni agent puli deb sanamaydi), qarz mijoz balansiga. Agent bonusi yo'q.
async function createAriza({ body, agent, turi, manba = 'mobil', webUser = null, webUserId = null, keyin = null }) {
  const sklad = !agent;
  if (sklad && turi !== 'sotish') throw new HttpException(400, 'Skladdan faqat sotuv qilinadi');
  const products = Array.isArray(body.products) ? body.products : [];
  if (!body.klientId || !products.length) {
    throw new HttpException(400, 'klientId va products majburiy');
  }

  const mijozOldin = await MijozModel.findByPk(body.klientId);
  if (!mijozOldin) throw new HttpException(404, 'Mijoz topilmadi');

  /* MOBIL OFLAYN: haqiqiy vaqt (internet yo'q paytda qilingan sotuv keyin keladi),
     takrorlanmas kalit va "oflayn" belgisi. */
  const vaqt = mobilVaqt(body.vaqt);
  const mobilId = mobilKalit(body.mobilId);
  const oflayn = body.oflayn === true || body.oflayn === 'true';
  const avtolavka = turi === 'sotish' && !!(agent && agent.avtolavka);
  const darhol = avtolavka || sklad;   // tovar shu zahoti topshiriladi — tasdiq/yig'ish/dostavchik yo'q

  // Qatorlar va jami SERVERDA hisoblanadi (ilova yuborgan itogSummaSumYangi ishlatilmaydi):
  // qator summasi = narx × miqdor, jami = qatorlar − chegirma (web "Yangi ariza" bilan bir xil).
  const tayyorQatorlar = products.map(mapQator);
  const { chegirma, jami: itog } = jamiHisobla(tayyorQatorlar, body.skidkaSum, agent);

  // Avtolavkada joyida olingan naqd (qisman to'lov). Berilmasa — currency bo'yicha.
  const tolangan = darhol && body.tolanganSumma !== undefined && body.tolanganSumma !== null && body.tolanganSumma !== ''
    ? Math.max(0, Math.min(itog, parseFloat(body.tolanganSumma) || 0)) : null;
  const naqdMi = body.currency === 'naqt' || body.currency === 'naqd';
  const qarzQism = tolangan !== null ? itog - tolangan : (naqdMi ? 0 : itog);

  /* QARZ TO'LOV SANASI: qarzga (yoki qisman) sotuvda agent kalendardan belgilaydi.
     Faqat qarz qismi bo'lsa saqlanadi; sotuv kunidan oldingi sana qabul qilinmaydi. */
  let tolovSana = null;
  if (turi === 'sotish' && qarzQism > 0.005 && body.tolovSana) {
    const s = sanaNormalla(body.tolovSana);
    if (s && s >= vaqt.toISOString().slice(0, 10)) tolovSana = s;
  }

  // Kredit limit / muddati o'tgan qarz tekshiruvi — faqat sotishda va faqat qarzga
  // ketadigan qism uchun (naqd sotuv qarz hosil qilmaydi; web bilan bir xil).
  // Tekshiruv tranzaksiya ichida, mijoz qatori qulflangan holda bajariladi (pastda).
  // Yagona istisno: AVTOLAVKA oflayn sotuvi — tovar mijozga allaqachon jismonan
  // topshirilgan, rad etish haqiqiy qarzni yo'qotib qo'yadi; ilova sotuv paytida
  // keshlangan ma'lumot bilan tekshirgan. Oddiy zakaz (tovar hali omborda) oflayn
  // bo'lsa ham to'liq tekshiriladi. Qoldiq tekshiruvi esa HECH QACHON o'tkazib yuborilmaydi.
  const kreditTekshirilsin = turi === 'sotish' && qarzQism > 0.005 && !(oflayn && avtolavka);

  /* JOYLASHUV: sotuv qayerda qilingani va mijoz nuqtasigacha masofa.
     Bloklanmaydi (GPS adashadi, offline yuborilgan bo'lishi mumkin) — web'da
     "uzoqdan sotuv" sifatida belgilanadi. Sotuv ochiq tashrif (check-in)
     ichida bo'lsa, shu tashrifga bog'lanadi. */
  const nuqta = koordinata(body);
  const masofa = nuqta ? masofaMetr(mijozOldin.lat, mijozOldin.lng, nuqta.lat, nuqta.lng) : null;
  const bugunSana = vaqt.toISOString().slice(0, 10);
  let tashrif = null;
  if (agent && body.tashrifId) {
    tashrif = await TashrifModel.findOne({ where: { id: body.tashrifId, agent_id: agent.id } });
  }
  if (agent && !tashrif && turi === 'sotish') {
    tashrif = await TashrifModel.findOne({
      where: { agent_id: agent.id, mijoz_id: body.klientId, sana: bugunSana, checkout_vaqt: null },
      order: [['id', 'DESC']],
    });
  }

  /* AVTOLAVKA: tovar mashinada, mijozga shu zahoti topshiriladi. Tasdiqlash /
     yig'ish / yo'lda bosqichlari yo'q — hujjat darhol "yetkazildi" bo'ladi,
     chiqim agentning o'z omboridan tushadi, qarz/kassa/bonus effektlari
     web changeHolat bilan bir xil (arizaYetkazildi.utils). */
  const ombor = avtolavka ? agentOmbori(agent.fullname) : (sklad ? ASOSIY_OMBOR : undefined);

  const ish = async (t) => {
    // QULF TARTIBI (yangi hujjat): tovar qatorlari tranzaksiyaning ENG BIRINCHI so'rovi —
    // REPEATABLE READ'da qoldiq o'qishlari (zaxiraTekshir / mashina qoldig'i) shu qulfdan
    // keyingi holatni ko'radi; parallel sotuvlar shu tovarlar bo'yicha navbatma-navbat o'tadi.
    if (turi === 'sotish') await tovarlarniQulfla(tayyorQatorlar.map(q => q.tovar_id), t);

    // Mijoz qatori qulflanadi: shu mijozga parallel sotuv/to'lov navbatma-navbat o'tadi,
    // kredit limiti eskirgan balans bilan tekshirilmaydi.
    const mijoz = await qulflabOl(MijozModel, body.klientId, t);
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    if (kreditTekshirilsin) {
      const kredit = await kreditTekshir(mijoz, qarzQism, t);
      if (kredit.bloklangan) {
        const err = new HttpException(402, kredit.xabar);
        err.status = 402;
        throw err;
      }
    }

    const qatorlar = await turkumToldir(tayyorQatorlar, t);   // qatorga tovar turkumi (chek, yig'ma ro'yxat, hisobot)

    // ZAKAZ (oddiy agent): faqat skladda mavjud tovar — boshqa ochiq buyurtmalarga
    // band qilingani ayiriladi. Oflayn zakaz ham tekshiriladi (aks holda bir tovar
    // ikki marta band qilinib, qoldiq minusga ketadi). zaxiraTekshir tovar qatorlarini
    // tranzaksiya ichida o'zi qulflaydi.
    if (turi === 'sotish' && !avtolavka) {
      await zaxiraTekshir(qatorlar, { ombor: ASOSIY_OMBOR, transaction: t });
    }

    if (avtolavka) {
      // Mashina qoldig'i — tovarlar tranzaksiya boshida qulflangan
      const qoldiq = await agentOmborQoldiq(ombor, t);
      for (const q of qatorlar) {
        if (!q.tovar_id) continue;
        const kerak = parseFloat(q.jami_dona) || 0;
        const bor = qoldiq[q.tovar_id] || 0;
        if (kerak > bor + 0.001) {
          throw new HttpException(400,
            `"${q.tovar_nomi || `#${q.tovar_id}`}" mashinada yetarli emas. Kerak: ${kerak}, bor: ${bor}`);
        }
      }
    }

    // Hujjat raqami hisoblagichi shu tranzaksiya bilan birga commit/rollback bo'ladi
    const raqam = await generateRaqam(t);

    const ariza = await ArizaModel.create({
      turi,
      raqam,
      manba,
      kanal: sklad ? 'sklad' : (agent.avtolavka ? 'avtolavka' : 'distributsiya'),
      holat: darhol ? 'yetkazildi' : 'yangi',
      ombor: ombor,
      yetkazilgan_sana: darhol ? vaqt : null,
      mijoz_id: body.klientId,
      mijoz_nomi: mijoz ? mijoz.nomi : null,
      agent_id: agent ? agent.id : null,
      agent_nomi: agent ? agent.fullname : null,
      jami_summa: itog,
      chegirma_summa: chegirma,
      tolov_turi: body.currency || null,
      tolov_sana: tolovSana,
      izoh: [body.komment, webUser ? `Web orqali kiritdi: ${webUser}` : null].filter(Boolean).join(' · ').slice(0, 2000) || null,
      jonatish_sana: darhol ? sanaNormalla(vaqt) : sanaNormalla(body.deliveryDate),
      mobil_id: mobilId,
      oflayn,
      // Avtolavka: joyida olingan naqd (to'liq, qisman yoki 0) — kun hisobi va hisobotlar shundan
      tolangan_summa: darhol ? (tolangan !== null ? tolangan : (naqdMi ? itog : 0)) : 0,
      lat: nuqta ? nuqta.lat : null,
      lng: nuqta ? nuqta.lng : null,
      masofa_m: masofa,
      tashrif_id: tashrif ? tashrif.id : null,
    }, { transaction: t });

    if (tashrif && turi === 'sotish') {
      await tashrif.update({ natija: 'savdo', ariza_id: tashrif.ariza_id || ariza.id }, { transaction: t });
    }
    // Mijoz nuqtasi hali belgilanmagan bo'lsa — agent haqiqatda do'konda turgan
    // holatda (avtolavka yoki tashrif ichida) sotuv nuqtasi mijoz manzili bo'ladi
    if (mijoz && nuqta && (mijoz.lat == null || mijoz.lng == null) && (avtolavka || tashrif)) {
      await MijozModel.update({ lat: nuqta.lat, lng: nuqta.lng }, { where: { id: mijoz.id }, transaction: t });
    }

    await ArizaQatorModel.bulkCreate(
      qatorlar.map(q => ({ ...q, ariza_id: ariza.id })),
      { transaction: t },
    );

    // Mijoz reytingi: zakaz berdi / sotib oldi (+ball, kuniga bir marta; bekor qilinsa qaytadi)
    if (turi === 'sotish' && mijoz) {
      await reytingYoz(mijoz.id, {
        tur: 'buyurtma', sabab: avtolavka ? 'Won Sell sotuvi' : (sklad ? 'Skladdan sotuv' : 'Zakaz berdi'),
        summa: parseFloat(ariza.jami_summa) || 0, manba_tur: 'ariza', manba_id: ariza.id,
        xodim: agent ? { rol: 'agent', id: agent.id, nomi: agent.fullname } : (webUser ? { rol: 'web', id: null, nomi: webUser } : null),
        sana: vaqt,
      }, t);
    }

    if (darhol) {
      const sana = vaqt;
      await TovarRegisterModel.bulkCreate(
        qatorlar.filter(q => q.tovar_id).map(q => ({
          tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum || null,
          ombor, tur: 'chiqim', manba_tur: 'sotuv', manba_id: ariza.id,
          donada: -Math.abs(parseFloat(q.jami_dona) || 0),
          bloklarda: -Math.abs(parseFloat(q.blok) || 0),
          qutilarda: 0, hajm: 0, kirim_narx: 0,
          sotuv_narx: parseFloat(q.narx) || 0,
          summa: -Math.abs(parseFloat(q.summa) || 0),
          sana,
        })), { transaction: t });
      // Naqd bo'lsa pul agentning qo'lida — kassa yozuvi 'avtolavka' manbasi va
      // user_id = agent bilan: inkassatsiya hisoboti uni agent yig'gan pul deb sanaydi
      // Sklad: pul kassada (manba 'sklad', user_id = admin) — inkassatsiyaga kirmaydi
      await arizaYetkazildiEffektlari(ariza, {
        transaction: t, userId: sklad ? webUserId : agent.id, kassaManbaTur: sklad ? 'sklad' : 'avtolavka', tolangan, sana: vaqt,
      });
    }

    // Chaqiruvchining qo'shimcha qadamlari (masalan saveVozvrat ombor kirimi) — shu tranzaksiyada
    if (keyin) await keyin(ariza, qatorlar, t);

    return ariza;
  };
  return sequelize.transaction(ish);
}

// Tahrirlanadigan (ombordan hali chiqmagan) zakaz holatlari — zaxira.utils OCHIQ_HOLAT bilan bir xil
const TAHRIR_HOLAT = ['yangi', 'tasdiqlangan', 'yigilmoqda'];

/* ── Orders & Sales ────────────────────────────────────────────────────── */
class MobileSavdoController {
  // 6.1 saveSell/ → data: { androidId, docId, docNumber }  (offline kontrakt)
  // Faqat agent — dostavchik sotuv yarata olmasligi kerak, aks holda
  // ariza.agent_id ustuniga dostavchining ID'si yozilib, `agent` jadvali
  // bilan mos kelmay qolar edi.
  saveSell = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const javob = (ariza, takror = false) => ({
      androidId: req.body.androidId ?? 0,
      docId: String(ariza.id),
      docNumber: ariza.raqam || String(ariza.id),
      // Mijoz nuqtasigacha masofa (metr) — null: GPS yoki mijoz koordinatasi yo'q
      masofa: ariza.masofa_m,
      uzoqda: ariza.masofa_m != null && ariza.masofa_m > SOTUV_RADIUS_M,
      takror,
    });
    // Oflayn navbat bir xil sotuvni qayta yuborsa — borini qaytaramiz (ikki marta yozilmaydi)
    const mobilId = mobilKalit(req.body.mobilId);
    const borini = async () => mobilId
      ? ArizaModel.findOne({ where: { mobil_id: mobilId, agent_id: req.currentAgent.id } }) : null;
    const bor = await borini();
    if (bor) return ok(res, javob(bor, true), 'Sotuv allaqachon saqlangan');
    let ariza;
    try {
      ariza = await createAriza({ body: req.body, agent: req.currentAgent, turi: 'sotish' });
    } catch (e) {
      if (e && e.name === 'SequelizeUniqueConstraintError') {
        const b = await borini();
        if (b) return ok(res, javob(b, true), 'Sotuv allaqachon saqlangan');
      }
      throw e;
    }
    ok(res, javob(ariza), 'Sotuv saqlandi');
  };

  // 6.2 saveVozvrat/ → data: { date (lokal id), docId }  (offline kontrakt)
  saveVozvrat = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const agent = req.currentAgent;
    const javob = (ariza, takror = false) => ({ date: req.body.date ?? 0, docId: String(ariza.id), ...(takror ? { takror: true } : {}) });

    // Oflayn navbat bir xil vozvratni qayta yuborsa — borini qaytaramiz (ombor kirimi ikki marta yozilmaydi)
    const mobilId = mobilKalit(req.body.mobilId);
    const borini = async () => mobilId
      ? ArizaModel.findOne({ where: { mobil_id: mobilId, agent_id: agent.id, turi: 'qaytarish' } }) : null;
    const bor = await borini();
    if (bor) return ok(res, javob(bor, true), 'Vozvrat allaqachon saqlangan');

    /* Qaytarilgan tovar AGENT omboriga kiradi, asosiyga emas.
       Skladchi web'da tekshirib qabul qilgach asosiy omborga o'tadi
       (ariza.controller.js → qaytarishQabul). Shu sababli ariza
       "qabul_kutilmoqda" holatida qoladi. Hujjat, qatorlar, ombor kirimi va
       holat — hammasi BITTA tranzaksiyada (yarim yozilgan vozvrat qolmaydi). */
    const ombor = agentOmbori(agent?.fullname);
    let ariza;
    try {
      ariza = await createAriza({
        body: req.body, agent, turi: 'qaytarish',
        keyin: async (a, qatorlar, t) => {
          await TovarRegisterModel.bulkCreate(
            qatorlar.filter(q => q.tovar_id).map(q => ({
              tovar_id:   q.tovar_id,
              tovar_nomi: q.tovar_nomi,
              turkum:     q.turkum || null,
              ombor,
              tur:        'qaytarma_kirim',
              manba_tur:  'qaytarma',
              manba_id:   a.id,
              donada:     Math.abs(parseFloat(q.jami_dona || 0)),
              bloklarda:  Math.abs(parseFloat(q.blok || 0)),
              qutilarda:  0,
              hajm:       0,
              kirim_narx: 0,
              sotuv_narx: parseFloat(q.narx || 0),
              summa:      Math.abs(parseFloat(q.summa || 0)),
              sana:       new Date(),
            })), { transaction: t });
          await a.update({ holat: 'qabul_kutilmoqda', ombor }, { transaction: t });
        },
      });
    } catch (e) {
      if (takrorXato(e)) {
        const b = await borini();
        if (b) return ok(res, javob(b, true), 'Vozvrat allaqachon saqlangan');
      }
      throw e;
    }

    // hujjat: data.date = yuborilgan zakazning lokal androidId (int) qiymati
    ok(res, javob(ariza), 'Vozvrat saqlandi');
  };

  // 6.4 editSell/ → data: { androidId }
  // Faqat zakaz egasi (agent_id) va faqat ombordan hali chiqmagan (ochiq) zakaz.
  // Qatorlar va jami serverda qayta hisoblanadi (mavjud chegirma saqlanadi).
  editSell = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const { docId, products } = req.body;
    const list = Array.isArray(products) ? products : [];
    if (!list.length) throw new HttpException(400, 'products majburiy');
    const yangiQatorlar = list.map(mapQator);   // miqdor/narx validatsiyasi tranzaksiyadan oldin

    await sequelize.transaction(async (t) => {
      const ariza = await qulflabOl(ArizaModel, docId, t);
      if (!ariza) throw new HttpException(404, req.mf('Not found'));
      if (Number(ariza.agent_id) !== Number(req.currentAgent.id)) throw new HttpException(403, 'Bu hujjat sizga tegishli emas');
      if (ariza.turi !== 'sotish' || !TAHRIR_HOLAT.includes(ariza.holat)) {
        throw new HttpException(400, `"${ariza.holat}" holatidagi hujjatni tahrirlab bo'lmaydi`);
      }
      // QULF TARTIBI (mavjud hujjat, web changeHolat bilan bir xil): ariza → tovar → o'qishlar
      await tovarlarniQulfla(yangiQatorlar.map(q => q.tovar_id), t);
      const qatorlar = await turkumToldir(yangiQatorlar, t);
      // Ochiq zakaz tahriri ham faqat skladdagi mavjud tovardan (o'zining bandi hisobga olinmaydi)
      await zaxiraTekshir(qatorlar, { ombor: ariza.ombor || ASOSIY_OMBOR, istisnoArizaId: ariza.id, transaction: t });
      const { jami } = jamiHisobla(qatorlar, ariza.chegirma_summa, null);

      await ArizaQatorModel.destroy({ where: { ariza_id: ariza.id }, transaction: t });
      await ArizaQatorModel.bulkCreate(
        qatorlar.map(q => ({ ...q, ariza_id: ariza.id })),
        { transaction: t },
      );
      await ariza.update({ jami_summa: jami }, { transaction: t });
    });
    ok(res, { androidId: req.body.androidId ?? 0 }, 'Yangilandi');
  };

  // 6.3 savePayment/ → data: { date }  (offline kontrakt)
  // paymentSum = [{ paymentTypeId, summa }]
  // Faqat agent — web "Inkassatsiya" hisoboti (hisobot.controller.js) faqat
  // `agent` jadvali bilan JOIN qiladi; dostavchik to'lov qabul qilsa,
  // kassa.user_id dostavchiga ishora qilib, hisobotdan sirli yo'qolib qolardi.
  savePayment = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const { klientId, paymentSum = [], komment, data: sana } = req.body;
    const qismlar = (Array.isArray(paymentSum) ? paymentSum : [])
      .map(p => parseFloat(p && p.summa != null ? p.summa : p) || 0);
    if (qismlar.some(x => x < 0)) throw new HttpException(400, "To'lov summasi noto'g'ri");
    const jami = Math.round(qismlar.reduce((s, x) => s + x, 0) * 100) / 100;
    if (jami <= 0) throw new HttpException(400, "To'lov summasi noto'g'ri");

    if (!klientId) throw new HttpException(400, 'klientId majburiy');

    // Oflayn navbat: bir xil to'lov qayta kelsa — ikkinchi marta yozilmaydi.
    // Tez tekshiruv shu yerda, yakuniy himoya — kassa.mobil_id UNIQUE (parallel takror
    // tranzaksiyani rollback qiladi va pastda "allaqachon qabul qilingan" deb javob beriladi).
    const mobilId = mobilKalit(req.body.mobilId);
    const takrorJavob = () => ok(res, { date: sana || '', takror: true }, "To'lov allaqachon qabul qilingan");
    const takrorMi = async () => !!(mobilId && await KassaModel.findOne({ where: { mobil_id: mobilId }, attributes: ['id'] }));
    if (await takrorMi()) return takrorJavob();

    const chekRasm = req.file ? `/uploads/kassa/${req.file.filename}` : null;
    const vaqt = mobilVaqt(req.body.vaqt);

    try {
      await sequelize.transaction(async (t) => {
        if (mobilId && await KassaModel.findOne({ where: { mobil_id: mobilId }, attributes: ['id'], transaction: t })) {
          const e = new Error('takror'); e.name = 'SequelizeUniqueConstraintError'; throw e;
        }
        // Mijoz qatori qulflab o'qiladi — balans parallel to'lov/sotuvda yo'qolmaydi
        const mijoz = await qulflabOl(MijozModel, klientId, t);
        if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
        const eskiBalans = parseFloat(mijoz.balans) || 0;

        const kassa = await KassaModel.create({
          tur: 'kirim',
          kategoriya: 'mijoz_tolov',
          summa: jami,
          tolov_usul: 'naqt',
          manba_tur: 'mijoz',
          manba_id: mijoz.id,
          mijoz_id: mijoz.id,
          mijoz_nomi: mijoz.nomi,
          izoh: komment || null,
          sana: vaqt,
          user_id: req.currentAgent ? req.currentAgent.id : null,  // inkassatsiya uchun: kim yig'gani
          chek_rasm: chekRasm,
          mobil_id: mobilId,
        }, { transaction: t });

        // To'lov qarzni kamaytiradi → balans OSHADI (web kassa bilan bir xil mantiq:
        // manfiy balans = qarz, to'lov balansni musbat tomonga suradi). Nisbiy yozuv (increment).
        await MijozModel.increment('balans', { by: jami, where: { id: mijoz.id }, transaction: t });

        if (eskiBalans < -0.5) {   // reyting: faqat qarzdor mijoz to'lovi
          await reytingYoz(mijoz.id, {
            tur: 'tolov_qabul', sabab: "Qarz to'lovi qabul qilindi", summa: jami, manba_tur: 'kassa', manba_id: kassa.id,
            qarzYopildi: eskiBalans + jami >= -0.5,
            xodim: req.currentAgent ? { rol: 'agent', id: req.currentAgent.id, nomi: req.currentAgent.fullname } : null,
            sana: vaqt,
          }, t);
        }
      });
    } catch (e) {
      if (takrorXato(e) && await takrorMi()) return takrorJavob();
      throw e;
    }
    ok(res, { date: sana || '' }, "To'lov qabul qilindi");
  };
}

module.exports = new MobileSavdoController();
module.exports.createAriza = createAriza;   // web: Won Sell → Sotuv qilish (xodim nomidan)
