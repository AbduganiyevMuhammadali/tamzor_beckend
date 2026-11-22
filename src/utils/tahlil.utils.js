/**
 * TAHLIL (hisobotlar) uchun umumiy yordamchilar — barcha hisobotlar bir xil
 * qoidalar bilan hisoblashi uchun bitta joyda:
 *
 *  • Davr: ?dan=YYYY-MM-DD&gacha=YYYY-MM-DD — server (biznes) vaqtidagi kunlar.
 *    Bazada vaqt UTC saqlanadi, kunlarga ajratish CONVERT_TZ bilan.
 *  • Sotuv: turi='sotish', holat='yetkazildi' — sana = yetkazilgan sana.
 *  • Tannarx: tovarning og'irlikli o'rtacha KIRIM (prixod) narxi, davr oxiridan
 *    oldingi 90 kun bo'yicha; yangi kirimi bo'lmasa — butun tarix bo'yicha.
 *    Oddiy AVG(kirim_narx) ishlatilmaydi: qaytarma yozuvlarida kirim_narx = 0
 *    va eski narxlar o'rtachani buzadi.
 *  • Ichki ko'chirish (avtolavka yuklash/qabul, tur o'zgarishi, agentdan agentga) savdo ham, kirim ham emas.
 */
const sequelize = require('../db/db-sequelize');
const HttpException = require('./HttpException.utils');

const ICHKI = ['yuklash', 'qabul'];            // tovar_register.manba_tur — ichki ko'chirish (avtolavka_hujjat)
/* Barcha ichki ko'chirishlar (savdo ham, kirim ham emas): avtolavka yuklash/qabul, tovar turi o'zgarishi
   ('kochirish', manba_id = tovar id) va agentdan agentga ('agent_kochirish', manba_id = agent_kochirish.id) */
const KOCHIRISH_MANBA = [...ICHKI, 'kochirish', 'agent_kochirish'];
const TANNARX_MANBA = ['prixod', 'ishlab_chiqarish'];   // kirim narxi manbai: xarid va o'zimiz ishlab chiqargan mahsulot
const BRAK_OMBOR = 'Brak ombori';
const AGENT_OMBOR = 'Agent: ';                 // avtolavka mashinasi ombori prefiksi

function tzOffset() {
  const m = -new Date().getTimezoneOffset();
  const a = Math.abs(m);
  return `${m >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
const n = v => Number(v) || 0;
const yax = v => Math.round(n(v));
// Miqdor (kg) — tarozi kasri 3 xonagacha saqlanadi, pul kabi butunga yaxlitlanmaydi
const miq = v => Math.round(n(v) * 1000) / 1000;
const foiz = (a, b) => (n(b) ? +((n(a) / n(b)) * 100).toFixed(1) : 0);
const pad = v => String(v).padStart(2, '0');
const kunKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const KUN_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Qat'iy YYYY-MM-DD va haqiqiy kalendar sanasi (2026-02-31, 2026-13-01 emas) */
function sanaTogrimi(v) {
  if (typeof v !== 'string' || !KUN_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}
const MAX_DAVR_KUN = 366;

/**
 * So'rovdagi davr: chegaralar, kunlar soni, guruhlash qadami va oldingi teng davr.
 * Berilgan, lekin noto'g'ri sana (format yoki kalendar) → 400; davr 366 kundan oshsa → 400.
 */
function davr(q = {}, standartKun = 30) {
  const tekshir = (v, nomi) => {
    if (v === undefined || v === null || v === '') return null;
    if (!sanaTogrimi(v)) throw new HttpException(400, `${nomi} YYYY-MM-DD formatda bo'lishi kerak`);
    return v;
  };
  const bugun = new Date();
  const gacha = tekshir(q.gacha, 'gacha') || kunKey(bugun);
  const d0 = new Date(bugun); d0.setDate(d0.getDate() - (standartKun - 1));
  let dan = tekshir(q.dan, 'dan') || kunKey(d0);
  if (dan > gacha) dan = gacha;
  if ((new Date(`${gacha}T00:00:00`) - new Date(`${dan}T00:00:00`)) / 86400000 + 1 > MAX_DAVR_KUN) {
    throw new HttpException(400, `Davr ${MAX_DAVR_KUN} kundan oshmasligi kerak`);
  }

  const from = new Date(`${dan}T00:00:00`);
  const to   = new Date(`${gacha}T23:59:59.999`);
  const kunlar = Math.round((new Date(`${gacha}T00:00:00`) - from) / 86400000) + 1;
  const pTo   = new Date(from.getTime() - 1);
  const pFrom = new Date(from); pFrom.setDate(pFrom.getDate() - kunlar);
  const guruh = kunlar <= 45 ? 'kun' : kunlar <= 210 ? 'hafta' : 'oy';
  return { dan, gacha, from, to, kunlar, guruh, pFrom, pTo, tz: tzOffset() };
}

