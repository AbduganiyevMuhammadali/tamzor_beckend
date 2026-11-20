'use strict';

/* Sotuvga bog'langan qaytarish (mobil savdoQaytarish) tarixi.
   savdo_qaytarish       — bitta qaytarish amali: qaysi sotuv, kim, qachon, pul qanday qaytdi
   savdo_qaytarish_qator — qatorlar: tovar, miqdor, summa, yaroqli (agent omboriga) / yaroqsiz (brak ombori)
   mobil_id UNIQUE — oflayn navbat takrori ikkinchi marta qo'llanmaydi. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (!jadvallar.includes('savdo_qaytarish')) {
      await queryInterface.createTable('savdo_qaytarish', {
        id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        mobil_id:   { type: DataTypes.STRING(64), allowNull: true, unique: true },
        ariza_id:   { type: DataTypes.INTEGER, allowNull: false },
        ariza_raqam:{ type: DataTypes.STRING(30), allowNull: true },
        agent_id:   { type: DataTypes.INTEGER, allowNull: false },
        agent_nomi: { type: DataTypes.STRING(100), allowNull: true },
        mijoz_id:   { type: DataTypes.INTEGER, allowNull: true },
        mijoz_nomi: { type: DataTypes.STRING(150), allowNull: true },
        tolov:      { type: DataTypes.ENUM('qarz', 'naqd'), allowNull: false },
        summa:      { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        yaroqli_summa:   { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        yaroqsiz_summa:  { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        eski_jami:  { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        yangi_jami: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        kassa_id:   { type: DataTypes.INTEGER, allowNull: true },
        izoh:       { type: DataTypes.STRING(500), allowNull: true },
        sana:       { type: DataTypes.DATE, allowNull: false },
        createdAt:  { type: DataTypes.DATE, allowNull: false },
        updatedAt:  { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('savdo_qaytarish', ['ariza_id'], { name: 'savdo_qaytarish_ariza' });
      await queryInterface.addIndex('savdo_qaytarish', ['agent_id', 'sana'], { name: 'savdo_qaytarish_agent_sana' });
    }
    if (!jadvallar.includes('savdo_qaytarish_qator')) {
      await queryInterface.createTable('savdo_qaytarish_qator', {
        id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        qaytarish_id:  { type: DataTypes.INTEGER, allowNull: false },
        ariza_qator_id:{ type: DataTypes.INTEGER, allowNull: true },
        tovar_id:      { type: DataTypes.INTEGER, allowNull: false },
        tovar_nomi:    { type: DataTypes.STRING(120), allowNull: true },
        dona:          { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
        narx:          { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        summa:         { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        yaroqli:       { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        ombor:         { type: DataTypes.STRING(80), allowNull: true },
        sabab:         { type: DataTypes.STRING(255), allowNull: true },
        createdAt:     { type: DataTypes.DATE, allowNull: false },
        updatedAt:     { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('savdo_qaytarish_qator', ['qaytarish_id'], { name: 'savdo_qaytarish_qator_q' });
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('savdo_qaytarish_qator');
    await queryInterface.dropTable('savdo_qaytarish');
  },
};
