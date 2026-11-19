/**
 * OMBORLAR ORASIDA KO'CHIRISH — xom ashyo va savdo tovari aralashmasligi uchun.
 *
 * Qoida: tovar o'z TURI omborida turadi (ombor.utils turOmbori):
 *   xom ashyo    → "Xom ashyo ombori" (sotilmaydi, ishlab chiqarishga shu yerdan beriladi)
 *   savdo tovari → asosiy sklad (zakaz, avtolavka yuklash shu yerdan)
 *
 * Tovar turi o'zgarganda qoldig'i yangi turi omboriga ko'chadi. Ko'chirish — ikki register
 * yozuvi tannarxda (chiqim + kirim, manba_tur 'kochirish', manba_id = tovar id): jami ombor
 * qiymati o'zgarmaydi, xarid ham, sotuv ham emas (tahlil.utils ICHKI).
 */
const sequelize = require('../db/db-sequelize');
const TovarRegisterModel = require('../models/tovar_register.model');
const HttpException = require('./HttpException.utils');
const { ASOSIY_OMBOR, XOM_ASHYO_OMBOR, turOmbori, omborNomi } = require('./ombor.utils');
const { mavjudQoldiq } = require('./zaxira.utils');
const { tannarxXaritasi } = require('./tahlil.utils');
const { tovarlarniQulfla } = require('./qulf.utils');

const MANBA = 'kochirish';
const EPS = 0.0005;
const n = v => parseFloat(v) || 0;
const yax = (v, d = 2) => Math.round(n(v) * 10 ** d) / 10 ** d;

/**
 * Tovarning `dan` omboridagi qoldig'ini `ga` omboriga ko'chiradi. Ko'chgan miqdorni qaytaradi.
 * band — ochiq buyurtmalarga band qilingan qism bilan nima qilinadi:
 *   'xato'    — band bo'lsa ko'chirilmaydi, 400 (tur o'zgartirish: avval buyurtmalar yopilsin)
 *   'qoldir'  — band qism joyida qoladi, faqat erkin qismi ko'chadi (tartiblash)
 */
async function qoldiqniKochir({ tovar, dan, ga, transaction, band = 'xato', narx = null }) {
  if (!dan || !ga || dan === ga) return 0;
  // Qoldiq o'qilishidan OLDIN tovar qatori qulflanadi — parallel yuklash/sotuv/chiqim shu tovar
  // bo'yicha kutadi, ko'chirilgan miqdor eskirgan qoldiqdan hisoblanmaydi (ombor minusga tushmaydi)
  if (transaction) await tovarlarniQulfla([tovar.id], transaction);
  const m = (await mavjudQoldiq({ tovarIds: [tovar.id], ombor: dan, transaction })).get(Number(tovar.id)) || { fizik: 0, band: 0, mavjud: 0 };
  if (band === 'xato' && m.band > EPS) {
    throw new HttpException(400, `"${tovar.nomi}" ${omborNomi(dan)}da ochiq buyurtmalarga band qilingan (${yax(m.band, 3)}). `
      + 'Avval o\'sha buyurtmalarni yetkazing yoki bekor qiling, keyin turini o\'zgartiring.');
  }
  const dona = yax(band === 'qoldir' ? m.mavjud : m.fizik, 3);
  if (dona <= EPS) return 0;
  const nx = yax(n((narx || await tannarxXaritasi(new Date()))[tovar.id]));
  const summa = yax(dona * nx);
  const asos = {
    tovar_id: tovar.id, tovar_nomi: tovar.nomi, turkum: tovar.turkum || null, manba_tur: MANBA, manba_id: tovar.id,
    bloklarda: 0, qutilarda: 0, hajm: 0, kirim_narx: nx, sana: new Date(),
  };
  await TovarRegisterModel.bulkCreate([
    { ...asos, ombor: dan, tur: 'chiqim', donada: -dona, summa: -summa },
    { ...asos, ombor: ga, tur: 'kirim', donada: dona, summa },
  ], { transaction });
  return dona;
}

/** Tovar turi o'zgardi — qoldig'i eski turi omboridan yangisiga o'tadi */
async function turgaKochir(tovar, eskiTuri, transaction) {
  const dan = turOmbori(eskiTuri);
  const ga = turOmbori(tovar.turi);
  const dona = await qoldiqniKochir({ tovar, dan, ga, transaction });
  return { dona, dan: omborNomi(dan), ga: omborNomi(ga) };
}

/** Noto'g'ri omborda turgan qoldiq: asosiy skladdagi xom ashyo va Xom ashyo omboridagi savdo tovari */
async function tartibsizQoldiq({ transaction } = {}) {
  const rows = await sequelize.query(`
    SELECT r.tovar_id, MAX(t.nomi) nomi, MAX(t.turkum) turkum, MAX(t.olchov_birligi) olchov, MAX(t.turi) turi,
           r.ombor, SUM(r.donada) dona
    FROM tovar_register r JOIN tovar t ON t.id = r.tovar_id
    WHERE (t.turi = 'xom_ashyo' AND r.ombor = :asosiy) OR (t.turi = 'tovar' AND r.ombor = :xom)
    GROUP BY r.tovar_id, r.ombor HAVING dona > :eps
    ORDER BY nomi`, { replacements: { asosiy: ASOSIY_OMBOR, xom: XOM_ASHYO_OMBOR, eps: EPS }, type: sequelize.QueryTypes.SELECT, transaction });
  return rows.map(r => ({
    tovar_id: r.tovar_id, nomi: r.nomi, turkum: r.turkum || null, olchov: r.olchov || 'kg', turi: r.turi,
    dona: yax(r.dona, 3), dan: r.ombor, ga: turOmbori(r.turi), dan_nomi: omborNomi(r.ombor), ga_nomi: omborNomi(turOmbori(r.turi)),
  }));
}

/** Noto'g'ri omborda turgan erkin qoldiqni turi omboriga ko'chiradi (band qismi joyida qoladi) */
async function tartibla({ transaction } = {}) {
  // Nomzodlar ro'yxati tranzaksiyadan TASHQARIDA o'qiladi: aks holda (REPEATABLE READ) snapshot
  // qulfdan oldin olinib, keyingi qoldiq o'qishlari eskirgan bo'lardi. Avval hamma tovar qatori
  // qulflanadi, so'ng har biri qoldiqniKochir ichida qulf ostida yangidan o'qiladi.
  const royxat = await tartibsizQoldiq(transaction ? {} : { transaction });
  if (!royxat.length) return [];
  if (transaction) await tovarlarniQulfla(royxat.map(r => r.tovar_id), transaction);
  const narx = await tannarxXaritasi(new Date());
  const natija = [];
  for (const r of royxat) {
    const dona = await qoldiqniKochir({ tovar: { id: r.tovar_id, nomi: r.nomi, turkum: r.turkum }, dan: r.dan, ga: r.ga, transaction, band: 'qoldir', narx });
    if (dona > 0) natija.push({ ...r, dona });
  }
  return natija;
}

module.exports = { MANBA_KOCHIRISH: MANBA, qoldiqniKochir, turgaKochir, tartibsizQoldiq, tartibla };
