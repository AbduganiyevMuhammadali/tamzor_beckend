const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class SozlamaModel extends Model {}
SozlamaModel.init({
  kalit:  { type: DataTypes.STRING(60), primaryKey: true, allowNull: false },
  qiymat: { type: DataTypes.STRING(255), allowNull: true },
  izoh:   { type: DataTypes.STRING(255), allowNull: true },
}, {
  sequelize,
  modelName: 'SozlamaModel',
  tableName: 'sozlama',
  timestamps: true,
  paranoid: false,
});

module.exports = SozlamaModel;
