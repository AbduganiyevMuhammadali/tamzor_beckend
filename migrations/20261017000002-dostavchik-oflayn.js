'use strict';

/**
 * Dostavchik mobil ilovasi oflayn rejimi — takroriy yuborishdan himoya.
 *
 *   yetkazish_urinish.mobil_id — "yetkazib bo'lmadi" yozuviga ilova bergan takrorlanmas kalit.
 *       Internet uzilib, ilova bir xil urinishni qayta yuborsa — ikkinchi urinish yozilmaydi.
 *   Eski qarzni undirish (qarzTolov) uchun mavjud kassa.mobil_id ishlatiladi.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.describeTable('yetkazish_urinish');
    if (!t.mobil_id) {
      await queryInterface.addColumn('yetkazish_urinish', 'mobil_id', { type: Sequelize.STRING(64), allowNull: true });
      await queryInterface.addIndex('yetkazish_urinish', ['mobil_id'], { unique: true, name: 'uq_yetkazish_urinish_mobil_id' });
    }
  },

  async down(queryInterface) {
    const t = await queryInterface.describeTable('yetkazish_urinish');
    if (t.mobil_id) {
      await queryInterface.removeIndex('yetkazish_urinish', 'uq_yetkazish_urinish_mobil_id');
      await queryInterface.removeColumn('yetkazish_urinish', 'mobil_id');
    }
  },
};
