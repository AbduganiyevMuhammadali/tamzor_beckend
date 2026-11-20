'use strict';

/* PLASTIK TO'LOV TASDIG'I VA AGENT NAQD TOPSHIRUVI (2026-11-22)
   plastik_tolov  — agent plastik (karta) orqali qabul qilgan to'lov: web'da tasdiqlanguncha 'kutilmoqda',
                    mijoz qarzi faqat tasdiqdan keyin kamayadi. tur: 'qarz_tolov' (savePayment) | 'sotuv' (saveSell).
                    Tasdiqlanganda kassa jurnaliga kirim (kassa_id = plastik kassa) — kassa_yozuv_id.
   pul_topshiruv  — agent qo'lidagi naqdni kassaga topshirish so'rovi: web foydalanuvchi naqd kassani
                    tanlab tasdiqlaydi → agent majburiyati kamayadi, kassa balansi oshadi (jurnalga yozuv yo'q:
                    pul allaqachon kassa jurnalida agent qo'lidagi kirim sifatida turibdi — ichki ko'chirish).
   pul_audit      — ikkalasi bo'yicha har bir amal: kim, qachon, eski → yangi, sabab. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    const holat = { type: DataTypes.ENUM('kutilmoqda', 'tasdiqlangan', 'rad_etildi'), allowNull: false, defaultValue: 'kutilmoqda' };
    const pul = { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 };
    const vaqtlar = {
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    };
    if (!jadvallar.includes('plastik_tolov')) {
      await queryInterface.createTable('plastik_tolov', {
        id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        mobil_id:       { type: DataTypes.STRING(64), allowNull: true, unique: true },
        tur:            { type: DataTypes.ENUM('qarz_tolov', 'sotuv'), allowNull: false },
        agent_id:       { type: DataTypes.INTEGER, allowNull: false },
        agent_nomi:     { type: DataTypes.STRING(100), allowNull: true },
        territoriya_id: { type: DataTypes.INTEGER, allowNull: true },
        mijoz_id:       { type: DataTypes.INTEGER, allowNull: false },
        mijoz_nomi:     { type: DataTypes.STRING(150), allowNull: true },
        ariza_id:       { type: DataTypes.INTEGER, allowNull: true, unique: true },
        ariza_raqam:    { type: DataTypes.STRING(30), allowNull: true },
        kassa_id:       { type: DataTypes.INTEGER, allowNull: false },
        summa:          pul,
        holat,
        izoh:           { type: DataTypes.STRING(255), allowNull: true },
        chek_rasm:      { type: DataTypes.STRING(255), allowNull: true },
        sana:           { type: DataTypes.DATE, allowNull: false },
        tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
        tasdiqlagan_nomi: { type: DataTypes.STRING(100), allowNull: true },
        tasdiq_vaqt:      { type: DataTypes.DATE, allowNull: true },
        rad_sababi:       { type: DataTypes.STRING(500), allowNull: true },
        kassa_yozuv_id:   { type: DataTypes.INTEGER, allowNull: true },
        ...vaqtlar,
      });
      await queryInterface.addIndex('plastik_tolov', ['holat', 'sana'], { name: 'plastik_tolov_holat' });
      await queryInterface.addIndex('plastik_tolov', ['agent_id', 'sana'], { name: 'plastik_tolov_agent' });
      await queryInterface.addIndex('plastik_tolov', ['kassa_id'], { name: 'plastik_tolov_kassa' });
    }
    if (!jadvallar.includes('pul_topshiruv')) {
      await queryInterface.createTable('pul_topshiruv', {
        id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        mobil_id:   { type: DataTypes.STRING(64), allowNull: true, unique: true },
        agent_id:   { type: DataTypes.INTEGER, allowNull: false },
        agent_nomi: { type: DataTypes.STRING(100), allowNull: true },
        summa:      pul,
        izoh:       { type: DataTypes.STRING(500), allowNull: true },
        sana:       { type: DataTypes.DATE, allowNull: false },
        holat,
        kassa_id:   { type: DataTypes.INTEGER, allowNull: true },
        tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
        tasdiqlagan_nomi: { type: DataTypes.STRING(100), allowNull: true },
        tasdiq_vaqt:      { type: DataTypes.DATE, allowNull: true },
        rad_sababi:       { type: DataTypes.STRING(500), allowNull: true },
        ...vaqtlar,
      });
      await queryInterface.addIndex('pul_topshiruv', ['agent_id', 'holat'], { name: 'pul_topshiruv_agent' });
      await queryInterface.addIndex('pul_topshiruv', ['holat', 'sana'], { name: 'pul_topshiruv_holat' });
      await queryInterface.addIndex('pul_topshiruv', ['kassa_id'], { name: 'pul_topshiruv_kassa' });
    }
    if (!jadvallar.includes('pul_audit')) {
      await queryInterface.createTable('pul_audit', {
        id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        obyekt:    { type: DataTypes.STRING(30), allowNull: false },     // 'plastik_tolov' | 'pul_topshiruv'
        obyekt_id: { type: DataTypes.INTEGER, allowNull: false },
        amal:      { type: DataTypes.STRING(30), allowNull: false },     // yaratildi | tahrirlandi | tasdiqlandi | rad_etildi
        eski:      { type: DataTypes.TEXT, allowNull: true },            // JSON
        yangi:     { type: DataTypes.TEXT, allowNull: true },            // JSON
        sabab:     { type: DataTypes.STRING(500), allowNull: true },
        user_id:   { type: DataTypes.INTEGER, allowNull: true },
        user_nomi: { type: DataTypes.STRING(100), allowNull: true },
        ...vaqtlar,
      });
      await queryInterface.addIndex('pul_audit', ['obyekt', 'obyekt_id'], { name: 'pul_audit_obyekt' });
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('pul_audit');
    await queryInterface.dropTable('pul_topshiruv');
    await queryInterface.dropTable('plastik_tolov');
  },
};
