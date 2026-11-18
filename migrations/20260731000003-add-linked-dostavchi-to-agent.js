'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('agent', 'linked_dostavchi_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'dual_role',
      references: { model: 'dostavchi', key: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('agent', 'linked_dostavchi_id');
  },
};
