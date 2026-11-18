'use strict';

/**
 * Oflayn qo'shilgan mijoz: ilova bergan takrorlanmas kalit. Internet uzilib, ilova
 * bir xil mijozni qayta yuborsa — yangisi yaratilmaydi, borining id'si qaytadi.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.describeTable('mijoz');
    if (!t.mobil_id) {
      await queryInterface.addColumn('mijoz', 'mobil_id', { type: Sequelize.STRING(64), allowNull: true });
      await queryInterface.addIndex('mijoz', ['mobil_id'], { unique: true, name: 'uq_mijoz_mobil_id' });
    }
  },
  async down(queryInterface) {
    const t = await queryInterface.describeTable('mijoz');
    if (t.mobil_id) { await queryInterface.removeIndex('mijoz', 'uq_mijoz_mobil_id'); await queryInterface.removeColumn('mijoz', 'mobil_id'); }
  },
};
