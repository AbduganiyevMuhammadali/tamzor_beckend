const { keyingiTartib, maksRaqam } = require('./qulf.utils');

// Ariza hujjat raqamini generatsiya qiladi: AR-2026-0001
// Web va mobil controllerlar bir xil formatdan foydalanishi uchun umumiy.
// Raqam `hujjat_raqam` hisoblagichidan olinadi — parallel yaratishda ham takrorlanmaydi.
// transaction berilsa, hisoblagich shu tranzaksiya bilan birga commit/rollback bo'ladi.
async function generateRaqam(transaction) {
  const year = new Date().getFullYear();
  const prefiks = `AR-${year}`;
  const tartib = await keyingiTartib(prefiks, () => maksRaqam('ariza', prefiks, transaction), transaction);
  return `${prefiks}-${String(tartib).padStart(4, '0')}`;
}

module.exports = { generateRaqam };
