const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

const dec = (k, nullable = false) => ({
  type: DataTypes.DECIMAL(18, 3), allowNull: nullable, defaultValue: nullable ? null : 0,
  get() { const v = this.getDataValue(k); return v === null || v === undefined ? null : parseFloat(v); },
});

/* ── Hujjat qatori ─────────────────────────────────────── */
class AvtolavkaQatorModel extends Model {}
AvtolavkaQatorModel.init({
  id:            { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  hujjat_id:     { type: DataTypes.INTEGER, allowNull: false },
  tovar_id:      { type: DataTypes.INTEGER, allowNull: false },
  tovar_nomi:    { type: DataTypes.STRING(120), allowNull: false },
  turkum:        { type: DataTypes.STRING(80), allowNull: true },
  narx:          dec('narx'),
  kirim_narx:    dec('kirim_narx'),
  blok:          dec('blok'),
  dona:          dec('dona'),
  kutilgan_dona: dec('kutilgan_dona', true),
  qabul_dona:    dec('qabul_dona', true),
  brak_dona:     dec('brak_dona'),
  farq_dona:     dec('farq_dona'),
  summa:         dec('summa'),
}, {
  sequelize, modelName: 'AvtolavkaQatorModel', tableName: 'avtolavka_qator',
  timestamps: true, paranoid: false,
});

/* ── Hujjat: yuklash (sklad → agent) yoki qabul (agent → sklad) ── */
class AvtolavkaHujjatModel extends Model {}
AvtolavkaHujjatModel.init({
  id:               { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  raqam:            { type: DataTypes.STRING(30), allowNull: true },
  tur:              { type: DataTypes.ENUM('yuklash', 'qabul'), allowNull: false },
  // 'mobil' — agent ilovadan so'ragan yuklash (omborchi tasdiqlaguncha qoralama)
  manba:            { type: DataTypes.ENUM('web', 'mobil'), allowNull: false, defaultValue: 'web' },
  agent_id:         { type: DataTypes.INTEGER, allowNull: false },
  agent_nomi:       { type: DataTypes.STRING(120), allowNull: true },
  ombor:            { type: DataTypes.STRING(80), allowNull: true },
  sana:             { type: DataTypes.DATEONLY, allowNull: false },
  holat:            { type: DataTypes.ENUM('qoralama', 'tasdiqlangan', 'bekor'), defaultValue: 'qoralama' },
  jami_dona:        dec('jami_dona'),
  jami_summa:       dec('jami_summa'),
  farq_dona:        dec('farq_dona'),
  brak_dona:        dec('brak_dona'),
  izoh:             { type: DataTypes.TEXT, allowNull: true },
  rad_sababi:       { type: DataTypes.STRING(255), allowNull: true },
  yaratgan_id:      { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_id:   { type: DataTypes.INTEGER, allowNull: true },
  tasdiqlagan_sana: { type: DataTypes.DATE, allowNull: true },
  // Agent yuklangan tovarni mobilda "qabul qildim" deb tasdiqlagan vaqt
  agent_qabul_vaqt: { type: DataTypes.DATE, allowNull: true },
}, {
  sequelize, modelName: 'AvtolavkaHujjatModel', tableName: 'avtolavka_hujjat',
  timestamps: true, paranoid: false,
});

AvtolavkaHujjatModel.hasMany(AvtolavkaQatorModel, { foreignKey: 'hujjat_id', as: 'qatorlar' });
AvtolavkaQatorModel.belongsTo(AvtolavkaHujjatModel, { foreignKey: 'hujjat_id', as: 'hujjat' });

/* ── Kun yopish: agent kun oxirida "topshirishga tayyorman" deb e'lon qiladi ── */
class AvtolavkaKunModel extends Model {}
AvtolavkaKunModel.init({
  id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  agent_id:    { type: DataTypes.INTEGER, allowNull: false },
  sana:        { type: DataTypes.DATEONLY, allowNull: false },
  yopish_vaqt: { type: DataTypes.DATE, allowNull: true },
  naqd_elon:   dec('naqd_elon', true),   // agent o'zi sanagan naqd
  izoh:        { type: DataTypes.TEXT, allowNull: true },
  // To'liq yopilgan kun qayta ochilsa (bir kunda yangi reys) — oxirgi ochilish vaqti va soni.
  // Shundan oldingi yopish/qabul/inkassatsiya yangi reysni "topshirildi" qilmaydi (kunHisobla).
  ochish_vaqt: { type: DataTypes.DATE, allowNull: true },
  ochish_soni: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
}, {
  sequelize, modelName: 'AvtolavkaKunModel', tableName: 'avtolavka_kun',
  timestamps: true, paranoid: false,
});

module.exports = { AvtolavkaHujjatModel, AvtolavkaQatorModel, AvtolavkaKunModel };
