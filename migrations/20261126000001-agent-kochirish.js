'use strict';

/* AGENTDAN AGENTGA KO'CHIRISH (2026-11-26)
   Operator web'da bir agentning sotiladigan omboridan ("Agent: <ism>") boshqa agentning omboriga
   tovar o'tkazadi. Darhol amal qiladi, keyin tahrirlash va bekor qilish mumkin (delta / teskari yozuv).
   agent_kochirish        — hujjat (raqam KO-000001, kim → kimga, holat faol | bekor, sorov_id — takrordan himoya)
   agent_kochirish_qator  — tovar qatorlari (dona, tannarx — hujjat yaratilgandagi o'rtacha kirim narxi)
   agent_kochirish_audit  — yaratildi / tahrirlandi / bekor_qilindi: kim, qachon, eski → yangi, sabab
   tovar_register.manba_tur — 'agent_kochirish' (manba_id = hujjat id). Eski 'kochirish' (tovar turi
                            o'zgarganda, manba_id = tovar id) bilan aralashmaydi. Savdo ham, kirim ham emas. */
const MANBA_ESKI = ['prixod', 'sotuv', 'qaytarma', 'inventar', 'yuklash', 'qabul', 'ishlab_chiqarish', 'kochirish'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));

    if (!jadvallar.includes('agent_kochirish')) {
      await queryInterface.createTable('agent_kochirish', {
        id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        raqam:         { type: DataTypes.STRING(30), allowNull: false, unique: true },
        dan_agent_id:  { type: DataTypes.INTEGER, allowNull: false },
        dan_agent_nomi:{ type: DataTypes.STRING(120), allowNull: true },
        ga_agent_id:   { type: DataTypes.INTEGER, allowNull: false },
        ga_agent_nomi: { type: DataTypes.STRING(120), allowNull: true },
        sana:          { type: DataTypes.DATE, allowNull: false },
        izoh:          { type: DataTypes.STRING(500), allowNull: true },
        sabab:         { type: DataTypes.STRING(500), allowNull: true },
        holat:         { type: DataTypes.ENUM('faol', 'bekor'), allowNull: false, defaultValue: 'faol' },
        sorov_id:      { type: DataTypes.STRING(64), allowNull: true, unique: true },
        user_id:       { type: DataTypes.INTEGER, allowNull: true },
        user_nomi:     { type: DataTypes.STRING(100), allowNull: true },
        bekor_user_id: { type: DataTypes.INTEGER, allowNull: true },
        bekor_vaqt:    { type: DataTypes.DATE, allowNull: true },
        bekor_sababi:  { type: DataTypes.STRING(500), allowNull: true },
        createdAt:     { type: DataTypes.DATE, allowNull: false },
        updatedAt:     { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('agent_kochirish', ['dan_agent_id', 'sana'], { name: 'idx_agent_kochirish_dan' });
      await queryInterface.addIndex('agent_kochirish', ['ga_agent_id', 'sana'], { name: 'idx_agent_kochirish_ga' });
      await queryInterface.addIndex('agent_kochirish', ['sana'], { name: 'idx_agent_kochirish_sana' });
    }

    if (!jadvallar.includes('agent_kochirish_qator')) {
      await queryInterface.createTable('agent_kochirish_qator', {
        id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        kochirish_id: { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'agent_kochirish', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        tovar_id:     { type: DataTypes.INTEGER, allowNull: false },
        tovar_nomi:   { type: DataTypes.STRING(120), allowNull: false },
        dona:         { type: DataTypes.DECIMAL(18, 3), allowNull: false, defaultValue: 0 },
        tannarx:      { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        summa:        { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        createdAt:    { type: DataTypes.DATE, allowNull: false },
        updatedAt:    { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('agent_kochirish_qator', ['kochirish_id', 'tovar_id'], { unique: true, name: 'uq_agent_kochirish_qator' });
    }

    if (!jadvallar.includes('agent_kochirish_audit')) {
      await queryInterface.createTable('agent_kochirish_audit', {
        id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        kochirish_id: { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'agent_kochirish', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        amal:         { type: DataTypes.ENUM('yaratildi', 'tahrirlandi', 'bekor_qilindi'), allowNull: false },
        eski:         { type: DataTypes.TEXT, allowNull: true },
        yangi:        { type: DataTypes.TEXT, allowNull: true },
        sabab:        { type: DataTypes.STRING(500), allowNull: true },
        user_id:      { type: DataTypes.INTEGER, allowNull: true },
        user_nomi:    { type: DataTypes.STRING(100), allowNull: true },
        vaqt:         { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('agent_kochirish_audit', ['kochirish_id'], { name: 'idx_agent_kochirish_audit' });
    }

    const [[col]] = await queryInterface.sequelize.query("SHOW COLUMNS FROM tovar_register LIKE 'manba_tur'");
    if (col && !String(col.Type).includes("'agent_kochirish'")) {
      await queryInterface.changeColumn('tovar_register', 'manba_tur', {
        type: Sequelize.ENUM(...MANBA_ESKI, 'agent_kochirish'), allowNull: false,
      });
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query("DELETE FROM tovar_register WHERE manba_tur = 'agent_kochirish'");
    await queryInterface.changeColumn('tovar_register', 'manba_tur', { type: Sequelize.ENUM(...MANBA_ESKI), allowNull: false });
    await queryInterface.dropTable('agent_kochirish_audit').catch(() => {});
    await queryInterface.dropTable('agent_kochirish_qator').catch(() => {});
    await queryInterface.dropTable('agent_kochirish').catch(() => {});
  },
};
