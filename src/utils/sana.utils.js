/**
 * So'rov (query) sanalarini tekshirish — ro'yxat filtrlari uchun.
 * Noto'g'ri sana jim "Invalid date" bo'lib bo'sh/xato natija bermasin — 400 qaytadi.
 */
const HttpException = require('./HttpException.utils');
const { sanaTogrimi } = require('./tahlil.utils');

/** 'YYYY-MM-DD' (ixtiyoriy vaqt qismi kesiladi) yoki null; noto'g'ri bo'lsa 400 */
function kunParam(v, nom = 'sana') {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).slice(0, 10);
  if (!sanaTogrimi(s)) throw new HttpException(400, `${nom} noto'g'ri sana (YYYY-MM-DD)`);
  return s;
}

/** { from, to } — ikkalasi ham tekshiriladi, from > to bo'lsa 400 */
function kunOraligi(q, dan = 'date_from', gacha = 'date_to') {
  const from = kunParam(q[dan], dan);
  const to = kunParam(q[gacha], gacha);
  if (from && to && from > to) throw new HttpException(400, `${dan} ${gacha} dan katta bo'lmasligi kerak`);
  return { from, to };
}

/** Mahalliy (Toshkent) kun boshi / oxiri — DATE (datetime) ustunlar uchun */
const kunBoshi = (s) => new Date(`${s}T00:00:00`);
const kunOxiri = (s) => new Date(`${s}T23:59:59.999`);

module.exports = { kunParam, kunOraligi, kunBoshi, kunOxiri };
