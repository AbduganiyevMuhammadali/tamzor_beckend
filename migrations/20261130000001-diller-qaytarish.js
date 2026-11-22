'use strict';

/* DILLERDAN QAYTARISH (2026-11-30) — egasi qarorlari 28–31 (AUDIT-VA-REJA §5l):
   diller_hujjat_qator.brak     — qaytarish qatori dillerning BRAK omboridan ("Diller: <ism> (brak)") kompaniyaning
                                  "Brak ombori"ga (true) yoki sog'lom omboridan asosiy omborga (false). Berishda doim false.
   diller_qaytarish_sotuv       — qaytarish qaysi berish (kompaniya sotuvi) arizasi qatorlarini qancha kamaytirgani:
                                  qaytarish kompaniya sotuvini kamaytiradi (agent savdoQaytarish modeli kabi —
                                  ariza_qator.jami_dona/dona/summa va ariza.jami_summa kamayadi). Iz va audit uchun. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const q = await queryInterface.describeTable('diller_hujjat_qator');
    if (!q.brak) await queryInterface.addColumn('diller_hujjat_qator', 'brak', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (!jadvallar.includes('diller_qaytarish_sotuv')) {
      await queryInterface.createTable('diller_qaytarish_sotuv', {
        id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        hujjat_id:      { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'diller_hujjat', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        ariza_id:       { type: DataTypes.INTEGER, allowNull: false },
        ariza_qator_id: { type: DataTypes.INTEGER, allowNull: false },
        tovar_id:       { type: DataTypes.INTEGER, allowNull: false },
        dona:           { type: DataTypes.DECIMAL(18, 3), allowNull: false, defaultValue: 0 },
        summa:          { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      });
      await queryInterface.addIndex('diller_qaytarish_sotuv', ['hujjat_id'], { name: 'idx_dqs_hujjat' });
      await queryInterface.addIndex('diller_qaytarish_sotuv', ['ariza_id'], { name: 'idx_dqs_ariza' });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('diller_qaytarish_sotuv').catch(() => {});
    await queryInterface.removeColumn('diller_hujjat_qator', 'brak').catch(() => {});
  },
};
