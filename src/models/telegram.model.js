const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Telegram mijoz boti (2026-11-28) — utils/telegram.utils.js */
class MijozTelegramModel extends Model {}
MijozTelegramModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
  mijoz_id:     { type: DataTypes.INTEGER, allowNull: false },
  chat_id:      { type: DataTypes.STRING(32), allowNull: false },
  tg_user_id:   { type: DataTypes.STRING(32), allowNull: true },
  telefon:      { type: DataTypes.STRING(32), allowNull: true },
  ism:          { type: DataTypes.STRING(150), allowNull: true },
  holat:        { type: DataTypes.ENUM('faol', 'bloklangan'), allowNull: false, defaultValue: 'faol' },
  xato:         { type: DataTypes.STRING(255), allowNull: true },
  oxirgi_xabar: { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'MijozTelegramModel', tableName: 'mijoz_telegram', timestamps: true, paranoid: false });

class TelegramXabarModel extends Model {}
TelegramXabarModel.init({
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
  mijoz_id: { type: DataTypes.INTEGER, allowNull: true },
  chat_id:  { type: DataTypes.STRING(32), allowNull: true },
  tur:      { type: DataTypes.STRING(30), allowNull: false },
  matn:     { type: DataTypes.TEXT, allowNull: true },
  holat:    { type: DataTypes.ENUM('yuborildi', 'xato'), allowNull: false },
  xato:     { type: DataTypes.STRING(255), allowNull: true },
  kim:      { type: DataTypes.STRING(150), allowNull: true },
}, { sequelize, modelName: 'TelegramXabarModel', tableName: 'telegram_xabar', timestamps: true, paranoid: false });

module.exports = { MijozTelegramModel, TelegramXabarModel };
