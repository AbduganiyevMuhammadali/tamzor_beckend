const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class AgentRegisterModel extends Model {}
AgentRegisterModel.init({
  id:         { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
  agent_id:   { type: DataTypes.INTEGER, allowNull: false },
  ariza_id:   { type: DataTypes.INTEGER, allowNull: true },
  tur:        { type: DataTypes.ENUM('savdo', 'qaytarma'), allowNull: false, defaultValue: 'savdo' },
  summa:      { type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0,
                get() { return parseFloat(this.getDataValue('summa') || 0) } },
  bonus_foiz: { type: DataTypes.DECIMAL(5, 2),  allowNull: false, defaultValue: 0,
                get() { return parseFloat(this.getDataValue('bonus_foiz') || 0) } },
  bonus_summa:{ type: DataTypes.DECIMAL(18, 2), allowNull: false, defaultValue: 0,
                get() { return parseFloat(this.getDataValue('bonus_summa') || 0) } },
  sana:       { type: DataTypes.DATE, allowNull: false },
  izoh:       { type: DataTypes.STRING(255), allowNull: true },
}, {
  sequelize,
  modelName: 'AgentRegisterModel',
  tableName:  'agent_register',
  timestamps: true,
  paranoid:   false,
});

module.exports = AgentRegisterModel;
