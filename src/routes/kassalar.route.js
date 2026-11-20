const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/kassalar.controller');
const auth    = require('../middleware/auth.middleware');
const h       = require('../middleware/awaitHandlerFactory.middleware');

/* 2026-11-22: Kassalar, plastik to'lovlar tasdig'i, agent naqd topshiruvlari (FRONTEND-UCHUN §17) */
router.get('/',            auth(), h(c.royxat));
router.get('/viloyatlar',  auth(), h(c.viloyatlar));
router.get('/agentlar',    auth(), h(c.agentlar));

router.get('/plastik-tolovlar',              auth(), h(c.plastikRoyxat));
router.get('/plastik-tolovlar/:id',          auth(), h(c.plastikBitta));
router.get('/plastik-tolovlar/:id/audit',    auth(), h(c.plastikAudit));
router.post('/plastik-tolovlar/:id/tasdiqla', auth(), h(c.plastikTasdiqla));
router.post('/plastik-tolovlar/:id/rad',     auth(), h(c.plastikRad));
router.patch('/plastik-tolovlar/:id',        auth(), h(c.plastikTahrir));

router.get('/topshiruvlar',               auth(), h(c.topshiruvRoyxat));
router.get('/topshiruvlar/:id',           auth(), h(c.topshiruvBitta));
router.post('/topshiruvlar/:id/tasdiqla', auth(), h(c.topshiruvTasdiqla));
router.post('/topshiruvlar/:id/rad',      auth(), h(c.topshiruvRad));

router.get('/:id',        auth(), h(c.bitta));
router.post('/',          auth(), h(c.create));
router.patch('/:id',      auth(), h(c.update));
router.patch('/:id/faol', auth(), h(c.faol));
router.delete('/:id',     auth(), h(c.delete));

module.exports = router;
