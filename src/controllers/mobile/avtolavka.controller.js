/**
 * AVTOLAVKA — mobil ilova (ko'chma savdo agenti).
 *
 * Agentning kuni:
 *   1. yuklashTavsiya / yuklashTovarlar → yuklashSorov   — mashinaga nima kerakligini so'raydi
 *   2. omborchi webda tasdiqlaydi (tovar agent omboriga o'tadi)
 *   3. yuklashlar → yuklashQabul                         — agent tovarni sanab "qabul qildim" deydi
 *   4. saveSell (savdo.controller) — mashinadagi tovardan sotadi, joylashuv bilan
 *   5. kunYakuni → kunniYopish                           — topshiradigan tovar va naqdni ko'radi,
 *                                                          "topshirishga tayyorman" deb e'lon qiladi
 *   6. omborchi webda qabul qiladi, kassir naqdni oladi → kun yopiladi
 *
 * avtolavkaHolat — shularning barchasi bitta ekranda: bosqich va keyingi qadam.
 */
const { Op } = require('sequelize');
const { reytingKorinish, qoidalar: reytingQoidalari } = require('../../utils/reyting.utils');
const sequelize = require('../../db/db-sequelize');
const { AvtolavkaHujjatModel, AvtolavkaQatorModel, AvtolavkaKunModel } = require('../../models/avtolavka.model');
const TovarModel = require('../../models/tovar.model');
const { narxXaritasi, agentNarxXaritasi, viloyatNarxlari } = require('../../utils/narx.utils');
const { MijozModel, MijozKategoriyaModel } = require('../../models/mijoz.model');
const { MarshrutRejaModel, TashrifModel } = require('../../models/marshrut.model');
const { NarxRuyxatModel, NarxRuyxatQatorModel } = require('../../models/narxRuyxat.model');
const { ok, fail, SABABLAR, summaOl, mobilKalit, mobilVaqt, takrorXato } = require('./shared');
const { ASOSIY_OMBOR, agentOmbori, sotuvOmbori, brakOmbori } = require('../../utils/ombor.utils');
const Diller = require('../../utils/diller.utils');
const HttpException = require('../../utils/HttpException.utils');
const KassaModel = require('../../models/kassa.model');
const TovarRegisterModel = require('../../models/tovar_register.model');
const AgentRegisterModel = require('../../models/agent_register.model');
const TerritoriyaModel = require('../../models/territoriya.model');
const { SavdoQaytarishModel, SavdoQaytarishQatorModel } = require('../../models/savdoQaytarish.model');
const AgentModel = require('../../models/agent.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { InkassatsiyaModel } = require('../../models/inkassatsiya.model');
const { mavjudQoldiq } = require('../../utils/zaxira.utils');
const { qulflabOl, tovarlarniQulfla } = require('../../utils/qulf.utils');
const { tzOffset, kunKey } = require('../../utils/tahlil.utils');
const { agentKochirishlari } = require('../../utils/agentKochirish.utils');
const { mobilBuyumlar } = require('../../utils/buyum.utils');
const { agentPlastikKassalar, majburiyat, majburiyatlar, agentPulTarix, topshiruvYarat, kassaTekshir, chekRasmOl } = require('../../utils/agentPul.utils');
const {
  INCLUDE, EPS, bugun, sanaMi, n, lokalKun,
  raqamYarat, narxMap, omborQoldiq, yuklashQoldigi, qatorlarniTayyorla, kunHisobla, kunniQaytaOch, tavsiyaHisobla,
} = require('../../utils/avtolavka.utils');

const HOLAT_NOMI = {
  bosh: 'Yuklanmagan', ochiq: 'Savdoda', topshirilmoqda: 'Topshirish kutilmoqda',
  yopiq: 'Kun yopildi', kamomad: 'Kamomad bilan yopildi',
};

/* Faqat avtolavka rejimidagi agent. Aks holda konvert ichida aniq xabar. */
function avtoAgent(req, res) {
  if (req.currentRole !== 'agent') {
    fail(res, 'Bu amal faqat agent uchun', 403);
    return null;
  }
  if (!req.currentAgent?.avtolavka) {
    fail(res, "Siz Won Sell (ko'chma savdo) rejimida emassiz. Administrator agent kartasida belgilashi kerak.", 403);
    return null;
  }
  return req.currentAgent;
}

/* 2026-11-29: dillerda yo'q oqimlar (yuklash so'rovi, kun yopish, naqd topshiruv) */
function dillerEmas(req, res) {
  const a = avtoAgent(req, res); if (!a) return null;
  if (a.diller) { fail(res, "Bu amal diller uchun emas — tovar kompaniyadan Dillerlar bo'limi orqali beriladi", 403); return null; }
  return a;
}

const AGENT_BEKOR = 'Agent bekor qildi';
const KUN_YOPILDI = 'Kun yopildi';

/* Yuklash hujjatining agent uchun tushunarli holati */
function yuklashHolati(h) {
  if (h.holat === 'bekor') return [AGENT_BEKOR, KUN_YOPILDI].includes(h.rad_sababi) ? 'bekor_qilindi' : 'rad_etildi';
  if (h.holat === 'qoralama') return 'kutilmoqda';
  return h.agent_qabul_vaqt ? 'qabul_qilindi' : 'yuklandi';
}

const qatorShakli = (q) => ({
  tovarId: String(q.tovar_id), tovar: q.tovar_nomi, turkum: q.turkum || '',
  dona: n(q.dona), blok: n(q.blok), narx: n(q.narx), summa: n(q.summa),
});

const hujjatShakli = (h) => ({
  docId: String(h.id),
  docNumber: h.raqam || String(h.id),
  sana: h.sana,
  manba: h.manba,
  holat: yuklashHolati(h),
  vaqt: h.createdAt,
  tasdiqVaqt: h.tasdiqlagan_sana,
  agentQabulVaqt: h.agent_qabul_vaqt,
  radSababi: h.rad_sababi || '',
  izoh: h.izoh || '',
  dona: n(h.jami_dona),
  summa: n(h.jami_summa),
  products: (h.qatorlar || []).map(qatorShakli),
});

/* Mobil mahsulot ro'yxatidan { tovar_id, dona, blok } — saveSell bilan bir xil kalitlar */
function mobilQatorlar(products) {
  return (Array.isArray(products) ? products : []).map(p => ({
    tovar_id: parseInt(p.tovarId ?? p.tovar_id, 10),
    dona: parseFloat(p.kolbo ?? p.dona ?? p.sht ?? 0),
    blok: parseFloat(p.pachka ?? p.blok ?? 0) || 0,
  })).filter(q => q.tovar_id > 0 && Number.isFinite(q.dona) && q.dona > 0 && q.dona <= 1e9);
}

/* Agent mashinasidagi hozirgi tovarlar, narx bilan */
async function mashinaTovarlari(agent) {
  const ombor = sotuvOmbori(agent);
  const map = await omborQoldiq(ombor);
  const ids = Object.keys(map).filter(id => map[id].qoldiq > EPS).map(Number);
  // Diller: narx — o'z narx ro'yxatidan (bo'lmasa 0), kompaniya narxi emas
  const dNarx = agent.diller ? await Diller.narxlarOl(agent.id) : null;
  const [narx, tovarlar] = await Promise.all([
    dNarx ? Object.fromEntries(ids.map(id => [id, { chakana_narx: dNarx[String(id)] || 0 }])) : narxMap(ids),
    ids.length ? TovarModel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'blokdagi_soni', 'turkum', 'olchov_birligi'], raw: true }) : [],
  ]);
  // Turkum — tovar kartasidan (Sozlamalar → Turkumlar); register yozuvidagi eski nom faqat zaxira
  const blok = {}, tk = {}, olchov = {}; tovarlar.forEach(t => { blok[t.id] = Math.max(1, +t.blokdagi_soni || 1); tk[t.id] = t.turkum || ''; olchov[t.id] = t.olchov_birligi || ''; });
  const qatorlar = ids.map(id => {
    const q = +map[id].qoldiq.toFixed(3), nx = narx[id]?.chakana_narx || 0;
    return {
      tovarId: String(id), tovar: map[id].tovar_nomi, turkum: tk[id] || map[id].turkum || '',
      blokdagiSoni: blok[id] || 1, countType: olchov[id] || 'dona', qoldiq: q, narx: nx, summa: +(q * nx).toFixed(2),
    };
  }).sort((a, b) => a.tovar.localeCompare(b.tovar));
  return {
    ombor, qatorlar,
    jami: {
      tovarSoni: qatorlar.length,
      dona: +qatorlar.reduce((s, x) => s + x.qoldiq, 0).toFixed(3),
      summa: +qatorlar.reduce((s, x) => s + x.summa, 0).toFixed(2),
    },
  };
}

/* Bosqichga qarab agentga keyingi qadam */
/* 2026-11-21: yangi modelda agent yuklashni so'ramaydi/qabul qilmaydi, kunni yopmaydi va naqd
   topshirmaydi — tovarni admin web'dan omboriga yuklaydi. Keyingi qadam doim 'savdo'. */
function keyingiQadam(kun, mashinaDona) {
  if (mashinaDona <= EPS) return { kod: 'savdo', matn: "Omboringizda tovar yo'q — administrator yuklashini kuting" };
  return { kod: 'savdo', matn: 'Mijozlarga boring va soting' };
}

// eslint-disable-next-line no-unused-vars
function eskiKeyingiQadam(kun, mashinaDona, qabulKutilmoqda) {
  if (kun.bosqich === 3) return { kod: 'yopiq', matn: "Kun yopildi. Rahmat! Yana chiqish kerak bo'lsa — yangi reys oching" };
  if (kun.holat === 'topshirilmoqda') return { kod: 'topshirish', matn: "Omborga qayting: qolgan tovar va naqdni topshiring" };
  if (qabulKutilmoqda > 0) return { kod: 'yuklash_qabul', matn: 'Yuklangan tovarni sanab, qabul qilganingizni tasdiqlang' };
  if (kun.sorovlar.length) return { kod: 'yuklash_kutilmoqda', matn: "So'rovingiz omborchida — tasdiqlanishini kuting" };
  if (mashinaDona <= EPS && kun.tovar.berildi.dona <= EPS) return { kod: 'yuklash_sorov', matn: "Mashinaga yuklash uchun so'rov yuboring" };
  if (mashinaDona <= EPS && kun.qayta_ochish) return { kod: 'yuklash_sorov', matn: "Kun qayta ochildi — yangi reys uchun yuklash so'rang" };
  return { kod: 'savdo', matn: 'Mijozlarga boring va soting' };
}

