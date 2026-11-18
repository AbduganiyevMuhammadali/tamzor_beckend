const Joi = require('joi');

exports.dostavchiSchemas = {
  create: Joi.object({
    ism:           Joi.string().max(120).required(),
    telefon:       Joi.string().max(30).allow('', null).optional(),
    transport:     Joi.string().max(80).allow('', null).optional(),
    mashina_raqam: Joi.string().max(30).allow('', null).optional(),
    izoh:          Joi.string().max(2000).allow('', null).optional(),
    faol:          Joi.boolean().optional(),
    login:         Joi.string().max(50).allow('', null).optional(),
    parol:         Joi.string().min(4).max(100).allow('', null).optional(),
  }),

  update: Joi.object({
    ism:           Joi.string().max(120).optional(),
    telefon:       Joi.string().max(30).allow('', null).optional(),
    transport:     Joi.string().max(80).allow('', null).optional(),
    mashina_raqam: Joi.string().max(30).allow('', null).optional(),
    izoh:          Joi.string().max(2000).allow('', null).optional(),
    faol:          Joi.boolean().optional(),
    login:         Joi.string().max(50).allow('', null).optional(),
    parol:         Joi.string().min(4).max(100).allow('', null).optional(),
  }),
};
