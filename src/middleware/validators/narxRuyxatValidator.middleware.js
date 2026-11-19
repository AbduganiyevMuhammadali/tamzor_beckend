const Joi = require('joi');

const TUR = Joi.string().valid('optom', 'chakana', 'maxsus');

exports.narxRuyxatSchemas = {
  create: Joi.object({
    nomi:     Joi.string().trim().min(1).max(100).required(),
    tur:      TUR.optional(),
    standart: Joi.boolean().optional(),
    faol:     Joi.boolean().optional(),
    izoh:     Joi.string().max(255).allow('', null).optional(),
  }),

  update: Joi.object({
    nomi:     Joi.string().trim().min(1).max(100).optional(),
    tur:      TUR.optional(),
    standart: Joi.boolean().optional(),
    faol:     Joi.boolean().optional(),
    izoh:     Joi.string().max(255).allow('', null).optional(),
  }),

  narxlar: Joi.object({
    qatorlar: Joi.array().items(Joi.object({
      tovar_id: Joi.number().integer().positive().required(),
      narx:     Joi.number().min(0).required(),
    })).max(5000).required(),   // bitta so'rovda ko'pi bilan 5000 qator
  }),
};
