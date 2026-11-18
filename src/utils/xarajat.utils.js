/**
 * Xarajat toifalari: kod → { nomi, ikon, faol }. Kassa sahifasi, foyda-zarar hisoboti va
 * Kunlik xarajatlar sahifasi toifa nomini shu yerdan oladi (foydalanuvchi nomini o'zgartirsa — hamma joyda o'zgaradi).
 * 'boshqa_chiqim' — Kassa sahifasidagi eski "Boshqa chiqim", "Boshqa xarajat" bilan bir xil.
 */
const sequelize = require('../db/db-sequelize');

async function xarajatTurlari() {
  const rows = await sequelize.query('SELECT id, kod, nomi, ikon, tartib, faol FROM xarajat_turi ORDER BY tartib, id',
    { type: sequelize.QueryTypes.SELECT }).catch(() => []);
  const map = new Map(rows.map(r => [r.kod, { ...r, faol: !!r.faol }]));
  if (!map.has('boshqa_chiqim')) {
    const b = map.get('xarajat');
    map.set('boshqa_chiqim', { id: null, kod: 'boshqa_chiqim', nomi: b ? b.nomi : 'Boshqa xarajat', ikon: b ? b.ikon : 'boshqa', tartib: 999, faol: false, alias: true });
  }
  return map;
}

module.exports = { xarajatTurlari };
