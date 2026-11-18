const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* ── Inkassatsiya: xodim (agent YOKI dostavchik) yig'gan naqd vs kassaga topshirgani ──
   Bir qatorda agent_id yoki dostavchi_id to'ldirilgan; agent_nomi — ikkalasida ham ism
   (utils/dostavchiInkassatsiya.utils.js). */
class InkassatsiyaModel extends Model {}
InkassatsiyaModel.init({
  id:                  { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  agent_id:            { type: DataTypes.INTEGER, allowNull: true },
  dostavchi_id:        { type: DataTypes.INTEGER, allowNull: true },
  agent_nomi:          { type: DataTypes.STRING(120), allowNull: true },
  sana:                { type: DataTypes.DATEONLY, allowNull: false },
  yigilgan_summa:      { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  topshirilgan_summa:  { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  farq:                { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  holat:               { type: DataTypes.ENUM('ochiq', 'yopiq', 'kamomad'), defaultValue: 'ochiq' },
  izoh:                { type: DataTypes.TEXT, allowNull: true },
  tasdiqlagan_id:      { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_sana:    { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, modelName: 'InkassatsiyaModel', tableName: 'inkassatsiya',
  timestamps: true, paranoid: false,
});

module.exports = { InkassatsiyaModel };
