'use strict';

/**
 * Qarzga sotuv: mijoz qarzni qachon to'lashini agent kalendardan belgilaydi
 * (mobil ilova). Muddati o'tgan qarz shu sana bo'yicha hisoblanadi; sana yo'q
 * bo'lsa — sotuv sanasi + mijozning to'lov muddati (tolov_muddati_kun).
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.describeTable('ariza');
    if (!t.tolov_sana) {
      await queryInterface.addColumn('ariza', 'tolov_sana', { type: Sequelize.DATEONLY, allowNull: true });
      await queryInterface.addIndex('ariza', ['mijoz_id', 'tolov_sana'], { name: 'ix_ariza_mijoz_tolov_sana' });
    }
  },
  async down(queryInterface) {
    const t = await queryInterface.describeTable('ariza');
    if (t.tolov_sana) {
      await queryInterface.removeIndex('ariza', 'ix_ariza_mijoz_tolov_sana');
      await queryInterface.removeColumn('ariza', 'tolov_sana');
    }
  },
};
