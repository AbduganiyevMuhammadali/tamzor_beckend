'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('tovar_register', 'optom_narx', {
      type: Sequelize.DECIMAL(18, 2), allowNull: true, defaultValue: 0, after: 'sotuv_narx',
    });
    await queryInterface.addColumn('tovar_register', 'optom_narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'optom_narx',
    });
    await queryInterface.addColumn('tovar_register', 'chakana_narx', {
      type: Sequelize.DECIMAL(18, 2), allowNull: true, defaultValue: 0, after: 'optom_narx_usd',
    });
    await queryInterface.addColumn('tovar_register', 'chakana_narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'chakana_narx',
    });
    await queryInterface.sequelize.query(`
      UPDATE tovar_register
      SET optom_narx = sotuv_narx, optom_narx_usd = sotuv_narx_usd,
          chakana_narx = sotuv_narx, chakana_narx_usd = sotuv_narx_usd
      WHERE sotuv_narx > 0 OR sotuv_narx_usd > 0
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tovar_register', 'optom_narx');
    await queryInterface.removeColumn('tovar_register', 'optom_narx_usd');
    await queryInterface.removeColumn('tovar_register', 'chakana_narx');
    await queryInterface.removeColumn('tovar_register', 'chakana_narx_usd');
  },
};