/** SQL ifoda: ustunni guruh kalitiga aylantiradi (kun / hafta boshi / oy) */
function guruhSql(ustun, guruh) {
  const lokal = `CONVERT_TZ(${ustun}, '+00:00', :tz)`;
  if (guruh === 'oy') return `DATE_FORMAT(${lokal}, '%Y-%m')`;
  if (guruh === 'hafta') return `DATE_FORMAT(DATE_SUB(DATE(${lokal}), INTERVAL WEEKDAY(${lokal}) DAY), '%Y-%m-%d')`;
  return `DATE_FORMAT(${lokal}, '%Y-%m-%d')`;
}

/** Davrdagi barcha guruh kalitlari — grafik uzilmasligi uchun bo'sh kunlar ham */
function guruhKalitlari(D) {
  const r = [];
  const d = new Date(D.from);
  if (D.guruh === 'oy') {
    d.setDate(1);
    while (d <= D.to) { r.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`); d.setMonth(d.getMonth() + 1); }
  } else if (D.guruh === 'hafta') {
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    while (d <= D.to) { r.push(kunKey(d)); d.setDate(d.getDate() + 7); }
  } else {
    while (d <= D.to) { r.push(kunKey(d)); d.setDate(d.getDate() + 1); }
  }
  return r;
}

/**
 * Tovar → tannarx (1 dona) xaritasi. gacha — qaysi sanagacha bo'lgan kirimlar
 * hisobga olinadi (davr oxiri). Natija: { [tovar_id]: narx }.
 */
/* Bekor qilingan ishlab chiqarish partiyasining mahsulot kirimi o'rtacha tannarxga kirmaydi */
const BEKOR_EMAS = `NOT (manba_tur = 'ishlab_chiqarish' AND EXISTS (SELECT 1 FROM ishlab_chiqarish ic WHERE ic.id = manba_id AND ic.holat = 'bekor'))`;

async function tannarxXaritasi(gacha = new Date()) {
  const dan90 = new Date(gacha.getTime() - 90 * 86400000);
  const [yaqin, tarix, zaxira] = await Promise.all([
    sequelize.query(`
      SELECT tovar_id, SUM(summa) / NULLIF(SUM(donada), 0) AS narx
      FROM tovar_register
      WHERE tur = 'kirim' AND manba_tur IN (:manba) AND donada > 0 AND sana BETWEEN :dan AND :gacha AND ${BEKOR_EMAS}
      GROUP BY tovar_id`, { replacements: { dan: dan90, gacha, manba: TANNARX_MANBA }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT tovar_id, SUM(summa) / NULLIF(SUM(donada), 0) AS narx
      FROM tovar_register
      WHERE tur = 'kirim' AND manba_tur IN (:manba) AND donada > 0 AND sana <= :gacha AND ${BEKOR_EMAS}
      GROUP BY tovar_id`, { replacements: { gacha, manba: TANNARX_MANBA }, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT tovar_id, AVG(kirim_narx) AS narx
      FROM tovar_register WHERE kirim_narx > 0 GROUP BY tovar_id`, { type: sequelize.QueryTypes.SELECT }),
  ]);
  const m = {};
  for (const set of [zaxira, tarix, yaqin]) for (const r of set) if (Number(r.narx) > 0) m[r.tovar_id] = Number(r.narx);
  return m;
}

/**
 * Yetkazilgan sotuvlar qatorlari (davr ichida) — tushum va tannarx shu yerdan.
 * Bitta so'rov: har qator ariza ma'lumoti bilan.
 */
async function sotuvQatorlari(from, to, { agent_id = null } = {}) {
  return sequelize.query(`
    SELECT a.id AS ariza_id, a.agent_id, a.agent_nomi, a.mijoz_id, a.mijoz_nomi, a.tolov_turi, a.manba,
           a.jami_summa, COALESCE(a.yetkazilgan_sana, a.createdAt) AS sana,
           q.tovar_id, q.tovar_nomi, q.turkum, q.jami_dona, q.summa
    FROM ariza a
    JOIN ariza_qator q ON q.ariza_id = a.id
    WHERE a.turi = 'sotish' AND a.holat = 'yetkazildi' AND a.deletedAt IS NULL
      AND COALESCE(a.yetkazilgan_sana, a.createdAt) BETWEEN :from AND :to
      ${agent_id ? 'AND a.agent_id = :agent_id' : ''}`,
    { replacements: { from, to, agent_id }, type: sequelize.QueryTypes.SELECT });
}

/** Qabul qilingan qaytarishlar (mijozdan qaytgan tovar) — tushumni kamaytiradi */
async function qaytarishQatorlari(from, to, { agent_id = null } = {}) {
  return sequelize.query(`
    SELECT a.id AS ariza_id, a.agent_id, a.mijoz_id, q.tovar_id, q.turkum,
           COALESCE(NULLIF(q.qabul_dona, 0), q.jami_dona) AS jami_dona, q.summa, q.jami_dona AS asl_dona
    FROM ariza a
    JOIN ariza_qator q ON q.ariza_id = a.id
    WHERE a.turi = 'qaytarish' AND a.holat = 'qabul_qilindi' AND a.deletedAt IS NULL
      AND COALESCE(a.qabul_sana, a.updatedAt) BETWEEN :from AND :to
      ${agent_id ? 'AND a.agent_id = :agent_id' : ''}`,
    { replacements: { from, to, agent_id }, type: sequelize.QueryTypes.SELECT });
}

/** Yetkazilgan sotuv: tushum, qaytarish, tannarx, foyda (+ qatorlar keyingi kesimlar uchun) */
async function sotuvTahlil(from, to, opts = {}) {
  const [qatorlar, qaytQ, narx] = await Promise.all([
    sotuvQatorlari(from, to, opts), qaytarishQatorlari(from, to, opts), tannarxXaritasi(to),
  ]);
  const tannarxOf = q => n(q.jami_dona) * (narx[q.tovar_id] || 0);
  let tushum = 0, tannarx = 0, dona = 0;
  const arizalar = new Set(), mijozlar = new Set();
  for (const q of qatorlar) {
    tushum += n(q.summa); tannarx += tannarxOf(q); dona += n(q.jami_dona);
    arizalar.add(q.ariza_id); if (q.mijoz_id) mijozlar.add(q.mijoz_id);
  }
  let qaytarish = 0, qaytTannarx = 0;
  for (const q of qaytQ) {
    const ulush = n(q.asl_dona) ? n(q.jami_dona) / n(q.asl_dona) : 1;
    qaytarish += n(q.summa) * ulush; qaytTannarx += tannarxOf(q);
  }
  const sofTushum = tushum - qaytarish;
  const sofTannarx = tannarx - qaytTannarx;
  const foyda = sofTushum - sofTannarx;
  return {
    qatorlar, qaytQ, narx, tannarxOf,
    jami: {
      tushum: yax(tushum), qaytarish: yax(qaytarish), sof_tushum: yax(sofTushum),
      tannarx: yax(sofTannarx), foyda: yax(foyda), marja: foiz(foyda, sofTushum),
      buyurtma: arizalar.size, mijoz: mijozlar.size, dona: yax(dona),
      ortacha_chek: arizalar.size ? yax(tushum / arizalar.size) : 0,
    },
  };
}

/** To'lov turini bir xil kalitga keltirish */
function tolovKalit(t) {
  const s = String(t || '').toLowerCase();
  if (['naqt', 'naqd', 'cash', 'сум'].includes(s)) return 'naqd';
  if (['plastik', 'karta', 'bank', 'perechisleniye', 'naqtsiz', 'naqdsiz'].includes(s)) return 'plastik';
  if (['qarz', 'nasiya', 'muddatli'].includes(s)) return 'qarz';
  return 'nomalum';
}
const TOLOV_NOM = { naqd: 'Naqd', plastik: 'Plastik / bank', qarz: 'Qarzga (nasiya)', nomalum: "Ko'rsatilmagan" };


module.exports = {
  ICHKI, KOCHIRISH_MANBA, TANNARX_MANBA, BRAK_OMBOR, AGENT_OMBOR,
  tzOffset, kunKey, sanaTogrimi, davr, guruhSql, guruhKalitlari,
  tannarxXaritasi, sotuvQatorlari, qaytarishQatorlari, sotuvTahlil,
  tolovKalit, TOLOV_NOM, n, yax, miq, foiz,
};
