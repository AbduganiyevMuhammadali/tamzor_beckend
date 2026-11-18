'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('agent', {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      fullname: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      telefon: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      passport: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      tugilgan_sana: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      territoriya_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: 'territoriya', key: 'id' },
        onDelete: 'SET NULL',
        onUpdate: 'CASCADE',
      },
      plan_summa: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: true,
        defaultValue: 0,
      },
      bonus_foiz: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 0,
      },
      kredit_limit: {
        type: Sequelize.DECIMAL(18, 2),
        allowNull: true,
        defaultValue: 0,
      },
      max_chegirma: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: true,
        defaultValue: 0,
      },
      ish_boshlagan: {
        type: Sequelize.DATEONLY,
        allowNull: true,
      },
      // Tashrif kunlari: "Du,Se,Ch" formatida saqlash
      tashrif_kunlari: {
        type: Sequelize.STRING(50),
        allowNull: true,
      },
      // Marshrut
      boshlanish_manzil: {
        type: Sequelize.STRING(255),
        allowNull: true,
      },
      transport: {
        type: Sequelize.ENUM('avto', 'moto', 'piyoda', 'velosiped', 'boshqa'),
        allowNull: true,
      },
      mashina_raqam: {
        type: Sequelize.STRING(20),
        allowNull: true,
      },
      radius_km: {
        type: Sequelize.DECIMAL(8, 2),
        allowNull: true,
      },
      izoh: {
        type: Sequelize.TEXT,
        allowNull: true,
      },
      faol: {
        type: Sequelize.BOOLEAN,
        defaultValue: true,
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
      },
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    await queryInterface.addIndex('agent', ['territoriya_id']);
    await queryInterface.addIndex('agent', ['faol']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('agent');
  },
};
