'use strict';

/* agent.juft_agent_id — distributsiya agentining Won Sell (avtolavka) "jufti".
   Bir xodim bitta login bilan ikkala rejimda ishlay olsin (masalan, App Store / Play
   Market tekshiruv akkaunti): mobil ilova "x-rejim: avtolavka" sarlavhasini yuborsa,
   so'rov shu juft agent nomidan bajariladi. Bo'sh — oddiy agent (avvalgidek). */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('agent', 'juft_agent_id', { type: Sequelize.INTEGER, allowNull: true });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('agent', 'juft_agent_id');
  },
};
