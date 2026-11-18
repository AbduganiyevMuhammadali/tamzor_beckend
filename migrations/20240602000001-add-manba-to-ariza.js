'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Zakaz qayerdan tushganini bildiradi: web (admin panel) yoki mobil (ilova)
    await queryInterface.addColumn('ariza', 'manba', {
      type: Sequelize.ENUM('web', 'mobil'),
      allowNull: false,
      defaultValue: 'web',
      after: 'turi',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('ariza', 'manba');
  },
};
