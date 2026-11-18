'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('mijoz', 'narx_turi', {
      type: Sequelize.ENUM('optom', 'chakana'),
      allowNull: false,
      defaultValue: 'chakana',
      after: 'sinf',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('mijoz', 'narx_turi');
  },
};
