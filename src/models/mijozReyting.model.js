const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Mijoz reytingi tarixi — har o'zgarish bitta qator (utils/reyting.utils.js yozadi) */
class MijozReytingModel extends Model {}
MijozReytingModel.init({
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  mijoz_id:      { type: DataTypes.INTEGER, allowNull: false },
  tur:           { type: DataTypes.ENUM('buyurtma', 'rad_etildi', 'kritik', 'tolov_qabul', 'tolov_surildi', 'qolda'), allowNull: false },
  yonalish:      { type: DataTypes.ENUM('savdo', 'moliya'), allowNull: false },
  ball:          { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
  reyting_keyin: { type: DataTypes.INTEGER, allowNull: false },
  sabab_id:      { type: DataTypes.STRING(30), allowNull: true },
  sabab:         { type: DataTypes.STRING(150), allowNull: true },
  izoh:          { type: DataTypes.STRING(255), allowNull: true },
  summa:         { type: DataTypes.DECIMAL(18, 2), allowNull: true },
  vada_sana:     { type: DataTypes.DATEONLY, allowNull: true },
  manba_tur:     { type: DataTypes.STRING(30), allowNull: true },
  manba_id:      { type: DataTypes.INTEGER, allowNull: true },
  xodim_rol:     { type: DataTypes.STRING(20), allowNull: true },
  xodim_id:      { type: DataTypes.INTEGER, allowNull: true },
  xodim_nomi:    { type: DataTypes.STRING(150), allowNull: true },
  mobil_id:      { type: DataTypes.STRING(64), allowNull: true },
  sana:          { type: DataTypes.DATE, allowNull: false },
}, { sequelize, modelName: 'MijozReytingModel', tableName: 'mijoz_reyting', timestamps: true, paranoid: false });

module.exports = MijozReytingModel;
