'use strict';

// mijoz.agent_id noto'g'ri `user` jadvaliga bog'langan edi (mijoz_ibfk_3).
// Mobil ilova `agent` jadvalidan kiradi, shuning uchun FK `agent.id` ga
// yo'naltiriladi — agent o'z mijozlariga to'g'ri biriktiriladi.
module.exports = {
  async up(queryInterface, Sequelize) {
    // 1) Eski (user'ga) FK ni olib tashlaymiz
    await queryInterface.removeConstraint('mijoz', 'mijoz_ibfk_3').catch(() => {});

    // 2) `user` da mavjud bo'lmagan agent_id larni tozalaymiz (yangi FK buzilmasligi uchun:
    //    user'dagi id agent'da bo'lmasligi mumkin). Mosi yo'qlarni null qilamiz.
    await queryInterface.sequelize.query(`
      UPDATE mijoz SET agent_id = NULL
      WHERE agent_id IS NOT NULL
        AND agent_id NOT IN (SELECT id FROM agent)
    `);

    // 3) Yangi FK — agent.id ga
    await queryInterface.addConstraint('mijoz', {
      fields: ['agent_id'],
      type: 'foreign key',
      name: 'mijoz_agent_fk',
      references: { table: 'agent', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint('mijoz', 'mijoz_agent_fk').catch(() => {});
    await queryInterface.addConstraint('mijoz', {
      fields: ['agent_id'],
      type: 'foreign key',
      name: 'mijoz_ibfk_3',
      references: { table: 'user', field: 'id' },
      onDelete: 'SET NULL',
    });
  },
};
