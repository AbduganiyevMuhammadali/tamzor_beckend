/**
 * AVTOLAVKA — web (omborchi) va mobil (agent) uchun umumiy hisob-kitob.
 *
 *   yuklash  — asosiy ombor → agent ombori ("Agent: <ism>"), hujjat tasdiqlanganda
 *   sotuv    — mobil ilovadan, chiqim agent omboridan (mobile/savdo.controller.js)
 *   qabul    — agent ombori → asosiy ombor; farq agent omborida qoladi, brak alohida
 *   kunHisobla — bir agent, bir kun: tovar balansi + pul balansi + holat
 *
 * Ombor harakati tovar_register orqali: o'tkazma ikki yozuv (chiqim + kirim),
 * ikkalasi tannarxda — jami ombor qiymati o'zgarmaydi, tovar faqat joy almashtiradi.
 */
const { Op, fn, col } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const { AvtolavkaHujjatModel, AvtolavkaQatorModel, AvtolavkaKunModel } = require('../models/avtolavka.model');
const AgentModel = require('../models/agent.model');
const TovarModel = require('../models/tovar.model');
const TovarRegisterModel = require('../models/tovar_register.model');
const HttpException = require('./HttpException.utils');
const { ASOSIY_OMBOR, agentOmbori } = require('./ombor.utils');
const { SOTUV_RADIUS_M } = require('./geo.utils');
const { mavjudQoldiq } = require('./zaxira.utils');
const { qulflabOl, tovarlarniQulfla, keyingiTartib, maksRaqam } = require('./qulf.utils');
const { tzOffset, kunKey } = require('./tahlil.utils');

const BRAK_OMBOR = 'Brak ombori';   // mobile/delivery.controller.js bilan bir xil
const PREFIKS = { yuklash: 'YK', qabul: 'QB' };
const INCLUDE = [{ model: AvtolavkaQatorModel, as: 'qatorlar' }];
const EPS = 0.001;

// Mahalliy (biznes, Toshkent) sana. toISOString() UTC beradi — 00:00–05:00 orasidagi
// amallar oldingi kunga tushib qolardi.
const bugun = () => kunKey(new Date());
// Bazada DATETIME UTC saqlanadi — kunga ajratish mahalliy vaqtda (tahlil/dashboard bilan bir xil)
const lokalKun = (ustun) => `DATE(CONVERT_TZ(${ustun}, '+00:00', :tz))`;
const sanaMi = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const n = (v) => parseFloat(v) || 0;

/* ── Yordamchilar ──────────────────────────────────────── */

/* Hujjat raqami: hujjat_raqam hisoblagichi tranzaksiya ichida (qulf.utils keyingiTartib).
   Ilgari COUNT+1 edi — parallel so'rovlar bir xil raqam olardi, o'chirilgan hujjatdan keyin
   raqam takrorlanardi. Hisoblagich birinchi marta mavjud eng katta raqamdan boshlanadi. */
async function raqamYarat(tur, transaction) {
  const yil = new Date().getFullYear();
  const prefiks = `${PREFIKS[tur]}-${yil}`;
  const tartib = await keyingiTartib(prefiks, () => maksRaqam('avtolavka_hujjat', prefiks, transaction), transaction);
  return `${prefiks}-${String(tartib).padStart(4, '0')}`;
}

async function avtolavkaAgent(agent_id) {
  const agent = await AgentModel.findByPk(agent_id);
  if (!agent) throw new HttpException(404, 'Agent topilmadi');
  if (!agent.avtolavka) throw new HttpException(400, `${agent.fullname} Won Sell rejimida emas (agent kartasida belgilang)`);
  // 2026-11-29: diller — Won Sell (yuklash/qabul/xodim nomidan sotuv) emas, Dillerlar bo'limi orqali
  if (agent.diller) throw new HttpException(400, `${agent.fullname} — diller: tovar Dillerlar → Berish / Qaytarish orqali beriladi`);
  return agent;
}

/** Tovar narxlari: o'rtacha tannarx va oxirgi optom/chakana narx */
async function narxMap(ids) {
  const map = {};
  if (!ids.length) return map;
  const rows = await sequelize.query(`
    SELECT tovar_id,
      AVG(CASE WHEN tur = 'kirim' AND kirim_narx > 0 THEN kirim_narx END) AS kirim_narx,
      (SELECT r2.optom_narx FROM tovar_register r2
         WHERE r2.tovar_id = tr.tovar_id AND r2.optom_narx > 0
         ORDER BY r2.sana DESC, r2.id DESC LIMIT 1) AS optom_narx,
      (SELECT r3.chakana_narx FROM tovar_register r3
         WHERE r3.tovar_id = tr.tovar_id AND r3.chakana_narx > 0
         ORDER BY r3.sana DESC, r3.id DESC LIMIT 1) AS chakana_narx
    FROM tovar_register tr
    WHERE tovar_id IN (:ids)
    GROUP BY tovar_id`, { replacements: { ids }, type: sequelize.QueryTypes.SELECT });
  rows.forEach(r => {
    map[r.tovar_id] = { kirim_narx: n(r.kirim_narx), optom_narx: n(r.optom_narx), chakana_narx: n(r.chakana_narx) };
  });
  return map;
}

/** Ombordagi qoldiq, tovar bo'yicha.
    qulfla=true — qulflovchi o'qish (LOCK IN SHARE MODE): tranzaksiya snapshotidan emas, oxirgi
    commit qilingan holatdan o'qiydi va shu ombor yozuvlarini commitgacha ushlab turadi. */
