const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Tovar turkumi (Sozlamalar → Turkumlar). Tovar `turkum_id` bilan bog'lanadi,
   nomi `tovar.turkum`ga va hujjat qatorlariga nusxalanadi (hisobotlar nom bo'yicha
   guruhlaydi) — qayta nomlash utils/turkum.utils.js orqali hammasiga tarqaladi. */
class TurkumModel extends Model {}
TurkumModel.init({
  id:     { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomi:   { type: DataTypes.STRING(80), allowNull: false, unique: true },
  kod:    { type: DataTypes.STRING(30), allowNull: true },
  izoh:   { type: DataTypes.STRING(255), allowNull: true },
  tartib: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  faol:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { sequelize, modelName: 'TurkumModel', tableName: 'turkum', timestamps: true });

module.exports = TurkumModel;
