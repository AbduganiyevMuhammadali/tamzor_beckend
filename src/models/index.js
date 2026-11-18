/**
 * Barcha modellarni shu yerda import qilib, cross-associations o'rnatamiz.
 * Har bir model fayli faqat o'z ichki (circular bo'lmagan) bog'liqliklarini o'zi qiladi.
 * Cross-model associations (MijozModel ↔ AgentModel) shu faylda.
 */

const TerritoriyaModel      = require('./territoriya.model');
const AgentModel             = require('./agent.model');
const { MijozModel, MijozKategoriyaModel } = require('./mijoz.model');
const { AuditModel, SotmaslikModel, AgentLocationModel } = require('./hisobot.model');
const { InkassatsiyaModel } = require('./inkassatsiya.model');
const { MarshrutRejaModel, TashrifModel } = require('./marshrut.model');
const { TripSheetModel, YetkazishQaytarishModel, YetkazishUrinishModel } = require('./tripSheet.model');
const { AvtolavkaHujjatModel, AvtolavkaQatorModel, AvtolavkaKunModel } = require('./avtolavka.model');
const { NarxRuyxatModel, NarxRuyxatQatorModel } = require('./narxRuyxat.model');
const TovarModel             = require('./tovar.model');
const TurkumModel            = require('./turkum.model');

/* ── MijozModel ↔ AgentModel ─────────────────────────── */
MijozModel.belongsTo(AgentModel, { foreignKey: 'agent_id', as: 'agent' });
AgentModel.hasMany(MijozModel,   { foreignKey: 'agent_id', as: 'mijozlar' });

/* ── MijozKategoriyaModel ↔ NarxRuyxatModel (toifa → narx ro'yxati) ── */
MijozKategoriyaModel.belongsTo(NarxRuyxatModel, { foreignKey: 'narx_ruyxat_id', as: 'narxRuyxat' });

/* ── TovarModel ↔ TurkumModel (Sozlamalar → Turkumlar; nomi tovar.turkum'da sinxron) ── */
TovarModel.belongsTo(TurkumModel, { foreignKey: 'turkum_id', as: 'turkumObj' });
TurkumModel.hasMany(TovarModel,   { foreignKey: 'turkum_id', as: 'tovarlar' });

module.exports = {
  TerritoriyaModel,
  AgentModel,
  MijozModel,
  MijozKategoriyaModel,
  AuditModel,
  SotmaslikModel,
  AgentLocationModel,
  InkassatsiyaModel,
  MarshrutRejaModel,
  TashrifModel,
  TripSheetModel,
  YetkazishQaytarishModel,
  YetkazishUrinishModel,
  AvtolavkaHujjatModel,
  AvtolavkaQatorModel,
  AvtolavkaKunModel,
  NarxRuyxatModel,
  NarxRuyxatQatorModel,
  TovarModel,
  TurkumModel,
};
