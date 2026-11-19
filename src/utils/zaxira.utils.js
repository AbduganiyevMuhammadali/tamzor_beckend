/**
 * ZAXIRA — buyurtma (zakaz) faqat skladda BOR tovardan beriladi.
 *
 * Mavjud qoldiq = buyurtma omboridagi jismoniy qoldiq
 *               − hali ombordan chiqmagan (yangi / tasdiqlangan / yig'ilmoqda)
 *                 buyurtmalarga band qilingan miqdor.
 * Tovar ombordan "yo'lda" bosqichida chiqim bo'ladi (web changeHolat), shu
 * paytgacha u boshqa buyurtmalar uchun band hisoblanadi. Avtolavka mashinalari va
 * brak ombori buyurtma uchun qoldiqqa kirmaydi — faqat buyurtmaning o'z ombori.
 *
 * Ishlatiladi: mobil agent zakazi (getProductSell / saveSell), web "Yangi ariza",
 * ariza tahriri va web forma uchun tovar ro'yxati.
 */
const sequelize = require('../db/db-sequelize');
const HttpException = require('./HttpException.utils');
const { ASOSIY_OMBOR } = require('./ombor.utils');
const { tovarlarniQulfla } = require('./qulf.utils');

const OCHIQ_HOLAT = ['yangi', 'tasdiqlangan', 'yigilmoqda'];
const n = v => parseFloat(v) || 0;

/**
 * @returns Map<tovar_id, { fizik, band, mavjud }>
 * istisnoArizaId — tahrirlanayotgan buyurtmaning o'z bandi hisobga olinmaydi.
 */
async function mavjudQoldiq({ tovarIds = null, ombor = ASOSIY_OMBOR, istisnoArizaId = null, transaction } = {}) {
  const ids = tovarIds ? [...new Set(tovarIds.map(Number).filter(Boolean))] : null;
  if (ids && !ids.length) return new Map();
  const tovarSharti = ids ? 'AND tovar_id IN (:ids)' : '';
  const [fizik, band] = await Promise.all([
    sequelize.query(`
      SELECT tovar_id, SUM(donada) AS q FROM tovar_register
      WHERE ombor = :ombor ${tovarSharti} GROUP BY tovar_id`,
    { replacements: { ombor, ids }, type: sequelize.QueryTypes.SELECT, transaction }),
    sequelize.query(`
      SELECT q.tovar_id, SUM(q.jami_dona) AS q
      FROM ariza_qator q JOIN ariza a ON a.id = q.ariza_id
      WHERE a.turi = 'sotish' AND a.holat IN (:ochiq) AND a.deletedAt IS NULL
        AND COALESCE(a.ombor, :asosiy) = :ombor
        ${istisnoArizaId ? 'AND a.id <> :istisno' : ''}
        ${ids ? 'AND q.tovar_id IN (:ids)' : ''}
      GROUP BY q.tovar_id`,
    { replacements: { ombor, ids, ochiq: OCHIQ_HOLAT, asosiy: ASOSIY_OMBOR, istisno: istisnoArizaId }, type: sequelize.QueryTypes.SELECT, transaction }),
  ]);
  const map = new Map();
  const ol = id => { if (!map.has(id)) map.set(id, { fizik: 0, band: 0, mavjud: 0 }); return map.get(id); };
  fizik.forEach(r => { ol(Number(r.tovar_id)).fizik = n(r.q); });
  band.forEach(r => { ol(Number(r.tovar_id)).band = n(r.q); });
  for (const x of map.values()) x.mavjud = Math.max(0, +(x.fizik - x.band).toFixed(3));
  return map;
}

/**
 * Buyurtma qatorlari mavjud qoldiqqa sig'adimi — sig'masa 400 xato (qaysi tovar,
 * qancha so'raldi, qancha bor). Bir tovar bir necha qatorda bo'lsa — yig'indisi.
 * @param qatorlar [{ tovar_id, tovar_nomi, jami_dona }]
 */
async function zaxiraTekshir(qatorlar, { ombor = ASOSIY_OMBOR, istisnoArizaId = null, transaction } = {}) {
  const kerak = new Map();
  for (const q of qatorlar || []) {
    const id = Number(q.tovar_id);
    if (!id) continue;
    const x = kerak.get(id) || { nomi: q.tovar_nomi || `#${id}`, dona: 0 };
    x.dona += n(q.jami_dona);
    kerak.set(id, x);
  }
  if (!kerak.size) return;
  // Tranzaksiya berilsa — shu tovar qatorlari qulflanadi: bir xil tovarni parallel band
  // qilayotgan buyurtmalar navbatma-navbat tekshiriladi (ikkalasi bir qoldiqni ko'rib
  // sklad minusga tushmasin). Qulf commit/rollback'gacha turadi.
  // MUHIM (InnoDB REPEATABLE READ): tranzaksiyadagi birinchi oddiy SELECT snapshot
  // oladi — eng ishonchlisi chaqiruvchi tovarlarniQulfla'ni tranzaksiya boshida chaqirishi.
  if (transaction) await tovarlarniQulfla([...kerak.keys()], transaction);
  const qoldiq = await mavjudQoldiq({ tovarIds: [...kerak.keys()], ombor, istisnoArizaId, transaction });
  const yetmaydi = [];
  for (const [id, x] of kerak) {
    const q = qoldiq.get(id) || { fizik: 0, band: 0, mavjud: 0 };
    if (x.dona > q.mavjud + 0.001) {
      yetmaydi.push(`"${x.nomi}" — so'raldi ${+x.dona.toFixed(3)}, mavjud ${q.mavjud}${q.band > 0 ? ` (yana ${q.band} tasi boshqa buyurtmalarga band)` : ''}`);
    }
  }
  if (yetmaydi.length) {
    throw new HttpException(400, `Skladda yetarli tovar yo'q: ${yetmaydi.join('; ')}`);
  }
}

module.exports = { mavjudQoldiq, zaxiraTekshir, OCHIQ_HOLAT };
