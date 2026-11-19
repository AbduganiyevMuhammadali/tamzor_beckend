'use strict';

/* Hujjat raqamlari hisoblagichi (AR-2026-0001, YK-2026-0001 ...).
   Avval raqam COUNT(*)+1 bilan berilardi — parallel yaratishda va o'chirilgan
   hujjatlardan keyin raqamlar takrorlanardi. Endi har prefiks+yil uchun
   hisoblagich shu jadvalda tranzaksiya ichida oshiriladi (src/utils/qulf.utils.js). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = await queryInterface.showAllTables();
    if (jadvallar.map(t => (typeof t === 'string' ? t : t.tableName)).includes('hujjat_raqam')) return;
    await queryInterface.createTable('hujjat_raqam', {
      kalit:  { type: DataTypes.STRING(40), primaryKey: true },
      oxirgi: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('hujjat_raqam');
  },
};
