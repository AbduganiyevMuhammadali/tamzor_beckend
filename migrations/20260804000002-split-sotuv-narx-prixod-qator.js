'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('prixod_qator', 'optom_narx', {
      type: Sequelize.DECIMAL(18, 2), allowNull: true, defaultValue: 0, after: 'sotuv_narx',
    });
    await queryInterface.addColumn('prixod_qator', 'optom_narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'optom_narx',
    });
    await queryInterface.addColumn('prixod_qator', 'chakana_narx', {
      type: Sequelize.DECIMAL(18, 2), allowNull: true, defaultValue: 0, after: 'optom_narx_usd',
    });
    await queryInterface.addColumn('prixod_qator', 'chakana_narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'chakana_narx',
    });
    // Eski ma'lumotlarni ko'chirish: mavjud sotuv_narx qiymati ikkalasiga ham nusxalanadi
    // (aks holda eski prixodlarda narx 0 bo'lib qolib, sotuv formasida narx yo'qolib qolardi)
    await queryInterface.sequelize.query(`
      UPDATE prixod_qator
      SET optom_narx = sotuv_narx, optom_narx_usd = sotuv_narx_usd,
          chakana_narx = sotuv_narx, chakana_narx_usd = sotuv_narx_usd
      WHERE sotuv_narx > 0 OR sotuv_narx_usd > 0
    `);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('prixod_qator', 'optom_narx');
    await queryInterface.removeColumn('prixod_qator', 'optom_narx_usd');
    await queryInterface.removeColumn('prixod_qator', 'chakana_narx');
    await queryInterface.removeColumn('prixod_qator', 'chakana_narx_usd');
  },
};
