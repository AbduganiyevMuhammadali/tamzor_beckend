'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('user', 'perms', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: null,
    });
  },
  down: async (queryInterface) => {
    await queryInterface.removeColumn('user', 'perms');
  },
};
