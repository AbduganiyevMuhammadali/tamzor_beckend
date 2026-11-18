const express = require('express');
const router = express.Router();
const c = require('../controllers/web/tahlil.controller');
const auth = require('../middleware/auth.middleware');
const ahf = require('../middleware/awaitHandlerFactory.middleware');

/* Hisobotlar bo'limi — har biri bitta biznes savoliga javob (izohi controllerda) */
router.get('/biznes',         auth(), ahf(c.biznes));
router.get('/umumiy',         auth(), ahf(c.umumiy));
router.get('/sotuv',          auth(), ahf(c.sotuv));
router.get('/tovarlar',       auth(), ahf(c.tovarlar));
router.get('/qarzlar',        auth(), ahf(c.qarzlar));
router.get('/ombor',          auth(), ahf(c.ombor));
router.get('/kirim',          auth(), ahf(c.kirim));
router.get('/yetkazuvchilar', auth(), ahf(c.yetkazuvchilar));
router.get('/jurnal',         auth(), ahf(c.jurnal));
router.get('/xodim',          auth(), ahf(c.xodim));
router.get('/reyting',        auth(), ahf(c.reyting));   // mijozlar reytingi: bosh sahifa bloki va hisobot

module.exports = router;