async function omborQoldiq(ombor, transaction, { qulfla = false } = {}) {
  // unscoped: aniq bitta ombor so'raladi (diller ombori ham bo'lishi mumkin — defaultScope uni yashiradi)
  const rows = await TovarRegisterModel.unscoped().findAll({
    where: { ombor },
    attributes: ['tovar_id', [fn('SUM', col('donada')), 'q'],
                 [fn('MAX', col('tovar_nomi')), 'tovar_nomi'], [fn('MAX', col('turkum')), 'turkum']],
    group: ['tovar_id'], raw: true, transaction,
    ...(qulfla && transaction ? { lock: transaction.LOCK.SHARE } : {}),
  });
  const map = {};
  rows.forEach(r => { map[r.tovar_id] = { qoldiq: n(r.q), tovar_nomi: r.tovar_nomi, turkum: r.turkum }; });
  return map;
}

/* Asosiy ombordan mashinaga yuklash mumkin bo'lgan qoldiq: jismoniy − distributsiya
   zakazlariga (yangi / tasdiqlangan / yig'ilmoqda) band qilingani. omborQoldiq bilan bir
   xil shaklda ({ [tovar_id]: { qoldiq } }) — yuklash formasi, tavsiya, mobil so'rov va
   tasdiqlash bitta qoidadan foydalanadi. */
async function yuklashQoldigi(transaction) {
  const m = await mavjudQoldiq({ ombor: ASOSIY_OMBOR, transaction });
  const map = {};
  for (const [id, x] of m) map[id] = { qoldiq: x.mavjud, fizik: x.fizik, band: x.band };
  return map;
}

/** Register yozuvi. O'tkazma tannarxda yoziladi: chiqim va kirim bir-birini yopadi */
function regYozuv({ q, ombor, tur, manba_tur, manba_id, dona, narx, sana }) {
  const ishora = tur === 'kirim' ? 1 : -1;
  return {
    tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum || null,
    ombor, tur, manba_tur, manba_id,
    donada: ishora * Math.abs(dona),
    bloklarda: ishora * Math.abs(n(q.blok)), qutilarda: 0, hajm: 0,
    kirim_narx: narx.kirim_narx, optom_narx: narx.optom_narx, chakana_narx: narx.chakana_narx,
    sotuv_narx: narx.chakana_narx || n(q.narx),
    summa: ishora * Math.abs(dona) * narx.kirim_narx,
    sana,
  };
}

/** Kiruvchi qatorlarni tovar ma'lumoti va narx bilan to'ldiradi */
async function qatorlarniTayyorla(qatorlar) {
  if (!Array.isArray(qatorlar) || !qatorlar.length) throw new HttpException(400, 'Kamida bitta tovar kerak');
  const ids = [...new Set(qatorlar.map(q => parseInt(q.tovar_id)).filter(Boolean))];
  const tovarlar = await TovarModel.findAll({ where: { id: { [Op.in]: ids } }, raw: true });
  const tMap = {}; tovarlar.forEach(t => { tMap[t.id] = t; });
  const narx = await narxMap(ids);

  const birlashgan = {};
  for (const q of qatorlar) {
    const t = tMap[q.tovar_id];
    if (!t) throw new HttpException(400, `Tovar topilmadi: #${q.tovar_id}`);
    const dona = n(q.dona);
    if (dona <= 0) throw new HttpException(400, `"${t.nomi}": miqdor noldan katta bo'lishi kerak`);
    const nx = narx[t.id] || { kirim_narx: 0, optom_narx: 0, chakana_narx: 0 };
    if (n(q.narx) < 0) throw new HttpException(400, `"${t.nomi}": narx manfiy bo'lishi mumkin emas`);
    const sotuv = n(q.narx) || nx.chakana_narx;
    const k = birlashgan[t.id] || (birlashgan[t.id] = {
      tovar_id: t.id, tovar_nomi: t.nomi, turkum: t.turkum || null,
      narx: sotuv, kirim_narx: nx.kirim_narx, blok: 0, dona: 0, summa: 0,
    });
    k.dona += dona;
    k.blok += n(q.blok) || (t.blokdagi_soni > 1 ? Math.floor(dona / t.blokdagi_soni) : 0);
    k.summa += dona * sotuv;
  }
  return Object.values(birlashgan).map(k => ({
    ...k, dona: +k.dona.toFixed(3), blok: +k.blok.toFixed(3), summa: +k.summa.toFixed(2),
  }));
}

/** Yuklashni tasdiqlash: asosiy ombordan chiqim, agent omboriga kirim.
    hujjat — model yoki id. Hujjat tranzaksiya ichida QULFLAB qayta o'qiladi va holat shu
    yangi nusxada tekshiriladi: ikki parallel tasdiqlash (yoki tasdiqlash + rad/o'chirish)
    tovarni ikki marta ko'chirmaydi — ikkinchisi kutadi va "tasdiqlangan" holatni ko'radi.
    Qulflangan (yangilangan) hujjat qaytariladi. */
