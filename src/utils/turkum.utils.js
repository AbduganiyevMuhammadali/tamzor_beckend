/**
 * TURKUM — tovar turkumi bitta joyda (turkum jadvali), nomi esa tovar va hujjat
 * qatorlariga nusxalanadi: ariza_qator, prixod_qator, tovar_register, avtolavka_qator,
 * ishlab_chiqarish_qator (hisobotlar, dashboard va mobil ilova nom bo'yicha ishlaydi).
 * Shuning uchun:
 *   - tovarga turkum berilganda `turkum_id` ham, `turkum` (nom) ham yoziladi (turkumAniqla);
 *   - turkum qayta nomlansa — tovar va barcha hujjat qatorlaridagi nom ham yangilanadi
 *     (turkumNominiYangila), aks holda eski hujjatlar hisobotda alohida guruh bo'lib qolardi.
 */
const sequelize = require('../db/db-sequelize');
const TurkumModel = require('../models/turkum.model');
const TovarModel = require('../models/tovar.model');
const HttpException = require('./HttpException.utils');

const SNAPSHOT_JADVALLAR = ['ariza_qator', 'prixod_qator', 'tovar_register', 'avtolavka_qator', 'ishlab_chiqarish_qator'];

/* Nom bo'yicha topish (katta-kichik harf farqsiz) */
async function nomBoyicha(nomi, transaction) {
  return TurkumModel.findOne({
    where: sequelize.where(sequelize.fn('LOWER', sequelize.col('nomi')), String(nomi).trim().toLowerCase()),
    transaction,
  });
}

/* { turkum_id } yoki { turkum: nom } → { turkum_id, turkum }.
   Nom berilsa-yu jadvalda bo'lmasa — yangi turkum ochiladi (ommaviy qo'shish, prixoddagi
   "yangi tovar" oynasi va importlar shunchaki nom yuboradi). Bo'sh → ikkalasi null. */
async function turkumAniqla({ turkum_id, turkum } = {}, transaction) {
  if (turkum_id) {
    const t = await TurkumModel.findByPk(turkum_id, { transaction });
    if (!t) throw new HttpException(400, 'Turkum topilmadi');
    return { turkum_id: t.id, turkum: t.nomi };
  }
  const nomi = String(turkum || '').trim();
  if (!nomi) return { turkum_id: null, turkum: null };
  let t = await nomBoyicha(nomi, transaction);
  if (!t) {
    const max = await TurkumModel.max('tartib', { transaction });
    t = await TurkumModel.create({ nomi: nomi.slice(0, 80), tartib: (Number(max) || 0) + 1 }, { transaction });
  }
  return { turkum_id: t.id, turkum: t.nomi };
}

/* Qayta nomlash: tovar kartalari + hujjat qatorlaridagi nom (eski nom bo'yicha) */
async function turkumNominiYangila(turkum, yangiNomi, transaction) {
  const eski = turkum.nomi;
  if (eski === yangiNomi) return;
  await TovarModel.update({ turkum: yangiNomi }, { where: { turkum_id: turkum.id }, transaction });
  for (const jadval of SNAPSHOT_JADVALLAR) {
    await sequelize.query(`UPDATE \`${jadval}\` SET turkum = :yangi WHERE turkum = :eski`,
      { replacements: { yangi: yangiNomi, eski }, transaction });
  }
}

/* Tovarning turkumi o'zgarganda (biriktirish / ajratish / ko'chirish / kartada tanlash) —
   uning barcha hujjat qatorlaridagi nom ham yangilanadi: turkum tovarning xususiyati,
   tarix unga ergashadi (hisobotlar, mobil mashina ro'yxati nom bo'yicha guruhlaydi). */
async function tovarTurkuminiTarqat(tovarIdlar, nomi, transaction) {
  const ids = (Array.isArray(tovarIdlar) ? tovarIdlar : [tovarIdlar]).map(Number).filter(Boolean);
  if (!ids.length) return;
  for (const jadval of SNAPSHOT_JADVALLAR) {
    await sequelize.query(`UPDATE \`${jadval}\` SET turkum = :nomi WHERE tovar_id IN (:ids)`,
      { replacements: { nomi: nomi || null, ids }, transaction });
  }
}

/* Hujjat qatorlariga (ariza_qator, tovar_register …) yozishdan OLDIN: turkumi bo'sh qatorga
   tovarning joriy turkumini qo'yadi. Mobil sotuv va web buyurtma formasi turkum yubormaydi —
   2026-11-01 gacha qatorlar turkumsiz yozilib, chek guruhlash va yig'ma ro'yxat "Turkumsiz"
   ko'rsatar edi (migratsiya 20261101000001 eskilarini to'ldirgan). Massivning o'zini qaytaradi. */
async function turkumToldir(qatorlar, transaction) {
  const ids = [...new Set((qatorlar || []).filter(q => q && !q.turkum && q.tovar_id).map(q => Number(q.tovar_id)).filter(Boolean))];
  if (!ids.length) return qatorlar;
  const tovarlar = await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'turkum'], raw: true, transaction });
  const map = new Map(tovarlar.map(t => [t.id, t.turkum || null]));
  for (const q of qatorlar) if (q && !q.turkum && q.tovar_id) q.turkum = map.get(Number(q.tovar_id)) || null;
  return qatorlar;
}

module.exports = { turkumAniqla, turkumNominiYangila, tovarTurkuminiTarqat, turkumToldir, nomBoyicha, SNAPSHOT_JADVALLAR };