/* "Mening kunim" — avtolavkaHolat va avtolavkaSinxron uchun umumiy */
async function holatHisobla(agent, sana, tayyorMashina = null) {
  if (agent.diller) return Diller.mobilHolat(agent, sana, tayyorMashina || await mashinaTovarlari(agent), { lokalKun, tzOffset });
  let [kun, mashina, qabulsiz, qaytNaqd] = await Promise.all([
    kunHisobla(agent, sana),
    tayyorMashina || mashinaTovarlari(agent),
    AvtolavkaHujjatModel.findAll({
      where: { agent_id: agent.id, sana, tur: 'yuklash', holat: 'tasdiqlangan', agent_qabul_vaqt: null },
      order: [['id', 'ASC']],
    }),
    qaytarishNaqdi(agent.id, sana),
  ]);
  // Kun qayta ochilgan (yangi reys): oldingi, allaqachon topshirilgan reysning tasdiqlanmagan yuklashi so'ralmaydi
  if (kun.qayta_ochish) {
    const ochish = new Date(kun.qayta_ochish.vaqt);
    qabulsiz = qabulsiz.filter(h => h.tasdiqlagan_sana && new Date(h.tasdiqlagan_sana) >= ochish);
  }
  const qadam = keyingiQadam(kun, mashina.jami.dona, qabulsiz.length);
  return {
    sana,
    bosqich: kun.bosqich,
    holat: kun.holat,
    holatNomi: kun.holat === 'bosh' && mashina.jami.dona > EPS
      ? 'Mashinada oldingi kun qoldig\'i bor'
      : (HOLAT_NOMI[kun.holat] || kun.holat),
    keyingiQadam: qadam.kod,
    keyingiQadamMatn: qadam.matn,
    mashina: mashina.jami,
    bugun: {
      yuklandiDona: kun.tovar.berildi.dona,
      yuklandiSumma: kun.tovar.berildi.summa,
      sotuvSoni: kun.tovar.sotildi.hujjat_soni,
      sotuvDona: kun.tovar.sotildi.dona,
      sotuvSumma: kun.pul.sotuv_jami,
      naqdSotuv: kun.pul.naqd_sotuv,
      plastikSotuv: kun.pul.plastik_sotuv,
      qarzgaSotuv: kun.pul.qarzga_sotuv,
      // Agent qo'lidagi naqd: bugun olingan naqd − bugun qaytarishda mijozga berilgan naqd
      // (yangi modelda kassaga topshirish yo'q — inkassatsiyaga bog'liq emas)
      naqdQolda: Math.max(0, +(kun.pul.naqd_olindi - qaytNaqd).toFixed(2)),
      qaytarishNaqd: qaytNaqd,
      tashrif: kun.kun.tashrif,
      reja: kun.kun.reja,
      uzoqSotuv: kun.kun.uzoq_sotuv,
    },
    sorovlar: kun.sorovlar.map(s => ({ docId: String(s.id), docNumber: s.raqam, dona: s.dona, summa: s.summa, vaqt: s.vaqt })),
    qabulKutilmoqda: qabulsiz.map(h => ({
      docId: String(h.id), docNumber: h.raqam, dona: n(h.jami_dona), summa: n(h.jami_summa), vaqt: h.tasdiqlagan_sana,
    })),
    kunYopish: kun.kun_yopish ? { vaqt: kun.kun_yopish.vaqt, naqdElon: kun.kun_yopish.naqd_elon } : null,
  };
}

/* Ombordagi tovarlar — yuklash so'rovi formasi (oflaynda ham ochilishi uchun sinxronga ham qo'shiladi) */
async function omborTovarlari(agent, where = { faol: true, turi: 'tovar' }) {   // xom ashyo mashinaga yuklanmaydi
  if (agent.diller) return [];   // diller asosiy ombordan yuklash so'ramaydi
  const tovarlar = await TovarModel.findAll({
    where, attributes: ['id', 'nomi', 'turkum', 'blokdagi_soni', 'olchov_birligi'], order: [['nomi', 'ASC']], raw: true,
  });
  const [asosiy, mashina, narx] = await Promise.all([
    yuklashQoldigi(), omborQoldiq(agentOmbori(agent.fullname)), narxMap(tovarlar.map(t => t.id)),
  ]);
  return tovarlar
    .map(t => ({
      tovarId: String(t.id), tovar: t.nomi, turkum: t.turkum || '', countType: t.olchov_birligi || 'kg',
      blokdagiSoni: Math.max(1, +t.blokdagi_soni || 1),
      omborda: +(asosiy[t.id]?.qoldiq || 0).toFixed(3),
      mashinada: +(mashina[t.id]?.qoldiq || 0).toFixed(3),
      narx: narx[t.id]?.chakana_narx || 0,
    }))
    .filter(t => t.omborda > EPS);
}

async function tavsiyaShakli(agent) {
  const t = await tavsiyaHisobla(agent);
  return {
    manba: t.manba,                // ortacha | oxirgi | yoq
    ishKunlari: t.ish_kunlari,
    qatorlar: t.qatorlar.map(r => ({
      tovarId: String(r.tovar_id), tovar: r.tovar_nomi, turkum: r.turkum || '',
      blokdagiSoni: r.blokdagi_soni, ortacha: r.ortacha, mashinada: r.mashinada,
      omborda: r.omborda, tavsiya: r.tavsiya, narx: r.narx,
    })),
    jami: t.jami,
  };
}

async function bugungiYuklashlar(agent, sana) {
  const rows = await AvtolavkaHujjatModel.findAll({
    where: { agent_id: agent.id, sana, tur: 'yuklash' },
    include: INCLUDE, order: [['id', 'ASC']],
  });
  return rows.map(hujjatShakli);
}

/* Oflayn sotuv uchun narx ma'lumoti: ilova mijoz narxini o'zi hisoblaydi
   (toifa ro'yxati → mijoz turidagi standart → eski narx — narx.utils bilan bir xil).
   2026-11-25: agentning viloyati bo'lsa viloyatQoida = true — ilova toifa ro'yxati → viloyat
   narxi (mijoz narxTuri) → SOTILMAYDI qoidasini ishlatadi; viloyat: { tovarId: { chakana, optom } }. */
async function narxSinxron(mijozlar, tovarIds, agent = null) {
  const katIds = [...new Set(mijozlar.map(m => m.kategoriya_id).filter(Boolean))];
  const katlar = katIds.length ? await MijozKategoriyaModel.findAll({ where: { id: katIds }, attributes: ['id', 'narx_ruyxat_id'], raw: true }) : [];
  const katRuyxat = {}; katlar.forEach(k => { if (k.narx_ruyxat_id) katRuyxat[k.id] = k.narx_ruyxat_id; });
  const kerakli = [...new Set(Object.values(katRuyxat))];
  const ruyxatlar = await NarxRuyxatModel.findAll({
    where: { faol: true, [Op.or]: [{ standart: true }, ...(kerakli.length ? [{ id: kerakli }] : [])] },
    attributes: ['id', 'nomi', 'tur', 'standart'], raw: true,
  });
  const ids = ruyxatlar.map(r => r.id);
  const qatorlar = ids.length && tovarIds.length
    ? await NarxRuyxatQatorModel.findAll({ where: { narx_ruyxat_id: ids, tovar_id: tovarIds }, attributes: ['narx_ruyxat_id', 'tovar_id', 'narx'], raw: true })
    : [];
  const eski = await narxMap(tovarIds);
  const viloyatId = agent && agent.territoriya_id ? Number(agent.territoriya_id) : null;
  const vil = viloyatId ? await viloyatNarxlari(viloyatId, tovarIds) : {};
  const standart = { chakana: null, optom: null };
  ruyxatlar.forEach(r => { if (r.standart && (r.tur === 'chakana' || r.tur === 'optom')) standart[r.tur] = r.id; });
  return {
    katRuyxat,
    javob: {
      standart,
      ruyxatlar: ruyxatlar.map(r => {
        const narxlar = {};
        qatorlar.filter(q => q.narx_ruyxat_id === r.id && n(q.narx) > 0).forEach(q => { narxlar[q.tovar_id] = n(q.narx); });
        return { id: r.id, nomi: r.nomi, tur: r.tur, narxlar };
      }),
      eski: Object.fromEntries(tovarIds.map(id => [id, { chakana: n(eski[id]?.chakana_narx), optom: n(eski[id]?.optom_narx) }])),
      viloyat: vil,
      viloyatId: viloyatId || null,
      viloyatQoida: !!viloyatId,
      // 2026-11-27: mijoz skidkalari { klientId: { tovarId: {tur: 'foiz'|'summa', qiymat, dan, gacha} } } — dillerda yo'q
      skidkalar: agent && agent.diller ? {} : await require('../../utils/skidka.utils').sinxronSkidkalar(mijozlar.map(m => m.id)),
    },
  };
}

/* Distributsiya agenti buyurtmasining bosqichi — ilova agentga "zakazim qayerda" deb ko'rsatadi */
const ARIZA_HOLAT = {
  yangi: 'Ofis tasdiqlashini kutmoqda', tasdiqlangan: 'Tasdiqlandi — omborda navbatda', yigilmoqda: "Omborda yig'ilmoqda",
  yolda: "Yo'lda — dostavchikda", yetkazildi: 'Yetkazildi', bekor: 'Bekor qilindi',
};
const ARIZA_BOSQICH = { yangi: 1, tasdiqlangan: 2, yigilmoqda: 3, yolda: 4, yetkazildi: 5, bekor: 0 };

