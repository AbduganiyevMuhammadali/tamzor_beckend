/* Agentdan agentga ko'chirish — migrations/20261126000001-agent-kochirish.js */
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

const son = (k, d = 2) => ({
  type: DataTypes.DECIMAL(18, d), allowNull: false, defaultValue: 0,
  get() { return parseFloat(this.getDataValue(k) || 0); },
});

class AgentKochirishModel extends Model {}
AgentKochirishModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  raqam:          { type: DataTypes.STRING(30), allowNull: false, unique: true },
  dan_agent_id:   { type: DataTypes.INTEGER, allowNull: false },
  dan_agent_nomi: { type: DataTypes.STRING(120), allowNull: true },
  ga_agent_id:    { type: DataTypes.INTEGER, allowNull: false },
  ga_agent_nomi:  { type: DataTypes.STRING(120), allowNull: true },
  sana:           { type: DataTypes.DATE, allowNull: false },
  izoh:           { type: DataTypes.STRING(500), allowNull: true },
  sabab:          { type: DataTypes.STRING(500), allowNull: true },
  holat:          { type: DataTypes.ENUM('faol', 'bekor'), allowNull: false, defaultValue: 'faol' },
  sorov_id:       { type: DataTypes.STRING(64), allowNull: true, unique: true },
  user_id:        { type: DataTypes.INTEGER, allowNull: true },
  user_nomi:      { type: DataTypes.STRING(100), allowNull: true },
  bekor_user_id:  { type: DataTypes.INTEGER, allowNull: true },
  bekor_vaqt:     { type: DataTypes.DATE, allowNull: true },
  bekor_sababi:   { type: DataTypes.STRING(500), allowNull: true },
}, { sequelize, modelName: 'AgentKochirishModel', tableName: 'agent_kochirish', timestamps: true });

class AgentKochirishQatorModel extends Model {}
AgentKochirishQatorModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kochirish_id: { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:     { type: DataTypes.INTEGER, allowNull: false },
  tovar_nomi:   { type: DataTypes.STRING(120), allowNull: false },
  dona:         son('dona', 3),
  tannarx:      son('tannarx'),
  summa:        son('summa'),
}, { sequelize, modelName: 'AgentKochirishQatorModel', tableName: 'agent_kochirish_qator', timestamps: true });

class AgentKochirishAuditModel extends Model {}
AgentKochirishAuditModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kochirish_id: { type: DataTypes.INTEGER, allowNull: false },
  amal:         { type: DataTypes.ENUM('yaratildi', 'tahrirlandi', 'bekor_qilindi'), allowNull: false },
  eski:         { type: DataTypes.TEXT, allowNull: true },
  yangi:        { type: DataTypes.TEXT, allowNull: true },
  sabab:        { type: DataTypes.STRING(500), allowNull: true },
  user_id:      { type: DataTypes.INTEGER, allowNull: true },
  user_nomi:    { type: DataTypes.STRING(100), allowNull: true },
  vaqt:         { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'AgentKochirishAuditModel', tableName: 'agent_kochirish_audit', timestamps: false });

module.exports = { AgentKochirishModel, AgentKochirishQatorModel, AgentKochirishAuditModel };
