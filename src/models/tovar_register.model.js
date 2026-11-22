const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class TovarRegisterModel extends Model {}

TovarRegisterModel.init({
  id: {
    type: DataTypes.BIGINT,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
  },

  tovar_id:   { type: DataTypes.INTEGER,     allowNull: false },
  tovar_nomi: { type: DataTypes.STRING(120), allowNull: false },
  turkum:     { type: DataTypes.STRING(80),  allowNull: true },
  ombor:      { type: DataTypes.STRING(80),  allowNull: true, defaultValue: 'Основной склад' },

  tur: {
    type: DataTypes.ENUM('kirim', 'chiqim', 'qaytarma_kirim', 'qaytarma_chiqim', 'inventarizatsiya'),
    allowNull: false,
  },

  manba_tur: {
    // yuklash/qabul — avtolavka: asosiy ombor ↔ agent ombori o'tkazmalari
    // ishlab_chiqarish — xom ashyo chiqimi (chiqim) va tayyor mahsulot kirimi (kirim, tannarxda)
    // kochirish — tovar turi o'zgarganda qoldig'i turi omboriga ko'chadi (asosiy sklad ↔ Xom ashyo ombori)
    // agent_kochirish — agentdan agentga ko'chirish (manba_id = agent_kochirish.id), ichki harakat
    type: DataTypes.ENUM('prixod', 'sotuv', 'qaytarma', 'inventar', 'yuklash', 'qabul', 'ishlab_chiqarish', 'kochirish', 'agent_kochirish'),
    allowNull: false,
  },
  manba_id: { type: DataTypes.INTEGER, allowNull: false },

  donada:    { type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 },
  bloklarda: { type: DataTypes.DECIMAL(14, 3), allowNull: true,  defaultValue: 0 },
  qutilarda: { type: DataTypes.DECIMAL(14, 3), allowNull: true,  defaultValue: 0 },
  hajm:      { type: DataTypes.DECIMAL(14, 3), allowNull: true,  defaultValue: 0 },

  kirim_narx:     { type: DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
  kirim_narx_usd: { type: DataTypes.DECIMAL(18, 4), allowNull: true, defaultValue: 0 },
  // Eski, endi ishlatilmaydigan yagona sotuv narxi — moslik uchun saqlanadi.
  sotuv_narx:       { type: DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
  sotuv_narx_usd:   { type: DataTypes.DECIMAL(18, 4), allowNull: true, defaultValue: 0 },
  optom_narx:       { type: DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
  optom_narx_usd:   { type: DataTypes.DECIMAL(18, 4), allowNull: true, defaultValue: 0 },
  chakana_narx:     { type: DataTypes.DECIMAL(18, 2), allowNull: true, defaultValue: 0 },
  chakana_narx_usd: { type: DataTypes.DECIMAL(18, 4), allowNull: true, defaultValue: 0 },
  summa:          { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },

  sana: { type: DataTypes.DATE, allowNull: false },
}, {
  sequelize,
  modelName: 'TovarRegisterModel',
  tableName:  'tovar_register',
  timestamps: true,
  paranoid:   false,
});

module.exports = TovarRegisterModel;