/* Skladda MAVJUD tovar (jismoniy − boshqa ochiq buyurtmalarga band) — zakaz shundan beriladi.
   Shakli mashinaTovarlari bilan bir xil: ilova ikkalasini bitta jadvalda saqlaydi. */
async function skladTovarlari() {
  const tovarlar = await TovarModel.findAll({ where: { faol: true, turi: 'tovar' }, attributes: ['id', 'nomi', 'turkum', 'blokdagi_soni'], raw: true });
  const ids = tovarlar.map(t => t.id);
  const [mavjud, narx] = await Promise.all([mavjudQoldiq({ tovarIds: ids }), narxMap(ids)]);
  const qatorlar = tovarlar
    .map(t => {
      const m = mavjud.get(t.id) || mavjud.get(String(t.id)) || { mavjud: 0, band: 0, fizik: 0 };
      const q = +n(m.mavjud).toFixed(3), nx = narx[t.id]?.chakana_narx || 0;
      return { tovarId: String(t.id), tovar: t.nomi, turkum: t.turkum || '', blokdagiSoni: Math.max(1, +t.blokdagi_soni || 1),
        qoldiq: q, band: +n(m.band).toFixed(3), narx: nx, summa: +(q * nx).toFixed(2) };
    })
    // Narxi belgilanmagan tovar zakazga tushmaydi (getProductSell bilan bir xil qoida)
    .filter(x => x.qoldiq > EPS && x.narx > 0)
    .sort((a, b) => a.tovar.localeCompare(b.tovar));
  return {
    ombor: ASOSIY_OMBOR, qatorlar,
    jami: { tovarSoni: qatorlar.length, dona: +qatorlar.reduce((s, x) => s + x.qoldiq, 0).toFixed(3), summa: +qatorlar.reduce((s, x) => s + x.summa, 0).toFixed(2) },
  };
}

function buyurtmaShakli(a) {
  const qatorlar = a.qatorlar || [];
  return {
    docId: String(a.id), docNumber: a.raqam || String(a.id), mobilId: a.mobil_id || null,
    klientId: String(a.mijoz_id || ''), klient: a.mijoz_nomi || '',
    vaqt: a.createdAt, jonatishSana: a.jonatish_sana || null,
    holat: a.holat, holatNomi: ARIZA_HOLAT[a.holat] || a.holat, bosqich: ARIZA_BOSQICH[a.holat] ?? 0,
    summa: n(a.jami_summa), dona: qatorlar.reduce((s, q) => s + n(q.jami_dona), 0),
    tolovTuri: a.tolov_turi === 'naqt' || a.tolov_turi === 'naqd' ? 'naqt' : 'qarz', tolovSana: a.tolov_sana || null,
    tolangan: n(a.tolangan_summa), dostavchi: a.dostavchi_nomi || '', yetkazilganVaqt: a.yetkazilgan_sana || null,
    bekorSababi: a.bekor_sababi || '', manba: a.manba || 'web', izoh: a.izoh || '',
    products: qatorlar.map(q => ({ tovarId: String(q.tovar_id || ''), tovar: q.tovar_nomi || '', dona: n(q.jami_dona), narx: n(q.narx), summa: n(q.summa) })),
  };
}

/* Agent bugun (mahalliy kun) qaytarishda mijozga qaytargan naqd — kassa chiqimi (savdoQaytarish) */
async function qaytarishNaqdi(agentId, sana) {
  const [r] = await sequelize.query(`SELECT COALESCE(SUM(summa), 0) s FROM kassa
     WHERE tur = 'chiqim' AND manba_tur = 'savdo_qaytarish' AND user_id = :id AND ${lokalKun('sana')} = :sana`,
  { replacements: { id: agentId, sana, tz: tzOffset() }, type: sequelize.QueryTypes.SELECT });
  return +n(r && r.s).toFixed(2);
}

/* Agentning brak ombori (qaytarilgan yaroqsiz tovar — sotilmaydi) */
async function brakTovarlari(agent) {
  const map = await omborQoldiq(brakOmbori(agent));
  return {
    qatorlar: Object.keys(map).filter(id => map[id].qoldiq > EPS).map(id => ({
      tovarId: String(id), tovar: map[id].tovar_nomi || '', turkum: map[id].turkum || '', qoldiq: +map[id].qoldiq.toFixed(3),
    })).sort((a, b) => a.tovar.localeCompare(b.tovar)),
  };
}

const SAVDO_KUN = 30;
/* Agentning oxirgi 30 kundagi yetkazilgan sotuvlari — bog'langan qaytarish uchun (oflaynda ham).
   Qator miqdori — oldingi qaytarishlardan keyin mijozda QOLGANI; bir tovar bir necha qatorda
   bo'lsa birlashtiriladi (savdoQaytarish ham tovar bo'yicha taqsimlaydi). */
async function agentSavdolari(agent) {
  const dan = new Date(Date.now() - SAVDO_KUN * 24 * 3600 * 1000);
  const rows = await ArizaModel.findAll({
    where: { agent_id: agent.id, turi: agent.diller ? 'diller_sotuv' : 'sotish', holat: 'yetkazildi', yetkazilgan_sana: { [Op.gte]: dan } },
    include: [{ model: ArizaQatorModel, as: 'qatorlar' }],
    order: [['yetkazilgan_sana', 'DESC'], ['id', 'DESC']],
    limit: 2000,
  });
  const ids = rows.map(a => a.id);
  const plastik = new Map(ids.length ? (await sequelize.query(
    `SELECT p.ariza_id, p.holat, p.summa, k.nomi kassa FROM plastik_tolov p LEFT JOIN kassalar k ON k.id = p.kassa_id WHERE p.ariza_id IN (:ids)`,
    { replacements: { ids }, type: sequelize.QueryTypes.SELECT })).map(p => [p.ariza_id, p]) : []);
  return rows.map(a => {
    const pt = plastik.get(a.id);
    const tov = new Map();
    for (const q of (a.qatorlar || []).slice().sort((x, y) => x.id - y.id)) {
      if (!q.tovar_id) continue;
      const x = tov.get(q.tovar_id) || { tovarId: String(q.tovar_id), tovar: q.tovar_nomi || '', dona: 0, narx: n(q.narx), summa: 0 };
      x.dona += n(q.jami_dona); x.summa += n(q.summa);
      tov.set(q.tovar_id, x);
    }
    return {
      docId: String(a.id), docNumber: a.raqam || String(a.id), sana: a.yetkazilgan_sana || a.createdAt,
      klientId: String(a.mijoz_id || ''), klient: a.mijoz_nomi || '',
      jami: n(a.jami_summa), tolangan: n(a.tolangan_summa),
      // To'lov holati: plastik — web tasdig'i bo'yicha; naqd to'langan — tasdiqlangan; to'lovsiz (qarz) — null
      tolovUsuli: a.turi === 'diller_sotuv' ? (a.tolov_turi === 'plastik' ? 'plastik' : a.tolov_turi === 'qarz' ? 'qarz' : 'naqd') : (pt ? 'plastik' : 'naqd'),
      tolovHolat: pt ? pt.holat : (n(a.tolangan_summa) > 0.005 ? 'tasdiqlangan' : null),
      ...(pt ? { plastikKassa: pt.kassa || null, plastikSumma: n(pt.summa) } : {}),
      qatorlar: [...tov.values()]
        .map(x => ({ ...x, dona: +x.dona.toFixed(3), summa: +x.summa.toFixed(2), narx: x.dona > EPS ? +(x.summa / x.dona).toFixed(2) : x.narx }))
        .filter(x => x.dona > EPS),
    };
  });
}

/* Super agentga biriktirilgan agentning qisqa ko'rsatkichlari (agentlarim) */
async function agentQisqa(agent, sana, viloyatlar, pul = null) {
  const [holat, mashina, [qarz]] = await Promise.all([
    holatHisobla(agent, sana),
    mashinaTovarlari(agent),
    sequelize.query(`SELECT COALESCE(SUM(-balans), 0) q FROM mijoz WHERE agent_id = :id AND balans < 0 AND deletedAt IS NULL`,
      { replacements: { id: agent.id }, type: sequelize.QueryTypes.SELECT }),
  ]);
  const b = holat.bugun;
  return {
    agentId: String(agent.id), ism: agent.fullname, telefon: agent.telefon || '',
    viloyat: agent.territoriya_id && viloyatlar.get(agent.territoriya_id) ? { id: agent.territoriya_id, nomi: viloyatlar.get(agent.territoriya_id) } : null,
    faol: !!agent.faol,
    bugun: { sotuvSoni: b.sotuvSoni, sotuvSumma: b.sotuvSumma, naqdSotuv: b.naqdSotuv, qarzgaSotuv: b.qarzgaSotuv, naqdQolda: b.naqdQolda },
    mijozQarzi: +n(qarz && qarz.q).toFixed(2),
    omborDona: mashina.jami.dona, omborSumma: mashina.jami.summa,
    pul: pul ? { qolda: pul.qolda, kutilmoqdaTopshiruv: pul.kutilmoqda_topshiruv, kutilmoqdaPlastik: pul.kutilmoqda_plastik } : null,
  };
}

/* Mobil pul bloki: qo'ldagi naqd (butun davr), kutilayotganlar va oxirgi 30 kun tarixi */
const PUL_TARIX_KUN = 30;
async function pulBloki(agent) {
  const [m, tarix] = await Promise.all([
    majburiyat(agent.id),
    agentPulTarix(agent.id, { dan: new Date(Date.now() - PUL_TARIX_KUN * 24 * 3600 * 1000), limit: 500 }),
  ]);
  return {
    qolda: m.qolda,
    kutilmoqdaTopshiruv: m.kutilmoqda_topshiruv,
    kutilmoqdaPlastik: m.kutilmoqda_plastik,
    // Topshirish mumkin bo'lgan summa (qo'ldagi − tasdiq kutilayotgan topshiruvlar)
    topshirishMumkin: Math.max(0, r2(m.qolda - m.kutilmoqda_topshiruv)),
    tarix: tarix.map(x => ({
      id: x.id, sana: x.sana, tur: x.tur, summa: x.summa,
      ...(x.klient ? { klient: x.klient } : {}),
      ...(x.kassa ? { kassa: x.kassa } : {}),
      holat: x.holat,
      ...(x.sabab ? { sabab: x.sabab } : {}),
      ...(x.izoh ? { izoh: x.izoh } : {}),
      // 2026-11-23: topshiruv — usul ('naqd'|'karta') va kassa nomi (naqd: tasdiqgacha null); chek rasmi bo'lsa yo'li
      ...(x.tur === 'topshiruv' ? { usul: x.usul || 'naqd', kassaNomi: x.kassa || null } : {}),
      ...(x.chek_rasm ? { chekRasm: x.chek_rasm } : {}),
    })),
  };
}

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;
const MAX_QAYTARISH_QATOR = 200;

