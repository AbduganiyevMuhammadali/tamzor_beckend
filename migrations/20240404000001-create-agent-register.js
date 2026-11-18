'use strict';
// Agent savdo registri — har yetkazilgan buyurtma uchun agent fakt-summasi va bonusi yoziladi.
// Plan-fakt hisoboti shu jadvaldan hisoblanadi.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('agent_register', {
      id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      agent_id:    { type: Sequelize.INTEGER, allowNull: false },
      ariza_id:    { type: Sequelize.INTEGER, allowNull: true },
      tur:         { type: Sequelize.ENUM('savdo', 'qaytarma'), allowNull: false, defaultValue: 'savdo' },
      summa:       { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 }, // savdo summasi (fakt)
      bonus_foiz:  { type: Sequelize.DECIMAL(5, 2),  allowNull: false, defaultValue: 0 }, // o'sha paytdagi foiz
      bonus_summa: { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 }, // hisoblangan bonus
      sana:        { type: Sequelize.DATE, allowNull: false },
      izoh:        { type: Sequelize.STRING(255), allowNull: true },
      createdAt:   { type: Sequelize.DATE, allowNull: false },
      updatedAt:   { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('agent_register', ['agent_id', 'sana']);
    await queryInterface.addIndex('agent_register', ['ariza_id']);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('agent_register');
  },
};
