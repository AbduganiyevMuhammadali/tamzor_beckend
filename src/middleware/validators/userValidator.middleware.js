const Joi = require('joi');
const Role = require('../../utils/userRoles.utils');

exports.userSchemas = {
  create: Joi.object({
    username: Joi.string().required().min(3).max(25),
    fullname: Joi.string().required().min(3).max(50),
    role: Joi.string().valid(Role.Admin, Role.User, Role.Programmer).required(),
    password: Joi.string().min(3).required().label('Password'),
    confirmPassword: Joi.any().equal(Joi.ref('password'))
        .required()
        .label('Confirm password')
        .messages({ 'any.only': '{{#label}} does not match' }),
    xarajat_limit: Joi.number().min(0).max(1e15).allow(null, '').label('xarajat_limit'),
  }),

  // 2026-11-27: qisman tahrir (masalan faqat { xarajat_limit }) — yuborilmagan maydon o'zgarmaydi
  update: Joi.object({
    username: Joi.string().min(3).max(25),
    fullname: Joi.string().min(3).max(50),
    role: Joi.string().valid(Role.Admin, Role.User, Role.Programmer),
    xarajat_limit: Joi.number().min(0).max(1e15).allow(null, '').label('xarajat_limit'),
    password: Joi.string().min(3).label('Password').empty(''),
    confirmPassword: Joi.any().equal(Joi.ref('password')).empty('')
        .label('Confirm password')
        .messages({ 'any.only': '{{#label}} does not match' }),
  }),

  login: Joi.object({
    username: Joi.string().empty(''),
    password: Joi.string().required(),
  }),
};