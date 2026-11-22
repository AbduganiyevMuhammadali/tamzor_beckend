const { DataTypes, Model } = require('sequelize');
const sequelize        = require('../db/db-sequelize');
const TerritoriyaModel = require('./territoriya.model');  // circular yo'q

class AgentModel extends Model {
  toJSON() {
    // parol (hash) ni hech qachon javobda ko'rsatmaslik
    const values = Object.assign({}, this.get());
    delete values.parol;
    return values;
  }
}

AgentModel.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    allowNull: false,
  },
  fullname: {
    type: DataTypes.STRING(100),
    allowNull: false,
  },
  // Mobil ilova uchun login/parol
  login: {
    type: DataTypes.STRING(50),
    allowNull: true,
    unique: true,
  },
  parol: {
    type: DataTypes.STRING(60),  // bcrypt hash
    allowNull: true,
  },
  token: {
    type: DataTypes.VIRTUAL,
  },
  telefon: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  passport: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  tugilgan_sana: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  territoriya_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  plan_summa: {
    type: DataTypes.DECIMAL(18, 2),
    allowNull: true,
    defaultValue: 0,
    get() {
      const v = this.getDataValue('plan_summa');
      return v !== null ? parseFloat(v) : 0;
    },
  },
  bonus_foiz: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    defaultValue: 0,
    get() {
      const v = this.getDataValue('bonus_foiz');
      return v !== null ? parseFloat(v) : 0;
    },
  },
  kredit_limit: {
    type: DataTypes.DECIMAL(18, 2),
    allowNull: true,
    defaultValue: 0,
    get() {
      const v = this.getDataValue('kredit_limit');
      return v !== null ? parseFloat(v) : 0;
    },
  },
  max_chegirma: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true,
    defaultValue: 0,
    get() {
      const v = this.getDataValue('max_chegirma');
      return v !== null ? parseFloat(v) : 0;
    },
  },
  ish_boshlagan: {
    type: DataTypes.DATEONLY,
    allowNull: true,
  },
  tashrif_kunlari: {
    type: DataTypes.STRING(50),
    allowNull: true,
    get() {
      const raw = this.getDataValue('tashrif_kunlari');
      if (!raw) return [];
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    },
    set(val) {
      if (Array.isArray(val)) {
        this.setDataValue('tashrif_kunlari', val.length ? val.join(',') : null);
      } else {
        this.setDataValue('tashrif_kunlari', val || null);
      }
    },
  },
  boshlanish_manzil: {
    type: DataTypes.STRING(255),
    allowNull: true,
  },
  transport: {
    type: DataTypes.ENUM('avto', 'moto', 'piyoda', 'velosiped', 'boshqa'),
    allowNull: true,
  },
  mashina_raqam: {
    type: DataTypes.STRING(20),
    allowNull: true,
  },
  radius_km: {
    type: DataTypes.DECIMAL(8, 2),
    allowNull: true,
    get() {
      const v = this.getDataValue('radius_km');
      return v !== null ? parseFloat(v) : null;
    },
  },
  izoh: {
    type: DataTypes.TEXT,
    allowNull: true,
  },
  faol: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  // Sinov/aralash rol uchun: true bo'lsa, mobil login javobida isDeliver
  // ham true qaytadi — agent bitta hisob bilan dostavchik oynalarini ham ko'ra oladi.
  dual_role: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
  // dual_role=true bo'lganda shu agentga mos keladigan `dostavchi` jadvalidagi
  // qator ID'si — ariza.dostavchi_id shu jadvalga FK bilan bog'langani uchun,
  // web tomondan unga tayinlangan buyurtmalar aynan shu ID orqali topiladi.
  linked_dostavchi_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Won Sell (avtolavka) "jufti": shu xodim bitta login bilan Won Sell rejimida ham ishlaydi
  // (mobil "x-rejim: avtolavka" — so'rov juft agent nomidan). Bo'sh — oddiy agent.
  juft_agent_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // Avtolavka (ko'chma savdo): agent tovarni mashinaga yuklab yuradi. Uning
  // mobil sotuvi darhol "yetkazildi" bo'ladi va chiqim o'z omboridan tushadi.
  // 2026-11-21 dan HAMMA agent shu rejimda (migrations/20261121000001): o'z omboridan sotadi.
  avtolavka: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
    allowNull: false,
  },
  // Super agent: o'zi ham agent (ombori, mijozlari, savdosi bor) + biriktirilgan agentlarni
  // mobil ilovada faqat KO'RADI (x-kuzat-agent sarlavhasi, mobileAuth)
  super_agent: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
  // Shu agent biriktirilgan super agent (agent.id, super_agent = true). Web panelda belgilanadi.
  super_agent_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
  },
  // 2026-11-25: mobil ilovada sotuvda narxni o'zgartirish ruxsati (login javobida editPrice).
  // Faqat web panelda belgilanadi; super agentning o'z bayrog'i o'z savdosiga amal qiladi.
  narx_ozgartirish: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
  // 2026-11-29: DILLER — hamkor, o'zi uchun ishlaydi (ombori "Diller: <ism>", narx erkin, kassa/GPS yo'q).
  // Faqat web'da belgilanadi (agent.controller dillerTekshir). utils/diller.utils.js
  diller: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
    allowNull: false,
  },
}, {
  sequelize,
  modelName: 'AgentModel',
  tableName: 'agent',
  timestamps: true,
  paranoid: true,
});

/* ── Association — faqat TerritoriyaModel (circular yo'q) ── */
AgentModel.belongsTo(TerritoriyaModel, { foreignKey: 'territoriya_id', as: 'territoriya' });
/* Super agent (o'z jadvali) — web ro'yxatda super agent nomi uchun */
AgentModel.belongsTo(AgentModel, { foreignKey: 'super_agent_id', as: 'superAgent', constraints: false });

module.exports = AgentModel;
