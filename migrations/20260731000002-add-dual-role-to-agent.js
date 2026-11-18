'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('agent', 'dual_role', {
      type: Sequelize.BOOLEAN,
      allowNull: false,
      defaultValue: false,
      after: 'faol',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('agent', 'dual_role');
  },
};
