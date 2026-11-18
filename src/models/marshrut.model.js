const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* ── Marshrut rejasi (Plan): agent qaysi kunga qaysi mijozga borishi kerak ── */
class MarshrutRejaModel extends Model {}
MarshrutRejaModel.init({
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  agent_id: { type: DataTypes.INTEGER, allowNull: false },
  mijoz_id: { type: DataTypes.INTEGER, allowNull: false },
  sana:     { type: DataTypes.DATEONLY, allowNull: false },
  tartib:   { type: DataTypes.INTEGER, allowNull: true },
  izoh:     { type: DataTypes.STRING(255), allowNull: true },
}, {
  sequelize, modelName: 'MarshrutRejaModel', tableName: 'marshrut_reja',
  timestamps: true, paranoid: false,
});

/* ── Tashrif (Fact): check-in / check-out ──────────────────────────────── */
class TashrifModel extends Model {}
TashrifModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  reja_id:        { type: DataTypes.INTEGER, allowNull: true },
  agent_id:       { type: DataTypes.INTEGER, allowNull: false },
  agent_nomi:     { type: DataTypes.STRING(120), allowNull: true },
  mijoz_id:       { type: DataTypes.INTEGER, allowNull: false },
  mijoz_nomi:     { type: DataTypes.STRING(150), allowNull: true },
  checkin_vaqt:   { type: DataTypes.DATE, allowNull: true },
  checkin_lat:    { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  checkin_lng:    { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  checkin_masofa: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  checkout_vaqt:  { type: DataTypes.DATE, allowNull: true },
  checkout_lat:   { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  checkout_lng:   { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  davomiylik_sek: { type: DataTypes.INTEGER, allowNull: true },
  natija:         { type: DataTypes.ENUM('savdo', 'sotmaslik', 'ochiq'), defaultValue: 'ochiq' },
  ariza_id:       { type: DataTypes.INTEGER, allowNull: true },
  sana:           { type: DataTypes.DATEONLY, allowNull: false },
}, {
  sequelize, modelName: 'TashrifModel', tableName: 'tashrif',
  timestamps: true, paranoid: false,
});

module.exports = { MarshrutRejaModel, TashrifModel };
