'use strict';

/* Tovar turkumlari alohida jadvalga (Sozlamalar → Turkumlar) va tovar.turkum_id.
   Mavjud tovarlardagi turkum nomlari jadvalga ko'chiriladi va bog'lanadi —
   `tovar.turkum` matni saqlanib qoladi (hujjatlar va hisobotlar shu nom bilan ishlaydi). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    await queryInterface.createTable('turkum', {
      id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      nomi:      { type: DataTypes.STRING(80), allowNull: false, unique: true },
      kod:       { type: DataTypes.STRING(30), allowNull: true },
      izoh:      { type: DataTypes.STRING(255), allowNull: true },
      tartib:    { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      faol:      { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
      createdAt: { type: DataTypes.DATE, allowNull: false },
      updatedAt: { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addColumn('tovar', 'turkum_id', { type: DataTypes.INTEGER, allowNull: true, after: 'turkum' });
    await queryInterface.addIndex('tovar', ['turkum_id'], { name: 'tovar_turkum_id' });

    // Mavjud nomlar → turkum jadvali (alifbo tartibida), tovarlar bog'lanadi
    await queryInterface.sequelize.query(`
      INSERT INTO turkum (nomi, tartib, faol, createdAt, updatedAt)
      SELECT x.nomi, (@i := @i + 1), 1, NOW(), NOW()
      FROM (SELECT DISTINCT TRIM(turkum) AS nomi FROM tovar
            WHERE turkum IS NOT NULL AND TRIM(turkum) <> '' ORDER BY nomi) x, (SELECT @i := 0) v`);
    await queryInterface.sequelize.query(`
      UPDATE tovar t JOIN turkum k ON k.nomi = TRIM(t.turkum)
      SET t.turkum_id = k.id WHERE t.turkum_id IS NULL`);
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('tovar', 'tovar_turkum_id');
    await queryInterface.removeColumn('tovar', 'turkum_id');
    await queryInterface.dropTable('turkum');
  },
};
