'use strict';

/* TOVAR ALMASHTIRISH (2026-11-28) — mijoz sotuvdagi tovarni qaytaradi, o'rniga boshqa tovar oladi.
   Bitta tranzaksiya: sotuvga bog'langan qaytarish (savdo_qaytarish, qarzdan) + yangi sotuv (ariza) + farq hisobi.
   farq = yangi_summa − qaytgan_summa; farq_usul: 'naqd' (farq naqd: mijoz to'ladi / agent qaytardi) | 'balans'. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (jadvallar.includes('savdo_almashtirish')) return;
    await queryInterface.createTable('savdo_almashtirish', {
      id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      raqam:         { type: DataTypes.STRING(30), allowNull: true },
      mobil_id:      { type: DataTypes.STRING(64), allowNull: true, unique: true },
      agent_id:      { type: DataTypes.INTEGER, allowNull: false },
      agent_nomi:    { type: DataTypes.STRING(120), allowNull: true },
      mijoz_id:      { type: DataTypes.INTEGER, allowNull: true },
      mijoz_nomi:    { type: DataTypes.STRING(150), allowNull: true },
      asl_ariza_id:  { type: DataTypes.INTEGER, allowNull: false },
      asl_raqam:     { type: DataTypes.STRING(30), allowNull: true },
      qaytarish_id:  { type: DataTypes.INTEGER, allowNull: false },
      ariza_id:      { type: DataTypes.INTEGER, allowNull: false },
      ariza_raqam:   { type: DataTypes.STRING(30), allowNull: true },
      qaytgan_summa: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      yangi_summa:   { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      farq:          { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      farq_usul:     { type: DataTypes.ENUM('naqd', 'balans'), allowNull: false },
      kassa_id:      { type: DataTypes.INTEGER, allowNull: true },
      izoh:          { type: DataTypes.STRING(500), allowNull: true },
      sana:          { type: DataTypes.DATE, allowNull: false },
      createdAt:     { type: DataTypes.DATE, allowNull: false },
      updatedAt:     { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('savdo_almashtirish', ['agent_id', 'sana'], { name: 'idx_almashtirish_agent' });
    await queryInterface.addIndex('savdo_almashtirish', ['mijoz_id'], { name: 'idx_almashtirish_mijoz' });
  },
  async down(queryInterface) {
    await queryInterface.dropTable('savdo_almashtirish');
  },
};
