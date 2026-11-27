const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Mijozga tovar bo'yicha skidka (2026-11-27) — utils/skidka.utils.js */
class MijozSkidkaModel extends Model {}
MijozSkidkaModel.init({
  id:        { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
  mijoz_id:  { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:  { type: DataTypes.INTEGER, allowNull: false },
  tur:       { type: DataTypes.ENUM('foiz', 'summa'), allowNull: false },
  qiymat:    { type: DataTypes.DECIMAL(18, 2), allowNull: false, get() { return parseFloat(this.getDataValue('qiymat') || 0); } },
  dan:       { type: DataTypes.DATEONLY, allowNull: true },
  gacha:     { type: DataTypes.DATEONLY, allowNull: true },
  izoh:      { type: DataTypes.STRING(255), allowNull: true },
  user_id:   { type: DataTypes.INTEGER, allowNull: true },
  user_nomi: { type: DataTypes.STRING(100), allowNull: true },
}, { sequelize, modelName: 'MijozSkidkaModel', tableName: 'mijoz_skidka', timestamps: true, paranoid: false });

module.exports = MijozSkidkaModel;
