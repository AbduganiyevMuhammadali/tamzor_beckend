'use strict';
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('dostavchi', {
      id:       { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      ism:      { type: Sequelize.STRING(120), allowNull: false },
      telefon:  { type: Sequelize.STRING(30),  allowNull: true },
      transport:{ type: Sequelize.STRING(80),  allowNull: true },  // mashina, moto, velosiped
      mashina_raqam: { type: Sequelize.STRING(30), allowNull: true },
      izoh:     { type: Sequelize.TEXT, allowNull: true },
      faol:     { type: Sequelize.BOOLEAN, defaultValue: true, allowNull: false },
      createdAt:{ type: Sequelize.DATE, allowNull: false },
      updatedAt:{ type: Sequelize.DATE, allowNull: false },
    });

    // Ariza jadvaliga dostavchi_id qo'shish
    await queryInterface.addColumn('ariza', 'dostavchi_id', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: { model: 'dostavchi', key: 'id' },
      onUpdate: 'SET NULL',
      onDelete: 'SET NULL',
    });
    await queryInterface.addColumn('ariza', 'dostavchi_nomi', {
      type: Sequelize.STRING(120),
      allowNull: true,
    });
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('ariza', 'dostavchi_id');
    await queryInterface.removeColumn('ariza', 'dostavchi_nomi');
    await queryInterface.dropTable('dostavchi');
  },
};
