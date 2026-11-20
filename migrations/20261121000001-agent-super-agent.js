'use strict';

/* Mobil ilova endi faqat 2 rol: AGENT va SUPER AGENT (2026-11-21).
   - Har bir agent o'z omboridan ("Agent: <ism>") to'g'ridan-to'g'ri sotadi — avvalgi Won Sell
     (avtolavka) oqimi hamma agentga tegishli: barcha mavjud agentlar avtolavka = 1, standart ham 1.
   - agent.super_agent      — super agent (o'zi ham agent + biriktirilgan agentlarni faqat ko'radi)
   - agent.super_agent_id   — shu agent qaysi super agentga biriktirilgan (FK'siz, web panelda belgilanadi) */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ustunlar = await queryInterface.describeTable('agent');
    if (!ustunlar.super_agent) {
      await queryInterface.addColumn('agent', 'super_agent', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    }
    if (!ustunlar.super_agent_id) {
      await queryInterface.addColumn('agent', 'super_agent_id', { type: Sequelize.INTEGER, allowNull: true });
      await queryInterface.addIndex('agent', ['super_agent_id'], { name: 'agent_super_agent_id' });
    }
    await queryInterface.changeColumn('agent', 'avtolavka', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true });
    await queryInterface.sequelize.query('UPDATE agent SET avtolavka = 1 WHERE avtolavka = 0');
  },
  async down(queryInterface, Sequelize) {
    // avtolavka qiymatlari qaytarilmaydi (qaysi agent avval distributsiya bo'lgani saqlanmagan)
    await queryInterface.changeColumn('agent', 'avtolavka', { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false });
    await queryInterface.removeIndex('agent', 'agent_super_agent_id').catch(() => {});
    await queryInterface.removeColumn('agent', 'super_agent_id');
    await queryInterface.removeColumn('agent', 'super_agent');
  },
};
