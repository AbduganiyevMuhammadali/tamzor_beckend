'use strict';

/* SUPER AGENT KUZATUV RUXSATLARI (2026-11-27): agent.super_kuzatuv — JSON { bolim: bool }
   (utils/superKuzatuv.utils.js). NULL — hamma bo'lim ochiq (avvalgidek). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const agent = await queryInterface.describeTable('agent');
    if (!agent.super_kuzatuv) await queryInterface.addColumn('agent', 'super_kuzatuv', { type: Sequelize.DataTypes.TEXT, allowNull: true });
  },
  async down(queryInterface) {
    const agent = await queryInterface.describeTable('agent');
    if (agent.super_kuzatuv) await queryInterface.removeColumn('agent', 'super_kuzatuv');
  },
};
