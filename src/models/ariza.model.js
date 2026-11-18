const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

// ── Ariza qatori ──────────────────────────────────────────
class ArizaQatorModel extends Model {}
ArizaQatorModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  ariza_id:   { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:   { type: DataTypes.INTEGER, allowNull: true },
  tovar_nomi: { type: DataTypes.STRING(120), allowNull: false },
  turkum:     { type: DataTypes.STRING(80),  allowNull: true },
  shtrix_kod: { type: DataTypes.STRING(30),  allowNull: true },
  narx: {
    type: DataTypes.DECIMAL(18, 2), defaultValue: 0,
    get() { return parseFloat(this.getDataValue('narx') || 0) },
  },
  blok:  { type: DataTypes.DECIMAL(10, 3), defaultValue: 0, get() { return parseFloat(this.getDataValue('blok')  || 0) } },
  dona:  { type: DataTypes.DECIMAL(10, 3), defaultValue: 0, get() { return parseFloat(this.getDataValue('dona')  || 0) } },
  hajm:  { type: DataTypes.DECIMAL(10, 3), defaultValue: 0, get() { return parseFloat(this.getDataValue('hajm')  || 0) } },
  jami_dona: { type: DataTypes.DECIMAL(10, 3), defaultValue: 0, get() { return parseFloat(this.getDataValue('jami_dona') || 0) } },
  summa: {
    type: DataTypes.DECIMAL(18, 2), defaultValue: 0,
    get() { return parseFloat(this.getDataValue('summa') || 0) },
  },
  chegirma_foiz:  { type: DataTypes.DECIMAL(5, 2),  defaultValue: 0, get() { return parseFloat(this.getDataValue('chegirma_foiz')  || 0) } },
  chegirma_summa: { type: DataTypes.DECIMAL(18, 2), defaultValue: 0, get() { return parseFloat(this.getDataValue('chegirma_summa') || 0) } },
  // Qaytarishda: skladchi haqiqatda qabul qilgan miqdor (agent aytganidan kam bo'lishi mumkin)
  qabul_dona:     { type: DataTypes.DECIMAL(10, 3), allowNull: true, get() { const v = this.getDataValue('qabul_dona'); return v === null ? null : parseFloat(v) } },
}, {
  sequelize,
  modelName: 'ArizaQatorModel',
  tableName: 'ariza_qator',
  timestamps: true,
  paranoid: false,
});