async function yuklashniTasdiqla(hujjatYokiId, userId, t) {
  const id = typeof hujjatYokiId === 'object' && hujjatYokiId ? hujjatYokiId.id : hujjatYokiId;
  const hujjat = await qulflabOl(AvtolavkaHujjatModel, id, t);
  if (!hujjat || hujjat.tur !== 'yuklash') throw new HttpException(404, 'Yuklash hujjati topilmadi');
  if (hujjat.holat !== 'qoralama') throw new HttpException(400, `Hujjat "${hujjat.holat}" holatida — tasdiqlab bo'lmaydi`);
  const qatorlar = await AvtolavkaQatorModel.findAll({ where: { hujjat_id: hujjat.id }, transaction: t });
  if (!qatorlar.length) throw new HttpException(400, 'Hujjat qatorlari bo\'sh');
  // Qoldiq tekshiruvidan OLDIN tovar qatorlari qulflanadi: shu tovarlar bo'yicha parallel
  // yuklash/buyurtma/chiqim navbatma-navbat bajariladi, asosiy ombor minusga tushmaydi.
  await tovarlarniQulfla(qatorlar.map(q => q.tovar_id), t);

  // Mashinaga faqat MAVJUD tovar yuklanadi: jismoniy qoldiq − distributsiya zakazlariga
  // (yangi / tasdiqlangan / yig'ilmoqda) band qilingani. Aks holda avtolavka mijozga
  // va'da qilingan tovarni olib ketadi va zakaz yig'ishda "yetarli emas" bo'lib qoladi.
  const kerak = {};
  for (const q of qatorlar) {
    const x = kerak[q.tovar_id] || (kerak[q.tovar_id] = { nomi: q.tovar_nomi, dona: 0 });
    x.dona += parseFloat(q.dona) || 0;
  }
  const mavjud = await mavjudQoldiq({ tovarIds: Object.keys(kerak), ombor: ASOSIY_OMBOR, transaction: t });
  for (const [id, x] of Object.entries(kerak)) {
    const m = mavjud.get(Number(id)) || { fizik: 0, band: 0, mavjud: 0 };
    if (x.dona > m.mavjud + EPS) {
      throw new HttpException(400,
        `"${x.nomi}" asosiy omborda yetarli emas. Kerak: ${+x.dona.toFixed(3)}, mavjud: ${m.mavjud}`
        + (m.band > 0 ? ` (omborda ${m.fizik}, shundan ${m.band} distributsiya zakazlariga band)` : ''));
    }
  }
  const narx = await narxMap(qatorlar.map(q => q.tovar_id));
  const sana = new Date();
  const yozuvlar = [];
  for (const q of qatorlar) {
    const nx = narx[q.tovar_id] || { kirim_narx: q.kirim_narx, optom_narx: 0, chakana_narx: q.narx };
    yozuvlar.push(regYozuv({ q, ombor: ASOSIY_OMBOR, tur: 'chiqim', manba_tur: 'yuklash', manba_id: hujjat.id, dona: q.dona, narx: nx, sana }));
    yozuvlar.push(regYozuv({ q, ombor: hujjat.ombor,  tur: 'kirim',  manba_tur: 'yuklash', manba_id: hujjat.id, dona: q.dona, narx: nx, sana }));
  }
  await TovarRegisterModel.bulkCreate(yozuvlar, { transaction: t });
  await hujjat.update({ holat: 'tasdiqlangan', tasdiqlagan_id: userId || null, tasdiqlagan_sana: sana }, { transaction: t });
  // 2026-11-27: sozlama yoqilgan bo'lsa agent dalolatnomani imzolashi kutiladi (yukImzo.utils)
  await require('./yukImzo.utils').tasdiqdaBelgila(hujjat, t);
  return hujjat;
}

/* ── Bir agent, bir kun — solishtirma ─────────────────── */
/* transaction — kun holatini o'zgartiruvchi amallar (kunni yopish/qayta ochish) agent qatorini
   qulflagandan keyin shu tranzaksiya ichida hisoblaydi. */
