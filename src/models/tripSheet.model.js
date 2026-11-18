const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* ── Trip Sheet: dostavchikning kunlik yetkazib berish marshrut varag'i ── */
class TripSheetModel extends Model {}
TripSheetModel.init({
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  raqam:           { type: DataTypes.STRING(30), allowNull: true },
  dostavchi_id:    { type: DataTypes.INTEGER, allowNull: false },
  dostavchi_nomi:  { type: DataTypes.STRING(120), allowNull: true },
  sana:            { type: DataTypes.DATEONLY, allowNull: false },
  holat:           { type: DataTypes.ENUM('yangi', 'yolda', 'yakunlandi'), defaultValue: 'yangi' },
  boshlangan_vaqt: { type: DataTypes.DATE, allowNull: true },
  tugagan_vaqt:    { type: DataTypes.DATE, allowNull: true },
  izoh:            { type: DataTypes.TEXT, allowNull: true },
  boshlangan_lat:  { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  boshlangan_lng:  { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  tugagan_lat:     { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  tugagan_lng:     { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  // Dostavchik kun oxirida o'zi sanagan naqd
  naqd_elon:       { type: DataTypes.DECIMAL(18, 2), allowNull: true },
}, {
  sequelize, modelName: 'TripSheetModel', tableName: 'trip_sheet',
  timestamps: true, paranoid: false,
});

/* ── Yetkazishda qisman qaytarish / brak ─────────────────────────────── */
class YetkazishQaytarishModel extends Model {}
YetkazishQaytarishModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ariza_id:     { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:     { type: DataTypes.INTEGER, allowNull: true },
  tovar_nomi:   { type: DataTypes.STRING(150), allowNull: true },
  dona:         { type: DataTypes.DECIMAL(10, 3), defaultValue: 0 },
  summa:        { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  tur:          { type: DataTypes.ENUM('qaytarma', 'brak'), defaultValue: 'qaytarma' },
  sabab:        { type: DataTypes.STRING(255), allowNull: true },
  dostavchi_id: { type: DataTypes.INTEGER, allowNull: true },
  sana:         { type: DataTypes.DATE, allowNull: false },
}, {
  sequelize, modelName: 'YetkazishQaytarishModel', tableName: 'yetkazish_qaytarish',
  timestamps: true, paranoid: false,
});

/* ── Muvaffaqiyatsiz yetkazish urinishi: do'kon yopiq, mijoz yo'q, rad etdi… ── */
class YetkazishUrinishModel extends Model {}
YetkazishUrinishModel.init({
  id:           { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ariza_id:     { type: DataTypes.INTEGER, allowNull: false },
  dostavchi_id: { type: DataTypes.INTEGER, allowNull: true },
  sabab:        { type: DataTypes.STRING(60), allowNull: false },
  izoh:         { type: DataTypes.STRING(255), allowNull: true },
  lat:          { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  lng:          { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  masofa_m:     { type: DataTypes.INTEGER, allowNull: true },
  sana:         { type: DataTypes.DATE, allowNull: false },
  mobil_id:     { type: DataTypes.STRING(64), allowNull: true },   // mobil oflayn: takrorlanmas kalit
}, {
  sequelize, modelName: 'YetkazishUrinishModel', tableName: 'yetkazish_urinish',
  timestamps: true, paranoid: false,
});

module.exports = { TripSheetModel, YetkazishQaytarishModel, YetkazishUrinishModel };
