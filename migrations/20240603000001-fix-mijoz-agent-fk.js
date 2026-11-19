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

    /* Eski FK (agent_id → user.id) NOTO'G'RI edi. up()'dan keyin mijoz.agent_id
       agent jadvali id'larini saqlaydi — ular user'da bo'lmasa, FK qo'shish
       yiqiladi ("Cannot add or update a child row"). agent_id'ni NULL qilib
       "tuzatish" esa mijozlarning agentga biriktirilishini butunlay yo'qotadi.
       Shuning uchun eski FK faqat ma'lumot unga mos kelsa tiklanadi; aks holda
       FK'siz qoldiriladi (ustun va qiymatlar saqlanadi). */
    const [[r]] = await queryInterface.sequelize.query(`
      SELECT COUNT(*) AS c FROM mijoz
      WHERE agent_id IS NOT NULL AND agent_id NOT IN (SELECT id FROM user)`);
    if (Number(r.c) > 0) {
      console.warn(`[20240603000001 down] ${r.c} ta mijoz.agent_id user jadvalida yo'q — `
        + "eski mijoz_ibfk_3 (→ user.id) FK tiklanmadi, agent biriktiruvlari saqlandi.");
      return;
    }
    await queryInterface.addConstraint('mijoz', {
      fields: ['agent_id'],
      type: 'foreign key',
      name: 'mijoz_ibfk_3',
      references: { table: 'user', field: 'id' },
      onDelete: 'SET NULL',
    });
  },
};