async function kunHisobla(agent, sana, { tafsilot = false, transaction = null } = {}) {
  const ombor = agentOmbori(agent.fullname);
  const R = { agent_id: agent.id, sana };
  const q = (sql) => sequelize.query(sql, {
    replacements: { agent_id: agent.id, sana, ombor, radius: SOTUV_RADIUS_M, tz: tzOffset() },
    type: sequelize.QueryTypes.SELECT, ...(transaction ? { transaction } : {}) });

  const [
    [yuk], [qab], [sot], [qayt], [boshi], [oxiri], [pul], [ink], [tash], [reja], sorovlar, [kunYopish], [koch],
  ] = await Promise.all([
    q(`SELECT COUNT(*) soni, COALESCE(SUM(jami_dona),0) dona, COALESCE(SUM(jami_summa),0) summa,
              MIN(tasdiqlagan_sana) vaqt, COALESCE(SUM(agent_qabul_vaqt IS NOT NULL),0) agent_qabul
       FROM avtolavka_hujjat WHERE agent_id = :agent_id AND sana = :sana AND tur = 'yuklash' AND holat = 'tasdiqlangan'`),
    q(`SELECT COUNT(*) soni, COALESCE(SUM(jami_dona),0) dona, COALESCE(SUM(jami_summa),0) summa,
              COALESCE(SUM(brak_dona),0) brak, COALESCE(SUM(farq_dona),0) farq, MAX(tasdiqlagan_sana) vaqt
       FROM avtolavka_hujjat WHERE agent_id = :agent_id AND sana = :sana AND tur = 'qabul' AND holat = 'tasdiqlangan'`),
    q(`SELECT COUNT(*) soni, COALESCE(SUM(a.jami_summa),0) summa,
              COALESCE(SUM(a.masofa_m > :radius),0) uzoq,
              COALESCE(SUM(CASE WHEN a.tolov_turi = 'plastik' THEN 0
                                WHEN a.tolangan_summa > 0 THEN a.tolangan_summa
                                WHEN a.tolov_turi IN ('naqt','naqd') THEN a.jami_summa ELSE 0 END),0) naqd,
              COALESCE(SUM(CASE WHEN a.tolov_turi = 'plastik' THEN a.tolangan_summa ELSE 0 END),0) plastik,
              COALESCE((SELECT SUM(q.jami_dona) FROM ariza_qator q WHERE q.ariza_id IN
                 (SELECT id FROM ariza WHERE agent_id = :agent_id AND deletedAt IS NULL AND turi = 'sotish'
                    AND holat = 'yetkazildi' AND ombor = :ombor AND ${lokalKun('yetkazilgan_sana')} = :sana)),0) dona
       FROM ariza a WHERE a.agent_id = :agent_id AND a.deletedAt IS NULL AND a.turi = 'sotish'
         AND a.holat = 'yetkazildi' AND a.ombor = :ombor AND ${lokalKun('a.yetkazilgan_sana')} = :sana`),
    q(`SELECT COALESCE(SUM(donada),0) dona, COALESCE(SUM(ABS(donada) * sotuv_narx),0) summa
       FROM tovar_register WHERE ombor = :ombor AND tur = 'qaytarma_kirim' AND ${lokalKun('sana')} = :sana`),
    q(`SELECT COALESCE(SUM(donada),0) dona, COALESCE(SUM(donada * COALESCE(NULLIF(sotuv_narx,0), kirim_narx)),0) summa
       FROM tovar_register WHERE ombor = :ombor AND ${lokalKun('sana')} < :sana`),
    q(`SELECT COALESCE(SUM(donada),0) dona, COALESCE(SUM(donada * COALESCE(NULLIF(sotuv_narx,0), kirim_narx)),0) summa
       FROM tovar_register WHERE ombor = :ombor AND ${lokalKun('sana')} <= :sana`),
    q(`SELECT COALESCE(SUM(summa),0) summa, COUNT(*) soni FROM kassa
       WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND user_id = :agent_id
         AND manba_tur IN ('mijoz','avtolavka') AND ${lokalKun('sana')} = :sana`),
    q(`SELECT topshirilgan_summa, farq, holat, tasdiqlagan_sana FROM inkassatsiya
       WHERE agent_id = :agent_id AND sana = :sana LIMIT 1`),
    q(`SELECT COUNT(*) soni, SUM(natija = 'savdo') savdo FROM tashrif WHERE agent_id = :agent_id AND sana = :sana`),
    q(`SELECT COUNT(*) soni FROM marshrut_reja WHERE agent_id = :agent_id AND sana = :sana`),
    // Agent mobildan so'ragan, omborchi hali tasdiqlamagan yuklashlar
    q(`SELECT id, raqam, jami_dona, jami_summa, createdAt vaqt FROM avtolavka_hujjat
       WHERE agent_id = :agent_id AND sana = :sana AND tur = 'yuklash' AND holat = 'qoralama' AND manba = 'mobil'
       ORDER BY id`),
    q(`SELECT yopish_vaqt, naqd_elon, izoh, ochish_vaqt, ochish_soni FROM avtolavka_kun WHERE agent_id = :agent_id AND sana = :sana LIMIT 1`),
    // 2026-11-26: agentdan agentga ko'chirish — kelgan (kirim) va ketgan (chiqim); tahrir/bekor yozuvlari ham shu yerda
    q(`SELECT COALESCE(SUM(CASE WHEN donada > 0 THEN donada ELSE 0 END),0) kirim,
              COALESCE(SUM(CASE WHEN donada < 0 THEN -donada ELSE 0 END),0) chiqim
       FROM tovar_register WHERE ombor = :ombor AND manba_tur = 'agent_kochirish' AND ${lokalKun('sana')} = :sana`),
  ]);

  const kunBoshi = n(boshi.dona), berildi = n(yuk.dona), qaytdi = n(qayt.dona);
  const sotildi = n(sot.dona), brak = n(qab.brak), topshirildi = n(qab.dona);
  const kKirim = n(koch && koch.kirim), kChiqim = n(koch && koch.chiqim);
  const kerak = kunBoshi + berildi + qaytdi + kKirim - kChiqim - sotildi - brak;
  const farq = +(kerak - topshirildi).toFixed(3);
  R.tovar = {
    kun_boshi:     { dona: kunBoshi, summa: n(boshi.summa) },
    berildi:       { dona: berildi, summa: n(yuk.summa), hujjat_soni: +yuk.soni },
    qaytarildi:    { dona: qaytdi, summa: n(qayt.summa) },
    // Boshqa agentlardan kelgan / boshqa agentlarga ketgan (agentdan agentga ko'chirish)
    kochirish:     { kirim: +kKirim.toFixed(3), chiqim: +kChiqim.toFixed(3) },
    sotildi:       { dona: sotildi, summa: n(sot.summa), hujjat_soni: +sot.soni },
    brak:          { dona: brak },
    qolishi_kerak: { dona: +kerak.toFixed(3) },
    topshirildi:   { dona: topshirildi, summa: n(qab.summa), hujjat_soni: +qab.soni },
    farq:          { dona: farq },
    // Hozirgi haqiqiy qoldiq (farq shu bilan mos kelishi kerak)
    kun_oxiri:     { dona: n(oxiri.dona), summa: n(oxiri.summa) },
  };

  const naqdOlindi = n(pul.summa), pulTopshirildi = ink ? n(ink.topshirilgan_summa) : 0;
  R.pul = {
    sotuv_jami:    n(sot.summa),
    naqd_sotuv:    n(sot.naqd),
    plastik_sotuv: n(sot.plastik),   // tasdiqlangan plastik (kutilayotgani qarzga kiradi)
    qarzga_sotuv:  +(n(sot.summa) - n(sot.naqd) - n(sot.plastik)).toFixed(2),
    naqd_olindi:   naqdOlindi,        // mijozlardan olingan naqd (sotuv + qarz undirish)
    tolov_soni:    +pul.soni,
    kerak:         naqdOlindi,
    topshirildi:   pulTopshirildi,
    farq:          +(naqdOlindi - pulTopshirildi).toFixed(2),
    inkassatsiya:  ink ? { holat: ink.holat, vaqt: ink.tasdiqlagan_sana } : null,
  };

  R.kun = {
    yuklash_vaqt: yuk.vaqt || null, qaytish_vaqt: qab.vaqt || null,
    reja: +reja.soni, tashrif: +tash.soni, savdo: +(tash.savdo || 0),
    // Agent tasdiqlangan yuklashlardan nechtasini mobilda "qabul qildim" dedi
    agent_qabul: { yuklash: +yuk.soni, qabul: +yuk.agent_qabul },
    uzoq_sotuv: +sot.uzoq || 0,
  };
  R.sorovlar = sorovlar.map(r => ({
    id: r.id, raqam: r.raqam, dona: n(r.jami_dona), summa: n(r.jami_summa), vaqt: r.vaqt,
  }));
  /* QAYTA OCHILGAN KUN (bir kunda yangi reys): summalar butun kun bo'yicha jami qoladi, lekin
     yopish, qabul va inkassatsiya faqat oxirgi ochilishdan KEYIN bo'lgani hisobga olinadi —
     ertalabki topshirish yangi reysni "yopiq" qilib qo'ymasin. */
  const ochish = kunYopish && kunYopish.ochish_vaqt ? new Date(kunYopish.ochish_vaqt) : null;
  // ochish_vaqt soniyagacha qirqib yoziladi (kunniQaytaOch) — shu soniyadagi qabul ham "keyin" hisoblanadi
  const keyin = (v) => !ochish || (!!v && new Date(v) >= ochish);
  R.qayta_ochish = ochish ? { vaqt: kunYopish.ochish_vaqt, soni: +kunYopish.ochish_soni || 1 } : null;
  R.kun_yopish = kunYopish && kunYopish.yopish_vaqt && keyin(kunYopish.yopish_vaqt)
    ? { vaqt: kunYopish.yopish_vaqt, naqd_elon: kunYopish.naqd_elon === null ? null : n(kunYopish.naqd_elon), izoh: kunYopish.izoh || null }
    : null;

  // Holat: ochiq → topshirildi → yopiq / kamomad
  // Naqd umuman yig'ilmagan bo'lsa (hammasi qarzga) — pul topshirish shart emas.
  // Qayta ochilgan kunda: yangi naqd yo'q (hammasi avval topshirilgan) bo'lsa ham shart emas.
  const tovarTopshirdi = +qab.soni > 0 && keyin(qab.vaqt);
  const pulTopshirdi = ochish
    ? (!!ink && keyin(ink.tasdiqlagan_sana)) || (R.pul.farq <= 0.5 && tovarTopshirdi)
    : !!ink || (naqdOlindi <= 0 && tovarTopshirdi);
  // Agent mobilda kunni yopgan bo'lsa — savdo tugagan, topshirish kutilmoqda
  if (!tovarTopshirdi && !pulTopshirdi) R.holat = R.kun_yopish ? 'topshirilmoqda' : (berildi > 0 || kKirim > 0 || sotildi > 0 ? 'ochiq' : 'bosh');
  else if (!tovarTopshirdi || !pulTopshirdi) R.holat = 'topshirilmoqda';
  else R.holat = (farq > EPS || R.pul.farq > 0.5) ? 'kamomad' : 'yopiq';
  // Bosqich: 0 yuklash · 1 savdo · 2 topshirish · 3 yopilgan
  R.bosqich = { bosh: 0, ochiq: 1, topshirilmoqda: 2, yopiq: 3, kamomad: 3 }[R.holat];
  R.topshirish = { tovar: tovarTopshirdi, pul: pulTopshirdi };

  if (!tafsilot) return R;

  // Tafsilot: mijozlar bo'yicha va tovarlar bo'yicha
  const [arizalar, tolovlar, tovarlar] = await Promise.all([
    q(`SELECT id, raqam, mijoz_id, mijoz_nomi, jami_summa, tolov_turi, yetkazilgan_sana vaqt
       FROM ariza WHERE agent_id = :agent_id AND deletedAt IS NULL AND turi = 'sotish'
         AND holat = 'yetkazildi' AND ombor = :ombor AND ${lokalKun('yetkazilgan_sana')} = :sana
       ORDER BY yetkazilgan_sana`),
    q(`SELECT id, mijoz_id, mijoz_nomi, summa, manba_tur, izoh, sana vaqt FROM kassa
       WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND user_id = :agent_id
         AND manba_tur IN ('mijoz','avtolavka') AND ${lokalKun('sana')} = :sana ORDER BY sana`),
    // Tovar bo'yicha: shu kundagi harakat + kun boshi/oxiridagi qoldiq
    // (kun oxiri = o'sha kunning farqi; bugun uchun hozirgi mashinadagi qoldiq)
    q(`SELECT r.tovar_id, MAX(r.tovar_nomi) tovar_nomi, MAX(r.turkum) turkum,
              SUM(CASE WHEN ${lokalKun('r.sana')} < :sana THEN r.donada ELSE 0 END) kun_boshi,
              SUM(CASE WHEN ${lokalKun('r.sana')} = :sana AND r.manba_tur = 'yuklash' THEN r.donada ELSE 0 END) berildi,
              SUM(CASE WHEN ${lokalKun('r.sana')} = :sana AND r.manba_tur = 'sotuv' THEN -r.donada ELSE 0 END) sotildi,
              SUM(CASE WHEN ${lokalKun('r.sana')} = :sana AND r.tur = 'qaytarma_kirim' THEN r.donada ELSE 0 END) qaytdi,
              SUM(CASE WHEN ${lokalKun('r.sana')} = :sana AND r.manba_tur = 'qabul' THEN -r.donada ELSE 0 END) topshirildi,
              SUM(CASE WHEN ${lokalKun('r.sana')} = :sana AND r.manba_tur = 'agent_kochirish' THEN r.donada ELSE 0 END) kochirildi,
              SUM(r.donada) kun_oxiri
       FROM tovar_register r WHERE r.ombor = :ombor AND ${lokalKun('r.sana')} <= :sana
       GROUP BY r.tovar_id
       HAVING ABS(kun_boshi) + berildi + sotildi + qaytdi + topshirildi + ABS(kochirildi) + ABS(kun_oxiri) > 0.001
       ORDER BY tovar_nomi`),
  ]);
  const brakRows = await q(`SELECT q.tovar_id, SUM(q.brak_dona) brak FROM avtolavka_qator q
       JOIN avtolavka_hujjat h ON h.id = q.hujjat_id
       WHERE h.agent_id = :agent_id AND h.sana = :sana AND h.tur = 'qabul' GROUP BY q.tovar_id`);
  const brakMap = {}; brakRows.forEach(r => { brakMap[r.tovar_id] = n(r.brak); });

  const mijozMap = {};
  arizalar.forEach(a => {
    const m = mijozMap[a.mijoz_id] || (mijozMap[a.mijoz_id] = { mijoz_id: a.mijoz_id, mijoz_nomi: a.mijoz_nomi, sotuv: 0, naqd: 0, hujjatlar: [] });
    m.sotuv += n(a.jami_summa);
    m.hujjatlar.push({ tur: 'sotuv', raqam: a.raqam, summa: n(a.jami_summa), tolov_turi: a.tolov_turi, vaqt: a.vaqt });
  });
  tolovlar.forEach(k => {
    const m = mijozMap[k.mijoz_id] || (mijozMap[k.mijoz_id] = { mijoz_id: k.mijoz_id, mijoz_nomi: k.mijoz_nomi, sotuv: 0, naqd: 0, hujjatlar: [] });
    m.naqd += n(k.summa);
    m.hujjatlar.push({ tur: 'tolov', raqam: `TL-${k.id}`, summa: n(k.summa), izoh: k.izoh, vaqt: k.vaqt });
  });
  R.mijozlar = Object.values(mijozMap).map(m => ({
    ...m, sotuv: +m.sotuv.toFixed(2), naqd: +m.naqd.toFixed(2), qarz_ozgarishi: +(m.sotuv - m.naqd).toFixed(2),
    hujjatlar: m.hujjatlar.sort((a, b) => new Date(a.vaqt) - new Date(b.vaqt)),
  })).sort((a, b) => b.sotuv - a.sotuv);

  R.tovarlar = tovarlar.map(t => {
    const brakD = brakMap[t.tovar_id] || 0;
    // qabul manbasiga brak ham kiradi — asosiyga qaytganini ajratamiz
    const topsh = n(t.topshirildi) - brakD;
    return {
      tovar_id: t.tovar_id, tovar_nomi: t.tovar_nomi, turkum: t.turkum,
      kun_boshi: n(t.kun_boshi), berildi: n(t.berildi), sotildi: n(t.sotildi), qaytdi: n(t.qaytdi),
      topshirildi: +topsh.toFixed(3), brak: brakD,
      kochirildi: +n(t.kochirildi).toFixed(3),   // agentdan agentga: + kelgan, − ketgan (sof)
      farq: +n(t.kun_oxiri).toFixed(3),
    };
  });
  R.voqealar = await kunVoqealari(agent, sana);
  return R;
}

