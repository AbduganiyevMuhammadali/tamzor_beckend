/**
 * Ishlab chiqarish partiyasi: xom ashyo → sof mahsulot (+ qo'shimcha mahsulot), tannarx bilan.
 * Hisob qoidasi: utils/ishlab.utils.js; jarayon: controllers/web/ishlab.controller.js.
 */
const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

// Har ustunga yangi obyekt: Sequelize ta'rif obyektini o'zgartiradi (field nomi yoziladi) — ulashib bo'lmaydi
const pul = () => ({ type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 });
const miqdor = () => ({ type: DataTypes.DECIMAL(14, 3), allowNull: false, defaultValue: 0 });

class IshlabModel extends Model {}
IshlabModel.init({
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  raqam:            { type: DataTypes.STRING(30), allowNull: false, unique: true },
  sana:             { type: DataTypes.DATE, allowNull: false },
  holat:            { type: DataTypes.ENUM('qoralama', 'jarayonda', 'yakunlandi', 'bekor'), allowNull: false, defaultValue: 'qoralama' },
  ombor:            { type: DataTypes.STRING(80), allowNull: false, defaultValue: 'Основной склад' },
  taqsimlash:       { type: DataTypes.ENUM('qiymat', 'miqdor'), allowNull: false, defaultValue: 'qiymat' },
  izoh:             { type: DataTypes.TEXT, allowNull: true },
  xom_ashyo_miqdor: miqdor(),
  xom_ashyo_summa: pul(),
  xarajat_summa: pul(),
  qoshimcha_summa: pul(),
  tannarx_jami: pul(),
  mahsulot_miqdor: miqdor(),
  yoqotish_miqdor: miqdor(),
  chiqish_foiz:     { type: DataTypes.DECIMAL(7, 2), allowNull: true },
  boshlangan_vaqt:  { type: DataTypes.DATE, allowNull: true },
  yakunlangan_vaqt: { type: DataTypes.DATE, allowNull: true },
  bekor_sababi:     { type: DataTypes.STRING(255), allowNull: true },
  user_id:          { type: DataTypes.INTEGER, allowNull: true },
  user_nomi:        { type: DataTypes.STRING(120), allowNull: true },
}, { sequelize, modelName: 'IshlabModel', tableName: 'ishlab_chiqarish', timestamps: true });

class IshlabQatorModel extends Model {}
IshlabQatorModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  hujjat_id:    { type: DataTypes.INTEGER, allowNull: false },
  tur:          { type: DataTypes.ENUM('xom_ashyo', 'mahsulot', 'qoshimcha'), allowNull: false },
  tovar_id:     { type: DataTypes.INTEGER, allowNull: false },
  tovar_nomi:   { type: DataTypes.STRING(120), allowNull: false },
  turkum:       { type: DataTypes.STRING(80), allowNull: true },
  olchov:       { type: DataTypes.STRING(20), allowNull: true },
  // Qaysi ombordan chiqdi / qaysi omborga kirdi: xom ashyo turi → "Xom ashyo ombori", savdo tovari → asosiy sklad
  ombor:        { type: DataTypes.STRING(80), allowNull: true },
  reja_miqdor: miqdor(),
  miqdor:       miqdor(),
  narx: pul(),
  summa: pul(),
  ulush:        { type: DataTypes.DECIMAL(9, 6), allowNull: true },
  optom_narx: pul(),
  chakana_narx: pul(),
}, { sequelize, modelName: 'IshlabQatorModel', tableName: 'ishlab_chiqarish_qator', timestamps: true });

class IshlabXarajatModel extends Model {}
IshlabXarajatModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  hujjat_id:  { type: DataTypes.INTEGER, allowNull: false },
  nomi:       { type: DataTypes.STRING(120), allowNull: false },
  summa: pul(),
  kassadan:   { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  tolov_usul: { type: DataTypes.ENUM('naqt', 'karta', 'bank'), allowNull: false, defaultValue: 'naqt' },
  kassa_id:   { type: DataTypes.INTEGER, allowNull: true },
}, { sequelize, modelName: 'IshlabXarajatModel', tableName: 'ishlab_chiqarish_xarajat', timestamps: true });

IshlabModel.hasMany(IshlabQatorModel, { foreignKey: 'hujjat_id', as: 'qatorlar' });
IshlabQatorModel.belongsTo(IshlabModel, { foreignKey: 'hujjat_id', as: 'hujjat' });
IshlabModel.hasMany(IshlabXarajatModel, { foreignKey: 'hujjat_id', as: 'xarajatlar' });
IshlabXarajatModel.belongsTo(IshlabModel, { foreignKey: 'hujjat_id', as: 'hujjat' });

module.exports = { IshlabModel, IshlabQatorModel, IshlabXarajatModel };
