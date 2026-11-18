'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.createTable('tovar', {
        id: {
          autoIncrement: true,
          type: Sequelize.DataTypes.INTEGER,
          allowNull: false,
          primaryKey: true,
        },
        nomi: {
          type: Sequelize.DataTypes.STRING(120),
          allowNull: false,
        },
        turkum: {
          type: Sequelize.DataTypes.STRING(80),
          allowNull: true,
        },
        podkategoriya: {
          type: Sequelize.DataTypes.STRING(80),
          allowNull: true,
        },
        savdo_yonalishi: {
          type: Sequelize.DataTypes.STRING(80),
          allowNull: true,
        },
        shtrix_kod: {
          type: Sequelize.DataTypes.STRING(30),
          allowNull: true,
          unique: true,
        },
        hajm: {
          type: Sequelize.DataTypes.DECIMAL(10, 3),
          allowNull: true,
          defaultValue: 0,
        },
        ogirlik: {
          type: Sequelize.DataTypes.DECIMAL(10, 3),
          allowNull: true,
          defaultValue: 0,
        },
        blokdagi_soni: {
          type: Sequelize.DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 1,
        },
        qutidagi_bloklar: {
          type: Sequelize.DataTypes.INTEGER,
          allowNull: true,
          defaultValue: 1,
        },
        olchov_birligi: {
          type: Sequelize.DataTypes.STRING(20),
          allowNull: true,
          defaultValue: 'dona',
        },
        brend: {
          type: Sequelize.DataTypes.STRING(80),
          allowNull: true,
        },
        ishlab_chiqaruvchi: {
          type: Sequelize.DataTypes.STRING(100),
          allowNull: true,
        },
        segment: {
          type: Sequelize.DataTypes.STRING(40),
          allowNull: true,
        },
        guruh: {
          type: Sequelize.DataTypes.STRING(40),
          allowNull: true,
        },
        tavsif: {
          type: Sequelize.DataTypes.TEXT,
          allowNull: true,
        },
        faol: {
          type: Sequelize.DataTypes.BOOLEAN,
          allowNull: false,
          defaultValue: true,
        },
        createdAt: { type: Sequelize.DataTypes.DATE },
        updatedAt: { type: Sequelize.DataTypes.DATE },
        deletedAt: { type: Sequelize.DataTypes.DATE, allowNull: true },
      }, { transaction });

      await transaction.commit();
    } catch (e) {
      await transaction.rollback();
      throw e;
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tovar');
  },
};
