const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Tovar almashtirish (2026-11-28) — controllers/mobile/avtolavka.controller.js savdoAlmashtirish */
const dec = (k) => ({ type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0, get() { return parseFloat(this.getDataValue(k) || 0); } });
class SavdoAlmashtirishModel extends Model {}
SavdoAlmashtirishModel.init({
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
  raqam:         { type: DataTypes.STRING(30), allowNull: true },
  mobil_id:      { type: DataTypes.STRING(64), allowNull: true, unique: true },
  agent_id:      { type: DataTypes.INTEGER, allowNull: false },
  agent_nomi:    { type: DataTypes.STRING(120), allowNull: true },
  mijoz_id:      { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi:    { type: DataTypes.STRING(150), allowNull: true },
  asl_ariza_id:  { type: DataTypes.INTEGER, allowNull: false },
  asl_raqam:     { type: DataTypes.STRING(30), allowNull: true },
  qaytarish_id:  { type: DataTypes.INTEGER, allowNull: false },
  ariza_id:      { type: DataTypes.INTEGER, allowNull: false },
  ariza_raqam:   { type: DataTypes.STRING(30), allowNull: true },
  qaytgan_summa: dec('qaytgan_summa'),
  yangi_summa:   dec('yangi_summa'),
  farq:          dec('farq'),
  farq_usul:     { type: DataTypes.ENUM('naqd', 'balans'), allowNull: false },
  kassa_id:      { type: DataTypes.INTEGER, allowNull: true },
  izoh:          { type: DataTypes.STRING(500), allowNull: true },
  sana:          { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'SavdoAlmashtirishModel', tableName: 'savdo_almashtirish', timestamps: true, paranoid: false });

module.exports = SavdoAlmashtirishModel;
