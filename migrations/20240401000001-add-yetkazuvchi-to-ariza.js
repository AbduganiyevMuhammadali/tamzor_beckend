'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ariza', 'yetkazuvchi_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'yetkazuvchi', key: 'id' },
      onUpdate: 'SET NULL',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('ariza', 'yetkazuvchi_nomi', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('ariza', 'yetkazuvchi_id');
    await queryInterface.removeColumn('ariza', 'yetkazuvchi_nomi');
  },
};
