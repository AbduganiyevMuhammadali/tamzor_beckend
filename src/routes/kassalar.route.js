const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/kassalar.controller');
const auth    = require('../middleware/auth.middleware');
const ruxsat  = require('../middleware/ruxsat.middleware');
const uploadKassa = require('../middleware/uploadKassa.middleware');
const h       = require('../middleware/awaitHandlerFactory.middleware');

/* 2026-11-22: Kassalar, plastik to'lovlar tasdig'i, agent naqd topshiruvlari (FRONTEND-UCHUN §17)
   2026-11-24: sahifa ruxsatlari (FRONTEND-UCHUN §19.5) — Admin/Programmer har doim;
     ko'rish            → moliya 'view'
     kassa CRUD         → moliya 'create'
     tasdiq/rad/tahrir  → moliya 'approve' */
const view    = [auth(), ruxsat('moliya', 'view')];
const create  = [auth(), ruxsat('moliya', 'create')];
const approve = [auth(), ruxsat('moliya', 'approve')];

// Chek yuklash — web xodim nomidan plastik sotuv uchun (faqat auth: sotuv sahifasi moliya ruxsatini talab qilmaydi)
router.post('/chek-yuklash', auth(), uploadKassa.single('chek'), h(c.chekYuklash));

router.get('/',            ...view, h(c.royxat));
router.get('/viloyatlar',  ...view, h(c.viloyatlar));
router.get('/agentlar',    ...view, h(c.agentlar));

router.get('/plastik-tolovlar',              ...view, h(c.plastikRoyxat));
router.get('/plastik-tolovlar/:id',          ...view, h(c.plastikBitta));
router.get('/plastik-tolovlar/:id/audit',    ...view, h(c.plastikAudit));
router.post('/plastik-tolovlar/:id/tasdiqla', ...approve, h(c.plastikTasdiqla));
router.post('/plastik-tolovlar/:id/rad',     ...approve, h(c.plastikRad));
router.patch('/plastik-tolovlar/:id',        ...approve, h(c.plastikTahrir));

router.get('/topshiruvlar',               ...view, h(c.topshiruvRoyxat));
router.get('/topshiruvlar/:id',           ...view, h(c.topshiruvBitta));
router.post('/topshiruvlar/:id/tasdiqla', ...approve, h(c.topshiruvTasdiqla));
router.post('/topshiruvlar/:id/rad',      ...approve, h(c.topshiruvRad));

router.get('/:id',        ...view, h(c.bitta));
router.post('/',          ...create, h(c.create));
router.patch('/:id',      ...create, h(c.update));
router.patch('/:id/faol', ...create, h(c.faol));
router.delete('/:id',     ...create, h(c.delete));

module.exports = router;
