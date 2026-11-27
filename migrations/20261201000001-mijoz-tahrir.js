'use strict';

/* MIJOZNI TAHRIRLASH RUXSATI (2026-11-27)
   agent.mijoz_tahrir — mobil ilovada mijozning telefoni, manzili va lokatsiyasini o'zgartirish ruxsati
   (login → editClient). Standart 0: ruxsatsiz agent mijozni umuman tahrirlay olmaydi. Diller — doim ruxsat. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const agent = await queryInterface.describeTable('agent');
    if (!agent.mijoz_tahrir) {
      await queryInterface.addColumn('agent', 'mijoz_tahrir', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    }
  },
  async down(queryInterface) {
    const agent = await queryInterface.describeTable('agent');
    if (agent.mijoz_tahrir) await queryInterface.removeColumn('agent', 'mijoz_tahrir');
  },
};
