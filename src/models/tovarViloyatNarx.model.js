const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

const narx = (k) => ({
  type: DataTypes.DECIMAL(18, 2), allowNull: true,
  get() { const v = this.getDataValue(k); return v == null ? null : parseFloat(v); },
});

/* Tovarning viloyat (territoriya) bo'yicha chakana/optom narxi — migrations/20261125000001.
   (tovar_id, territoriya_id) yagona; ikkala narx ham null bo'lsa qator saqlanmaydi. */
class TovarViloyatNarxModel extends Model {}
TovarViloyatNarxModel.init({
  id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  tovar_id:       { type: DataTypes.INTEGER, allowNull: false },
  territoriya_id: { type: DataTypes.INTEGER, allowNull: false },
  chakana_narx:   narx('chakana_narx'),
  optom_narx:     narx('optom_narx'),
  user_id:        { type: DataTypes.INTEGER, allowNull: true },
  user_nomi:      { type: DataTypes.STRING(100), allowNull: true },
}, { sequelize, modelName: 'TovarViloyatNarxModel', tableName: 'tovar_viloyat_narx', timestamps: true });

module.exports = TovarViloyatNarxModel;