/* ── Kunni qayta ochish ───────────────────────────────────
   1) Agent ilovada kunni yopgan, topshirish hali boshlanmagan — "xato bosildi": yopish bekor qilinadi.
   2) Topshirish boshlangan yoki kun to'liq yopilgan — YANGI REYS: kun yozuvi saqlanadi, ochish_vaqt
      yangilanadi. Shundan keyin agent yana yuklash so'raydi/sotadi, kun oxirida yana topshiradi;
      solishtirma butun kun bo'yicha jami (kunHisobla). Faqat bugungi kun uchun. */
async function kunniQaytaOch(agent, sana) {
  // Agent qatori qulflanadi — kunni yopish/qayta ochish/qabul shu agent bo'yicha navbatma-navbat;
  // ikki marta bosilgan "Yangi reys" ochish_soni'ni ikki marta oshirmaydi (ikkinchisi yangi holatni ko'radi).
  return sequelize.transaction(async (t) => {
    await qulflabOl(AgentModel, agent.id, t);
    const kun = await kunHisobla(agent, sana, { transaction: t });
    const boshlangan = kun.topshirish.tovar || kun.topshirish.pul;
    if (!kun.kun_yopish && !boshlangan) return { ozgardi: false, yangiReys: false };   // kun ochiq
    if (!boshlangan) {
      await AvtolavkaKunModel.update({ yopish_vaqt: null }, { where: { agent_id: agent.id, sana }, transaction: t });
      return { ozgardi: true, yangiReys: false };
    }
    const [yozuv] = await AvtolavkaKunModel.findOrCreate({ where: { agent_id: agent.id, sana }, defaults: { agent_id: agent.id, sana }, transaction: t });
    // Soniyagacha qirqiladi: DATETIME millisekundni yaxlitlab keyingi soniyaga o'tkazib yuborishi mumkin,
    // shunda darhol ketidan qilingan qabul "ochilishdan oldin" bo'lib qolardi
    await yozuv.update({ ochish_vaqt: new Date(Math.floor(Date.now() / 1000) * 1000), ochish_soni: (+yozuv.ochish_soni || 0) + 1 }, { transaction: t });
    return { ozgardi: true, yangiReys: true, soni: (+yozuv.ochish_soni || 0) };
  });
}

