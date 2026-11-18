const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

/* Uchinchi shaxs — mijoz ham, yetkazuvchi ham bo'lmagan qarz oldi-berdi tarafi */
class UchinchiShaxsModel extends Model {}
UchinchiShaxsModel.init({
  id:      { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ism:     { type: DataTypes.STRING(150), allowNull: false },
  telefon: { type: DataTypes.STRING(30), allowNull: true },
  izoh:    { type: DataTypes.TEXT, allowNull: true },
  faol:    { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
}, { sequelize, modelName: 'UchinchiShaxsModel', tableName: 'uchinchi_shaxs', timestamps: true, paranoid: true });

/* Harakat: musbat ta'sir — shaxs bizga ko'proq qarzdor, manfiy — biz shaxsga ko'proq qarzdor */
const HARAKAT_TUR = {
  qarz_berdik:  { ishora: +1, kassa: 'chiqim', kategoriya: 'qarz_berildi',    nom: 'Qarz berdik' },
  qaytardi:     { ishora: -1, kassa: 'kirim',  kategoriya: 'qarz_qaytdi',     nom: 'Qarzini qaytardi' },
  qarz_oldik:   { ishora: -1, kassa: 'kirim',  kategoriya: 'qarz_olindi',     nom: 'Qarz oldik' },
  qaytardik:    { ishora: +1, kassa: 'chiqim', kategoriya: 'qarz_qaytarildi', nom: 'Qarzimizni qaytardik' },
  bosh_qarzdor: { ishora: +1, kassa: null,     kategoriya: null,              nom: "Boshlang'ich qoldiq — u bizga qarzdor" },
  bosh_haqdor:  { ishora: -1, kassa: null,     kategoriya: null,              nom: "Boshlang'ich qoldiq — biz unga qarzdormiz" },
};

class UchinchiShaxsHarakatModel extends Model {}
UchinchiShaxsHarakatModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  shaxs_id:   { type: DataTypes.INTEGER, allowNull: false },
  tur:        { type: DataTypes.ENUM(...Object.keys(HARAKAT_TUR)), allowNull: false },
  summa:      { type: DataTypes.DECIMAL(18, 2), allowNull: false, get() { return parseFloat(this.getDataValue('summa') || 0); } },
  tolov_usul: { type: DataTypes.ENUM('naqt', 'karta', 'bank'), allowNull: true },
  sana:       { type: DataTypes.DATE, allowNull: false },
  muddat:     { type: DataTypes.DATEONLY, allowNull: true },
  izoh:       { type: DataTypes.STRING(255), allowNull: true },
  kassa_id:   { type: DataTypes.INTEGER, allowNull: true },
  user_id:    { type: DataTypes.INTEGER, allowNull: true },
}, { sequelize, modelName: 'UchinchiShaxsHarakatModel', tableName: 'uchinchi_shaxs_harakat', timestamps: true });

module.exports = { UchinchiShaxsModel, UchinchiShaxsHarakatModel, HARAKAT_TUR };