/* savdoQaytarish so'rovini tekshirish (tranzaksiyadan oldin) */
function qaytarishSorovi(b) {
  const savdoId = Number(b.savdoId);
  if (!Number.isInteger(savdoId) || savdoId <= 0) throw new HttpException(400, "savdoId noto'g'ri");
  const tolov = String(b.tolov || '');
  if (!['qarz', 'naqd'].includes(tolov)) throw new HttpException(400, "tolov faqat 'qarz' yoki 'naqd' bo'lishi mumkin");
  const list = b.qatorlar;
  if (!Array.isArray(list) || !list.length) throw new HttpException(400, 'Kamida bitta qaytariladigan tovar kerak');
  if (list.length > MAX_QAYTARISH_QATOR) throw new HttpException(400, `Bir qaytarishda ${MAX_QAYTARISH_QATOR} tadan ortiq qator bo'lmaydi`);
  const qatorlar = list.map((q, i) => {
    if (!q || typeof q !== 'object') throw new HttpException(400, `${i + 1}-qator noto'g'ri`);
    const tovarId = Number(q.tovarId);
    if (!Number.isInteger(tovarId) || tovarId <= 0) throw new HttpException(400, `${i + 1}-qator: tovarId noto'g'ri`);
    const dona = typeof q.dona === 'number' ? q.dona : Number(String(q.dona ?? '').trim().replace(',', '.'));
    if (!Number.isFinite(dona) || dona <= 0 || dona > 1e9) throw new HttpException(400, `${i + 1}-qator: miqdor noto'g'ri (0 dan katta bo'lishi kerak)`);
    let yaroqli = q.yaroqli;
    if (yaroqli === 'true') yaroqli = true; else if (yaroqli === 'false') yaroqli = false;
    if (typeof yaroqli !== 'boolean') throw new HttpException(400, `${i + 1}-qator: yaroqli true yoki false bo'lishi kerak`);
    const sabab = q.sabab === undefined || q.sabab === null ? null : String(q.sabab).trim().slice(0, 255) || null;
    return { tovarId, dona: r3(dona), yaroqli, sabab };
  });
  const izoh = b.izoh === undefined || b.izoh === null ? null : String(b.izoh).trim().slice(0, 500) || null;
  return { savdoId, tolov, qatorlar, izoh };
}

const qaytarishJavob = (q, takror = false) => ({
  qaytarishId: String(q.id), savdoId: String(q.ariza_id), summa: n(q.summa), yangiJami: n(q.yangi_jami),
  ...(takror ? { takror: true } : {}),
});

class MobileAvtolavkaController {
  // GET avtolavkaHolat/?sana= — "Mening kunim": bosqich, mashina, bugungi ko'rsatkichlar
  avtolavkaHolat = async (req, res) => {
    const agent = avtoAgent(req, res); if (!agent) return;
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugun();
    ok(res, await holatHisobla(agent, sana));
  };

  // GET mashinaQoldiq/ — mashinadagi tovarlar (sotish mumkin bo'lgan qoldiq)
  mashinaQoldiq = async (req, res) => {
    const agent = avtoAgent(req, res); if (!agent) return;
    const m = await mashinaTovarlari(agent);
    ok(res, { qatorlar: m.qatorlar, jami: m.jami });
  };

