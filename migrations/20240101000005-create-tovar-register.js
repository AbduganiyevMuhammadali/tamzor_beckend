'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('tovar_register', {
      id: {
        type: Sequelize.DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      // Tovar
      tovar_id:    { type: Sequelize.DataTypes.INTEGER,     allowNull: false },
      tovar_nomi:  { type: Sequelize.DataTypes.STRING(120), allowNull: false },
      turkum:      { type: Sequelize.DataTypes.STRING(80),  allowNull: true },
      ombor:       { type: Sequelize.DataTypes.STRING(80),  allowNull: true, defaultValue: 'Основной склад' },

      // Harakat turi
      // kirim | chiqim | qaytarma_kirim | qaytarma_chiqim | inventarizatsiya
      tur: {
        type: Sequelize.DataTypes.ENUM(
          'kirim',
          'chiqim',
          'qaytarma_kirim',
          'qaytarma_chiqim',
          'inventarizatsiya'
        ),
        allowNull: false,
      },

      // Manba hujjat
      manba_tur: {
        type: Sequelize.DataTypes.ENUM('prixod', 'sotuv', 'qaytarma', 'inventar'),
        allowNull: false,
      },
      manba_id: { type: Sequelize.DataTypes.INTEGER, allowNull: false },

      // Miqdor (donada saqlanadi — hisob birligi)
      donada:    { type: Sequelize.DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
      bloklarda: { type: Sequelize.DataTypes.DECIMAL(14, 3), allowNull: true,  defaultValue: 0 },
      qutilarda: { type: Sequelize.DataTypes.DECIMAL(14, 3), allowNull: true,  defaultValue: 0 },
      hajm:      { type: Sequelize.DataTypes.DECIMAL(14, 3), allowNull: true,  defaultValue: 0 },

      // Narxlar
      kirim_narx:  { type: Sequelize.DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
      sotuv_narx:  { type: Sequelize.DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
      summa:       { type: Sequelize.DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },

      // Sana
      sana: { type: Sequelize.DataTypes.DATE, allowNull: false },

      createdAt: { type: Sequelize.DataTypes.DATE },
      updatedAt: { type: Sequelize.DataTypes.DATE },
    });

    // Tez qidiruv uchun indekslar
    await queryInterface.addIndex('tovar_register', ['tovar_id']);
    await queryInterface.addIndex('tovar_register', ['manba_tur', 'manba_id']);
    await queryInterface.addIndex('tovar_register', ['tur']);
    await queryInterface.addIndex('tovar_register', ['sana']);
    await queryInterface.addIndex('tovar_register', ['ombor']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('tovar_register');
  },
};
