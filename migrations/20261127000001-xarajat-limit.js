'use strict';

/* XARAJAT LIMITI (2026-11-27)
   user.xarajat_limit — bitta xarajatning eng katta summasi (faqat role 'User' uchun amal qiladi).
     NULL — cheksiz (hech narsa o'zgarmaydi), 0 — har xarajat tasdiqqa boradi. Admin/Programmer — limitsiz.
   xarajat_sorov — limitdan oshgan xarajat: 'kutilmoqda' → tasdiqlangan (kassa jurnaliga yoziladi,
     kassa_yozuv_id) | rad_etildi (sabab) | bekor (yaratuvchi o'zi). sorov_id — takrordan himoya. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const ustunlar = await queryInterface.describeTable('user');
    if (!ustunlar.xarajat_limit) {
      await queryInterface.addColumn('user', 'xarajat_limit', { type: DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: null });
    }

    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (!jadvallar.includes('xarajat_sorov')) {
      await queryInterface.createTable('xarajat_sorov', {
        id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        kategoriya:       { type: DataTypes.STRING(50), allowNull: false },
        summa:            { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        kassa_id:         { type: DataTypes.INTEGER, allowNull: false },
        tolov_usul:       { type: DataTypes.ENUM('naqt', 'karta', 'bank'), allowNull: false, defaultValue: 'naqt' },
        sana:             { type: DataTypes.DATE, allowNull: false },
        izoh:             { type: DataTypes.STRING(255), allowNull: true },
        chek_rasm:        { type: DataTypes.STRING(255), allowNull: true },
        user_id:          { type: DataTypes.INTEGER, allowNull: true },
        user_nomi:        { type: DataTypes.STRING(100), allowNull: true },
        holat:            { type: DataTypes.ENUM('kutilmoqda', 'tasdiqlangan', 'rad_etildi', 'bekor'), allowNull: false, defaultValue: 'kutilmoqda' },
        tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
        tasdiqlagan_nomi: { type: DataTypes.STRING(100), allowNull: true },
        tasdiq_vaqt:      { type: DataTypes.DATE, allowNull: true },
        rad_sababi:       { type: DataTypes.STRING(500), allowNull: true },
        kassa_yozuv_id:   { type: DataTypes.INTEGER, allowNull: true },
        sorov_id:         { type: DataTypes.STRING(64), allowNull: true, unique: true },
        createdAt:        { type: DataTypes.DATE, allowNull: false },
        updatedAt:        { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('xarajat_sorov', ['holat', 'sana'], { name: 'idx_xarajat_sorov_holat' });
      await queryInterface.addIndex('xarajat_sorov', ['user_id', 'holat'], { name: 'idx_xarajat_sorov_user' });
      await queryInterface.addIndex('xarajat_sorov', ['kassa_id'], { name: 'idx_xarajat_sorov_kassa' });
    }
  },

  async down(queryInterface) {
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (jadvallar.includes('xarajat_sorov')) await queryInterface.dropTable('xarajat_sorov');
    const ustunlar = await queryInterface.describeTable('user');
    if (ustunlar.xarajat_limit) await queryInterface.removeColumn('user', 'xarajat_limit');
  },
};
