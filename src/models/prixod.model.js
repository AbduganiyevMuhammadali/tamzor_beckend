const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class PrixodQatorModel extends Model {}
PrixodQatorModel.init({
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  prixod_id:        { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:         { type: DataTypes.INTEGER, allowNull: false },
  tovar_nomi:       { type: DataTypes.STRING(120), allowNull: false },
  tovar_kodi:       { type: DataTypes.STRING(30), allowNull: true },
  shtrix_kod:       { type: DataTypes.STRING(30), allowNull: true },
  turkum:           { type: DataTypes.STRING(80), allowNull: true },
  ishlab_chiqarish_sana: { type: DataTypes.DATEONLY, allowNull: true },
  yaroqlilik_muddati:    { type: DataTypes.DATEONLY, allowNull: true },
  narx:             { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
  narx_usd:         { type: DataTypes.DECIMAL(18, 4), allowNull: true,  defaultValue: 0 },
  // Eski, endi ishlatilmaydigan yagona sotuv narxi — moslik uchun saqlanadi.
  sotuv_narx:       { type: DataTypes.DECIMAL(18, 2), allowNull: true,  defaultValue: 0 },
  sotuv_narx_usd:   { type: DataTypes.DECIMAL(18, 4), allowNull: true,  defaultValue: 0 },
  optom_narx:       { type: DataTypes.DECIMAL(18, 2), allowNull: true,  defaultValue: 0 },
  optom_narx_usd:   { type: DataTypes.DECIMAL(18, 4), allowNull: true,  defaultValue: 0 },
  chakana_narx:     { type: DataTypes.DECIMAL(18, 2), allowNull: true,  defaultValue: 0 },
  chakana_narx_usd: { type: DataTypes.DECIMAL(18, 4), allowNull: true,  defaultValue: 0 },
  kurs:             { type: DataTypes.DECIMAL(12, 2), allowNull: true },
  qutilarda:        { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
  bloklarda:        { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
  donada:           { type: DataTypes.DECIMAL(10, 3), allowNull: false, defaultValue: 0 },
  hajm:             { type: DataTypes.DECIMAL(10, 3), allowNull: true },
  summa:            { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  modelName: 'PrixodQatorModel',
  tableName: 'prixod_qator',
  timestamps: true,
  paranoid: false,
});

class PrixodModel extends Model {}
PrixodModel.init({
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  hujjat_raqam:     { type: DataTypes.STRING(30), allowNull: true },
  sana:             { type: DataTypes.DATE, allowNull: false },
  yetkazuvchi:      { type: DataTypes.STRING(120), allowNull: true },
  yetkazuvchi_id:   { type: DataTypes.INTEGER, allowNull: true },
  tolov_turi:       { type: DataTypes.ENUM('naqt', 'optom', 'chaka'), allowNull: true },
  tolangan_summa:   { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
  ombor:            { type: DataTypes.STRING(80), allowNull: true, defaultValue: 'Основной склад' },
  kirim_narx_turi:  { type: DataTypes.STRING(60), allowNull: true },
  sotish_narx_turi: { type: DataTypes.STRING(60), allowNull: true },
  izoh:             { type: DataTypes.TEXT, allowNull: true },
  qoshimcha_xarajat: { type: DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
  jami_summa:       { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
  holat:            { type: DataTypes.ENUM('qoralama', 'tasdiqlangan'), allowNull: false, defaultValue: 'qoralama' },
}, {
  sequelize,
  modelName: 'PrixodModel',
  tableName: 'prixod',
  timestamps: true,
  paranoid: true,
});

PrixodModel.hasMany(PrixodQatorModel, { foreignKey: 'prixod_id', as: 'qatorlar' });
PrixodQatorModel.belongsTo(PrixodModel, { foreignKey: 'prixod_id', as: 'prixod' });

const { YetkazuvchiModel } = require('./yetkazuvchi.model');
PrixodModel.belongsTo(YetkazuvchiModel, { foreignKey: 'yetkazuvchi_id', as: 'yetkazuvchiObj' });
YetkazuvchiModel.hasMany(PrixodModel,   { foreignKey: 'yetkazuvchi_id', as: 'prixodlar' });

module.exports = { PrixodModel, PrixodQatorModel };
