const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/xarajat.controller');
const auth    = require('../middleware/auth.middleware');
const ahf     = require('../middleware/awaitHandlerFactory.middleware');
const uploadKassa = require('../middleware/uploadKassa.middleware');   // chek rasmi: uploads/kassa/
const ruxsat  = require('../middleware/ruxsat.middleware');

/* Moliya → Kunlik xarajatlar. /turlar — /:id dan oldin */
router.get('/turlar',        auth(), ahf(c.turlar));
router.post('/turlar',       auth(), ahf(c.turQosh));
router.patch('/turlar/:id',  auth(), ahf(c.turTahrir));
/* 2026-11-27 Xarajat limiti (FRONTEND-UCHUN §22): limitdan oshgan so'rovlar. Ko'rish — har kim (tasdiqlovchi
   hammasini, boshqalar o'zinikini); tasdiq/rad — Admin/Programmer yoki moliya 'approve'; bekor — yaratuvchi. */
router.get('/kassalar',                 auth(), ahf(c.kassalar));
router.get('/sorovlar',                 auth(), ahf(c.sorovlar));
router.get('/sorovlar/:id',             auth(), ahf(c.sorov));
router.post('/sorovlar/:id/tasdiqla',   auth(), ruxsat('moliya', 'approve'), ahf(c.sorovTasdiqla));
router.post('/sorovlar/:id/rad',        auth(), ruxsat('moliya', 'approve'), ahf(c.sorovRad));
router.post('/sorovlar/:id/bekor',      auth(), ahf(c.sorovBekor));
router.get('/',              auth(), ahf(c.royxat));
router.post('/',             auth(), uploadKassa.rasm.single('rasm'), ahf(c.create));
router.patch('/:id',         auth(), uploadKassa.rasm.single('rasm'), ahf(c.update));
router.delete('/:id',        auth(), ahf(c.delete));

module.exports = router;
