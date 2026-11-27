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
// 2026-11-27: yuk dalolatnomasi imzosi majburiymi ({ yuk_imzo_majburiy: bool })
router.get('/yuk-imzo',     auth(), h(async (req, res) => res.send({ yuk_imzo_majburiy: await require('../utils/yukImzo.utils').imzoMajburiy() })));
router.patch('/yuk-imzo',   auth('Admin'), h(async (req, res) => res.send(await require('../utils/yukImzo.utils').imzoMajburiyYoz(!!(req.body && req.body.yuk_imzo_majburiy)))));

module.exports = router;
