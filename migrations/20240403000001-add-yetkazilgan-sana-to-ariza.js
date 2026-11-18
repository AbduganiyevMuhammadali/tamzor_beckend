'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('ariza');
    if (!table.yetkazilgan_sana) {
      await queryInterface.addColumn('ariza', 'yetkazilgan_sana', {
        type: Sequelize.DATE,
        allowNull: true,
      });
    }
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('ariza', 'yetkazilgan_sana');
  },
};
