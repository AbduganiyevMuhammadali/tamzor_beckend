/* TELEGRAM MIJOZ BOTI (2026-11-28) — web: sozlamalar, mijoz bog'lanishlari, xabarlar jurnali (utils/telegram.utils.js)
   GET    /telegram/sozlama                      — bot holati, turlar (yoqilgan/o'chiq), statistika
   PATCH  /telegram/sozlama  { turlar: { sotuv: true, ... } }  — faqat Admin
   GET    /telegram/mijoz/:id                    — mijozning Telegram bog'lanishlari va oxirgi 50 xabar
   DELETE /telegram/mijoz/:id/:bogId             — bog'lanishni o'chirish (Admin)
   GET    /telegram/xabarlar?mijoz_id&holat&page — jurnal (100 tadan) */
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');
const HttpException = require('../utils/HttpException.utils');
const TG = require('../utils/telegram.utils');
const { MijozTelegramModel, TelegramXabarModel } = require('../models/telegram.model');

router.get('/sozlama', auth(), h(async (req, res) => res.send(await TG.sozlamalar())));
router.patch('/sozlama', auth('Admin'), h(async (req, res) => res.send(await TG.sozlamaYoz(req.body))));

router.get('/mijoz/:id', auth(), h(async (req, res) => {
  const id = Number(req.params.id) || 0;
  const [boglar, xabarlar] = await Promise.all([
    MijozTelegramModel.findAll({ where: { mijoz_id: id }, order: [['id', 'ASC']], raw: true }),
    TelegramXabarModel.findAll({ where: { mijoz_id: id }, order: [['id', 'DESC']], limit: 50, raw: true }),
  ]);
  res.send({ boglar, xabarlar });
}));

router.delete('/mijoz/:id/:bogId', auth('Admin'), h(async (req, res) => {
  const n = await MijozTelegramModel.destroy({ where: { id: Number(req.params.bogId) || 0, mijoz_id: Number(req.params.id) || 0 } });
  if (!n) throw new HttpException(404, "Bog'lanish topilmadi");
  res.send({ ok: true });
}));

router.get('/xabarlar', auth(), h(async (req, res) => {
  const where = {};
  if (req.query.mijoz_id) where.mijoz_id = Number(req.query.mijoz_id) || 0;
  if (['yuborildi', 'xato'].includes(req.query.holat)) where.holat = req.query.holat;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const { count, rows } = await TelegramXabarModel.findAndCountAll({ where, order: [['id', 'DESC']], limit: 100, offset: (page - 1) * 100, raw: true });
  res.send({ count, rows, page, pages: Math.ceil(count / 100) });
}));

module.exports = router;
