const Joi = require('joi');

const create = Joi.object({
  nomi:             Joi.string().min(1).max(150).required(),
  yuridik_nomi:     Joi.string().max(200).allow('', null).optional(),
  telefon:          Joi.string().max(20).allow('', null).optional(),
  telefon2:         Joi.string().max(20).allow('', null).optional(),
  manzil:           Joi.string().max(255).allow('', null).optional(),
  mo_ljal:          Joi.string().max(255).allow('', null).optional(),
  territoriya_id:   Joi.number().integer().allow(null).optional(),
  kategoriya_id:    Joi.number().integer().allow(null).optional(),
  agent_id:         Joi.number().integer().allow(null).optional(),
  sinf:             Joi.string().valid('A','B','C','D').allow(null).optional(),
  narx_turi:        Joi.string().valid('optom','chakana').default('chakana'),
  inn:              Joi.string().max(20).allow('', null).optional(),
  shartnoma_raqam:  Joi.string().max(50).allow('', null).optional(),
  shartnoma_sana:   Joi.string().isoDate().allow('', null).optional(),
  hisob_raqam:      Joi.string().max(30).allow('', null).optional(),
  bank:             Joi.string().max(100).allow('', null).optional(),
  mfo:              Joi.string().max(10).allow('', null).optional(),
  tashrif_kunlari:  Joi.string().max(50).allow('', null).optional(),
  tashrif_chastota: Joi.string().max(30).allow('', null).optional(),
  lat:              Joi.number().min(-90).max(90).allow(null).optional(),
  lng:              Joi.number().min(-180).max(180).allow(null).optional(),
  kredit_limit:     Joi.number().min(0).allow(null).optional(),
  tolov_muddati_kun: Joi.number().integer().min(1).allow(null).optional(),
  izoh:             Joi.string().allow('', null).optional(),
  faol:             Joi.boolean().default(true),
  // Boshlang'ich qoldiq: manfiy = mijoz qarzdor, musbat = mijoz haqdor (biz qarzdormiz)
  boshlangich_balans: Joi.number().allow(null).optional(),
  boshlangich_sana:   Joi.string().isoDate().allow('', null).optional(),
  boshlangich_izoh:   Joi.string().max(255).allow('', null).optional(),
});

const update = create.fork(Object.keys(create.describe().keys), f => f.optional());

module.exports = { mijozSchemas: { create, update } };
