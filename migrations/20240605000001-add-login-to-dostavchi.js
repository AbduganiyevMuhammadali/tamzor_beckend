'use strict';

// Dostavchik mobil ilovadan kirishi uchun login/parol ustunlari
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('dostavchi', 'login', {
      type: Sequelize.STRING(50),
      allowNull: true,
      unique: true,
      after: 'ism',
    });
    await queryInterface.addColumn('dostavchi', 'parol', {
      type: Sequelize.STRING(100),
      allowNull: true,
      after: 'login',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('dostavchi', 'parol');
    await queryInterface.removeColumn('dostavchi', 'login');
  },
};
