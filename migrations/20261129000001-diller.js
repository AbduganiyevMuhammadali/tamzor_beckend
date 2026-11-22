'use strict';

/* DILLERLAR (2026-11-29) — hamkor: agent kabi mobil ilovada ishlaydi, lekin O'ZI UCHUN.
   agent.diller          — bayroq (web'da qo'yiladi). Diller ombori "Diller: <ism>" (kompaniya zaxirasi EMAS).
   tovar.diller_narx     — diller sotib olish narxi (berish formasida standart).
   diller_hujjat         — kompaniya ↔ diller hujjatlari: berish (kompaniya sotuvi), tolov (qarz to'lovi),
                           qaytarish (dillerdan kompaniyaga). raqam DL-000001. Tahrirlanmaydi.
                           ariza_id — berishda kompaniya sotuvi hisobotlari uchun yaratilgan ariza (kanal='diller').
   diller_hujjat_qator   — berish/qaytarish qatorlari (narx — diller sotib olgan narx).
   diller_narx           — dillerning o'z narx ro'yxati (mobil, serverda saqlanadi).
   diller_pul            — dillerning O'Z pul daftari (mijozlaridan olgan naqd/plastik, mijozga qaytargani).
                           Kompaniya kassasiga/jurnaliga hech qachon tushmaydi.
   ENUM'lar: ariza.turi + 'diller_sotuv' (dillerning mijozga sotuvi — kompaniya hisobotlari turi='sotish' ni oladi),
             ariza.kanal + 'diller', tovar_register.manba_tur + diller_berish/diller_qaytarish/diller_sotuv/diller_qaytarma. */
