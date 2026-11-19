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
const { narxXaritasi } = require('../../utils/narx.utils');
const { MijozModel, MijozKategoriyaModel } = require('../../models/mijoz.model');
const { MarshrutRejaModel, TashrifModel } = require('../../models/marshrut.model');
const { NarxRuyxatModel, NarxRuyxatQatorModel } = require('../../models/narxRuyxat.model');
const { ok, fail, SABABLAR, summaOl } = require('./shared');
const { ASOSIY_OMBOR, agentOmbori } = require('../../utils/ombor.utils');
const AgentModel = require('../../models/agent.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { InkassatsiyaModel } = require('../../models/inkassatsiya.model');
const { mavjudQoldiq } = require('../../utils/zaxira.utils');
const { qulflabOl } = require('../../utils/qulf.utils');
const { tzOffset, kunKey } = require('../../utils/tahlil.utils');
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
  const ombor = agentOmbori(agent.fullname);
  const map = await omborQoldiq(ombor);
  const ids = Object.keys(map).filter(id => map[id].qoldiq > EPS).map(Number);
  const [narx, tovarlar] = await Promise.all([
    narxMap(ids),
    ids.length ? TovarModel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'blokdagi_soni', 'turkum'], raw: true }) : [],
  ]);
  // Turkum — tovar kartasidan (Sozlamalar → Turkumlar); register yozuvidagi eski nom faqat zaxira
  const blok = {}, tk = {}; tovarlar.forEach(t => { blok[t.id] = Math.max(1, +t.blokdagi_soni || 1); tk[t.id] = t.turkum || ''; });
  const qatorlar = ids.map(id => {
    const q = +map[id].qoldiq.toFixed(3), nx = narx[id]?.chakana_narx || 0;
    return {
      tovarId: String(id), tovar: map[id].tovar_nomi, turkum: tk[id] || map[id].turkum || '',
      blokdagiSoni: blok[id] || 1, qoldiq: q, narx: nx, summa: +(q * nx).toFixed(2),
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
function keyingiQadam(kun, mashinaDona, qabulKutilmoqda) {
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
  let [kun, mashina, qabulsiz] = await Promise.all([
    kunHisobla(agent, sana),
    tayyorMashina || mashinaTovarlari(agent),
    AvtolavkaHujjatModel.findAll({
      where: { agent_id: agent.id, sana, tur: 'yuklash', holat: 'tasdiqlangan', agent_qabul_vaqt: null },
      order: [['id', 'ASC']],
    }),
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
      qarzgaSotuv: kun.pul.qarzga_sotuv,
      naqdQolda: Math.max(0, kun.pul.naqd_olindi - kun.pul.topshirildi),
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
   (toifa ro'yxati → mijoz turidagi standart → eski narx — narx.utils bilan bir xil). */
async function narxSinxron(mijozlar, tovarIds) {
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
    const agent = avtoAgent(req, res); if (!agent) return;
    ok(res, await tavsiyaShakli(agent));
  };

  // GET yuklashTovarlar/?searchKey=&categoryId= — asosiy ombordagi tovarlar (so'rov formasi)
  yuklashTovarlar = async (req, res) => {
    const agent = avtoAgent(req, res); if (!agent) return;
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
    const agent = avtoAgent(req, res); if (!agent) return;
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
    const agent = avtoAgent(req, res); if (!agent) return;
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugun();
    ok(res, await bugungiYuklashlar(agent, sana));
  };

  // POST yuklashQabul/ { docId, izoh } — agent yuklangan tovarni sanab qabul qildi
  yuklashQabul = async (req, res) => {
    const agent = avtoAgent(req, res); if (!agent) return;
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
    const agent = avtoAgent(req, res); if (!agent) return;
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
    const agent = avtoAgent(req, res); if (!agent) return;
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
    const agent = avtoAgent(req, res); if (!agent) return;
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
    const r = await narxXaritasi({ mijozId: klientId, tovarIds: tovarlar.map(t => t.id) });
    ok(res, {
      ruyxat: r.ruyxat,
      narxlar: r.narxlar.map(x => ({ tovarId: String(x.tovar_id), narx: x.narx, manba: x.manba })),
    });
  };

  // GET avtolavkaSinxron/ — oflayn ishlash uchun hamma narsa bitta so'rovda:
  // kun holati, mashina qoldig'i, agent mijozlari (qarz, limit, narx ro'yxati),
  // bugungi reja va tashriflar, narx ro'yxatlari, sotmaslik sabablari.
  avtolavkaSinxron = async (req, res) => {
    const agent = avtoAgent(req, res); if (!agent) return;
    const sana = bugun();
    const mashina = await mashinaTovarlari(agent);
    const [holat, mijozRows, rejalar, tashriflar, ombor, tavsiya, yuklashlar] = await Promise.all([
      holatHisobla(agent, sana, mashina),
      // Barcha faol mijozlar — ilovada "Barchasi" tabida boshqa agentlarning mijozlari ham mas'ul agent nomi bilan ko'rinadi
      MijozModel.findAll({ where: { faol: true }, order: [['nomi', 'ASC']], raw: true }),
      MarshrutRejaModel.findAll({ where: { agent_id: agent.id, sana }, order: [['tartib', 'ASC'], ['id', 'ASC']], raw: true }),
      TashrifModel.findAll({ where: { agent_id: agent.id, sana }, order: [['id', 'ASC']], raw: true }),
      omborTovarlari(agent),
      tavsiyaShakli(agent).catch(() => null),
      bugungiYuklashlar(agent, sana),
    ]);
    // Rejadagi, lekin boshqa agentga biriktirilgan mijozlar ham ro'yxatda bo'lsin
    const bor = new Set(mijozRows.map(m => m.id));
    const qoshimcha = rejalar.map(r => r.mijoz_id).filter(id => id && !bor.has(id));
    const mijozlar = qoshimcha.length
      ? mijozRows.concat(await MijozModel.findAll({ where: { id: qoshimcha }, raw: true }))
      : mijozRows;

    const tovarIds = mashina.qatorlar.map(q => Number(q.tovarId));
    const narx = await narxSinxron(mijozlar, tovarIds);
    const ruyxatIds = new Set(narx.javob.ruyxatlar.map(r => r.id));
    const agentNomi = new Map((await AgentModel.findAll({ attributes: ['id', 'fullname'], raw: true, paranoid: false })).map(a => [a.id, a.fullname]));

    ok(res, {
      serverVaqt: new Date(),
      sana,
      agent: { id: agent.id, ism: agent.fullname, ombor: mashina.ombor },
      holat,
      mashina: { qatorlar: mashina.qatorlar, jami: mashina.jami },
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
      narx: narx.javob,
      // Oflayn yuklash so'rovi va Mashina ekrani uchun
      ombor, tavsiya, yuklashlar,
      sabablar: SABABLAR.filter(x => x.tip === 'Причина').map(x => ({ id: x.id, name: x.name, neytral: !!x.neytral })),
      reytingQoida: await reytingQoidalari(),
    });
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
    const narx = await narxSinxron(mijozlar, sklad.qatorlar.map(q => Number(q.tovarId)));
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
      sabablar: SABABLAR.filter(x => x.tip === 'Причина').map(x => ({ id: x.id, name: x.name, neytral: !!x.neytral })),
      reytingQoida: await reytingQoidalari(),
    });
  };
}

module.exports = new MobileAvtolavkaController();
