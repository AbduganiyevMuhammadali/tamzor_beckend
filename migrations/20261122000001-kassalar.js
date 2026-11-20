'use strict';

/* KASSALAR (2026-11-22) — pul turadigan joylar (naqd kassa / plastik karta-hisob).
   kassalar        — nomi (to'lov turi sifatida ko'rinadi), tur 'naqd'|'plastik', faol
   kassa_viloyat   — plastik kassa qaysi viloyat(lar)ga (territoriya) xizmat qiladi (ko'p-ko'p).
                     Naqd kassa viloyatga bog'lanmaydi.
   kassa (jurnal)  + kassa_id — yozuv qaysi kassaga tegishli (eski yozuvlar NULL — "taqsimlanmagan")
                   + agent_id — pul hozir shu agent qo'lida (naqd sotuv / qarz undirish / naqd qaytarish).
                     Faqat yangi yozuvlarga qo'yiladi: agent majburiyati shu migratsiyadan boshlab sanaladi
                     (eski naqd avvalgi kun yopish / inkassatsiya orqali hisob-kitob qilingan). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (!jadvallar.includes('kassalar')) {
      await queryInterface.createTable('kassalar', {
        id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        nomi:      { type: DataTypes.STRING(100), allowNull: false, unique: true },
        tur:       { type: DataTypes.ENUM('naqd', 'plastik'), allowNull: false },
        faol:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        izoh:      { type: DataTypes.STRING(255), allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      });
    }
    if (!jadvallar.includes('kassa_viloyat')) {
      await queryInterface.createTable('kassa_viloyat', {
        id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        kassa_id:       { type: DataTypes.INTEGER, allowNull: false },
        territoriya_id: { type: DataTypes.INTEGER, allowNull: false },
        createdAt:      { type: DataTypes.DATE, allowNull: false },
        updatedAt:      { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('kassa_viloyat', ['kassa_id', 'territoriya_id'], { name: 'kassa_viloyat_juft', unique: true });
      await queryInterface.addIndex('kassa_viloyat', ['territoriya_id'], { name: 'kassa_viloyat_ter' });
    }
    const ustunlar = await queryInterface.describeTable('kassa');
    if (!ustunlar.kassa_id) {
      await queryInterface.addColumn('kassa', 'kassa_id', { type: DataTypes.INTEGER, allowNull: true });
      await queryInterface.addIndex('kassa', ['kassa_id'], { name: 'kassa_kassa_id' });
    }
    if (!ustunlar.agent_id) {
      await queryInterface.addColumn('kassa', 'agent_id', { type: DataTypes.INTEGER, allowNull: true });
      await queryInterface.addIndex('kassa', ['agent_id', 'sana'], { name: 'kassa_agent_sana' });
    }
  },
  async down(queryInterface) {
    await queryInterface.removeIndex('kassa', 'kassa_agent_sana').catch(() => {});
    await queryInterface.removeColumn('kassa', 'agent_id').catch(() => {});
    await queryInterface.removeIndex('kassa', 'kassa_kassa_id').catch(() => {});
    await queryInterface.removeColumn('kassa', 'kassa_id').catch(() => {});
    await queryInterface.dropTable('kassa_viloyat');
    await queryInterface.dropTable('kassalar');
  },
};
