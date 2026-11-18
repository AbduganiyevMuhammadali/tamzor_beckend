'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('yetkazuvchi', {
      id:      { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      ism:     { type: Sequelize.STRING(120), allowNull: false },
      telefon: { type: Sequelize.STRING(30),  allowNull: true },
      manzil:  { type: Sequelize.STRING(255), allowNull: true },
      izoh:    { type: Sequelize.TEXT,        allowNull: true },
      balans:  { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.createTable('yetkazuvchi_harakatlar', {
      id:             { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      yetkazuvchi_id: { type: Sequelize.INTEGER, allowNull: false },
      prixod_id:      { type: Sequelize.INTEGER, allowNull: true },
      tur:            { type: Sequelize.ENUM('qarz', 'tolov'), allowNull: false },
      summa:          { type: Sequelize.DECIMAL(18, 2), allowNull: false },
      tolov_turi:     { type: Sequelize.ENUM('naqt', 'optom', 'chaka'), allowNull: true },
      izoh:           { type: Sequelize.TEXT, allowNull: true },
      sana:           { type: Sequelize.DATE, allowNull: false },
      createdAt:      { type: Sequelize.DATE, allowNull: false },
      updatedAt:      { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('yetkazuvchi_harakatlar', ['yetkazuvchi_id']);
    await queryInterface.addIndex('yetkazuvchi_harakatlar', ['prixod_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('yetkazuvchi_harakatlar');
    await queryInterface.dropTable('yetkazuvchi');
  },
};
