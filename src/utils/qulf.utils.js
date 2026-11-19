/**
 * QULF (row lock) yordamchilari — pul va tovar harakatlarida bir xil so'rov
 * parallel (ikki marta bosish, oflayn qayta urinish) kelganda effekt ikki marta
 * qo'llanmasligi uchun.
 *
 * Qoida: holatni o'zgartiruvchi har bir amal hujjatni TRANZAKSIYA ICHIDA
 * `SELECT ... FOR UPDATE` bilan qayta o'qiydi va holatni shu yangi nusxada
 * tekshiradi. Ikkinchi so'rov birinchisi commit bo'lguncha kutadi, so'ng
 * yangilangan holatni ko'rib rad etiladi.
 */
const sequelize = require('../db/db-sequelize');

/** Hujjatni tranzaksiya ichida qulflab o'qiydi (topilmasa null). */
async function qulflabOl(Model, id, transaction, options = {}) {
  if (!transaction) throw new Error('qulflabOl: transaction kerak');
  return Model.findByPk(id, { ...options, transaction, lock: transaction.LOCK.UPDATE });
}

/**
 * Tovar qatorlarini (tovar jadvali) id tartibida qulflaydi. Zaxira/qoldiq
 * tekshiruvidan OLDIN chaqiriladi: shu tovarlar bo'yicha parallel buyurtma,
 * yuklash yoki chiqimlar navbatma-navbat bajariladi va qoldiq minusga tushmaydi.
 * Tartib (ORDER BY id) bir xil bo'lgani uchun deadlock bo'lmaydi.
 */
async function tovarlarniQulfla(tovarIds, transaction) {
  if (!transaction) throw new Error('tovarlarniQulfla: transaction kerak');
  const ids = [...new Set((tovarIds || []).map(Number).filter(Number.isFinite))].sort((a, b) => a - b);
  if (!ids.length) return;
  await sequelize.query('SELECT id FROM tovar WHERE id IN (:ids) ORDER BY id FOR UPDATE', {
    replacements: { ids }, transaction, type: sequelize.QueryTypes.SELECT,
  });
}

/**
 * Hujjat raqami uchun keyingi tartib raqami (masalan AR-2026 → 43).
 * `hujjat_raqam` jadvalidagi hisoblagich tranzaksiya ichida yangilanadi —
 * parallel so'rovlar bir xil raqam olmaydi, o'chirilgan hujjat raqami qayta
 * berilmaydi. Hisoblagich birinchi marta mavjud hujjatlarning eng katta
 * raqamidan boshlanadi (`boshlangich` funksiyasi).
 */
async function keyingiTartib(kalit, boshlangich, transaction) {
  const opts = { replacements: { kalit }, transaction };
  const [bor] = await sequelize.query('SELECT oxirgi FROM hujjat_raqam WHERE kalit = :kalit', {
    ...opts, type: sequelize.QueryTypes.SELECT,
  });
  if (!bor) {
    const b = Number(await boshlangich()) || 0;
    await sequelize.query('INSERT IGNORE INTO hujjat_raqam (kalit, oxirgi) VALUES (:kalit, :b)', {
      replacements: { kalit, b }, transaction,
    });
  }
  await sequelize.query('UPDATE hujjat_raqam SET oxirgi = oxirgi + 1 WHERE kalit = :kalit', opts);
  const [row] = await sequelize.query('SELECT oxirgi FROM hujjat_raqam WHERE kalit = :kalit', {
    ...opts, type: sequelize.QueryTypes.SELECT,
  });
  return Number(row.oxirgi);
}

/** `jadval` dagi `PREFIKS-...-NNNN` ko'rinishidagi raqamlarning eng kattasi. */
async function maksRaqam(jadval, prefiks, transaction, qoshimchaShart = '', replacements = {}) {
  const [r] = await sequelize.query(
    `SELECT MAX(CAST(SUBSTRING_INDEX(raqam, '-', -1) AS UNSIGNED)) AS m
       FROM \`${jadval}\` WHERE raqam LIKE :pat ${qoshimchaShart}`,
    { replacements: { ...replacements, pat: `${prefiks}-%` }, transaction, type: sequelize.QueryTypes.SELECT },
  );
  return Number(r && r.m) || 0;
}

module.exports = { qulflabOl, tovarlarniQulfla, keyingiTartib, maksRaqam };
