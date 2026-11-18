const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Kunlik xarajat toifasi — kassa.kategoriya shu `kod` ni saqlaydi */
class XarajatTuriModel extends Model {}
XarajatTuriModel.init({
  id:     { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  kod:    { type: DataTypes.STRING(50), allowNull: false, unique: true },
  nomi:   { type: DataTypes.STRING(100), allowNull: false },
  ikon:   { type: DataTypes.STRING(30), allowNull: true },
  tartib: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  faol:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { sequelize, modelName: 'XarajatTuriModel', tableName: 'xarajat_turi', timestamps: true });

module.exports = XarajatTuriModel;
