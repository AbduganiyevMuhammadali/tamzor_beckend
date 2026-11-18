'use strict';

// Yetkazib berish vaqtida qisman qaytarish yoki brak (yaroqsiz) tovarni joyida
// rasmiylashtirish. Ariza umuman bekor bo'lmaydi — faqat qatorlardagi ba'zi
// dona/summasi ayiriladi va ombor holatiga (qaytarma yoki brak) mos yoziladi.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('yetkazish_qaytarish', {
      id:           { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      ariza_id:     { type: Sequelize.INTEGER, allowNull: false },
      tovar_id:     { type: Sequelize.INTEGER, allowNull: true },
      tovar_nomi:   { type: Sequelize.STRING(150), allowNull: true },
      dona:         { type: Sequelize.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
      summa:        { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      tur:          { type: Sequelize.ENUM('qaytarma', 'brak'), allowNull: false, defaultValue: 'qaytarma' },
      // qaytarma → ombordagi SOTILADIGAN qoldiqqa qaytadi
      // brak     → alohida "Brak ombori"ga tushadi, sotuvga qaytmaydi
      sabab:        { type: Sequelize.STRING(255), allowNull: true },
      dostavchi_id: { type: Sequelize.INTEGER, allowNull: true },
      sana:         { type: Sequelize.DATE, allowNull: false },
      createdAt:    { type: Sequelize.DATE, allowNull: false },
      updatedAt:    { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('yetkazish_qaytarish', ['ariza_id']);
    await queryInterface.addIndex('yetkazish_qaytarish', ['tur']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('yetkazish_qaytarish');
  },
};
