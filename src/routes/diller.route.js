const express = require('express');
const router = express.Router();
const c = require('../controllers/web/diller.controller');
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');
const ruxsat = require('../middleware/ruxsat.middleware');

/* Dillerlar (2026-11-29, FRONTEND-UCHUN §24). Admin/Programmer — doim ochiq.
   O'qish — avtolavka view|create YOKI ombor view|edit YOKI moliya view.
   Berish / qaytarish — avtolavka create YOKI ombor edit. To'lov — moliya create YOKI moliya approve. */
const OQISH = ruxsat.biri([['avtolavka', ['view', 'create']], ['ombor', ['view', 'edit']], ['moliya', 'view']]);
const TOVAR = ruxsat.biri([['avtolavka', 'create'], ['ombor', 'edit']]);
const PUL = ruxsat.biri([['moliya', ['create', 'approve']]]);

router.get('/',                auth(), OQISH, h(c.royxat));
router.get('/hujjat/:hid',     auth(), OQISH, h(c.hujjat));
router.get('/:id',             auth(), OQISH, h(c.karta));
router.get('/:id/hujjatlar',   auth(), OQISH, h(c.hujjatlar));
router.get('/:id/sotuvlar',    auth(), OQISH, h(c.sotuvlar));
router.get('/:id/mijozlar',    auth(), OQISH, h(c.mijozlar));
router.post('/:id/berish',     auth(), TOVAR, h(c.berish));
router.post('/:id/qaytarish',  auth(), TOVAR, h(c.qaytarish));
router.post('/:id/tolov',      auth(), PUL, h(c.tolov));

module.exports = router;
