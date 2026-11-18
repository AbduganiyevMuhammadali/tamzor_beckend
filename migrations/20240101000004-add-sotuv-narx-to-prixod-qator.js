'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('prixod_qator', 'sotuv_narx', {
      type: Sequelize.DataTypes.DECIMAL(18, 2),
      allowNull: true,
      defaultValue: 0,
      after: 'narx',
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('prixod_qator', 'sotuv_narx');
  },
};
