'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('agent_location', 'rol', {
      type: Sequelize.ENUM('agent', 'dostavchi'),
      allowNull: false,
      defaultValue: 'agent',
      after: 'agent_id',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('agent_location', 'rol');
  },
};