  // GET yuklashTavsiya/ — oxirgi 14 kun sotuvi asosida ertalabki yuklash taklifi
  yuklashTavsiya = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    ok(res, await tavsiyaShakli(agent));
  };

  // GET yuklashTovarlar/?searchKey=&categoryId= — asosiy ombordagi tovarlar (so'rov formasi)
  yuklashTovarlar = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    const where = { faol: true, turi: 'tovar' };
    const key = String(req.query.searchKey || '').trim();
    const kat = String(req.query.categoryId || '').trim();
    if (key) where[Op.or] = [{ nomi: { [Op.like]: `%${key}%` } }, { shtrix_kod: { [Op.like]: `%${key}%` } }];
    if (kat) where.turkum = kat;
    ok(res, await omborTovarlari(agent, where));
  };

  // POST yuklashSorov/ { androidId, izoh, products:[{ tovarId, kolbo }] }
  // Bugun uchun ochiq so'rov bo'lsa — uning qatorlari almashtiriladi (bitta so'rov tahrirlanadi).
  yuklashSorov = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    const qatorlar = mobilQatorlar(req.body.products);
    if (!qatorlar.length) return fail(res, "Kamida bitta tovar va miqdor kiriting");
    const sana = bugun();

    const kun = await kunHisobla(agent, sana);
    if (kun.bosqich === 3) return fail(res, "Bugungi kun yopilgan — yangi yuklash so'rab bo'lmaydi");
    if (kun.kun_yopish) return fail(res, "Siz kunni yopgansiz. Yana yuklash kerak bo'lsa, avval kunni qayta oching");

    const tayyor = await qatorlarniTayyorla(qatorlar);
    const asosiy = await yuklashQoldigi();   // distributsiya zakazlariga band qilingani ayirilgan
    const yetmaydi = tayyor
      .filter(q => q.dona > (asosiy[q.tovar_id]?.qoldiq || 0) + EPS)
      .map(q => `${q.tovar_nomi}: so'raldi ${q.dona}, omborda ${+(asosiy[q.tovar_id]?.qoldiq || 0).toFixed(3)}`);
    if (yetmaydi.length) return fail(res, `Omborda yetarli emas — ${yetmaydi.join('; ')}`);

    const jamiDona = +tayyor.reduce((s, q) => s + q.dona, 0).toFixed(3);
    const jamiSumma = +tayyor.reduce((s, q) => s + q.summa, 0).toFixed(2);
    const izoh = String(req.body.izoh ?? req.body.komment ?? '').trim() || null;

    const hujjat = await sequelize.transaction(async (t) => {
      // Agent qatori qulflanadi: bir vaqtda kelgan ikki so'rov (oflayn qayta urinish) ikkita
      // qoralama yaratmaydi — ikkinchisi birinchisining qoralamasini topib, qatorlarini almashtiradi.
      await qulflabOl(AgentModel, agent.id, t);
      // Kun qulf ostida qayta tekshiriladi — parallel kunniYopish bilan poyga bo'lmasin
      const kunYozuv = await AvtolavkaKunModel.findOne({ where: { agent_id: agent.id, sana }, transaction: t });
      if (kunYozuv && kunYozuv.yopish_vaqt
          && (!kunYozuv.ochish_vaqt || new Date(kunYozuv.yopish_vaqt) >= new Date(kunYozuv.ochish_vaqt))) {
        return null;
      }
      let h = await AvtolavkaHujjatModel.findOne({
        where: { agent_id: agent.id, sana, tur: 'yuklash', manba: 'mobil', holat: 'qoralama' },
        order: [['id', 'DESC']], transaction: t, lock: t.LOCK.UPDATE,
      });
      if (h) {
        await AvtolavkaQatorModel.destroy({ where: { hujjat_id: h.id }, transaction: t });
        await h.update({ jami_dona: jamiDona, jami_summa: jamiSumma, izoh: izoh ?? h.izoh }, { transaction: t });
      } else {
        h = await AvtolavkaHujjatModel.create({
          raqam: await raqamYarat('yuklash', t), tur: 'yuklash', manba: 'mobil',
          agent_id: agent.id, agent_nomi: agent.fullname, ombor: agentOmbori(agent.fullname),
          sana, holat: 'qoralama', izoh, jami_dona: jamiDona, jami_summa: jamiSumma,
        }, { transaction: t });
      }
      await AvtolavkaQatorModel.bulkCreate(tayyor.map(q => ({ ...q, hujjat_id: h.id })), { transaction: t });
      return h;
    });
    if (!hujjat) return fail(res, "Siz kunni yopgansiz. Yana yuklash kerak bo'lsa, avval kunni qayta oching");

    ok(res, {
      androidId: req.body.androidId ?? 0,
      docId: String(hujjat.id),
      docNumber: hujjat.raqam,
      holat: 'kutilmoqda',
      dona: jamiDona,
      summa: jamiSumma,
    }, "So'rov omborga yuborildi");
  };

  // GET yuklashlar/?sana= — agentning shu kungi yuklash hujjatlari (so'rov, yuklangan, qabul qilingan)
  yuklashlar = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugun();
    ok(res, await bugungiYuklashlar(agent, sana));
  };

  // POST yuklashQabul/ { docId, izoh } — agent yuklangan tovarni sanab qabul qildi
  yuklashQabul = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    const h = await AvtolavkaHujjatModel.findOne({
      where: { id: req.body.docId, agent_id: agent.id, tur: 'yuklash' }, include: INCLUDE,
    });
    if (!h) return fail(res, 'Yuklash hujjati topilmadi', 404);
    if (h.holat !== 'tasdiqlangan') return fail(res, 'Hujjat hali omborchi tomonidan tasdiqlanmagan');
    if (!h.agent_qabul_vaqt) {
      const izoh = String(req.body.izoh || '').trim();
      await h.update({
        agent_qabul_vaqt: new Date(),
        izoh: izoh ? `${h.izoh ? h.izoh + ' | ' : ''}Agent: ${izoh}`.slice(0, 2000) : h.izoh,
      });
    }
    ok(res, hujjatShakli(h), 'Yuklash qabul qilindi');
  };

  // POST yuklashBekor/ { docId } — agent o'z so'rovini qaytarib oladi (faqat tasdiqlanmagan)
  yuklashBekor = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    // Qulf + qayta tekshiruv: omborchi shu paytda tasdiqlayotgan bo'lsa (tovar mashinaga o'tgan)
    // hujjat "bekor" bo'lib qolmasin — ikkinchisi tasdiqlash commit bo'lishini kutadi.
    const natija = await sequelize.transaction(async (t) => {
      const h = await AvtolavkaHujjatModel.findOne({
        where: { id: req.body.docId, agent_id: agent.id, tur: 'yuklash', manba: 'mobil' },
        transaction: t, lock: t.LOCK.UPDATE,
      });
      if (!h) return { xato: "So'rov topilmadi", kod: 404 };
      if (h.holat !== 'qoralama') return { xato: "Tasdiqlangan yuklashni bekor qilib bo'lmaydi" };
      await h.update({ holat: 'bekor', rad_sababi: AGENT_BEKOR }, { transaction: t });
      return { id: h.id };
    });
    if (natija.xato) return fail(res, natija.xato, natija.kod);
    const h = await AvtolavkaHujjatModel.findByPk(natija.id, { include: INCLUDE });
    ok(res, hujjatShakli(h), "So'rov bekor qilindi");
  };

  // GET kunYakuni/?sana= — omborga nima topshirishi kerak: tovar ro'yxati va naqd
  kunYakuni = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugun();
    const [kun, mashina] = await Promise.all([kunHisobla(agent, sana, { tafsilot: true }), mashinaTovarlari(agent)]);
    const T = kun.tovar, P = kun.pul;
    ok(res, {
      sana,
      holat: kun.holat,
      holatNomi: HOLAT_NOMI[kun.holat] || kun.holat,
      tovar: {
        kunBoshi: T.kun_boshi.dona,
        berildi: T.berildi.dona,
        sotildi: T.sotildi.dona,
        qaytdi: T.qaytarildi.dona,
        qolishiKerak: T.qolishi_kerak.dona,
        mashinadaHozir: mashina.jami.dona,
      },
      // Bugun uchun — hozir mashinada turgan, omborga qaytariladigan tovar
      topshiriladiganTovarlar: sana === bugun() ? mashina.qatorlar : kun.tovarlar
        .filter(t => t.farq > EPS)
        .map(t => ({ tovarId: String(t.tovar_id), tovar: t.tovar_nomi, turkum: t.turkum || '', qoldiq: t.farq })),
      pul: {
        sotuvJami: P.sotuv_jami,
        naqdSotuv: P.naqd_sotuv,
        qarzgaSotuv: P.qarzga_sotuv,
        naqdOlindi: P.naqd_olindi,             // naqd sotuv + mijozlardan qarz undirish
        topshirildi: P.topshirildi,
        topshirishKerak: Math.max(0, +(P.naqd_olindi - P.topshirildi).toFixed(2)),
      },
      mijozlar: (kun.mijozlar || []).map(m => ({
        klientId: String(m.mijoz_id || ''), klient: m.mijoz_nomi || '', sotuv: m.sotuv, naqd: m.naqd,
      })),
      kunYopish: kun.kun_yopish ? { vaqt: kun.kun_yopish.vaqt, naqdElon: kun.kun_yopish.naqd_elon } : null,
    });
  };

  // POST kunniYopish/ { naqdSumma, izoh }       — savdo tugadi, topshirishga tayyorman
  // POST kunniYopish/ { bekor: true }           — xato bosilgan bo'lsa qayta ochish
  kunniYopish = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    // Oflayn ilova kunni yopgan sanani yuboradi (keyin internet bo'lganda keladi) — 3 kundan eski bo'lmasin
    const kecha3 = kunKey(new Date(Date.now() - 3 * 24 * 3600 * 1000));   // mahalliy sana (bugun() bilan bir xil)
    const sana = sanaMi(req.body.sana) && req.body.sana >= kecha3 && req.body.sana <= bugun() ? req.body.sana : bugun();
    // Qayta ochish: xato bosilgan yopish yoki to'liq yopilgan kunda yangi reys (kunniQaytaOch)
    if (req.body.bekor === true || req.body.bekor === 'true') {
      const r = await kunniQaytaOch(agent, sana);
      return ok(res, { sana, ochildi: true, yangiReys: r.yangiReys },
        r.yangiReys ? "Kun qayta ochildi — yangi reys: yuklash so'rang" : 'Kun qayta ochildi');
    }

    const naqdRaw = req.body.naqdSumma ?? req.body.naqd;
    // Chekli, 0..1e12 — Infinity/NaN/manfiy 400
    const naqdElon = summaOl(naqdRaw, { bosh: null, xabar: "Naqd summa noto'g'ri" });
    const izoh = String(req.body.izoh ?? req.body.komment ?? '').trim() || null;

    // Agent qatori qulflanib, kun holati shu tranzaksiya ichida qayta hisoblanadi —
    // parallel qabul/qayta ochish/yuklash so'rovi bilan poyga bo'lmasin
    const natija = await sequelize.transaction(async (t) => {
      await qulflabOl(AgentModel, agent.id, t);
      const kun = await kunHisobla(agent, sana, { transaction: t });
      if (kun.bosqich === 3) return { xato: 'Bugungi kun allaqachon yopilgan' };
      if (kun.tovar.berildi.dona <= EPS && kun.tovar.sotildi.dona <= EPS && kun.tovar.kun_boshi.dona <= EPS) {
        return { xato: "Bugun yuklash ham, savdo ham bo'lmagan — yopadigan narsa yo'q" };
      }
      const [yozuv] = await AvtolavkaKunModel.findOrCreate({
        where: { agent_id: agent.id, sana }, defaults: { agent_id: agent.id, sana }, transaction: t,
      });
      await yozuv.update({ yopish_vaqt: new Date(), naqd_elon: naqdElon, izoh }, { transaction: t });
      // Tasdiqlanmagan yuklash so'rovlari endi kerak emas
      await AvtolavkaHujjatModel.update({ holat: 'bekor', rad_sababi: KUN_YOPILDI }, {
        where: { agent_id: agent.id, sana, tur: 'yuklash', manba: 'mobil', holat: 'qoralama' }, transaction: t,
      });
      return { kun };
    });
    if (natija.xato) return fail(res, natija.xato);
    const { kun } = natija;

    const kutilgan = Math.max(0, +(kun.pul.naqd_olindi - kun.pul.topshirildi).toFixed(2));
    ok(res, {
      sana,
      kutilganNaqd: kutilgan,
      elonNaqd: naqdElon,
      // Agent sanagan naqd tizimdagidan farq qilsa — omborga kelmasdan oldin ko'radi
      farq: naqdElon === null ? null : +(naqdElon - kutilgan).toFixed(2),
      topshiriladiganDona: kun.tovar.kun_oxiri.dona,
    }, 'Kun yopildi — omborga tovar va naqdni topshiring');
  };

  // GET mijozNarxlari/?klientId= — shu mijozga tovar narxlari (toifa narx ro'yxati → standart → eski narx)
  mijozNarxlari = async (req, res) => {
    const klientId = Number(req.query.klientId);
    if (!klientId) return fail(res, 'klientId kerak');
    const tovarlar = await TovarModel.findAll({ attributes: ['id'], where: { faol: true, turi: 'tovar' }, raw: true });
    // 2026-11-25: agent viloyati bo'lsa toifa ro'yxati → viloyat narxi → 'yoq' (sotilmaydi)
    const r = req.currentRole === 'agent'
      ? await agentNarxXaritasi({ agent: req.currentAgent, mijozId: klientId, tovarIds: tovarlar.map(t => t.id) })
      : await narxXaritasi({ mijozId: klientId, tovarIds: tovarlar.map(t => t.id) });
    ok(res, {
      ruyxat: r.ruyxat,
      narxlar: r.narxlar.map(x => ({ tovarId: String(x.tovar_id), narx: x.narx, manba: x.manba, ...(x.skidka ? { aslNarx: x.asl_narx, skidka: x.skidka } : {}) })),
    });
  };

  // GET avtolavkaSinxron/ — oflayn ishlash uchun hamma narsa bitta so'rovda:
  // kun holati, mashina qoldig'i, agent mijozlari (qarz, limit, narx ro'yxati),
  // bugungi reja va tashriflar, narx ro'yxatlari, sotmaslik sabablari.
  avtolavkaSinxron = async (req, res) => {
    const agent = avtoAgent(req, res); if (!agent) return;
    const sana = bugun();
    const mashina = await mashinaTovarlari(agent);
    const [holat, mijozlar, rejalar, tashriflar, ombor, tavsiya, yuklashlar, brak, savdolar, viloyat, kassalar, pul, kochirishlar] = await Promise.all([
      holatHisobla(agent, sana, mashina),
      // 2026-11-21: faqat agentga biriktirilgan mijozlar (o'zi yaratganlari ham — saveKlient agent_id yozadi)
      MijozModel.findAll({ where: { faol: true, agent_id: agent.id }, order: [['nomi', 'ASC']], raw: true }),
      MarshrutRejaModel.findAll({ where: { agent_id: agent.id, sana }, order: [['tartib', 'ASC'], ['id', 'ASC']], raw: true }),
      TashrifModel.findAll({ where: { agent_id: agent.id, sana }, order: [['id', 'ASC']], raw: true }),
      omborTovarlari(agent),
      agent.diller ? null : tavsiyaShakli(agent).catch(() => null),
      agent.diller ? [] : bugungiYuklashlar(agent, sana),
      brakTovarlari(agent),
      agentSavdolari(agent),
      agent.territoriya_id ? TerritoriyaModel.findByPk(agent.territoriya_id, { attributes: ['id', 'nomi'], raw: true }) : null,
      agent.diller ? [] : agentPlastikKassalar(agent),
      agent.diller ? null : pulBloki(agent),
      agent.diller ? [] : agentKochirishlari(agent.id),   // 2026-11-26: agentdan agentga ko'chirishlar (30 kun, ikki yo'nalish)
    ]);
    const dillerBlok = agent.diller ? await Diller.mobilBlok(agent) : null;   // 2026-11-29

    const tovarIds = mashina.qatorlar.map(q => Number(q.tovarId));
    const [narx, buyumlar] = await Promise.all([
      narxSinxron(mijozlar, tovarIds, agent),
      mobilBuyumlar(agent, mijozlar.map(m => m.id)),   // 2026-11-28: buyumlar (sinxrondagi mijozlar to'plami)
    ]);
    const ruyxatIds = new Set(narx.javob.ruyxatlar.map(r => r.id));
    const agentNomi = new Map((await AgentModel.findAll({ attributes: ['id', 'fullname'], raw: true, paranoid: false })).map(a => [a.id, a.fullname]));

    ok(res, {
      serverVaqt: new Date(),
      sana,
      agent: {
        id: agent.id, ism: agent.fullname, ombor: mashina.ombor, brakOmbor: brakOmbori(agent), diller: !!agent.diller,
        viloyat: viloyat ? { id: viloyat.id, nomi: viloyat.nomi } : null,
      },
      // Super agent biriktirilgan agentni ko'ryapti (x-kuzat-agent) — ilova faqat o'qish rejimida
      kuzatuv: !!req.kuzatuv,
      holat,
      mashina: { qatorlar: mashina.qatorlar, jami: mashina.jami },
      brak,
      savdolar,
      // Agentdan agentga ko'chirishlar: yonalish 'kirim' (boshqa agentdan keldi) | 'chiqim' (boshqa agentga ketdi).
      // ombor/mashina qoldig'i bularni allaqachon hisobga olgan.
      kochirishlar,
      // 2026-11-28: sotilmaydigan buyumlar — katalog, qo'lda, mijozlarda, tarix (FRONTEND-UCHUN §23)
      buyumlar,
      // 2026-11-22: plastik to'lov uchun kassalar (agent viloyatidagi faol plastik kassalar) va agent puli
      kassalar: kassalar.map(k => ({ id: k.id, nomi: k.nomi })),
      pul,
      // 2026-11-29: diller — kompaniyaga qarzi, hujjatlar tarixi (90 kun), o'z narx ro'yxati; agentda null
      diller: dillerBlok,
      mijozlar: mijozlar.map(m => {
        const balans = n(m.balans);
        const rid = m.kategoriya_id ? narx.katRuyxat[m.kategoriya_id] : null;
        return {
          klientId: String(m.id), nomi: m.nomi || '', yuridikNomi: m.yuridik_nomi || '',
          tel: m.telefon || '', tel2: m.telefon2 || '', manzil: m.manzil || '', moljal: m.mo_ljal || '',
          lat: m.lat != null ? n(m.lat) : null, lng: m.lng != null ? n(m.lng) : null,
          qarz: balans < 0 ? -balans : 0, balans,
          kreditLimit: n(m.kredit_limit),
          narxTuri: m.narx_turi || 'chakana',
          ruyxatId: rid && ruyxatIds.has(rid) ? rid : null,
          tashrifKunlari: m.tashrif_kunlari || '',
          // Mas'ul agent — boshqa agentning mijozi bo'lsa kartada ko'rsatiladi
          agentId: m.agent_id ? String(m.agent_id) : null, agentNomi: m.agent_id ? (agentNomi.get(m.agent_id) || '') : '', meniki: m.agent_id === agent.id,
          // Qarzga sotuvda to'lov sanasi kalendarining standart taklifi (sotuv + shuncha kun)
          tolovMuddatiKun: parseInt(m.tolov_muddati_kun, 10) || 30,
          ...reytingKorinish(m),   // mijoz reytingi: reyting, daraja, darajaNomi, radKetmaKet, tolovVada
        };
      }),
      reja: rejalar.map(r => ({ klientId: String(r.mijoz_id), tartib: r.tartib, izoh: r.izoh || '' })),
      tashriflar: tashriflar.map(t => ({
        tashrifId: t.id, klientId: String(t.mijoz_id), checkinVaqt: t.checkin_vaqt, checkoutVaqt: t.checkout_vaqt,
        natija: t.natija || null, arizaId: t.ariza_id ? String(t.ariza_id) : null,
      })),
      // Diller: narx erkin — viloyat qoidasi yo'q
      narx: agent.diller ? { ...narx.javob, viloyat: {}, viloyatQoida: false, skidkalar: {} } : narx.javob,
      // Oflayn yuklash so'rovi va Mashina ekrani uchun
      ombor, tavsiya: agent.diller ? null : tavsiya, yuklashlar,
      sabablar: SABABLAR.filter(x => x.tip === 'Причина').map(x => ({ id: x.id, name: x.name, neytral: !!x.neytral })),
      reytingQoida: await reytingQoidalari(),
    });
  };

  // GET agentlarim/ — super agentga biriktirilgan agentlar va ularning bugungi ko'rsatkichlari
  agentlarim = async (req, res) => {
    const sup = req.kuzatuv ? req.superAgent : req.currentAgent;
    if (req.currentRole !== 'agent' || !sup || !sup.super_agent) throw new HttpException(403, 'Bu oyna faqat super agent uchun');
    const agentlar = await AgentModel.findAll({ where: { super_agent_id: sup.id, faol: true, diller: false }, order: [['fullname', 'ASC']] });
    const tIds = [...new Set(agentlar.map(a => a.territoriya_id).filter(Boolean))];
    const viloyatlar = new Map(tIds.length
      ? (await TerritoriyaModel.findAll({ where: { id: tIds }, attributes: ['id', 'nomi'], raw: true })).map(t => [t.id, t.nomi]) : []);
    const sana = bugun();
    const natija = [];
    const pullar = await majburiyatlar(agentlar.map(a => a.id));
    for (const a of agentlar) natija.push(await agentQisqa(a, sana, viloyatlar, pullar.get(a.id)));   // ketma-ket: pool to'lmasin
    ok(res, natija);
  };

  // POST savdoQaytarish/ { savdoId, mobilId, vaqt, tolov:'qarz'|'naqd', izoh, qatorlar:[{ tovarId, dona, yaroqli, sabab }] }
  // Agentning O'Z yetkazilgan sotuviga bog'langan qaytarish. Sotuv summasi kamayadi (KPI shundan),
  // yaroqli tovar agent omboriga, yaroqsizi agentning brak omboriga kiradi.
  //   tolov='qarz' — mijoz qarzi kamayadi (balans += summa); tolangan_summa yangi jamidan oshmaydi
  //   tolov='naqd' — agent mijozga naqd qaytardi: tolangan_summa −= summa (≤ sotuvda to'langan naqd),
  //                  kassa chiqimi agent nomidan (qo'lidagi naqd kamayadi), balans o'zgarmaydi
  savdoQaytarish = async (req, res) => {
    const agent = avtoAgent(req, res); if (!agent) return;
    const sorov = qaytarishSorovi(req.body || {});
    const mobilId = mobilKalit(req.body.mobilId);
    const vaqt = mobilVaqt(req.body.vaqt);

    const borini = async (t) => (mobilId ? SavdoQaytarishModel.findOne({ where: { mobil_id: mobilId }, ...(t ? { transaction: t } : {}) }) : null);
    const takrorTekshir = (q) => {
      if (Number(q.agent_id) !== Number(agent.id) || Number(q.ariza_id) !== sorov.savdoId) {
        throw new HttpException(409, 'Bu mobilId boshqa amalga tegishli');
      }
      return ok(res, qaytarishJavob(q, true), 'Qaytarish allaqachon saqlangan');
    };
    const oldin = await borini();
    if (oldin) return takrorTekshir(oldin);

    let natija;
    try {
      natija = await sequelize.transaction(async (t) => {
        // QULF TARTIBI (mavjud hujjat): ariza → qatorlar → tovar → mijoz
        const ariza = await qulflabOl(ArizaModel, sorov.savdoId, t);
        if (!ariza) throw new HttpException(404, 'Sotuv topilmadi');
        if (Number(ariza.agent_id) !== Number(agent.id)) throw new HttpException(403, 'Bu sotuv sizga tegishli emas');
        if (ariza.turi !== (agent.diller ? 'diller_sotuv' : 'sotish') || ariza.holat !== 'yetkazildi') {
          throw new HttpException(400, `Faqat yetkazilgan sotuvga qaytarish qilinadi (hujjat: ${ariza.turi}, ${ariza.holat})`);
        }
        // Parallel takror ariza qulfidan keyin ko'rinadi
        const takror = await borini(t);
        if (takror) return { takror };

        const qatorlar = await ArizaQatorModel.findAll({ where: { ariza_id: ariza.id }, order: [['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE });
        await tovarlarniQulfla(sorov.qatorlar.map(q => q.tovarId), t);
        const mijoz = ariza.mijoz_id ? await qulflabOl(MijozModel, ariza.mijoz_id, t) : null;

        // Joriy (oldingi qaytarishlardan keyin qolgan) qiymatlar — xotirada kamaytirib boriladi
        const holat = new Map(qatorlar.map(q => [q.id, { q, jami_dona: n(q.jami_dona), dona: n(q.dona), summa: n(q.summa) }]));
        const bolaklar = [];   // { qator, dona, summa, narx, yaroqli, sabab, tovar_id, tovar_nomi, turkum }
        for (const p of sorov.qatorlar) {
          const mos = qatorlar.filter(q => Number(q.tovar_id) === p.tovarId);
          if (!mos.length) throw new HttpException(400, `Tovar #${p.tovarId} bu sotuvda yo'q`);
          const qoldi = r3(mos.reduce((s2, q) => s2 + holat.get(q.id).jami_dona, 0));
          if (p.dona > qoldi + 0.0005) {
            throw new HttpException(400, `"${mos[0].tovar_nomi || `#${p.tovarId}`}" — qaytarish miqdori sotuvda qolganidan ko'p. Mumkin: ${Math.max(0, qoldi)}, so'raldi: ${p.dona}`);
          }
          let kerak = p.dona;
          for (const q of mos) {
            if (kerak <= 0.0005) break;
            const h = holat.get(q.id);
            if (h.jami_dona <= 0.0005) continue;
            const dona = r3(Math.min(kerak, h.jami_dona));
            const narx = n(q.narx);
            // Qatorning oxirgi donasi qaytsa — qolgan summa (yaxlitlash farqi qolmasin)
            const summa = dona >= h.jami_dona - 0.0005 ? r2(h.summa) : r2(Math.min(h.summa, narx * dona));
            h.jami_dona = r3(h.jami_dona - dona);
            h.dona = Math.max(0, r3(h.dona - dona));
            h.summa = Math.max(0, r2(h.summa - summa));
            bolaklar.push({ qator: q, dona, summa, narx, yaroqli: p.yaroqli, sabab: p.sabab });
            kerak = r3(kerak - dona);
          }
        }

        const qaytSumma = r2(bolaklar.reduce((s2, b) => s2 + b.summa, 0));
        const eskiJami = n(ariza.jami_summa);
        const yangiJami = Math.max(0, r2(eskiJami - qaytSumma));
        const kamaydi = r2(eskiJami - yangiJami);   // chegirma bo'lsa jami 0 dan pastga tushmaydi
        const tolangan = n(ariza.tolangan_summa);

        const arizaYangi = { jami_summa: yangiJami };
        if (sorov.tolov === 'naqd') {
          if (kamaydi > tolangan + 0.005) {
            throw new HttpException(400, `Naqd qaytarish (${kamaydi}) shu sotuvda olingan naqddan (${tolangan}) ko'p — "qarzdan ayirish" ni tanlang`);
          }
          arizaYangi.tolangan_summa = Math.max(0, r2(tolangan - kamaydi));
          // Naqd to'liq qaytdi, lekin summa qoldi — hujjat endi qarzga sotuv (hisobotlar naqd deb sanamasin)
          const naqdTur = ariza.tolov_turi === 'naqt' || ariza.tolov_turi === 'naqd';
          if (naqdTur && arizaYangi.tolangan_summa <= 0.005 && yangiJami > 0.005) arizaYangi.tolov_turi = 'qarz';
        } else if (tolangan > yangiJami) {
          arizaYangi.tolangan_summa = yangiJami;
        }

        const qaytarish = await SavdoQaytarishModel.create({
          mobil_id: mobilId, ariza_id: ariza.id, ariza_raqam: ariza.raqam, agent_id: agent.id, agent_nomi: agent.fullname,
          mijoz_id: ariza.mijoz_id, mijoz_nomi: ariza.mijoz_nomi, tolov: sorov.tolov, summa: kamaydi,
          yaroqli_summa: r2(bolaklar.filter(b => b.yaroqli).reduce((s2, b) => s2 + b.summa, 0)),
          yaroqsiz_summa: r2(bolaklar.filter(b => !b.yaroqli).reduce((s2, b) => s2 + b.summa, 0)),
          eski_jami: eskiJami, yangi_jami: yangiJami, izoh: sorov.izoh, sana: vaqt,
        }, { transaction: t });

        const ombor = sotuvOmbori(agent), brakOmbor = brakOmbori(agent);
        await SavdoQaytarishQatorModel.bulkCreate(bolaklar.map(b => ({
          qaytarish_id: qaytarish.id, ariza_qator_id: b.qator.id, tovar_id: b.qator.tovar_id, tovar_nomi: b.qator.tovar_nomi,
          dona: b.dona, narx: b.narx, summa: b.summa, yaroqli: b.yaroqli, ombor: b.yaroqli ? ombor : brakOmbor, sabab: b.sabab,
        })), { transaction: t });
        await TovarRegisterModel.bulkCreate(bolaklar.map(b => ({
          tovar_id: b.qator.tovar_id, tovar_nomi: b.qator.tovar_nomi || '', turkum: b.qator.turkum || null,
          ombor: b.yaroqli ? ombor : brakOmbor, tur: 'qaytarma_kirim',
          // manba — asl sotuv (hisobotlar 'qaytarma' ni ariza bilan bog'laydi); tafsilot savdo_qaytarish jadvalida
          manba_tur: agent.diller ? 'diller_qaytarma' : 'qaytarma', manba_id: ariza.id,
          donada: b.dona, bloklarda: 0, qutilarda: 0, hajm: 0, kirim_narx: 0, sotuv_narx: b.narx, summa: b.summa, sana: vaqt,
        })), { transaction: t });

        for (const h of holat.values()) {
          if (Math.abs(h.jami_dona - n(h.q.jami_dona)) > 0.0001 || Math.abs(h.summa - n(h.q.summa)) > 0.001) {
            await h.q.update({ jami_dona: h.jami_dona, dona: h.dona, summa: h.summa }, { transaction: t });
          }
        }
        await ariza.update(arizaYangi, { transaction: t });

        if (kamaydi > 0) {
          if (sorov.tolov === 'qarz' && mijoz) {
            await MijozModel.increment('balans', { by: kamaydi, where: { id: mijoz.id }, transaction: t });
          }
          if (sorov.tolov === 'naqd' && agent.diller) {
            // 2026-11-29: diller mijozga o'z pulidan qaytardi — kompaniya kassasi/jurnaliga yozilmaydi
            const { DillerPulModel } = require('../../models/diller.model');
            await DillerPulModel.create({
              diller_id: agent.id, tur: 'chiqim', kategoriya: 'qaytarish', usul: 'naqd', summa: kamaydi,
              mijoz_id: ariza.mijoz_id, mijoz_nomi: ariza.mijoz_nomi, ariza_id: ariza.id, qaytarish_id: qaytarish.id,
              izoh: `${ariza.raqam || ariza.id} — qaytarish, naqd mijozga qaytarildi`.slice(0, 255), sana: vaqt,
            }, { transaction: t });
          } else if (sorov.tolov === 'naqd') {
            const kassa = await KassaModel.create({
              tur: 'chiqim', kategoriya: 'sotuv_qaytarish', summa: kamaydi, tolov_usul: 'naqt',
              manba_tur: 'savdo_qaytarish', manba_id: qaytarish.id, mijoz_id: ariza.mijoz_id, mijoz_nomi: ariza.mijoz_nomi,
              izoh: `${ariza.raqam || ariza.id} — qaytarish, naqd mijozga qaytarildi`.slice(0, 255),
              sana: vaqt, user_id: agent.id, agent_id: agent.id,   // agent qo'lidagi naqd kamayadi (majburiyat)
            }, { transaction: t });
            await qaytarish.update({ kassa_id: kassa.id }, { transaction: t });
          }
          // Agent plan-fakti va bonusi haqiqiy (kamaygan) savdodan
          const regs = await AgentRegisterModel.findAll({ where: { ariza_id: ariza.id, tur: 'savdo' }, transaction: t, lock: t.LOCK.UPDATE });
          for (const r of regs) {
            const yangiSumma = Math.max(0, r2(n(r.summa) - kamaydi));
            await r.update({ summa: yangiSumma, bonus_summa: Math.round(yangiSumma * n(r.bonus_foiz) / 100) }, { transaction: t });
          }
        }
        return { qaytarish };
      });
    } catch (e) {
      if (takrorXato(e)) {
        const b = await borini();
        if (b) return takrorTekshir(b);
      }
      throw e;
    }
    if (natija.takror) return takrorTekshir(natija.takror);
    ok(res, qaytarishJavob(natija.qaytarish), 'Qaytarish saqlandi');
  };

  // POST pulTopshirish/ { mobilId, summa, izoh, vaqt, usul?, kassaId?, chekRasm? } — agent qo'lidagi naqdni topshiradi.
  // usul 'naqd' (standart): kassirga naqd — web'da naqd kassa tanlanib tasdiqlanadi.
  // usul 'karta' (2026-11-23): agent kartadan kompaniya plastik kassasiga o'tkazdi — kassaId (agent viloyatidagi
  //   faol plastik kassa, avtolavkaSinxron.kassalar) va chekRasm (chekYuklash/ yo'li) majburiy; web kassa tanlamaydi.
  // Ikkalasi ham 'kutilmoqda' → tasdiqda majburiyat kamayadi, rad — yozuv qoladi.
  // summa ≤ qo'ldagi naqd − tasdiq kutilayotgan topshiruvlar, aks holda 400. mobilId — takror himoyasi.
  pulTopshirish = async (req, res) => {
    const agent = dillerEmas(req, res); if (!agent) return;
    const b = req.body || {};
    const summa = summaOl(b.summa, { xabar: "Summa noto'g'ri" });
    if (!(summa > 0)) throw new HttpException(400, "Summa 0 dan katta bo'lishi kerak");
    const izoh = b.izoh === undefined || b.izoh === null ? null : String(b.izoh).trim().slice(0, 500) || null;
    const usul = b.usul === undefined || b.usul === null || b.usul === '' ? 'naqd' : String(b.usul);
    if (!['naqd', 'karta'].includes(usul)) throw new HttpException(400, "usul faqat 'naqd' yoki 'karta' bo'lishi mumkin");
    const mobilId = mobilKalit(b.mobilId);
    const vaqt = mobilVaqt(b.vaqt);
    const { PulTopshiruvModel } = require('../../models/kassalar.model');
    const javob = (x, takror = false) => ({
      topshiruvId: String(x.id), holat: x.holat, summa: n(x.summa), usul: x.usul || 'naqd',
      kassaId: x.kassa_id ? String(x.kassa_id) : null, chekRasm: x.chek_rasm || null, ...(takror ? { takror: true } : {}),
    });
    const takrorTekshir = (x) => {
      if (Number(x.agent_id) !== Number(agent.id)) throw new HttpException(409, 'Bu mobilId boshqa amalga tegishli');
      return ok(res, javob(x, true), 'Topshiruv allaqachon yuborilgan');
    };
    if (mobilId) {
      const bor = await PulTopshiruvModel.findOne({ where: { mobil_id: mobilId } });
      if (bor) return takrorTekshir(bor);
    }
    let kassa = null, chekRasm = null;
    if (usul === 'karta') {
      if (b.kassaId === undefined || b.kassaId === null || b.kassaId === '') throw new HttpException(400, 'Karta topshiruvi uchun kassaId majburiy (plastik kassa)');
      kassa = await kassaTekshir(b.kassaId, { tur: 'plastik', agent });
      chekRasm = chekRasmOl(b.chekRasm, { majburiy: true, xabar: "Karta topshiruvi uchun chek rasmi majburiy (chekRasm)" });
    }
    let r;
    try {
      r = await topshiruvYarat(agent, { summa, izoh, mobilId, vaqt, usul, kassa, chekRasm });
    } catch (e) {
      if (takrorXato(e) && mobilId) {
        const bor = await PulTopshiruvModel.findOne({ where: { mobil_id: mobilId } });
        if (bor) return takrorTekshir(bor);
      }
      throw e;
    }
    if (r.takror) return takrorTekshir(r.takror);
    ok(res, javob(r.row), 'Topshiruv yuborildi — kassir tasdiqlashi kutilmoqda');
  };

  // POST dillerNarxlari/ { narxlar: { "<tovarId>": number|null } } — dillerning o'z narx ro'yxati (upsert, null — o'chirish)
  dillerNarxlari = async (req, res) => {
    if (req.currentRole !== 'agent' || !req.currentAgent || !req.currentAgent.diller) throw new HttpException(403, 'Bu amal faqat diller uchun');
    ok(res, await Diller.narxlarSaqla(req.currentAgent, req.body || {}), 'Narxlar saqlandi');
  };

  // GET agentSinxron/ — DISTRIBUTSIYA (pre-sale) agenti uchun oflayn nusxa, bitta so'rovda:
  // skladda mavjud tovar, mijozlar (qarz, limit, narx ro'yxati), bugungi reja va tashriflar,
  // narx ro'yxatlari, sabablar, oxirgi 14 kunlik buyurtmalar (bosqichi bilan) va bugungi ko'rsatkichlar.
  // Agent zakaz oladi — tovarni dostavchik yetkazadi, naqdni ham u oladi; agent faqat eski qarzni undiradi.
  agentSinxron = async (req, res) => {
    if (req.currentRole !== 'agent') return fail(res, 'Bu amal faqat agent uchun', 403);
    const agent = req.currentAgent;
    if (agent.avtolavka) return fail(res, "Siz Won Sell rejimidasiz — avtolavkaSinxron/ ishlatiladi", 403);
    const sana = bugun();
    const kunBoshi = new Date(`${sana}T00:00:00`);
    const oldin = new Date(kunBoshi); oldin.setDate(oldin.getDate() - 14);
    const [sklad, mijozRows, rejalar, tashriflar, arizalar, [[pul]], inkas] = await Promise.all([
      skladTovarlari(),
      // Barcha faol mijozlar — ilovada "Barchasi" tabida boshqa agentlarning mijozlari ham mas'ul agent nomi bilan ko'rinadi
      MijozModel.findAll({ where: { faol: true }, order: [['nomi', 'ASC']], raw: true }),
      MarshrutRejaModel.findAll({ where: { agent_id: agent.id, sana }, order: [['tartib', 'ASC'], ['id', 'ASC']], raw: true }),
      TashrifModel.findAll({ where: { agent_id: agent.id, sana }, order: [['id', 'ASC']], raw: true }),
      ArizaModel.findAll({
        where: { agent_id: agent.id, turi: 'sotish', createdAt: { [Op.gte]: oldin } },
        include: [{ model: ArizaQatorModel, as: 'qatorlar' }], order: [['createdAt', 'DESC']],
      }),
      sequelize.query(`SELECT COALESCE(SUM(summa), 0) undirildi, COUNT(*) soni FROM kassa
        WHERE tur = 'kirim' AND manba_tur = 'mijoz' AND user_id = :id AND ${lokalKun('sana')} = :sana`, { replacements: { id: agent.id, sana, tz: tzOffset() } }),
      InkassatsiyaModel.findOne({ where: { agent_id: agent.id, sana }, raw: true }),
    ]);
    const bor = new Set(mijozRows.map(m => m.id));
    const qoshimcha = rejalar.map(r => r.mijoz_id).filter(id => id && !bor.has(id));
    const mijozlar = qoshimcha.length ? mijozRows.concat(await MijozModel.findAll({ where: { id: qoshimcha }, raw: true })) : mijozRows;
    const [narx, buyumlar] = await Promise.all([
      narxSinxron(mijozlar, sklad.qatorlar.map(q => Number(q.tovarId)), agent),
      mobilBuyumlar(agent, mijozlar.map(m => m.id)),   // 2026-11-28: buyumlar
    ]);
    const ruyxatIds = new Set(narx.javob.ruyxatlar.map(r => r.id));
    const agentNomi = new Map((await AgentModel.findAll({ attributes: ['id', 'fullname'], raw: true, paranoid: false })).map(a => [a.id, a.fullname]));

    const buyurtmalar = arizalar.map(buyurtmaShakli);
    const bugungi = arizalar.filter(a => new Date(a.createdAt) >= kunBoshi && a.holat !== 'bekor');
    const naqdMi = a => a.tolov_turi === 'naqt' || a.tolov_turi === 'naqd';
    const sanoq = {}; for (const b of buyurtmalar) sanoq[b.holat] = (sanoq[b.holat] || 0) + 1;
    const undirildi = n(pul.undirildi), topshirildi = n(inkas?.topshirilgan_summa);
    const sotuvSumma = bugungi.reduce((s, a) => s + n(a.jami_summa), 0);
    const keyingi = rejalar.find(r => !tashriflar.some(t => t.mijoz_id === r.mijoz_id));
    ok(res, {
      serverVaqt: new Date(), sana, rejim: 'agent',
      agent: { id: agent.id, ism: agent.fullname, ombor: ASOSIY_OMBOR },
      holat: {
        sana, rejim: 'agent', bosqich: 1, holat: 'savdo', holatNomi: 'Buyurtma yig\'ish',
        keyingiQadam: 'savdo', keyingiQadamMatn: keyingi ? 'Marshrut bo\'yicha mijozlarga boring, buyurtma oling' : (rejalar.length ? 'Bugungi reja bajarildi — qolgan mijozlarga ham kiring' : 'Mijozlarga boring va buyurtma oling'),
        mashina: sklad.jami,
        bugun: {
          yuklandiDona: 0, yuklandiSumma: 0,
          sotuvSoni: bugungi.length, sotuvDona: bugungi.reduce((s, a) => s + (a.qatorlar || []).reduce((x, q) => x + n(q.jami_dona), 0), 0),
          sotuvSumma, naqdSotuv: bugungi.filter(naqdMi).reduce((s, a) => s + n(a.jami_summa), 0),
          qarzgaSotuv: bugungi.filter(a => !naqdMi(a)).reduce((s, a) => s + n(a.jami_summa), 0),
          naqdQolda: Math.max(0, undirildi - topshirildi),
          tashrif: new Set(tashriflar.map(t => t.mijoz_id)).size, reja: rejalar.length,
          uzoqSotuv: bugungi.filter(a => n(a.masofa_m) > 300).length,
        },
        sorovlar: [], qabulKutilmoqda: [], kunYopish: null,
        buyurtma: { yangi: sanoq.yangi || 0, tasdiqlangan: sanoq.tasdiqlangan || 0, yigilmoqda: sanoq.yigilmoqda || 0, yolda: sanoq.yolda || 0, yetkazildi: sanoq.yetkazildi || 0, bekor: sanoq.bekor || 0 },
        pul: { undirildi, tolovSoni: Number(pul.soni || 0), topshirildi, naqdQolda: Math.max(0, undirildi - topshirildi), inkassatsiya: inkas ? inkas.holat : null },
      },
      sklad: { qatorlar: sklad.qatorlar, jami: sklad.jami },
      mijozlar: mijozlar.map(m => {
        const balans = n(m.balans);
        const rid = m.kategoriya_id ? narx.katRuyxat[m.kategoriya_id] : null;
        return {
          klientId: String(m.id), nomi: m.nomi || '', yuridikNomi: m.yuridik_nomi || '',
          tel: m.telefon || '', tel2: m.telefon2 || '', manzil: m.manzil || '', moljal: m.mo_ljal || '',
          lat: m.lat != null ? n(m.lat) : null, lng: m.lng != null ? n(m.lng) : null,
          qarz: balans < 0 ? -balans : 0, balans, kreditLimit: n(m.kredit_limit),
          narxTuri: m.narx_turi || 'chakana', ruyxatId: rid && ruyxatIds.has(rid) ? rid : null,
          tashrifKunlari: m.tashrif_kunlari || '',
          // Mas'ul agent — boshqa agentning mijozi bo'lsa kartada ko'rsatiladi
          agentId: m.agent_id ? String(m.agent_id) : null, agentNomi: m.agent_id ? (agentNomi.get(m.agent_id) || '') : '', meniki: m.agent_id === agent.id, tolovMuddatiKun: parseInt(m.tolov_muddati_kun, 10) || 30,
          ...reytingKorinish(m),   // mijoz reytingi
        };
      }),
      reja: rejalar.map(r => ({ klientId: String(r.mijoz_id), tartib: r.tartib, izoh: r.izoh || '' })),
      tashriflar: tashriflar.map(t => ({
        tashrifId: t.id, klientId: String(t.mijoz_id), checkinVaqt: t.checkin_vaqt, checkoutVaqt: t.checkout_vaqt,
        natija: t.natija || null, arizaId: t.ariza_id ? String(t.ariza_id) : null,
      })),
      narx: narx.javob,
      buyurtmalar,
      buyumlar,
      sabablar: SABABLAR.filter(x => x.tip === 'Причина').map(x => ({ id: x.id, name: x.name, neytral: !!x.neytral })),
      reytingQoida: await reytingQoidalari(),
    });
  };
}

module.exports = new MobileAvtolavkaController();
