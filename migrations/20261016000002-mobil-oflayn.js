'use strict';

/**
 * Mobil ilova oflayn rejimi — takroriy yuborishdan himoya.
 *
 *   ariza.mobil_id — ilova sotuvga bergan takrorlanmas kalit. Internet uzilib, ilova
 *                    bir xil sotuvni qayta yuborsa server yangisini yaratmaydi, borini qaytaradi.
 *   ariza.oflayn   — sotuv internet yo'q paytda qilingan (keyin yuborilgan).
 *   kassa.mobil_id — mijoz to'lovi uchun xuddi shunday kalit.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ariza = await queryInterface.describeTable('ariza');
    if (!ariza.mobil_id) {
      await queryInterface.addColumn('ariza', 'mobil_id', { type: Sequelize.STRING(64), allowNull: true });
      await queryInterface.addIndex('ariza', ['mobil_id'], { unique: true, name: 'uq_ariza_mobil_id' });
    }
    if (!ariza.oflayn) {
      await queryInterface.addColumn('ariza', 'oflayn', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    }
    const kassa = await queryInterface.describeTable('kassa');
    if (!kassa.mobil_id) {
      await queryInterface.addColumn('kassa', 'mobil_id', { type: Sequelize.STRING(64), allowNull: true });
      await queryInterface.addIndex('kassa', ['mobil_id'], { unique: true, name: 'uq_kassa_mobil_id' });
    }
  },

  async down(queryInterface) {
    const ariza = await queryInterface.describeTable('ariza');
    if (ariza.mobil_id) { await queryInterface.removeIndex('ariza', 'uq_ariza_mobil_id'); await queryInterface.removeColumn('ariza', 'mobil_id'); }
    if (ariza.oflayn) await queryInterface.removeColumn('ariza', 'oflayn');
    const kassa = await queryInterface.describeTable('kassa');
    if (kassa.mobil_id) { await queryInterface.removeIndex('kassa', 'uq_kassa_mobil_id'); await queryInterface.removeColumn('kassa', 'mobil_id'); }
  },
};