/* ── Kun hikoyasi: yuklash → tashriflar/sotuvlar/to'lovlar → qabul → kassa ── */
async function kunVoqealari(agent, sana) {
  const ombor = agentOmbori(agent.fullname);
  const q = (sql) => sequelize.query(sql, {
    replacements: { agent_id: agent.id, sana, ombor, tz: tzOffset() }, type: sequelize.QueryTypes.SELECT });
  const [hujjatlar, sotuvlar, tashriflar, tolovlar, inkas, sorovlar, kunYopish] = await Promise.all([
    q(`SELECT id, raqam, tur, jami_dona, jami_summa, farq_dona, brak_dona, tasdiqlagan_sana vaqt, agent_qabul_vaqt
       FROM avtolavka_hujjat WHERE agent_id = :agent_id AND sana = :sana AND holat = 'tasdiqlangan'`),
    q(`SELECT a.id, a.raqam, a.mijoz_nomi, a.jami_summa, a.tolov_turi, a.tolangan_summa, a.yetkazilgan_sana vaqt, a.masofa_m,
              (SELECT COALESCE(SUM(jami_dona),0) FROM ariza_qator WHERE ariza_id = a.id) dona
       FROM ariza a WHERE a.agent_id = :agent_id AND a.deletedAt IS NULL AND a.turi = 'sotish'
         AND a.holat = 'yetkazildi' AND a.ombor = :ombor AND ${lokalKun('a.yetkazilgan_sana')} = :sana`),
    q(`SELECT t.id, t.mijoz_nomi, t.natija, t.checkin_vaqt vaqt, t.checkout_vaqt,
              (SELECT s.sabab_nomi FROM sotmaslik s WHERE s.agent_id = t.agent_id AND s.mijoz_id = t.mijoz_id
                 AND ${lokalKun('s.sana')} = t.sana LIMIT 1) sabab
       FROM tashrif t WHERE t.agent_id = :agent_id AND t.sana = :sana AND t.natija <> 'savdo'`),
    q(`SELECT id, mijoz_nomi, summa, sana vaqt FROM kassa
       WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND user_id = :agent_id AND manba_tur = 'mijoz' AND ${lokalKun('sana')} = :sana`),
    q(`SELECT topshirilgan_summa, yigilgan_summa, holat, COALESCE(tasdiqlagan_sana, updatedAt) vaqt
       FROM inkassatsiya WHERE agent_id = :agent_id AND sana = :sana LIMIT 1`),
    q(`SELECT raqam, jami_dona, jami_summa, holat, rad_sababi, createdAt vaqt FROM avtolavka_hujjat
       WHERE agent_id = :agent_id AND sana = :sana AND tur = 'yuklash' AND manba = 'mobil'`),
    q(`SELECT yopish_vaqt vaqt, naqd_elon, ochish_vaqt, ochish_soni FROM avtolavka_kun WHERE agent_id = :agent_id AND sana = :sana`),
  ]);
  const kochirishlar = await q(`SELECT k.raqam, k.sana vaqt, k.holat, k.dan_agent_id, k.dan_agent_nomi, k.ga_agent_nomi,
       (SELECT COALESCE(SUM(dona),0) FROM agent_kochirish_qator x WHERE x.kochirish_id = k.id) dona
     FROM agent_kochirish k WHERE (k.dan_agent_id = :agent_id OR k.ga_agent_id = :agent_id) AND ${lokalKun('k.sana')} = :sana`);
  const v = [];
  kochirishlar.forEach(k => {
    const chiqim = Number(k.dan_agent_id) === Number(agent.id);
    v.push({ tur: 'kochirish', vaqt: k.vaqt, raqam: k.raqam, yonalish: chiqim ? 'chiqim' : 'kirim',
      agent: chiqim ? k.ga_agent_nomi : k.dan_agent_nomi, dona: n(k.dona), holat: k.holat });
  });
  sorovlar.forEach(h => v.push({ tur: 'sorov', vaqt: h.vaqt, raqam: h.raqam, dona: n(h.jami_dona), summa: n(h.jami_summa),
    holat: h.holat, sabab: h.rad_sababi || null }));
  hujjatlar.forEach(h => {
    if (h.tur === 'yuklash') {
      v.push({ tur: 'yuklash', vaqt: h.vaqt, raqam: h.raqam, dona: n(h.jami_dona), summa: n(h.jami_summa) });
      if (h.agent_qabul_vaqt) v.push({ tur: 'agent_qabul', vaqt: h.agent_qabul_vaqt, raqam: h.raqam, dona: n(h.jami_dona) });
    } else {
      v.push({ tur: 'qabul', vaqt: h.vaqt, raqam: h.raqam, dona: n(h.jami_dona), summa: n(h.jami_summa), farq: n(h.farq_dona), brak: n(h.brak_dona) });
    }
  });
  sotuvlar.forEach(a => v.push({ tur: 'sotuv', vaqt: a.vaqt, raqam: a.raqam, mijoz: a.mijoz_nomi, summa: n(a.jami_summa),
    dona: n(a.dona), naqd: a.tolov_turi === 'naqt' || a.tolov_turi === 'naqd', tolangan: n(a.tolangan_summa),
    masofa: a.masofa_m === null ? null : +a.masofa_m, uzoq: a.masofa_m !== null && +a.masofa_m > SOTUV_RADIUS_M }));
  kunYopish.forEach(k => {
    if (k.vaqt) v.push({ tur: 'kun_yopish', vaqt: k.vaqt, naqd: k.naqd_elon === null ? null : n(k.naqd_elon) });
    if (k.ochish_vaqt) v.push({ tur: 'kun_ochildi', vaqt: k.ochish_vaqt, soni: +k.ochish_soni || 1 });
  });
  tashriflar.forEach(t => v.push({ tur: t.natija === 'ochiq' ? 'mijozda' : 'sotmaslik', vaqt: t.vaqt, mijoz: t.mijoz_nomi,
    sabab: t.sabab || null, ochiq: !t.checkout_vaqt }));
  tolovlar.forEach(k => v.push({ tur: 'tolov', vaqt: k.vaqt, mijoz: k.mijoz_nomi, summa: n(k.summa) }));
  inkas.forEach(i => v.push({ tur: 'kassa', vaqt: i.vaqt, summa: n(i.topshirilgan_summa), kutilgan: n(i.yigilgan_summa), holat: i.holat }));
  return v.filter(x => x.vaqt).sort((a, b) => new Date(a.vaqt) - new Date(b.vaqt));
}

