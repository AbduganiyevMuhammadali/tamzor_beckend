const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* ── Audit natijasi (mobil chekUp) ──────────────────────── */
class AuditModel extends Model {}
AuditModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  agent_id:     { type: DataTypes.INTEGER, allowNull: true },
  agent_nomi:   { type: DataTypes.STRING(120), allowNull: true },
  mijoz_id:     { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi:   { type: DataTypes.STRING(150), allowNull: true },
  maydon:       { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  stend:        { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  biz_bilan:    { type: DataTypes.DECIMAL(5, 2), allowNull: true },
  bizsiz:       { type: DataTypes.DECIMAL(5, 2), allowNull: true },
  sabab:        { type: DataTypes.STRING(120), allowNull: true },
  shikoyat:     { type: DataTypes.TEXT, allowNull: true },
  taklif:       { type: DataTypes.TEXT, allowNull: true },
  kirish_vaqt:  { type: DataTypes.STRING(20), allowNull: true },
  chiqish_vaqt: { type: DataTypes.STRING(20), allowNull: true },
  lat:          { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  lng:          { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  tovarlar: {
    type: DataTypes.JSON, allowNull: true,
    // mysql2 ba'zan JSON ni string qaytaradi — doim massivga keltiramiz
    get() {
      const v = this.getDataValue('tovarlar');
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
      return v || [];
    },
  },
  rasmlar: {
    type: DataTypes.JSON, allowNull: true,
    get() {
      const v = this.getDataValue('rasmlar');
      if (typeof v === 'string') { try { return JSON.parse(v); } catch { return []; } }
      return v || [];
    },
  },
  sana:         { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'AuditModel', tableName: 'audit_natija', timestamps: true, paranoid: false });

/* ── Sotmaslik sabablari (mobil clientNotSell) ──────────── */
class SotmaslikModel extends Model {}
SotmaslikModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  agent_id:   { type: DataTypes.INTEGER, allowNull: true },
  agent_nomi: { type: DataTypes.STRING(120), allowNull: true },
  mijoz_id:   { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi: { type: DataTypes.STRING(150), allowNull: true },
  sabab_id:   { type: DataTypes.STRING(30), allowNull: true },
  sabab_nomi: { type: DataTypes.STRING(120), allowNull: true },
  sana:       { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'SotmaslikModel', tableName: 'sotmaslik', timestamps: true, paranoid: false });

/* ── Agent/dostavchi GPS marshruti (mobil sendLocation) ─────
   `agent_id` — agent yoki dostavchining ID'si (jadval nomi tarixiy
   sababli "agent_location" qolgan); `rol` shu ID qaysi jadvalga
   tegishli ekanini bildiradi — aks holda agent va dostavchi ID
   raqamlari to'qnashib, GPS izi noto'g'ri odamga yozilib qolardi. */
class AgentLocationModel extends Model {}
AgentLocationModel.init({
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  agent_id: { type: DataTypes.INTEGER, allowNull: true },
  rol:      { type: DataTypes.ENUM('agent', 'dostavchi'), allowNull: false, defaultValue: 'agent' },
  lat:      { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  lng:      { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  battery:  { type: DataTypes.INTEGER, allowNull: true },
  sana:     { type: DataTypes.DATE, allowNull: true },
}, { sequelize, modelName: 'AgentLocationModel', tableName: 'agent_location', timestamps: true, paranoid: false });

module.exports = { AuditModel, SotmaslikModel, AgentLocationModel };
