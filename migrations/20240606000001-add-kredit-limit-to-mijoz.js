'use strict';

// Mijoz uchun qarz limiti — limitdan oshgan/muddati o'tgan qarzli mijozga
// yangi zakaz avtomatik bloklanadi.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('mijoz', 'kredit_limit', {
      type: Sequelize.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,   // 0 = cheklov yo'q (eski xatti-harakat saqlanadi)
      after: 'balans',
    });
    await queryInterface.addColumn('mijoz', 'tolov_muddati_kun', {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 30,  // necha kundan keyin qarz "muddati o'tgan" hisoblanadi
      after: 'kredit_limit',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('mijoz', 'tolov_muddati_kun');
    await queryInterface.removeColumn('mijoz', 'kredit_limit');
  },
};
