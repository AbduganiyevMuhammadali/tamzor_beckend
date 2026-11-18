const SozlamaModel = require('../models/sozlama.model');

const DEFAULT_KURS = 12650;

// Joriy dollar kursini qaytaradi (sozlama jadvalidan, topilmasa default).
async function joriyKurs() {
  const row = await SozlamaModel.findByPk('dollar_kurs');
  const kurs = parseFloat(row?.qiymat);
  return kurs > 0 ? kurs : DEFAULT_KURS;
}

module.exports = { joriyKurs, DEFAULT_KURS };
