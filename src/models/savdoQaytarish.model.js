const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

const pul = (k) => ({ type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0, get() { return parseFloat(this.getDataValue(k) || 0); } });

/* Sotuvga bog'langan qaytarish (mobil savdoQaytarish) — migrations/20261121000002 */
class SavdoQaytarishModel extends Model {}
SavdoQaytarishModel.init({
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  mobil_id:    { type: DataTypes.STRING(64), allowNull: true, unique: true },
  ariza_id:    { type: DataTypes.INTEGER, allowNull: false },
  ariza_raqam: { type: DataTypes.STRING(30), allowNull: true },
  agent_id:    { type: DataTypes.INTEGER, allowNull: false },
  agent_nomi:  { type: DataTypes.STRING(100), allowNull: true },
  mijoz_id:    { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi:  { type: DataTypes.STRING(150), allowNull: true },
  tolov:       { type: DataTypes.ENUM('qarz', 'naqd'), allowNull: false },
  summa:          pul('summa'),
  yaroqli_summa:  pul('yaroqli_summa'),
  yaroqsiz_summa: pul('yaroqsiz_summa'),
  eski_jami:      pul('eski_jami'),
  yangi_jami:     pul('yangi_jami'),
  kassa_id:    { type: DataTypes.INTEGER, allowNull: true },
  izoh:        { type: DataTypes.STRING(500), allowNull: true },
  sana:        { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'SavdoQaytarishModel', tableName: 'savdo_qaytarish', timestamps: true });

class SavdoQaytarishQatorModel extends Model {}
SavdoQaytarishQatorModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  qaytarish_id:   { type: DataTypes.INTEGER, allowNull: false },
  ariza_qator_id: { type: DataTypes.INTEGER, allowNull: true },
  tovar_id:       { type: DataTypes.INTEGER, allowNull: false },
  tovar_nomi:     { type: DataTypes.STRING(120), allowNull: true },
  dona:           { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0, get() { return parseFloat(this.getDataValue('dona') || 0); } },
  narx:           pul('narx'),
  summa:          pul('summa'),
  yaroqli:        { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  ombor:          { type: DataTypes.STRING(80), allowNull: true },
  sabab:          { type: DataTypes.STRING(255), allowNull: true },
}, { sequelize, modelName: 'SavdoQaytarishQatorModel', tableName: 'savdo_qaytarish_qator', timestamps: true });

SavdoQaytarishModel.hasMany(SavdoQaytarishQatorModel, { foreignKey: 'qaytarish_id', as: 'qatorlar' });

module.exports = { SavdoQaytarishModel, SavdoQaytarishQatorModel };
