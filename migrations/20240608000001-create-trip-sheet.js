'use strict';

// Trip Sheet: dostavchikning bir kunlik yetkazib berish marshrut varag'i.
// Bir nechta arizani (hujjatni) birlashtiradi — dostavchik shu ro'yxat bo'yicha
// ketma-ket yetkazib beradi.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('trip_sheet', {
      id:             { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      raqam:          { type: Sequelize.STRING(30), allowNull: true },
      dostavchi_id:   { type: Sequelize.INTEGER, allowNull: false },
      dostavchi_nomi: { type: Sequelize.STRING(120), allowNull: true },
      sana:           { type: Sequelize.DATEONLY, allowNull: false },
      holat:          { type: Sequelize.ENUM('yangi', 'yolda', 'yakunlandi'), defaultValue: 'yangi' },
      boshlangan_vaqt:{ type: Sequelize.DATE, allowNull: true },
      tugagan_vaqt:   { type: Sequelize.DATE, allowNull: true },
      izoh:           { type: Sequelize.TEXT, allowNull: true },
      createdAt:      { type: Sequelize.DATE, allowNull: false },
      updatedAt:      { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('trip_sheet', ['dostavchi_id', 'sana']);

    // Trip sheet ↔ ariza bog'lanishi (ko'p-ko'p emas, bitta ariza bitta trip
    // sheetga tegishli bo'ladi — shuning uchun ariza jadvaliga to'g'ridan-to'g'ri
    // trip_sheet_id ustuni qo'shamiz, oddiyroq va tezkorroq so'rovlar uchun)
    await queryInterface.addColumn('ariza', 'trip_sheet_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'dostavchi_id',
    });
    await queryInterface.addColumn('ariza', 'trip_tartib', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'trip_sheet_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ariza', 'trip_tartib');
    await queryInterface.removeColumn('ariza', 'trip_sheet_id');
    await queryInterface.dropTable('trip_sheet');
  },
};
