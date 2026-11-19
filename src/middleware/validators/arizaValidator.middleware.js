const Joi = require('joi');

const qatorSchema = Joi.object({
  tovar_id:   Joi.number().integer().positive().allow(null).optional(),
  tovar_nomi: Joi.string().min(1).max(120).required(),
  turkum:     Joi.string().max(80).allow('', null).optional(),
  shtrix_kod: Joi.string().max(30).allow('', null).optional(),
  narx:       Joi.number().min(0).required(),
  blok:       Joi.number().min(0).default(0),
  dona:       Joi.number().min(0).default(0),
  hajm:       Joi.number().min(0).default(0),
  chegirma_foiz:  Joi.number().min(0).max(100).default(0),
  chegirma_summa: Joi.number().min(0).default(0),
})
  // Miqdorsiz (0 blok va 0 dona) qator — summasi 0, faqat chalkashlik
  .custom((v, helpers) => ((Number(v.blok) || 0) > 0 || (Number(v.dona) || 0) > 0
    ? v : helpers.message(`"${v.tovar_nomi}": miqdor 0 dan katta bo'lishi kerak`)));

const create = Joi.object({
  turi:    Joi.string().valid('sotish','qaytarish','almashtirish').default('sotish'),
  mijoz_id:    Joi.number().integer().positive().allow(null).optional(),
  mijoz_nomi:  Joi.string().max(150).allow('', null).optional(),
  agent_id:    Joi.number().integer().positive().allow(null).optional(),
  agent_nomi:  Joi.string().max(100).allow('', null).optional(),
  chegirma_foiz:  Joi.number().min(0).max(100).default(0),
  chegirma_summa: Joi.number().min(0).default(0),
  bonus_summa:    Joi.number().min(0).default(0),
  tolov_turi:     Joi.string().max(30).allow('', null).optional(),
  ombor:          Joi.string().max(80).allow('', null).optional(),
  ekspeditor:     Joi.string().max(100).allow('', null).optional(),
  jonatish_sana:  Joi.string().isoDate().allow('', null).optional(),
  izoh:           Joi.string().max(2000).allow('', null).optional(),
  qatorlar: Joi.array().items(qatorSchema).min(1).max(500).required()
    .messages({ 'array.min': 'Kamida 1 ta tovar kiritilishi shart', 'array.max': "Bitta arizada 500 tadan ortiq qator bo'lmasin" }),
});

// Tahrir: hamma maydon ixtiyoriy va STANDART QIYMATSIZ — aks holda yuborilmagan
// turi/chegirma maydonlari 'sotish'/0 bilan bazadagi qiymatni ustidan yozardi.
const update = Joi.object({
  turi:    Joi.string().valid('sotish','qaytarish','almashtirish').optional(),
  mijoz_id:    Joi.number().integer().positive().allow(null).optional(),
  mijoz_nomi:  Joi.string().max(150).allow('', null).optional(),
  agent_id:    Joi.number().integer().positive().allow(null).optional(),
  agent_nomi:  Joi.string().max(100).allow('', null).optional(),
  chegirma_foiz:  Joi.number().min(0).max(100).optional(),
  chegirma_summa: Joi.number().min(0).optional(),
  bonus_summa:    Joi.number().min(0).optional(),
  tolov_turi:     Joi.string().max(30).allow('', null).optional(),
  ombor:          Joi.string().max(80).allow('', null).optional(),
  ekspeditor:     Joi.string().max(100).allow('', null).optional(),
  jonatish_sana:  Joi.string().isoDate().allow('', null).optional(),
  izoh:           Joi.string().max(2000).allow('', null).optional(),
  qatorlar: Joi.array().items(qatorSchema).min(1).max(500).optional()
    .messages({ 'array.min': 'Kamida 1 ta tovar kiritilishi shart', 'array.max': "Bitta arizada 500 tadan ortiq qator bo'lmasin" }),
}).unknown(false);

const holatChange = Joi.object({
  holat:       Joi.string().valid('tasdiqlangan','yigilmoqda','yolda','yetkazildi','bekor').required(),
  bekor_sababi: Joi.string().max(255).when('holat', { is: 'bekor', then: Joi.optional(), otherwise: Joi.optional() }),
  dostavchi_id: Joi.number().integer().allow(null).optional(),
});

// Hududdagi bir nechta zakazni birga yo'lga chiqarish
const topluYolda = Joi.object({
  ariza_idlar:  Joi.array().items(Joi.number().integer()).min(1).max(100).required(),
  dostavchi_id: Joi.number().integer().allow(null).optional(),
});

module.exports = { arizaSchemas: { create, update, holatChange, topluYolda } };
