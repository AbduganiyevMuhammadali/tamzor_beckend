const { Op } = require('sequelize');
const { ArizaModel } = require('../models/ariza.model');

// Ariza hujjat raqamini generatsiya qiladi: AR-2026-0001
// Web va mobil controllerlar bir xil formatdan foydalanishi uchun umumiy.
async function generateRaqam() {
  const year = new Date().getFullYear();
  const count = await ArizaModel.count({
    where: { createdAt: { [Op.gte]: new Date(`${year}-01-01`) } },
    paranoid: false,
  });
  return `AR-${year}-${String(count + 1).padStart(4, '0')}`;
}

module.exports = { generateRaqam };
