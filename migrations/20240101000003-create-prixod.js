'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('prixod', {
        id:            { type: Sequelize.DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        hujjat_raqam:  { type: Sequelize.DataTypes.STRING(30), allowNull: true },
        sana:          { type: Sequelize.DataTypes.DATE, allowNull: false },
        yetkazuvchi:   { type: Sequelize.DataTypes.STRING(120), allowNull: true },
        ombor:         { type: Sequelize.DataTypes.STRING(80), allowNull: true, defaultValue: 'Основной склад' },
        kirim_narx_turi: { type: Sequelize.DataTypes.STRING(60), allowNull: true },
        sotish_narx_turi: { type: Sequelize.DataTypes.STRING(60), allowNull: true },
        izoh:          { type: Sequelize.DataTypes.TEXT, allowNull: true },
        qoshimcha_xarajat: { type: Sequelize.DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
        jami_summa:    { type: Sequelize.DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        holat:         { type: Sequelize.DataTypes.ENUM('qoralama', 'tasdiqlangan'), allowNull: false, defaultValue: 'qoralama' },
        createdAt:     { type: Sequelize.DataTypes.DATE },
        updatedAt:     { type: Sequelize.DataTypes.DATE },
        deletedAt:     { type: Sequelize.DataTypes.DATE, allowNull: true },
      }, { transaction });

      await queryInterface.createTable('prixod_qator', {
        id:               { type: Sequelize.DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        prixod_id:        { type: Sequelize.DataTypes.INTEGER, allowNull: false, references: { model: 'prixod', key: 'id' }, onDelete: 'CASCADE' },
        tovar_id:         { type: Sequelize.DataTypes.INTEGER, allowNull: false },
        tovar_nomi:       { type: Sequelize.DataTypes.STRING(120), allowNull: false },
        tovar_kodi:       { type: Sequelize.DataTypes.STRING(30), allowNull: true },
        shtrix_kod:       { type: Sequelize.DataTypes.STRING(30), allowNull: true },
        turkum:           { type: Sequelize.DataTypes.STRING(80), allowNull: true },
        ishlab_chiqarish_sana: { type: Sequelize.DataTypes.DATEONLY, allowNull: true },
        yaroqlilik_muddati: { type: Sequelize.DataTypes.DATEONLY, allowNull: true },
        narx:             { type: Sequelize.DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        qutilarda:        { type: Sequelize.DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
        bloklarda:        { type: Sequelize.DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
        donada:           { type: Sequelize.DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
        hajm:             { type: Sequelize.DataTypes.DECIMAL(10, 3), allowNull: true },
        summa:            { type: Sequelize.DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
        createdAt:        { type: Sequelize.DataTypes.DATE },
        updatedAt:        { type: Sequelize.DataTypes.DATE },
      }, { transaction });

      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      throw e;
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('prixod_qator');
    await queryInterface.dropTable('prixod');
  },
};
