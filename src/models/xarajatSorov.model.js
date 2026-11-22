const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Limitdan oshgan xarajat so'rovi — migrations/20261127000001 (FRONTEND-UCHUN §22) */
class XarajatSorovModel extends Model {}
XarajatSorovModel.init({
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kategoriya:       { type: DataTypes.STRING(50), allowNull: false },
  summa:            { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0, get() { return parseFloat(this.getDataValue('summa') || 0); } },
  kassa_id:         { type: DataTypes.INTEGER, allowNull: false },
  tolov_usul:       { type: DataTypes.ENUM('naqt', 'karta', 'bank'), allowNull: false, defaultValue: 'naqt' },
  sana:             { type: DataTypes.DATE, allowNull: false },
  izoh:             { type: DataTypes.STRING(255), allowNull: true },
  chek_rasm:        { type: DataTypes.STRING(255), allowNull: true },
  user_id:          { type: DataTypes.INTEGER, allowNull: true },
  user_nomi:        { type: DataTypes.STRING(100), allowNull: true },
  holat:            { type: DataTypes.ENUM('kutilmoqda', 'tasdiqlangan', 'rad_etildi', 'bekor'), allowNull: false, defaultValue: 'kutilmoqda' },
  tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_nomi: { type: DataTypes.STRING(100), allowNull: true },
  tasdiq_vaqt:      { type: DataTypes.DATE, allowNull: true },
  rad_sababi:       { type: DataTypes.STRING(500), allowNull: true },
  kassa_yozuv_id:   { type: DataTypes.INTEGER, allowNull: true },
  sorov_id:         { type: DataTypes.STRING(64), allowNull: true, unique: true },
}, { sequelize, modelName: 'XarajatSorovModel', tableName: 'xarajat_sorov', timestamps: true });

module.exports = XarajatSorovModel;
