'use strict';

/**
 * Narx ro'yxatlari va mijoz toifalari.
 *
 *   narx_ruyxat         — nomli narx jadvali (tur: optom | chakana | maxsus).
 *                         standart=1 — shu turdagi mijozlarning asosiy ro'yxati.
 *   narx_ruyxat_qator   — ro'yxatdagi har tovar uchun narx (ruyxat + tovar bo'yicha yagona).
 *   mijoz_kategoriya.narx_ruyxat_id — toifaga biriktirilgan ro'yxat (ustunlik: toifa → standart → eski narx).
 *
 * Boshlang'ich ma'lumot: mavjud tovar_register dagi oxirgi chakana/optom narxlardan
 * ikkita standart ro'yxat ("Chakana", "Optom") yaratiladi — xulq o'zgarmaydi.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const jadvallar = await queryInterface.showAllTables();

    if (!jadvallar.includes('narx_ruyxat')) {
      await queryInterface.createTable('narx_ruyxat', {
        id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        nomi:       { type: Sequelize.STRING(100), allowNull: false },
        tur:        { type: Sequelize.ENUM('optom', 'chakana', 'maxsus'), allowNull: false, defaultValue: 'chakana' },
        standart:   { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        faol:       { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        izoh:       { type: Sequelize.STRING(255), allowNull: true },
        createdAt:  { type: Sequelize.DATE, allowNull: false },
        updatedAt:  { type: Sequelize.DATE, allowNull: false },
      });
    }

    if (!jadvallar.includes('narx_ruyxat_qator')) {
      await queryInterface.createTable('narx_ruyxat_qator', {
        id:              { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        narx_ruyxat_id:  { type: Sequelize.INTEGER, allowNull: false,
          references: { model: 'narx_ruyxat', key: 'id' }, onDelete: 'CASCADE' },
        tovar_id:        { type: Sequelize.INTEGER, allowNull: false,
          references: { model: 'tovar', key: 'id' }, onDelete: 'CASCADE' },
        narx:            { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        createdAt:       { type: Sequelize.DATE, allowNull: false },
        updatedAt:       { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('narx_ruyxat_qator', ['narx_ruyxat_id', 'tovar_id'], { unique: true, name: 'uq_narx_ruyxat_tovar' });
      await queryInterface.addIndex('narx_ruyxat_qator', ['tovar_id'], { name: 'idx_narx_ruyxat_qator_tovar' });
    }

    const kat = await queryInterface.describeTable('mijoz_kategoriya');
    if (!kat.narx_ruyxat_id) {
      await queryInterface.addColumn('mijoz_kategoriya', 'narx_ruyxat_id', {
        type: Sequelize.INTEGER, allowNull: true,
        references: { model: 'narx_ruyxat', key: 'id' }, onDelete: 'SET NULL',
      });
    }

    // Boshlang'ich standart ro'yxatlar — faqat jadval bo'sh bo'lsa
    const [[{ soni }]] = await queryInterface.sequelize.query('SELECT COUNT(*) AS soni FROM narx_ruyxat');
    if (Number(soni) === 0) {
      const now = new Date();
      for (const [nomi, tur, ustun] of [['Chakana (standart)', 'chakana', 'chakana_narx'], ['Optom (standart)', 'optom', 'optom_narx']]) {
        await queryInterface.bulkInsert('narx_ruyxat', [{ nomi, tur, standart: true, faol: true, izoh: 'Tizim boshlang\'ich ro\'yxati', createdAt: now, updatedAt: now }]);
        const [[{ id }]] = await queryInterface.sequelize.query('SELECT id FROM narx_ruyxat WHERE tur = :tur AND standart = 1 ORDER BY id DESC LIMIT 1', { replacements: { tur } });
        await queryInterface.sequelize.query(`
          INSERT INTO narx_ruyxat_qator (narx_ruyxat_id, tovar_id, narx, createdAt, updatedAt)
          SELECT :id, t.id,
            (SELECT r.${ustun} FROM tovar_register r WHERE r.tovar_id = t.id AND r.${ustun} > 0 ORDER BY r.sana DESC, r.id DESC LIMIT 1),
            :now, :now
          FROM tovar t
          WHERE t.deletedAt IS NULL
            AND EXISTS (SELECT 1 FROM tovar_register r2 WHERE r2.tovar_id = t.id AND r2.${ustun} > 0)`,
          { replacements: { id, now } });
      }
    }
  },

  async down(queryInterface) {
    const kat = await queryInterface.describeTable('mijoz_kategoriya');
    if (kat.narx_ruyxat_id) await queryInterface.removeColumn('mijoz_kategoriya', 'narx_ruyxat_id');
    await queryInterface.dropTable('narx_ruyxat_qator');
    await queryInterface.dropTable('narx_ruyxat');
  },
};
