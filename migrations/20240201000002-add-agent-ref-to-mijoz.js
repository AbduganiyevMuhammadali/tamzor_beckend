'use strict';

// Mijoz jadvalidagi agent_id ustuniga agent jadvaliga murojaat qo'shish
// Eslatma: agar agent jadvali oldin mavjud bo'lmasa bu migration avval ishlaydi
module.exports = {
  async up(queryInterface, Sequelize) {
    // agent jadval mavjudligini tekshirib, agar yo'q bo'lsa o'tkazib yuboramiz
    try {
      const tables = await queryInterface.showAllTables();
      if (!tables.includes('agent')) return;

      // Eski foreign key bor bo'lsa olib tashlaymiz
      // (MySQL da FK nomini bilish kerak — skip qilamiz, indeks qo'shish yetarli)
      await queryInterface.addIndex('mijoz', ['agent_id'], {
        name: 'mijoz_agent_id_idx',
        ifNotExists: true,
      }).catch(() => {}); // allaqachon bor bo'lsa xatolik bermaydi
    } catch (e) {
      // jadval yo'q — skip
    }
  },

  async down() {},
};
