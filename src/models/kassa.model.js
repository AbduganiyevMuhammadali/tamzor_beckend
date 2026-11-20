const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class KassaModel extends Model {}
KassaModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
  tur:        { type: DataTypes.ENUM('kirim', 'chiqim'), allowNull: false },
  kategoriya: { type: DataTypes.STRING(50), allowNull: false },
  summa:      { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0,
                get() { return parseFloat(this.getDataValue('summa') || 0) } },
  tolov_usul: { type: DataTypes.ENUM('naqt', 'karta', 'bank'), allowNull: false, defaultValue: 'naqt' },
  manba_tur:  { type: DataTypes.STRING(30), allowNull: true },
  manba_id:   { type: DataTypes.INTEGER, allowNull: true },
  mijoz_id:   { type: DataTypes.INTEGER, allowNull: true },
  mijoz_nomi: { type: DataTypes.STRING(150), allowNull: true },
  izoh:       { type: DataTypes.STRING(255), allowNull: true },
  sana:       { type: DataTypes.DATE, allowNull: false },
  user_id:    { type: DataTypes.INTEGER, allowNull: true },
  chek_rasm:  { type: DataTypes.STRING(255), allowNull: true },  // mobil to'lov cheki rasmi
  mobil_id:   { type: DataTypes.STRING(64), allowNull: true },   // mobil oflayn: takrorlanmas kalit
  kassa_id:   { type: DataTypes.INTEGER, allowNull: true },      // qaysi kassada (kassalar); NULL — taqsimlanmagan / agent qo'lida
  agent_id:   { type: DataTypes.INTEGER, allowNull: true },      // pul shu agent qo'lida (kassa_id NULL bo'lsa majburiyat) — 20261122000001
}, {
  sequelize,
  modelName: 'KassaModel',
  tableName:  'kassa',
  timestamps: true,
  paranoid:   false,
});

module.exports = KassaModel;