/* ── Ertalabki yuklash taklifi ─────────────────────────────
   Oxirgi 14 kundagi o'rtacha kunlik sotuv + 20% zaxira − mashinadagi qoldiq,
   blokka yaxlitlanadi, asosiy ombordagi qoldiq bilan cheklanadi. */
async function tavsiyaHisobla(agent) {
  const ombor = agentOmbori(agent.fullname);
  // Chegaralar mahalliy kun bo'yicha (CURDATE() MySQL sessiya zonasiga bog'liq — UTC bo'lishi mumkin)
  const bugunKun = bugun();
  const dan = new Date(`${bugunKun}T00:00:00`); dan.setDate(dan.getDate() - 14);
  const danKun = kunKey(dan);
  const [sotuvlar, [ishKun], oxirgi] = await Promise.all([
    sequelize.query(`SELECT tovar_id, SUM(-donada) sotildi FROM tovar_register
       WHERE ombor = :ombor AND manba_tur = 'sotuv' AND sana >= :danVaqt AND sana < :bugunVaqt
       GROUP BY tovar_id`, { replacements: { ombor, danVaqt: dan, bugunVaqt: new Date(`${bugunKun}T00:00:00`) }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`SELECT COUNT(DISTINCT sana) n FROM avtolavka_hujjat
       WHERE agent_id = :id AND tur = 'yuklash' AND holat = 'tasdiqlangan'
         AND sana >= :danKun AND sana < :bugunKun`,
      { replacements: { id: agent.id, danKun, bugunKun }, type: sequelize.QueryTypes.SELECT }),
    AvtolavkaHujjatModel.findOne({
      where: { agent_id: agent.id, tur: 'yuklash', holat: 'tasdiqlangan' },
      include: INCLUDE, order: [['sana', 'DESC'], ['id', 'DESC']],
    }),
  ]);
  const kunSoni = Math.max(1, +ishKun.n || 0);
  const manba = sotuvlar.length ? 'ortacha' : (oxirgi ? 'oxirgi' : 'yoq');
  const ortacha = {};
  if (manba === 'ortacha') sotuvlar.forEach(r => { ortacha[r.tovar_id] = n(r.sotildi) / kunSoni; });
  else if (oxirgi) oxirgi.qatorlar.forEach(q => { ortacha[q.tovar_id] = n(q.dona) / 1.2; });

  const ids = Object.keys(ortacha).map(Number);
  const [tovarlar, asosiy, mashina, narx] = await Promise.all([
    ids.length ? TovarModel.findAll({ where: { id: { [Op.in]: ids } }, attributes: ['id', 'nomi', 'turkum', 'blokdagi_soni'], raw: true }) : [],
    yuklashQoldigi(), omborQoldiq(ombor), narxMap(ids),
  ]);
  const qatorlar = tovarlar.map(t => {
    const bs = Math.max(1, +t.blokdagi_soni || 1);
    const bor = Math.max(0, mashina[t.id]?.qoldiq || 0);
    const omborda = Math.max(0, asosiy[t.id]?.qoldiq || 0);
    const kerak = Math.ceil((ortacha[t.id] * 1.2) / bs) * bs;
    const tavsiya = Math.min(Math.max(0, Math.ceil((kerak - bor) / bs) * bs), Math.floor(omborda / bs) * bs);
    return {
      tovar_id: t.id, tovar_nomi: t.nomi, turkum: t.turkum, blokdagi_soni: bs,
      ortacha: +ortacha[t.id].toFixed(1), mashinada: bor, omborda, tavsiya,
      narx: narx[t.id]?.chakana_narx || 0,
    };
  }).filter(r => r.tavsiya > 0 || r.mashinada > 0).sort((a, b) => b.ortacha - a.ortacha);

  return {
    manba, ish_kunlari: kunSoni,
    oxirgi: oxirgi ? { raqam: oxirgi.raqam, sana: oxirgi.sana } : null,
    qatorlar,
    jami: {
      dona: qatorlar.reduce((s, r) => s + r.tavsiya, 0),
      summa: +qatorlar.reduce((s, r) => s + r.tavsiya * r.narx, 0).toFixed(2),
    },
  };
}

module.exports = {
  BRAK_OMBOR, PREFIKS, INCLUDE, EPS, bugun, sanaMi, n, lokalKun,
  raqamYarat, avtolavkaAgent, narxMap, omborQoldiq, yuklashQoldigi, regYozuv, qatorlarniTayyorla,
  yuklashniTasdiqla, kunHisobla, kunniQaytaOch, kunVoqealari, tavsiyaHisobla, SOTUV_RADIUS_M,
};
