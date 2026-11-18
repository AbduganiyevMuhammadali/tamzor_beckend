const Joi = require('joi');

exports.yetkazuvchiSchemas = {
  create: Joi.object({
    ism:     Joi.string().max(120).required(),
    telefon: Joi.string().max(30).allow('', null).optional(),
    manzil:  Joi.string().max(255).allow('', null).optional(),
    izoh:    Joi.string().max(2000).allow('', null).optional(),
  }),

  update: Joi.object({
    ism:     Joi.string().max(120).optional(),
    telefon: Joi.string().max(30).allow('', null).optional(),
    manzil:  Joi.string().max(255).allow('', null).optional(),
    izoh:    Joi.string().max(2000).allow('', null).optional(),
  }),

  tolov: Joi.object({
    summa:      Joi.number().min(0.01).required(),
    tolov_turi: Joi.string().valid('naqt', 'optom', 'chaka').required(),
    izoh:       Joi.string().max(2000).allow('', null).optional(),
    sana:       Joi.string().allow('', null).optional(),
  }),
};
