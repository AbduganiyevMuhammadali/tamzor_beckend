/* Buyumlar (sotilmaydigan jihozlar) — migrations/20261128000001-buyumlar.js, mantiq: utils/buyum.utils.js */
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class BuyumModel extends Model {}
BuyumModel.init({
  id:     { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomi:   { type: DataTypes.STRING(120), allowNull: false, unique: true },
  birlik: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'dona' },
  izoh:   { type: DataTypes.STRING(500), allowNull: true },
  faol:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { sequelize, modelName: 'BuyumModel', tableName: 'buyum', timestamps: true });

class BuyumHarakatModel extends Model {}
BuyumHarakatModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  raqam:        { type: DataTypes.STRING(30), allowNull: false, unique: true },
  tur:          { type: DataTypes.ENUM('kirim', 'agentga', 'agentdan', 'agentdan_agentga', 'mijozga', 'mijozdan'), allowNull: false },
  dan_agent_id: { type: DataTypes.INTEGER, allowNull: true },
  ga_agent_id:  { type: DataTypes.INTEGER, allowNull: true },
  agent_id:     { type: DataTypes.INTEGER, allowNull: true },
  mijoz_id:     { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi:   { type: DataTypes.STRING(150), allowNull: true },
  sana:         { type: DataTypes.DATE, allowNull: false },
  izoh:         { type: DataTypes.STRING(500), allowNull: true },
  rasm:         { type: DataTypes.STRING(255), allowNull: true },
  mobil_id:     { type: DataTypes.STRING(64), allowNull: true, unique: true },
  sorov_id:     { type: DataTypes.STRING(64), allowNull: true, unique: true },
  user_id:      { type: DataTypes.INTEGER, allowNull: true },
  user_nomi:    { type: DataTypes.STRING(100), allowNull: true },
}, { sequelize, modelName: 'BuyumHarakatModel', tableName: 'buyum_harakat', timestamps: true });

class BuyumHarakatQatorModel extends Model {}
BuyumHarakatQatorModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  harakat_id: { type: DataTypes.INTEGER, allowNull: false },
  buyum_id:   { type: DataTypes.INTEGER, allowNull: false },
  buyum_nomi: { type: DataTypes.STRING(120), allowNull: false },
  dona:       { type: DataTypes.INTEGER, allowNull: false },
}, { sequelize, modelName: 'BuyumHarakatQatorModel', tableName: 'buyum_harakat_qator', timestamps: false });

module.exports = { BuyumModel, BuyumHarakatModel, BuyumHarakatQatorModel };
