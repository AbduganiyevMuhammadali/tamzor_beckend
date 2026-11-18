const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const TerritoriyaModel = require('./territoriya.model');

/* ── Mijoz kategoriyasi ──────────────────────────────── */
class MijozKategoriyaModel extends Model {}
MijozKategoriyaModel.init({
  id:   { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomi: { type: DataTypes.STRING(100), allowNull: false },
  izoh: { type: DataTypes.STRING(255), allowNull: true },
  // Toifaga biriktirilgan narx ro'yxati (bo'lmasa mijozning narx turi bo'yicha standart ro'yxat)
  narx_ruyxat_id: { type: DataTypes.INTEGER, allowNull: true },
}, { sequelize, modelName: 'MijozKategoriyaModel', tableName: 'mijoz_kategoriya', timestamps: true });

/* ── Mijoz ───────────────────────────────────────────── */
class MijozModel extends Model {}
MijozModel.init({
  id:              { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  nomi:            { type: DataTypes.STRING(150), allowNull: false },
  yuridik_nomi:    { type: DataTypes.STRING(200), allowNull: true },
  telefon:         { type: DataTypes.STRING(20),  allowNull: true },
  telefon2:        { type: DataTypes.STRING(20),  allowNull: true },
  manzil:          { type: DataTypes.STRING(255), allowNull: true },
  mo_ljal:         { type: DataTypes.STRING(255), allowNull: true },
  territoriya_id:  { type: DataTypes.INTEGER,     allowNull: true },
  kategoriya_id:   { type: DataTypes.INTEGER,     allowNull: true },
  agent_id:        { type: DataTypes.INTEGER,     allowNull: true },
  sinf:            { type: DataTypes.ENUM('A','B','C','D'), allowNull: true },
  // Sotuv formasida narx avtomatik shu turga qarab tanlanadi (optom_narx/chakana_narx)
  narx_turi:       { type: DataTypes.ENUM('optom','chakana'), allowNull: false, defaultValue: 'chakana' },
  balans:          { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  // Tizimga o'tishdagi boshlang'ich qoldiq (ishora balans bilan bir xil: manfiy = mijoz qarzdor, musbat = mijoz haqdor)
  boshlangich_balans: { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
  boshlangich_sana:   { type: DataTypes.DATEONLY, allowNull: true },
  boshlangich_izoh:   { type: DataTypes.STRING(255), allowNull: true },
  kredit_limit:    { type: DataTypes.DECIMAL(18, 2), defaultValue: 0 },
  tolov_muddati_kun: { type: DataTypes.INTEGER, defaultValue: 30 },
  inn:             { type: DataTypes.STRING(20),  allowNull: true },
  shartnoma_raqam: { type: DataTypes.STRING(50),  allowNull: true },
  shartnoma_sana:  { type: DataTypes.DATEONLY,    allowNull: true },
  hisob_raqam:     { type: DataTypes.STRING(30),  allowNull: true },
  bank:            { type: DataTypes.STRING(100), allowNull: true },
  mfo:             { type: DataTypes.STRING(10),  allowNull: true },
  tashrif_kunlari: { type: DataTypes.STRING(50),  allowNull: true },
  tashrif_chastota:{ type: DataTypes.STRING(30),  allowNull: true },
  lat:             { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  lng:             { type: DataTypes.DECIMAL(10, 7), allowNull: true },
  izoh:            { type: DataTypes.TEXT,        allowNull: true },
  faol:            { type: DataTypes.BOOLEAN,     defaultValue: true },
  mobil_id:        { type: DataTypes.STRING(64),  allowNull: true },   // oflayn qo'shilgan mijoz kaliti
  // Reyting (utils/reyting.utils.js) — faqat shu util o'zgartiradi
  reyting:         { type: DataTypes.INTEGER,     allowNull: false, defaultValue: 100 },
  reyting_savdo:   { type: DataTypes.INTEGER,     allowNull: false, defaultValue: 0 },
  reyting_moliya:  { type: DataTypes.INTEGER,     allowNull: false, defaultValue: 0 },
  rad_ketma_ket:   { type: DataTypes.INTEGER,     allowNull: false, defaultValue: 0 },
  tolov_vada_sana: { type: DataTypes.DATEONLY,    allowNull: true },
  reyting_vaqt:    { type: DataTypes.DATE,        allowNull: true },
}, {
  sequelize,
  modelName: 'MijozModel',
  tableName: 'mijoz',
  timestamps: true,
  paranoid: true,
});

/* ── Associations (AgentModel yo'q — circular import oldini olish) ── */
MijozModel.belongsTo(TerritoriyaModel,    { foreignKey: 'territoriya_id', as: 'territoriya' });
MijozModel.belongsTo(MijozKategoriyaModel,{ foreignKey: 'kategoriya_id',  as: 'kategoriya'  });

module.exports = { MijozModel, TerritoriyaModel, MijozKategoriyaModel };
