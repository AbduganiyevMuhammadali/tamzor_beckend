const express = require('express');
const router = express.Router();
const c = require('../controllers/web/sozlama.controller');
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');

router.get('/kurs',   auth(), h(c.getKurs));
router.patch('/kurs', auth('Admin'), h(c.updateKurs));
router.get('/chek',   auth(), h(c.getChek));
router.patch('/chek', auth('Admin'), h(c.updateChek));
router.get('/xavfsizlik',   auth('Admin'), h(c.getXavfsizlik));     // o'chirish paroli
router.patch('/xavfsizlik', auth('Admin'), h(c.updateXavfsizlik));
router.get('/reyting',      auth(), h(c.getReyting));               // mijoz reytingi ballari
router.patch('/reyting',    auth('Admin'), h(c.updateReyting));

module.exports = router;
