'use strict';

/* MIJOZGA TOVAR BO'YICHA SKIDKA (2026-11-27)
   mijoz_skidka — bitta mijoz + bitta tovar uchun bitta qoida (UNIQUE): tur 'foiz' (narxdan %) yoki
   'summa' (har dona narxidan so'm). dan/gacha — ixtiyoriy muddat (NULL — cheklanmagan).
   Sotuvda avtomatik qo'llanadi (agent ilovasi, web agent nomidan, skladdan sotuv, distributsiya narxi);
   dillerda qo'llanmaydi. utils/skidka.utils.js */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (!jadvallar.includes('mijoz_skidka')) {
      await queryInterface.createTable('mijoz_skidka', {
        id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        mijoz_id:  { type: DataTypes.INTEGER, allowNull: false },
        tovar_id:  { type: DataTypes.INTEGER, allowNull: false },
        tur:       { type: DataTypes.ENUM('foiz', 'summa'), allowNull: false },
        qiymat:    { type: DataTypes.DECIMAL(18, 2), allowNull: false },
        dan:       { type: DataTypes.DATEONLY, allowNull: true },
        gacha:     { type: DataTypes.DATEONLY, allowNull: true },
        izoh:      { type: DataTypes.STRING(255), allowNull: true },
        user_id:   { type: DataTypes.INTEGER, allowNull: true },
        user_nomi: { type: DataTypes.STRING(100), allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('mijoz_skidka', ['mijoz_id', 'tovar_id'], { unique: true, name: 'uq_mijoz_skidka' });
      await queryInterface.addIndex('mijoz_skidka', ['tovar_id'], { name: 'idx_mijoz_skidka_tovar' });
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('mijoz_skidka');
  },
};
