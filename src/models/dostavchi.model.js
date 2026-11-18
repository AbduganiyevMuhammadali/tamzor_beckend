const { DataTypes, Model } = require('sequelize');
const sequelize = require('../db/db-sequelize');

class DostavchiModel extends Model {
  toJSON() {
    // parol (hash) ni hech qachon javobda ko'rsatmaslik
    const values = Object.assign({}, this.get());
    delete values.parol;
    return values;
  }
}
DostavchiModel.init({
  id:            { type: DataTypes.INTEGER,     primaryKey: true, autoIncrement: true, allowNull: false },
  ism:           { type: DataTypes.STRING(120), allowNull: false },
  login:         { type: DataTypes.STRING(50),  allowNull: true, unique: true },
  parol:         { type: DataTypes.STRING(100), allowNull: true },
  telefon:       { type: DataTypes.STRING(30),  allowNull: true },
  transport:     { type: DataTypes.STRING(80),  allowNull: true },
  mashina_raqam: { type: DataTypes.STRING(30),  allowNull: true },
  izoh:          { type: DataTypes.TEXT,        allowNull: true },
  faol:          { type: DataTypes.BOOLEAN,     allowNull: false, defaultValue: true },
}, {
  sequelize,
  modelName: 'DostavchiModel',
  tableName:  'dostavchi',
  timestamps: true,
  paranoid:   false,
});

module.exports = DostavchiModel;
