const Joi = require('joi');

const qatorSchema = Joi.object({
  tovar_id:              Joi.number().integer().required(),
  tovar_nomi:            Joi.string().max(120).required(),
  tovar_kodi:            Joi.string().max(30).allow('', null).optional(),
  shtrix_kod:            Joi.string().max(30).allow('', null).optional(),
  turkum:                Joi.string().max(80).allow('', null).optional(),
  ishlab_chiqarish_sana: Joi.string().allow('', null).optional(),
  yaroqlilik_muddati:    Joi.string().allow('', null).optional(),
  // narx (so'm) $ narx kiritilganda backend'da avtomatik hisoblanadi, shuning
  // uchun majburiy emas — lekin kamida biri (so'm yoki $) berilishi kerak.
  narx:                  Joi.number().min(0).default(0),
  narx_usd:              Joi.number().min(0).default(0),
  sotuv_narx:            Joi.number().min(0).allow(null).optional(),
  sotuv_narx_usd:        Joi.number().min(0).allow(null).optional(),
  optom_narx:            Joi.number().min(0).allow(null).optional(),
  optom_narx_usd:        Joi.number().min(0).allow(null).optional(),
  chakana_narx:          Joi.number().min(0).allow(null).optional(),
  chakana_narx_usd:      Joi.number().min(0).allow(null).optional(),
  qutilarda:             Joi.number().min(0).default(0),
  bloklarda:             Joi.number().min(0).default(0),
  donada:                Joi.number().min(0).default(0),
  hajm:                  Joi.number().min(0).allow(null).optional(),
  // summa server tomonda narx × donada qilib qayta hisoblanadi (prixod.controller) — klientniki ishlatilmaydi
  summa:                 Joi.number().min(0).default(0),
})
  .or('narx', 'narx_usd')
  .messages({ 'object.missing': "Kirim narxi (so'm yoki $) kiritilishi shart" });

// Hujjat sanasi: YYYY-MM-DD (ixtiyoriy vaqt/ISO qismi bilan) va haqiqiy sana bo'lishi shart.
// Joi.date() ishlatilmaydi — u qiymatni Date obyektiga aylantirib, saqlanish formatini o'zgartiradi.
const sanaSchema = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/)
  .custom((v, h) => {
    const d = new Date(v.slice(0, 10) + 'T00:00:00Z');
    return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v.slice(0, 10) ? h.error('any.invalid') : v;
  })
  .messages({ 'string.pattern.base': "Sana noto'g'ri (YYYY-MM-DD)", 'any.invalid': "Sana noto'g'ri (YYYY-MM-DD)" });

exports.prixodSchemas = {
  create: Joi.object({
    sana:              sanaSchema.required(),
    yetkazuvchi:       Joi.string().max(120).allow('', null).optional(),
    yetkazuvchi_id:    Joi.number().integer().allow(null).optional(),
    tolov_turi:        Joi.string().valid('naqt', 'optom', 'chaka').allow(null).optional(),
    tolangan_summa:    Joi.number().min(0).default(0),
    ombor:             Joi.string().max(80).allow('', null).optional(),
    izoh:              Joi.string().max(2000).allow('', null).optional(),
    qoshimcha_xarajat: Joi.number().min(0).default(0),
    qatorlar:          Joi.array().items(qatorSchema).min(0).max(500).default([]),
  }),
  update: Joi.object({
    sana:              sanaSchema.optional(),
    yetkazuvchi:       Joi.string().max(120).allow('', null).optional(),
    yetkazuvchi_id:    Joi.number().integer().allow(null).optional(),
    tolov_turi:        Joi.string().valid('naqt', 'optom', 'chaka').allow(null).optional(),
    tolangan_summa:    Joi.number().min(0).optional(),
    ombor:             Joi.string().max(80).allow('', null).optional(),
    izoh:              Joi.string().max(2000).allow('', null).optional(),
    qoshimcha_xarajat: Joi.number().min(0).optional(),
    qatorlar:          Joi.array().items(qatorSchema).max(500).optional(),
  }),
  // Faqat narx tuzatish (tasdiqlangan hujjatda ham) — miqdor yuborilmaydi
  narxlar: Joi.object({
    qatorlar: Joi.array().max(500).items(Joi.object({
      id:         Joi.number().integer().required(),
      narx:       Joi.number().min(0).allow(null).optional(),
      narx_usd:   Joi.number().min(0).allow(null).optional(),
      sotuv_narx: Joi.number().min(0).allow(null).optional(),
      donada:     Joi.number().min(0).allow(null).optional(),   // jami miqdor (kg) — tasdiqlangan hujjatda faqat Admin
    })).min(1).required(),
  }),
};
