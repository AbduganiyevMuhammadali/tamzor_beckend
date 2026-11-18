'use strict';

/* Barcha tovar kg'da sotiladi (go'sht/parranda) — yangi tovar kartasi uchun standart
   o'lchov birligi 'dona' emas, 'kg'. Birligi bo'sh qolgan tovarlar ham kg'ga o'tadi. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('tovar', 'olchov_birligi', {
      type: Sequelize.DataTypes.STRING(20), allowNull: true, defaultValue: 'kg',
    });
    await queryInterface.sequelize.query("UPDATE tovar SET olchov_birligi = 'kg' WHERE olchov_birligi IS NULL OR olchov_birligi = ''");
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('tovar', 'olchov_birligi', {
      type: Sequelize.DataTypes.STRING(20), allowNull: true, defaultValue: 'dona',
    });
  },
};
