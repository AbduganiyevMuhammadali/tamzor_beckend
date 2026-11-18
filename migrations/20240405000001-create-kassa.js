'use strict';
// Kassa harakatlari — qo'lda kirim/chiqim va mijoz to'lovlari.
// Avtomatik sotuv/prixod pullari mavjud jadvallardan yig'iladi, bu jadval
// qo'lda amallar (xarajat, boshqa daromad) va mijoz to'lovlari uchun.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('kassa', {
      id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
      tur:        { type: Sequelize.ENUM('kirim', 'chiqim'), allowNull: false },
      // kategoriya: mijoz_tolov, boshqa_daromad / xarajat, ish_haqi, ijara, boshqa_chiqim
      kategoriya: { type: Sequelize.STRING(50), allowNull: false },
      summa:      { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      tolov_usul: { type: Sequelize.ENUM('naqt', 'karta', 'bank'), allowNull: false, defaultValue: 'naqt' },
      // bog'liq hujjat (ixtiyoriy)
      manba_tur:  { type: Sequelize.STRING(30), allowNull: true },  // ariza, mijoz, prixod, qol
      manba_id:   { type: Sequelize.INTEGER, allowNull: true },
      mijoz_id:   { type: Sequelize.INTEGER, allowNull: true },
      mijoz_nomi: { type: Sequelize.STRING(150), allowNull: true },
      izoh:       { type: Sequelize.STRING(255), allowNull: true },
      sana:       { type: Sequelize.DATE, allowNull: false },
      user_id:    { type: Sequelize.INTEGER, allowNull: true },  // kim kiritdi
      createdAt:  { type: Sequelize.DATE, allowNull: false },
      updatedAt:  { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('kassa', ['sana']);
    await queryInterface.addIndex('kassa', ['tur', 'kategoriya']);
    await queryInterface.addIndex('kassa', ['mijoz_id']);
  },
  async down(queryInterface) {
    await queryInterface.dropTable('kassa');
  },
};
