const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

const pul = (k) => ({ type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0, get() { return parseFloat(this.getDataValue(k) || 0); } });
const HOLAT = { type: DataTypes.ENUM('kutilmoqda', 'tasdiqlangan', 'rad_etildi'), allowNull: false, defaultValue: 'kutilmoqda' };

/* Kassalar (naqd kassa / plastik karta) — migrations/20261122000001.
   Eslatma: `kassa` jadvali (KassaModel) — pul harakatlari JURNALI; bu esa pul turadigan JOYLAR. */
class KassalarModel extends Model {}
KassalarModel.init({
  id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomi: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  tur:  { type: DataTypes.ENUM('naqd', 'plastik'), allowNull: false },
  faol: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  izoh: { type: DataTypes.STRING(255), allowNull: true },
}, { sequelize, modelName: 'KassalarModel', tableName: 'kassalar', timestamps: true });

class KassaViloyatModel extends Model {}
KassaViloyatModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kassa_id:       { type: DataTypes.INTEGER, allowNull: false },
  territoriya_id: { type: DataTypes.INTEGER, allowNull: false },
}, { sequelize, modelName: 'KassaViloyatModel', tableName: 'kassa_viloyat', timestamps: true });

KassalarModel.hasMany(KassaViloyatModel, { foreignKey: 'kassa_id', as: 'viloyatBog' });

/* Plastik to'lov (web tasdig'ini kutadi) — migrations/20261122000002 */
class PlastikTolovModel extends Model {}
PlastikTolovModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  mobil_id:       { type: DataTypes.STRING(64), allowNull: true, unique: true },
  tur:            { type: DataTypes.ENUM('qarz_tolov', 'sotuv'), allowNull: false },
  agent_id:       { type: DataTypes.INTEGER, allowNull: false },
  agent_nomi:     { type: DataTypes.STRING(100), allowNull: true },
  territoriya_id: { type: DataTypes.INTEGER, allowNull: true },
  mijoz_id:       { type: DataTypes.INTEGER, allowNull: false },
  mijoz_nomi:     { type: DataTypes.STRING(150), allowNull: true },
  ariza_id:       { type: DataTypes.INTEGER, allowNull: true, unique: true },
  ariza_raqam:    { type: DataTypes.STRING(30), allowNull: true },
  kassa_id:       { type: DataTypes.INTEGER, allowNull: false },
  summa:          pul('summa'),
  holat:          HOLAT,
  izoh:           { type: DataTypes.STRING(255), allowNull: true },
  chek_rasm:      { type: DataTypes.STRING(255), allowNull: true },
  sana:           { type: DataTypes.DATE, allowNull: false },
  tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_nomi: { type: DataTypes.STRING(100), allowNull: true },
  tasdiq_vaqt:      { type: DataTypes.DATE, allowNull: true },
  rad_sababi:       { type: DataTypes.STRING(500), allowNull: true },
  kassa_yozuv_id:   { type: DataTypes.INTEGER, allowNull: true },
}, { sequelize, modelName: 'PlastikTolovModel', tableName: 'plastik_tolov', timestamps: true });

/* Agent topshiruvi (naqd yoki karta) */
class PulTopshiruvModel extends Model {}
PulTopshiruvModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  mobil_id:   { type: DataTypes.STRING(64), allowNull: true, unique: true },
  agent_id:   { type: DataTypes.INTEGER, allowNull: false },
  agent_nomi: { type: DataTypes.STRING(100), allowNull: true },
  summa:      pul('summa'),
  izoh:       { type: DataTypes.STRING(500), allowNull: true },
  sana:       { type: DataTypes.DATE, allowNull: false },
  holat:      HOLAT,
  // 2026-11-23: 'naqd' — kassirga naqd; 'karta' — agent kartadan plastik kassaga o'tkazdi (kassa_id = o'sha kassa)
  usul:       { type: DataTypes.ENUM('naqd', 'karta'), allowNull: false, defaultValue: 'naqd' },
  chek_rasm:  { type: DataTypes.STRING(255), allowNull: true },
  kassa_id:   { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_nomi: { type: DataTypes.STRING(100), allowNull: true },
  tasdiq_vaqt:      { type: DataTypes.DATE, allowNull: true },
  rad_sababi:       { type: DataTypes.STRING(500), allowNull: true },
}, { sequelize, modelName: 'PulTopshiruvModel', tableName: 'pul_topshiruv', timestamps: true });

/* Audit: kim, qachon, eski → yangi, sabab */
class PulAuditModel extends Model {}
PulAuditModel.init({
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  obyekt:    { type: DataTypes.STRING(30), allowNull: false },
  obyekt_id: { type: DataTypes.INTEGER, allowNull: false },
  amal:      { type: DataTypes.STRING(30), allowNull: false },
  eski:      { type: DataTypes.TEXT, allowNull: true },
  yangi:     { type: DataTypes.TEXT, allowNull: true },
  sabab:     { type: DataTypes.STRING(500), allowNull: true },
  user_id:   { type: DataTypes.INTEGER, allowNull: true },
  user_nomi: { type: DataTypes.STRING(100), allowNull: true },
}, { sequelize, modelName: 'PulAuditModel', tableName: 'pul_audit', timestamps: true });

module.exports = { KassalarModel, KassaViloyatModel, PlastikTolovModel, PulTopshiruvModel, PulAuditModel };
