const express = require('express');
const router = express.Router();
const c = require('../controllers/web/buyum.controller');
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');
const ruxsat = require('../middleware/ruxsat.middleware');

/* Buyumlar (2026-11-28, FRONTEND-UCHUN §23). Admin/Programmer — doim ochiq.
   Yozish (harakat) — avtolavka 'create' YOKI ombor 'edit'.
   O'qish — avtolavka 'view'|'create' YOKI ombor 'view'|'edit' (yozish ruxsati o'qishni ham beradi).
   Katalog (yaratish / tahrir / o'chirish) — ombor 'edit'. */
const YOZISH = ruxsat.biri([['avtolavka', 'create'], ['ombor', 'edit']]);
const OQISH = ruxsat.biri([['avtolavka', ['view', 'create']], ['ombor', ['view', 'edit']]]);
const KATALOG = ruxsat('ombor', 'edit');

router.get('/',                  auth(), OQISH, h(c.katalog));
router.post('/',                 auth(), KATALOG, h(c.yarat));
router.post('/harakat',          auth(), YOZISH, h(c.harakat));
router.get('/harakatlar',        auth(), OQISH, h(c.harakatlar));
router.get('/harakatlar/:id',    auth(), OQISH, h(c.harakatBitta));
router.get('/hisobot/agentlar',  auth(), OQISH, h(c.hisobotAgentlar));
router.get('/hisobot/mijozlar',  auth(), OQISH, h(c.hisobotMijozlar));
router.get('/hisobot/buyumlar',  auth(), OQISH, h(c.hisobotBuyumlar));
router.get('/agent/:id',         auth(), OQISH, h(c.agent));
router.patch('/:id',             auth(), KATALOG, h(c.tahrir));
router.delete('/:id',            auth(), KATALOG, h(c.ochir));

module.exports = router;
