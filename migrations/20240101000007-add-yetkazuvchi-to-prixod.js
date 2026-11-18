'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('prixod', 'yetkazuvchi_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      after: 'yetkazuvchi',
    });
    await queryInterface.addColumn('prixod', 'tolov_turi', {
      type: Sequelize.ENUM('naqt', 'optom', 'chaka'),
      allowNull: true,
      after: 'yetkazuvchi_id',
    });
    await queryInterface.addColumn('prixod', 'tolangan_summa', {
      type: Sequelize.DECIMAL(18, 2),
      allowNull: false,
      defaultValue: 0,
      after: 'tolov_turi',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('prixod', 'tolangan_summa');
    await queryInterface.removeColumn('prixod', 'tolov_turi');
    await queryInterface.removeColumn('prixod', 'yetkazuvchi_id');
  },
};
