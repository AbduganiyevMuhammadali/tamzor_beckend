'use strict';
// Ariza dan eski yetkazuvchi_id/nomi olib tashlanadi —
// buyurtma yetkazish endi dostavchi_id orqali boshqariladi.
module.exports = {
  async up(queryInterface, Sequelize) {
    const table = await queryInterface.describeTable('ariza');
    if (table.yetkazuvchi_id)   await queryInterface.removeColumn('ariza', 'yetkazuvchi_id');
    if (table.yetkazuvchi_nomi) await queryInterface.removeColumn('ariza', 'yetkazuvchi_nomi');
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.addColumn('ariza', 'yetkazuvchi_id',   { type: Sequelize.INTEGER, allowNull: true });
    await queryInterface.addColumn('ariza', 'yetkazuvchi_nomi', { type: Sequelize.STRING(120), allowNull: true });
  },
};
