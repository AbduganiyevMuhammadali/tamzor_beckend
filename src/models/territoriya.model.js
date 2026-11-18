const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class TerritoriyaModel extends Model {}
TerritoriyaModel.init({
  id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomi: { type: DataTypes.STRING(100), allowNull: false },
  izoh: { type: DataTypes.STRING(255), allowNull: true },
}, { sequelize, modelName: 'TerritoriyaModel', tableName: 'territoriya', timestamps: true });

module.exports = TerritoriyaModel;
