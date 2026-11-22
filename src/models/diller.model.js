const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* DILLERLAR (2026-11-29) — migrations/20261129000001-diller.js, mantiq utils/diller.utils.js */
const pul = (k) => ({ type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0,
  get() { return parseFloat(this.getDataValue(k) || 0); } });

class DillerHujjatModel extends Model {}
DillerHujjatModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  raqam:          { type: DataTypes.STRING(30), allowNull: false, unique: true },
  diller_id:      { type: DataTypes.INTEGER, allowNull: false },
  diller_nomi:    { type: DataTypes.STRING(100), allowNull: true },
  tur:            { type: DataTypes.ENUM('berish', 'tolov', 'qaytarish'), allowNull: false },
  sana:           { type: DataTypes.DATE, allowNull: false },
  jami:           pul('jami'),
  tolangan:       pul('tolangan'),
  kassa_id:       { type: DataTypes.INTEGER, allowNull: true },
  kassa_yozuv_id: { type: DataTypes.INTEGER, allowNull: true },
  ariza_id:       { type: DataTypes.INTEGER, allowNull: true },
  izoh:           { type: DataTypes.STRING(500), allowNull: true },
  sorov_id:       { type: DataTypes.STRING(64), allowNull: true, unique: true },
  user_id:        { type: DataTypes.INTEGER, allowNull: true },
  user_nomi:      { type: DataTypes.STRING(100), allowNull: true },
}, { sequelize, modelName: 'DillerHujjatModel', tableName: 'diller_hujjat', timestamps: true, paranoid: false });

class DillerHujjatQatorModel extends Model {}
DillerHujjatQatorModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  hujjat_id:  { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:   { type: DataTypes.INTEGER, allowNull: false },
  tovar_nomi: { type: DataTypes.STRING(120), allowNull: false },
  dona:       { type: DataTypes.DECIMAL(18, 3), allowNull: false, get() { return parseFloat(this.getDataValue('dona') || 0); } },
  narx:       pul('narx'),
  summa:      pul('summa'),
}, { sequelize, modelName: 'DillerHujjatQatorModel', tableName: 'diller_hujjat_qator', timestamps: false });

DillerHujjatModel.hasMany(DillerHujjatQatorModel, { foreignKey: 'hujjat_id', as: 'qatorlar' });

class DillerNarxModel extends Model {}
DillerNarxModel.init({
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  diller_id: { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:  { type: DataTypes.INTEGER, allowNull: false },
  narx:      pul('narx'),
}, { sequelize, modelName: 'DillerNarxModel', tableName: 'diller_narx', timestamps: true });

/* Dillerning O'Z puli (mijozlaridan) — kompaniya kassasi emas */
class DillerPulModel extends Model {}
DillerPulModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  diller_id:    { type: DataTypes.INTEGER, allowNull: false },
  tur:          { type: DataTypes.ENUM('kirim', 'chiqim'), allowNull: false },
  kategoriya:   { type: DataTypes.ENUM('sotuv', 'mijoz_tolov', 'qaytarish'), allowNull: false },
  usul:         { type: DataTypes.ENUM('naqd', 'plastik'), allowNull: false, defaultValue: 'naqd' },
  summa:        pul('summa'),
  mijoz_id:     { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi:   { type: DataTypes.STRING(150), allowNull: true },
  ariza_id:     { type: DataTypes.INTEGER, allowNull: true },
  qaytarish_id: { type: DataTypes.INTEGER, allowNull: true },
  mobil_id:     { type: DataTypes.STRING(64), allowNull: true, unique: true },
  izoh:         { type: DataTypes.STRING(255), allowNull: true },
  chek_rasm:    { type: DataTypes.STRING(255), allowNull: true },
  sana:         { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'DillerPulModel', tableName: 'diller_pul', timestamps: true });

module.exports = { DillerHujjatModel, DillerHujjatQatorModel, DillerNarxModel, DillerPulModel };
