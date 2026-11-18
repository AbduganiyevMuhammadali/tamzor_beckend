'use strict';

// Mobil ilovada agent/dostavchik to'lov qabul qilganda chek/kvitansiya rasmini
// biriktirishi mumkin — shu rasm yo'li shu yerda saqlanadi.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('kassa', 'chek_rasm', {
      type: Sequelize.STRING(255),
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('kassa', 'chek_rasm');
  },
};
