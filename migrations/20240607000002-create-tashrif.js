'use strict';

// Tashrif (Fact): agent do'konga kelib (check-in) va ketganda (check-out) qayd
// qiladi. reja_id bo'lsa — rejalashtirilgan tashrif, bo'lmasa rejasiz (extra) tashrif.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tashrif', {
      id:            { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      reja_id:       { type: Sequelize.INTEGER, allowNull: true },
      agent_id:      { type: Sequelize.INTEGER, allowNull: false },
      agent_nomi:    { type: Sequelize.STRING(120), allowNull: true },
      mijoz_id:      { type: Sequelize.INTEGER, allowNull: false },
      mijoz_nomi:    { type: Sequelize.STRING(150), allowNull: true },
      checkin_vaqt:  { type: Sequelize.DATE, allowNull: true },
      checkin_lat:   { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      checkin_lng:   { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      checkin_masofa:{ type: Sequelize.DECIMAL(10, 2), allowNull: true },  // mijoz koordinatasidan metrlarda
      checkout_vaqt: { type: Sequelize.DATE, allowNull: true },
      checkout_lat:  { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      checkout_lng:  { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      davomiylik_sek:{ type: Sequelize.INTEGER, allowNull: true },   // checkout - checkin (soniyada)
      natija:        { type: Sequelize.ENUM('savdo', 'sotmaslik', 'ochiq'), defaultValue: 'ochiq' },
      ariza_id:      { type: Sequelize.INTEGER, allowNull: true },   // shu tashrif natijasida yaratilgan savdo
      sana:          { type: Sequelize.DATEONLY, allowNull: false },
      createdAt:     { type: Sequelize.DATE, allowNull: false },
      updatedAt:     { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('tashrif', ['agent_id', 'sana']);
    await queryInterface.addIndex('tashrif', ['mijoz_id', 'sana']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tashrif');
  },
};
