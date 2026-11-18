/**
 * XAVFSIZLIK — o'chirish paroli.
 * Tasdiqlangan hujjatni (hozircha: kirim/prixod) o'chirish foydalanuvchi parolidan alohida,
 * umumiy "o'chirish paroli" bilan tasdiqlanadi (foydalanuvchi so'rovi 2026-11-03: "parolni 123
 * qilib qo'y"). Parol `sozlama` jadvalida `ochirish_parol` kalitida, standart qiymati 123;
 * Sozlamalar → Xavfsizlik (GET/PATCH /sozlama/xavfsizlik, Admin) orqali o'zgartiriladi.
 */
const SozlamaModel = require('../models/sozlama.model');
const HttpException = require('./HttpException.utils');

const KALIT = 'ochirish_parol';
const STANDART = '123';

async function ochirishParoli() {
  const r = await SozlamaModel.findByPk(KALIT);
  return r && r.qiymat ? String(r.qiymat) : STANDART;
}

/** Noto'g'ri bo'lsa 403 */
async function ochirishParoliTekshir(parol) {
  const kerak = await ochirishParoli();
  if (String(parol ?? '') !== kerak) throw new HttpException(403, "O'chirish paroli noto'g'ri");
}

async function ochirishParoliniYoz(parol) {
  const p = String(parol ?? '').trim();
  if (p.length < 3 || p.length > 64) throw new HttpException(400, "O'chirish paroli 3 tadan 64 tagacha belgi bo'lsin");
  const [row] = await SozlamaModel.findOrCreate({
    where: { kalit: KALIT },
    defaults: { qiymat: p, izoh: "Tasdiqlangan hujjatlarni o'chirish paroli (Kirim)" },
  });
  await row.update({ qiymat: p });
  return p;
}

module.exports = { ochirishParoli, ochirishParoliTekshir, ochirishParoliniYoz, OCHIRISH_PAROL_STANDART: STANDART };
