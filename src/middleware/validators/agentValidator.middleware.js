const Joi = require('joi');

const KUNLAR = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
const TRANSPORT = ['avto', 'moto', 'piyoda', 'velosiped', 'boshqa'];

// Default qiymatlarsiz asos — tahrir (PATCH) sxemasi shundan olinadi
const asos = Joi.object({
  fullname:          Joi.string().min(2).max(100).required()
                       .messages({ 'string.empty': 'Ism majburiy', 'any.required': 'Ism majburiy' }),
  telefon:           Joi.string().max(20).allow('', null).optional(),
  passport:          Joi.string().max(20).allow('', null).optional(),
  tugilgan_sana:     Joi.string().isoDate().allow('', null).optional(),
  territoriya_id:    Joi.number().integer().positive().allow(null).optional(),
  plan_summa:        Joi.number().min(0).required()
                       .messages({ 'any.required': 'Oylik plan summasi majburiy' }),
  bonus_foiz:        Joi.number().min(0).max(100).allow(null).optional(),
  kredit_limit:      Joi.number().min(0).allow(null).optional(),
  max_chegirma:      Joi.number().min(0).max(100).allow(null).optional(),
  ish_boshlagan:     Joi.string().isoDate().allow('', null).optional(),
  // Array yoki vergul bilan ajratilgan string
  tashrif_kunlari:   Joi.alternatives().try(
    Joi.array().items(Joi.string().valid(...KUNLAR)),
    Joi.string().max(50).allow('', null)
  ).optional(),
  boshlanish_manzil: Joi.string().max(255).allow('', null).optional(),
  transport:         Joi.string().valid(...TRANSPORT).allow(null).optional(),
  mashina_raqam:     Joi.string().max(20).allow('', null).optional(),
  radius_km:         Joi.number().min(0).max(1000).allow(null).optional(),
  izoh:              Joi.string().allow('', null).optional(),
  faol:              Joi.boolean().optional(),
  avtolavka:         Joi.boolean().optional(),   // 2026-11-21 dan e'tiborsiz: hamma agent o'z omboridan sotadi
  // Super agent bayrog'i va biriktirish (agent.controller superAgentTekshir — qoidalar)
  super_agent:       Joi.boolean().optional(),
  super_agent_id:    Joi.number().integer().positive().allow(null).optional(),
  // Mobil ilovada narxni o'zgartirish ruxsati (login → editPrice)
  narx_ozgartirish:  Joi.boolean().optional(),
  // 2026-11-27: mobil ilovada mijoz telefon/manzil/lokatsiyasini tahrirlash ruxsati (login → editClient)
  mijoz_tahrir:      Joi.boolean().optional(),
  // 2026-11-29: diller (hamkor) bayrog'i — qoidalar utils/diller.utils bayroqTekshir
  diller:            Joi.boolean().optional(),
  // Mobil ilova kirishi (login bo'sh — agent ilovaga kirmaydi; parol bo'sh — o'zgarmaydi)
  login:             Joi.string().trim().max(50).allow('', null).optional(),
  parol:             Joi.string().min(4).max(100).allow('', null).optional()
                       .messages({ 'string.min': 'Parol kamida 4 belgi' }),
});

const create = asos.keys({ faol: Joi.boolean().default(true) });

// Tahrirda default YO'Q: faol yuborilmasa o'zgarmaydi (o'chirilgan agent qayta yoqilmaydi)
const update = asos
  .fork(['fullname', 'plan_summa'], f => f.optional())
  .unknown(false);

module.exports = { agentSchemas: { create, update } };