const MANBA_ESKI = ['prixod', 'sotuv', 'qaytarma', 'inventar', 'yuklash', 'qabul', 'ishlab_chiqarish', 'kochirish', 'agent_kochirish'];
const MANBA_YANGI = ['diller_berish', 'diller_qaytarish', 'diller_sotuv', 'diller_qaytarma'];
const TURI_ESKI = ['sotish', 'qaytarish', 'almashtirish'];
const KANAL_ESKI = ['distributsiya', 'avtolavka', 'sklad'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));

    const agent = await queryInterface.describeTable('agent');
    if (!agent.diller) await queryInterface.addColumn('agent', 'diller', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    const tovar = await queryInterface.describeTable('tovar');
    if (!tovar.diller_narx) await queryInterface.addColumn('tovar', 'diller_narx', { type: DataTypes.DECIMAL(18, 2), allowNull: true });

    if (!jadvallar.includes('diller_hujjat')) {
      await queryInterface.createTable('diller_hujjat', {
        id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        raqam:          { type: DataTypes.STRING(30), allowNull: false, unique: true },
        diller_id:      { type: DataTypes.INTEGER, allowNull: false },
        diller_nomi:    { type: DataTypes.STRING(100), allowNull: true },
        tur:            { type: DataTypes.ENUM('berish', 'tolov', 'qaytarish'), allowNull: false },
        sana:           { type: DataTypes.DATE, allowNull: false },
        jami:           { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        tolangan:       { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        kassa_id:       { type: DataTypes.INTEGER, allowNull: true },
        kassa_yozuv_id: { type: DataTypes.INTEGER, allowNull: true },
        ariza_id:       { type: DataTypes.INTEGER, allowNull: true },
        izoh:           { type: DataTypes.STRING(500), allowNull: true },
        sorov_id:       { type: DataTypes.STRING(64), allowNull: true, unique: true },
        user_id:        { type: DataTypes.INTEGER, allowNull: true },
        user_nomi:      { type: DataTypes.STRING(100), allowNull: true },
        createdAt:      { type: DataTypes.DATE, allowNull: false },
        updatedAt:      { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('diller_hujjat', ['diller_id', 'sana'], { name: 'idx_diller_hujjat_diller' });
      await queryInterface.addIndex('diller_hujjat', ['tur', 'sana'], { name: 'idx_diller_hujjat_tur' });
    }
    if (!jadvallar.includes('diller_hujjat_qator')) {
      await queryInterface.createTable('diller_hujjat_qator', {
        id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        hujjat_id:  { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'diller_hujjat', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        tovar_id:   { type: DataTypes.INTEGER, allowNull: false },
        tovar_nomi: { type: DataTypes.STRING(120), allowNull: false },
        dona:       { type: DataTypes.DECIMAL(18, 3), allowNull: false },
        narx:       { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        summa:      { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      });
      await queryInterface.addIndex('diller_hujjat_qator', ['hujjat_id'], { name: 'idx_diller_qator_hujjat' });
      await queryInterface.addIndex('diller_hujjat_qator', ['tovar_id'], { name: 'idx_diller_qator_tovar' });
    }
    if (!jadvallar.includes('diller_narx')) {
      await queryInterface.createTable('diller_narx', {
        id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        diller_id: { type: DataTypes.INTEGER, allowNull: false },
        tovar_id:  { type: DataTypes.INTEGER, allowNull: false },
        narx:      { type: DataTypes.DECIMAL(18, 2), allowNull: false },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('diller_narx', ['diller_id', 'tovar_id'], { unique: true, name: 'uq_diller_narx' });
    }
    if (!jadvallar.includes('diller_pul')) {
      await queryInterface.createTable('diller_pul', {
        id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        diller_id:   { type: DataTypes.INTEGER, allowNull: false },
        tur:         { type: DataTypes.ENUM('kirim', 'chiqim'), allowNull: false },
        kategoriya:  { type: DataTypes.ENUM('sotuv', 'mijoz_tolov', 'qaytarish'), allowNull: false },
        usul:        { type: DataTypes.ENUM('naqd', 'plastik'), allowNull: false, defaultValue: 'naqd' },
        summa:       { type: DataTypes.DECIMAL(18, 2), allowNull: false },
        mijoz_id:    { type: DataTypes.INTEGER, allowNull: true },
        mijoz_nomi:  { type: DataTypes.STRING(150), allowNull: true },
        ariza_id:    { type: DataTypes.INTEGER, allowNull: true },
        qaytarish_id:{ type: DataTypes.INTEGER, allowNull: true },
        mobil_id:    { type: DataTypes.STRING(64), allowNull: true, unique: true },
        izoh:        { type: DataTypes.STRING(255), allowNull: true },
        chek_rasm:   { type: DataTypes.STRING(255), allowNull: true },
        sana:        { type: DataTypes.DATE, allowNull: false },
        createdAt:   { type: DataTypes.DATE, allowNull: false },
        updatedAt:   { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('diller_pul', ['diller_id', 'sana'], { name: 'idx_diller_pul_diller' });
      await queryInterface.addIndex('diller_pul', ['mijoz_id'], { name: 'idx_diller_pul_mijoz' });
    }

    const enumQosh = async (jadval, ustun, eski, yangi, defaultValue) => {
      const [[c]] = await queryInterface.sequelize.query(`SHOW COLUMNS FROM \`${jadval}\` LIKE '${ustun}'`);
      if (c && yangi.some(v => !String(c.Type).includes(`'${v}'`))) {
        await queryInterface.changeColumn(jadval, ustun, {
          type: Sequelize.ENUM(...eski, ...yangi), allowNull: false, ...(defaultValue ? { defaultValue } : {}),
        });
      }
    };
    await enumQosh('tovar_register', 'manba_tur', MANBA_ESKI, MANBA_YANGI);
    await enumQosh('ariza', 'turi', TURI_ESKI, ['diller_sotuv'], 'sotish');
    await enumQosh('ariza', 'kanal', KANAL_ESKI, ['diller'], 'distributsiya');
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`DELETE FROM tovar_register WHERE manba_tur IN ('${MANBA_YANGI.join("','")}')`);
    await queryInterface.changeColumn('tovar_register', 'manba_tur', { type: Sequelize.ENUM(...MANBA_ESKI), allowNull: false });
    await queryInterface.sequelize.query("DELETE FROM ariza WHERE turi = 'diller_sotuv' OR kanal = 'diller'");
    await queryInterface.changeColumn('ariza', 'turi', { type: Sequelize.ENUM(...TURI_ESKI), allowNull: false, defaultValue: 'sotish' });
    await queryInterface.changeColumn('ariza', 'kanal', { type: Sequelize.ENUM(...KANAL_ESKI), allowNull: false, defaultValue: 'distributsiya' });
    await queryInterface.dropTable('diller_pul').catch(() => {});
    await queryInterface.dropTable('diller_narx').catch(() => {});
    await queryInterface.dropTable('diller_hujjat_qator').catch(() => {});
    await queryInterface.dropTable('diller_hujjat').catch(() => {});
    await queryInterface.removeColumn('tovar', 'diller_narx').catch(() => {});
    await queryInterface.removeColumn('agent', 'diller').catch(() => {});
  },
};
