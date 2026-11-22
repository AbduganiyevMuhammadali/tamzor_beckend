'use strict';

/* BUYUMLAR (2026-11-28) — sotilmaydigan jihozlar: muzlatkich, stend, banner...
   Kompaniya → agent → mijoz (do'kon) bo'ylab faqat SONI hisoblanadi (seriya raqami, narx, holat yo'q).
   buyum               — katalog (tovar emas). nomi UNIQUE, faol=0 — yangi harakatga chiqmaydi.
   buyum_harakat       — o'zgarmas harakat jurnali (raqam BH-000001). Qoldiq faqat shu jurnaldan hisoblanadi
                         (utils/buyum.utils.js). Tahrir/bekor yo'q — xato teskari harakat bilan tuzatiladi.
                         tur: kirim (kompaniyaga keldi), agentga, agentdan (kompaniyaga qaytdi), agentdan_agentga,
                              mijozga / mijozdan (mobil: agent_id — agent, mijoz_id — do'kon).
                         mobil_id — mobil takror kaliti, sorov_id — web takror kaliti (ikkalasi UNIQUE).
   buyum_harakat_qator — harakat qatorlari (buyum, dona > 0 butun), UNIQUE(harakat_id, buyum_id). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));

    if (!jadvallar.includes('buyum')) {
      await queryInterface.createTable('buyum', {
        id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        nomi:      { type: DataTypes.STRING(120), allowNull: false, unique: true },
        birlik:    { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'dona' },
        izoh:      { type: DataTypes.STRING(500), allowNull: true },
        faol:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      });
    }

    if (!jadvallar.includes('buyum_harakat')) {
      await queryInterface.createTable('buyum_harakat', {
        id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        raqam:        { type: DataTypes.STRING(30), allowNull: false, unique: true },
        tur:          { type: DataTypes.ENUM('kirim', 'agentga', 'agentdan', 'agentdan_agentga', 'mijozga', 'mijozdan'), allowNull: false },
        dan_agent_id: { type: DataTypes.INTEGER, allowNull: true },
        ga_agent_id:  { type: DataTypes.INTEGER, allowNull: true },
        agent_id:     { type: DataTypes.INTEGER, allowNull: true },
        mijoz_id:     { type: DataTypes.INTEGER, allowNull: true },
        mijoz_nomi:   { type: DataTypes.STRING(150), allowNull: true },
        sana:         { type: DataTypes.DATE, allowNull: false },
        izoh:         { type: DataTypes.STRING(500), allowNull: true },
        rasm:         { type: DataTypes.STRING(255), allowNull: true },
        mobil_id:     { type: DataTypes.STRING(64), allowNull: true, unique: true },
        sorov_id:     { type: DataTypes.STRING(64), allowNull: true, unique: true },
        user_id:      { type: DataTypes.INTEGER, allowNull: true },
        user_nomi:    { type: DataTypes.STRING(100), allowNull: true },
        createdAt:    { type: DataTypes.DATE, allowNull: false },
        updatedAt:    { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('buyum_harakat', ['tur', 'sana'], { name: 'idx_buyum_harakat_tur' });
      await queryInterface.addIndex('buyum_harakat', ['sana'], { name: 'idx_buyum_harakat_sana' });
      await queryInterface.addIndex('buyum_harakat', ['dan_agent_id'], { name: 'idx_buyum_harakat_dan' });
      await queryInterface.addIndex('buyum_harakat', ['ga_agent_id'], { name: 'idx_buyum_harakat_ga' });
      await queryInterface.addIndex('buyum_harakat', ['agent_id'], { name: 'idx_buyum_harakat_agent' });
      await queryInterface.addIndex('buyum_harakat', ['mijoz_id'], { name: 'idx_buyum_harakat_mijoz' });
    }

    if (!jadvallar.includes('buyum_harakat_qator')) {
      await queryInterface.createTable('buyum_harakat_qator', {
        id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        harakat_id: { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'buyum_harakat', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        buyum_id:   { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'buyum', key: 'id' }, onDelete: 'RESTRICT', onUpdate: 'CASCADE' },
        buyum_nomi: { type: DataTypes.STRING(120), allowNull: false },
        dona:       { type: DataTypes.INTEGER, allowNull: false },
      });
      await queryInterface.addIndex('buyum_harakat_qator', ['harakat_id', 'buyum_id'], { unique: true, name: 'uq_buyum_harakat_qator' });
      await queryInterface.addIndex('buyum_harakat_qator', ['buyum_id'], { name: 'idx_buyum_harakat_qator_buyum' });
      // MySQL 8.0.16+ CHECK; eski versiya e'tiborsiz qoldiradi (kod baribir dona > 0 ni tekshiradi)
      await queryInterface.sequelize.query('ALTER TABLE buyum_harakat_qator ADD CONSTRAINT chk_buyum_qator_dona CHECK (dona > 0)').catch(() => {});
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('buyum_harakat_qator').catch(() => {});
    await queryInterface.dropTable('buyum_harakat').catch(() => {});
    await queryInterface.dropTable('buyum').catch(() => {});
  },
};
