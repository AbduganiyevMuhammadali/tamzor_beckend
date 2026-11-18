'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // ── 1. Ariza (savdo arizasi) ──────────────────────────────────────
    await queryInterface.createTable('ariza', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },

      // Raqam: avtomatik  AR-2024-0001
      raqam: { type: Sequelize.STRING(30), allowNull: true },

      holat: {
        type: Sequelize.ENUM('yangi','tasdiqlangan','yigilmoqda','yolda','yetkazildi','bekor'),
        defaultValue: 'yangi',
        allowNull: false,
      },
      turi: {
        type: Sequelize.ENUM('sotish','qaytarish','almashtirish'),
        defaultValue: 'sotish',
        allowNull: false,
      },

      // Mijoz
      mijoz_id:    { type: Sequelize.INTEGER, allowNull: true, references: { model: 'mijoz', key: 'id' }, onDelete: 'SET NULL' },
      mijoz_nomi:  { type: Sequelize.STRING(150), allowNull: true },

      // Agent
      agent_id:    { type: Sequelize.INTEGER, allowNull: true, references: { model: 'agent', key: 'id' }, onDelete: 'SET NULL' },
      agent_nomi:  { type: Sequelize.STRING(100), allowNull: true },

      // Moliyaviy
      jami_summa:    { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      chegirma_foiz: { type: Sequelize.DECIMAL(5, 2),  defaultValue: 0 },
      chegirma_summa:{ type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      bonus_summa:   { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      tolov_turi:    { type: Sequelize.STRING(30), allowNull: true },

      // Logistika
      ombor:         { type: Sequelize.STRING(80), allowNull: true, defaultValue: 'Asosiy sklad' },
      ekspeditor:    { type: Sequelize.STRING(100), allowNull: true },
      jonatish_sana: { type: Sequelize.DATEONLY, allowNull: true },

      // Qo'shimcha
      izoh:          { type: Sequelize.TEXT, allowNull: true },
      bekor_sababi:  { type: Sequelize.STRING(255), allowNull: true },

      // Tasdiqlagan foydalanuvchi
      tasdiqlagan_id:  { type: Sequelize.INTEGER, allowNull: true },
      tasdiqlagan_sana:{ type: Sequelize.DATE, allowNull: true },

      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE, allowNull: true },
    });

    await queryInterface.addIndex('ariza', ['holat']);
    await queryInterface.addIndex('ariza', ['mijoz_id']);
    await queryInterface.addIndex('ariza', ['agent_id']);
    await queryInterface.addIndex('ariza', ['jonatish_sana']);

    // ── 2. Ariza qatorlari ────────────────────────────────────────────
    await queryInterface.createTable('ariza_qator', {
      id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },

      ariza_id:    { type: Sequelize.INTEGER, allowNull: false, references: { model: 'ariza', key: 'id' }, onDelete: 'CASCADE' },
      tovar_id:    { type: Sequelize.INTEGER, allowNull: true },
      tovar_nomi:  { type: Sequelize.STRING(120), allowNull: false },
      turkum:      { type: Sequelize.STRING(80), allowNull: true },
      shtrix_kod:  { type: Sequelize.STRING(30), allowNull: true },

      narx:        { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      blok:        { type: Sequelize.DECIMAL(10, 3), defaultValue: 0 },
      dona:        { type: Sequelize.DECIMAL(10, 3), defaultValue: 0 },
      hajm:        { type: Sequelize.DECIMAL(10, 3), defaultValue: 0 },
      jami_dona:   { type: Sequelize.DECIMAL(10, 3), defaultValue: 0 },
      summa:       { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },

      chegirma_foiz:  { type: Sequelize.DECIMAL(5, 2), defaultValue: 0 },
      chegirma_summa: { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },

      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.addIndex('ariza_qator', ['ariza_id']);
    await queryInterface.addIndex('ariza_qator', ['tovar_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('ariza_qator');
    await queryInterface.dropTable('ariza');
  },
};