// ── Asosiy Ariza ──────────────────────────────────────────
class ArizaModel extends Model {}
ArizaModel.init({
  id:    { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  raqam: { type: DataTypes.STRING(30), allowNull: true },

  holat: {
    // qabul_kutilmoqda / qabul_qilindi — qaytarish oqimi uchun:
    // agent qaytargan tovar avval agent omborida turadi, skladchi
    // tasdiqlagach asosiy omborga o'tadi
    type: DataTypes.ENUM('yangi','tasdiqlangan','yigilmoqda','yolda','yetkazildi','bekor',
                         'qabul_kutilmoqda','qabul_qilindi'),
    defaultValue: 'yangi',
    allowNull: false,
  },
  turi: {
    type: DataTypes.ENUM('sotish','qaytarish','almashtirish'),
    defaultValue: 'sotish',
    allowNull: false,
  },
  manba: {
    type: DataTypes.ENUM('web','mobil'),
    defaultValue: 'web',
    allowNull: false,
  },
  // Savdo kanali: distributsiya (zakaz → tasdiq → yig'ish → dostavchik), avtolavka (Won Sell —
  // agent mashinasidan, darhol yetkazildi), sklad (Won Sell — admin asosiy skladdan xodimsiz sotadi).
  // Ro'yxatlar shu ustun bilan ajratiladi (ariza.controller kanalSharti); ombor nomiga qaralmaydi.
  kanal: {
    type: DataTypes.ENUM('distributsiya','avtolavka','sklad'),
    defaultValue: 'distributsiya',
    allowNull: false,
  },

  mijoz_id:   { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi: { type: DataTypes.STRING(150), allowNull: true },
  agent_id:   { type: DataTypes.INTEGER, allowNull: true },
  agent_nomi: { type: DataTypes.STRING(100), allowNull: true },

  jami_summa:    { type: DataTypes.DECIMAL(18,2), defaultValue: 0, get() { return parseFloat(this.getDataValue('jami_summa')    || 0) } },
  chegirma_foiz: { type: DataTypes.DECIMAL(5,2),  defaultValue: 0, get() { return parseFloat(this.getDataValue('chegirma_foiz') || 0) } },
  chegirma_summa:{ type: DataTypes.DECIMAL(18,2), defaultValue: 0, get() { return parseFloat(this.getDataValue('chegirma_summa')|| 0) } },
  bonus_summa:   { type: DataTypes.DECIMAL(18,2), defaultValue: 0, get() { return parseFloat(this.getDataValue('bonus_summa')   || 0) } },
  tolov_turi:    { type: DataTypes.STRING(30), allowNull: true },

  ombor:          { type: DataTypes.STRING(80),  allowNull: true, defaultValue: 'Основной склад' },
  dostavchi_id:   { type: DataTypes.INTEGER,     allowNull: true },
  trip_sheet_id:  { type: DataTypes.INTEGER,     allowNull: true },
  trip_tartib:    { type: DataTypes.INTEGER,     allowNull: true },
  dostavchi_nomi: { type: DataTypes.STRING(120), allowNull: true },
  jonatish_sana:  { type: DataTypes.DATEONLY,    allowNull: true },

  izoh:         { type: DataTypes.TEXT,        allowNull: true },
  bekor_sababi: { type: DataTypes.STRING(255), allowNull: true },

  tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_sana: { type: DataTypes.DATE,    allowNull: true },
  yetkazilgan_sana: { type: DataTypes.DATE,    allowNull: true },
  qabul_qilgan_id:  { type: DataTypes.INTEGER, allowNull: true },
  qabul_sana:       { type: DataTypes.DATE,    allowNull: true },

  // Mobil sotuv qayerda qilingani: GPS nuqta, mijozgacha masofa (metr)
  // va sotuv qaysi tashrif (check-in) ichida bo'lgani
  lat:        { type: DataTypes.DECIMAL(10, 7), allowNull: true, get() { const v = this.getDataValue('lat'); return v == null ? null : parseFloat(v) } },
  lng:        { type: DataTypes.DECIMAL(10, 7), allowNull: true, get() { const v = this.getDataValue('lng'); return v == null ? null : parseFloat(v) } },
  masofa_m:   { type: DataTypes.INTEGER, allowNull: true },
  tashrif_id: { type: DataTypes.INTEGER, allowNull: true },
  // Mobil oflayn: takrorlanmas kalit va "internetsiz qilingan" belgisi
  mobil_id:   { type: DataTypes.STRING(64), allowNull: true },
  oflayn:     { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

  // Yetkazish tafsilotlari (dostavchik mobil ilovasi)
  yetkazgan_dostavchi_id: { type: DataTypes.INTEGER, allowNull: true },
  yetkazish_lat:      { type: DataTypes.DECIMAL(10, 7), allowNull: true, get() { const v = this.getDataValue('yetkazish_lat'); return v == null ? null : parseFloat(v) } },
  yetkazish_lng:      { type: DataTypes.DECIMAL(10, 7), allowNull: true, get() { const v = this.getDataValue('yetkazish_lng'); return v == null ? null : parseFloat(v) } },
  yetkazish_masofa_m: { type: DataTypes.INTEGER, allowNull: true },
  // Yetkazishda joyida olingan naqd (qisman bo'lishi mumkin; qolgani mijoz qarzi)
  tolangan_summa:     { type: DataTypes.DECIMAL(18, 2), defaultValue: 0, get() { return parseFloat(this.getDataValue('tolangan_summa') || 0) } },
  yetkazish_urinish:  { type: DataTypes.INTEGER, defaultValue: 0 },
  yetkazish_izoh:     { type: DataTypes.STRING(255), allowNull: true },
  // Qarzga sotuv: mijoz qarzni qachon to'laydi (mobil kalendardan). Bo'sh bo'lsa —
  // sotuv sanasi + mijoz.tolov_muddati_kun (utils/qarz.utils.js)
  tolov_sana:         { type: DataTypes.DATEONLY, allowNull: true },
}, {
  sequelize,
  modelName: 'ArizaModel',
  tableName: 'ariza',
  timestamps: true,
  paranoid: true,
});

// ── Associations ──────────────────────────────────────────
ArizaModel.hasMany(ArizaQatorModel, { foreignKey: 'ariza_id', as: 'qatorlar' });
ArizaQatorModel.belongsTo(ArizaModel, { foreignKey: 'ariza_id', as: 'ariza' });

const { MijozModel } = require('./mijoz.model');
ArizaModel.belongsTo(MijozModel, { foreignKey: 'mijoz_id', as: 'mijoz' });

const AgentModel = require('./agent.model');
ArizaModel.belongsTo(AgentModel, { foreignKey: 'agent_id', as: 'agent' });

const DostavchiModel = require('./dostavchi.model');
ArizaModel.belongsTo(DostavchiModel, { foreignKey: 'dostavchi_id', as: 'dostavchi' });

module.exports = { ArizaModel, ArizaQatorModel };
