const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class YetkazuvchiModel extends Model {}
YetkazuvchiModel.init({
  id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ism:     { type: DataTypes.STRING(120), allowNull: false },
  telefon: { type: DataTypes.STRING(30),  allowNull: true },
  manzil:  { type: DataTypes.STRING(255), allowNull: true },
  izoh:    { type: DataTypes.TEXT,        allowNull: true },
  balans:  { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
}, {
  sequelize,
  modelName: 'YetkazuvchiModel',
  tableName:  'yetkazuvchi',
  timestamps: true,
  paranoid:   false,
});

class YetkazuvchiHarakatlarModel extends Model {}
YetkazuvchiHarakatlarModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  yetkazuvchi_id: { type: DataTypes.INTEGER, allowNull: false },
  prixod_id:      { type: DataTypes.INTEGER, allowNull: true },
  tur:            { type: DataTypes.ENUM('qarz', 'tolov'), allowNull: false },
  summa:          { type: DataTypes.DECIMAL(18, 2), allowNull: false },
  tolov_turi:     { type: DataTypes.ENUM('naqt', 'optom', 'chaka'), allowNull: true },
  izoh:           { type: DataTypes.TEXT, allowNull: true },
  sana:           { type: DataTypes.DATE, allowNull: false },
}, {
  sequelize,
  modelName: 'YetkazuvchiHarakatlarModel',
  tableName:  'yetkazuvchi_harakatlar',
  timestamps: true,
  paranoid:   false,
});

YetkazuvchiModel.hasMany(YetkazuvchiHarakatlarModel, {
  foreignKey: 'yetkazuvchi_id',
  as: 'harakatlar',
});
YetkazuvchiHarakatlarModel.belongsTo(YetkazuvchiModel, {
  foreignKey: 'yetkazuvchi_id',
  as: 'yetkazuvchi',
});

module.exports = { YetkazuvchiModel, YetkazuvchiHarakatlarModel };
