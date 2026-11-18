const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const TovarModel = require('./tovar.model');

/* ── Narx ro'yxati (nomli narx jadvali) ──────────────────── */
class NarxRuyxatModel extends Model {}
NarxRuyxatModel.init({
  id:       { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomi:     { type: DataTypes.STRING(100), allowNull: false },
  tur:      { type: DataTypes.ENUM('optom', 'chakana', 'maxsus'), allowNull: false, defaultValue: 'chakana' },
  standart: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  faol:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
  izoh:     { type: DataTypes.STRING(255), allowNull: true },
}, { sequelize, modelName: 'NarxRuyxatModel', tableName: 'narx_ruyxat', timestamps: true });

/* ── Ro'yxatdagi tovar narxi ─────────────────────────────── */
class NarxRuyxatQatorModel extends Model {}
NarxRuyxatQatorModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  narx_ruyxat_id: { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:       { type: DataTypes.INTEGER, allowNull: false },
  narx:           { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0,
    get() { const v = this.getDataValue('narx'); return v == null ? 0 : parseFloat(v); } },
}, { sequelize, modelName: 'NarxRuyxatQatorModel', tableName: 'narx_ruyxat_qator', timestamps: true });

NarxRuyxatModel.hasMany(NarxRuyxatQatorModel, { foreignKey: 'narx_ruyxat_id', as: 'qatorlar', onDelete: 'CASCADE' });
NarxRuyxatQatorModel.belongsTo(NarxRuyxatModel, { foreignKey: 'narx_ruyxat_id', as: 'ruyxat' });
NarxRuyxatQatorModel.belongsTo(TovarModel, { foreignKey: 'tovar_id', as: 'tovar' });

module.exports = { NarxRuyxatModel, NarxRuyxatQatorModel };
