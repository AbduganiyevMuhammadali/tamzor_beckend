'use strict';

/* TELEGRAM MIJOZ BOTI (2026-11-28)
   mijoz_telegram — mijoz ↔ Telegram chat bog'lanishi: mijoz botda /start qilib telefon raqamini yuboradi,
     raqam mijoz telefoniga (oxirgi 9 raqam) mos kelsa bog'lanadi. holat 'faol' | 'bloklangan' (botni bloklagan /
     akkaunt o'chgan — yuborishda aniqlanadi, qayta /start qilsa faol).
   telegram_xabar — yuborilgan/yuborilmagan xabarlar jurnali (amal bekor bo'lsa ham yozuv qoladi).
   Sozlamalar: sozlama 'tg_<tur>' = '1' | '0' (utils/telegram.utils.js). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (!jadvallar.includes('mijoz_telegram')) {
      await queryInterface.createTable('mijoz_telegram', {
        id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        mijoz_id:   { type: DataTypes.INTEGER, allowNull: false },
        chat_id:    { type: DataTypes.STRING(32), allowNull: false },
        tg_user_id: { type: DataTypes.STRING(32), allowNull: true },
        telefon:    { type: DataTypes.STRING(32), allowNull: true },
        ism:        { type: DataTypes.STRING(150), allowNull: true },
        holat:      { type: DataTypes.ENUM('faol', 'bloklangan'), allowNull: false, defaultValue: 'faol' },
        xato:       { type: DataTypes.STRING(255), allowNull: true },
        oxirgi_xabar: { type: DataTypes.DATE, allowNull: true },
        createdAt:  { type: DataTypes.DATE, allowNull: false },
        updatedAt:  { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('mijoz_telegram', ['mijoz_id', 'chat_id'], { unique: true, name: 'uq_mijoz_telegram' });
      await queryInterface.addIndex('mijoz_telegram', ['chat_id'], { name: 'idx_mijoz_telegram_chat' });
    }
    if (!jadvallar.includes('telegram_xabar')) {
      await queryInterface.createTable('telegram_xabar', {
        id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        mijoz_id:  { type: DataTypes.INTEGER, allowNull: true },
        chat_id:   { type: DataTypes.STRING(32), allowNull: true },
        tur:       { type: DataTypes.STRING(30), allowNull: false },
        matn:      { type: DataTypes.TEXT, allowNull: true },
        holat:     { type: DataTypes.ENUM('yuborildi', 'xato'), allowNull: false },
        xato:      { type: DataTypes.STRING(255), allowNull: true },
        kim:       { type: DataTypes.STRING(150), allowNull: true },
        createdAt: { type: DataTypes.DATE, allowNull: false },
        updatedAt: { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('telegram_xabar', ['mijoz_id', 'createdAt'], { name: 'idx_telegram_xabar_mijoz' });
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('telegram_xabar');
    await queryInterface.dropTable('mijoz_telegram');
  },
};
