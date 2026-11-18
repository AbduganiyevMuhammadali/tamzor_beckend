'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // 1. Territoriya (hudud)
    await queryInterface.createTable('territoriya', {
      id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      nomi:        { type: Sequelize.STRING(100), allowNull: false },
      izoh:        { type: Sequelize.STRING(255), allowNull: true },
      createdAt:   { type: Sequelize.DATE, allowNull: false },
      updatedAt:   { type: Sequelize.DATE, allowNull: false },
    });

    // 2. Mijoz kategoriyasi
    await queryInterface.createTable('mijoz_kategoriya', {
      id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      nomi:        { type: Sequelize.STRING(100), allowNull: false },
      izoh:        { type: Sequelize.STRING(255), allowNull: true },
      createdAt:   { type: Sequelize.DATE, allowNull: false },
      updatedAt:   { type: Sequelize.DATE, allowNull: false },
    });

    // 3. Mijoz
    await queryInterface.createTable('mijoz', {
      id:              { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      nomi:            { type: Sequelize.STRING(150), allowNull: false },
      yuridik_nomi:    { type: Sequelize.STRING(200), allowNull: true },
      telefon:         { type: Sequelize.STRING(20),  allowNull: true },
      telefon2:        { type: Sequelize.STRING(20),  allowNull: true },
      manzil:          { type: Sequelize.STRING(255), allowNull: true },
      mo_ljal:         { type: Sequelize.STRING(255), allowNull: true },
      territoriya_id:  { type: Sequelize.INTEGER,     allowNull: true, references: { model: 'territoriya', key: 'id' }, onDelete: 'SET NULL' },
      kategoriya_id:   { type: Sequelize.INTEGER,     allowNull: true, references: { model: 'mijoz_kategoriya', key: 'id' }, onDelete: 'SET NULL' },
      agent_id:        { type: Sequelize.INTEGER,     allowNull: true, references: { model: 'user', key: 'id' }, onDelete: 'SET NULL' },
      sinf:            { type: Sequelize.ENUM('A','B','C','D'), allowNull: true },
      balans:          { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      inn:             { type: Sequelize.STRING(20),  allowNull: true },
      shartnoma_raqam: { type: Sequelize.STRING(50),  allowNull: true },
      shartnoma_sana:  { type: Sequelize.DATEONLY,    allowNull: true },
      hisob_raqam:     { type: Sequelize.STRING(30),  allowNull: true },
      bank:            { type: Sequelize.STRING(100), allowNull: true },
      mfo:             { type: Sequelize.STRING(10),  allowNull: true },
      tashrif_kunlari: { type: Sequelize.STRING(50),  allowNull: true },
      tashrif_chastota:{ type: Sequelize.STRING(30),  allowNull: true },
      lat:             { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      lng:             { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      izoh:            { type: Sequelize.TEXT,        allowNull: true },
      faol:            { type: Sequelize.BOOLEAN,     defaultValue: true },
      createdAt:       { type: Sequelize.DATE,        allowNull: false },
      updatedAt:       { type: Sequelize.DATE,        allowNull: false },
      deletedAt:       { type: Sequelize.DATE,        allowNull: true },
    });

    await queryInterface.addIndex('mijoz', ['territoriya_id']);
    await queryInterface.addIndex('mijoz', ['kategoriya_id']);
    await queryInterface.addIndex('mijoz', ['agent_id']);
    await queryInterface.addIndex('mijoz', ['faol']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('mijoz');
    await queryInterface.dropTable('mijoz_kategoriya');
    await queryInterface.dropTable('territoriya');
  },
};
