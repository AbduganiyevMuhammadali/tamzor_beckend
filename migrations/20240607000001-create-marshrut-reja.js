'use strict';

// Marshrut rejasi: agent uchun kunlik/haftalik tashrif rejasi (Plan).
// Haqiqiy borish-borilmaganligi 'tashrif' jadvalida (Fact) — ikkisi solishtirilib
// Plan-Fact tahlili chiqariladi.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('marshrut_reja', {
      id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      agent_id:   { type: Sequelize.INTEGER, allowNull: false },
      mijoz_id:   { type: Sequelize.INTEGER, allowNull: false },
      sana:       { type: Sequelize.DATEONLY, allowNull: false },   // aniq kun uchun reja
      tartib:     { type: Sequelize.INTEGER, allowNull: true },     // kun ichidagi tashrif tartibi (1,2,3...)
      izoh:       { type: Sequelize.STRING(255), allowNull: true },
      createdAt:  { type: Sequelize.DATE, allowNull: false },
      updatedAt:  { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('marshrut_reja', ['agent_id', 'sana']);
    await queryInterface.addIndex('marshrut_reja', ['mijoz_id', 'sana']);
    // Bir agent bir mijozga bir kunda faqat bitta reja
    await queryInterface.addConstraint('marshrut_reja', {
      fields: ['agent_id', 'mijoz_id', 'sana'],
      type: 'unique',
      name: 'uq_marshrut_reja_agent_mijoz_sana',
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('marshrut_reja');
  },
};
