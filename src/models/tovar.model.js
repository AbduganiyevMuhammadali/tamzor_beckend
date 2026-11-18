const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class TovarModel extends Model {}

TovarModel.init({
  id:                 { type: DataTypes.INTEGER,       primaryKey: true, autoIncrement: true, allowNull: false },
  nomi:               { type: DataTypes.STRING(120),   allowNull: false },
  turkum:             { type: DataTypes.STRING(80),    allowNull: true },
  turkum_id:          { type: DataTypes.INTEGER,       allowNull: true },   // Sozlamalar → Turkumlar; nomi `turkum`da sinxron (utils/turkum.utils.js)
  podkategoriya:      { type: DataTypes.STRING(80),    allowNull: true },
  savdo_yonalishi:    { type: DataTypes.STRING(80),    allowNull: true },
  shtrix_kod:         { type: DataTypes.STRING(30),    allowNull: true, unique: true },
  hajm:               { type: DataTypes.DECIMAL(10,3), allowNull: true, defaultValue: 0 },
  ogirlik:            { type: DataTypes.DECIMAL(10,3), allowNull: true, defaultValue: 0 },
  blokdagi_soni:      { type: DataTypes.INTEGER,       allowNull: true, defaultValue: 1 },
  qutidagi_bloklar:   { type: DataTypes.INTEGER,       allowNull: true, defaultValue: 1 },
  olchov_birligi:     { type: DataTypes.STRING(20),    allowNull: true, defaultValue: 'kg' },
  brend:              { type: DataTypes.STRING(80),    allowNull: true },
  ishlab_chiqaruvchi: { type: DataTypes.STRING(100),   allowNull: true },
  segment:            { type: DataTypes.STRING(40),    allowNull: true },
  guruh:              { type: DataTypes.STRING(40),    allowNull: true },
  tavsif:             { type: DataTypes.TEXT,          allowNull: true },
  faol:               { type: DataTypes.BOOLEAN,       allowNull: false, defaultValue: true },
  // 'xom_ashyo' — sotilmaydi, "Xom ashyo ombori"da turadi va ishlab chiqarishga beriladi (utils/ombor.utils.js turOmbori)
  turi:               { type: DataTypes.ENUM('tovar', 'xom_ashyo'), allowNull: false, defaultValue: 'tovar' },
}, {
  sequelize,
  modelName: 'TovarModel',
  tableName:  'tovar',
  timestamps: true,
  paranoid:   true,
});

module.exports = TovarModel;
