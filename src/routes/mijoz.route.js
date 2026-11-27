const express  = require('express');
const router   = express.Router();
const c        = require('../controllers/web/mijoz.controller');
const auth     = require('../middleware/auth.middleware');
const joiMW    = require('../middleware/joi.middleware');
const ahf      = require('../middleware/awaitHandlerFactory.middleware');
const { mijozSchemas } = require('../middleware/validators/mijozValidator.middleware');
const multer   = require('multer');
const imp      = require('../controllers/web/mijozImport.controller');
// Excel/CSV import — fayl xotirada o'qiladi (diskka yozilmaydi), 8 MB gacha
const importFayl = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

/* Spravochnik (katalog ma'lumotlari) */
router.get('/spravochnik', auth(), ahf(c.spravochnik));

/* Excel/CSV dan import: oqish (fayl → ustunlar, avto moslash) → tekshir/saqla; shablon */
router.post('/import/oqish',  auth(), importFayl.single('file'), ahf(imp.oqish));
router.post('/import',        auth(), ahf(imp.import));
router.get('/import/shablon', auth(), ahf(imp.shablon));

/* Xaritadagi mijozlar — '/:id' dan oldin turishi shart */
router.get('/xarita', auth(), ahf(c.xarita));

/* Mijozning oldi-berdi tarixi (savdo va to'lovlar bitta vaqt o'qida) */
router.get('/:id/oldi-berdi', auth(), ahf(c.oldiBerdi));

// Mijoz reytingi (utils/reyting.utils.js)
router.get('/reyting/xulosa', auth(), ahf(c.reytingXulosa));
router.get('/:id/reyting',   auth(), ahf(c.reyting));
router.post('/:id/reyting',  auth('Admin', 'Programmer'), ahf(c.reytingTuzat));

/* Mijoz CRUD */
/* 2026-11-27: mijozga tovar bo'yicha skidka */
const sk = require('../controllers/web/skidka.controller');
router.get('/:id/skidkalar',              auth(), ahf(sk.royxat));
router.put('/:id/skidkalar',              auth(), ahf(sk.saqla));
router.delete('/:id/skidkalar/:tovar_id', auth(), ahf(sk.ochir));

router.get('/',     auth(), ahf(c.getAll));
router.get('/:id',  auth(), ahf(c.getById));
router.post('/',    auth(), joiMW(mijozSchemas.create), ahf(c.create));
router.patch('/:id',auth(), joiMW(mijozSchemas.update), ahf(c.update));
router.delete('/:id',auth(), ahf(c.delete));

/* Territoriya */
router.post('/territoriya',        auth(), ahf(c.territoriyaCreate));
router.patch('/territoriya/:id',   auth(), ahf(c.territoriyaUpdate));
router.delete('/territoriya/:id',  auth(), ahf(c.territoriyaDelete));

/* Kategoriya */
router.post('/kategoriya',         auth(), ahf(c.kategoriyaCreate));
router.patch('/kategoriya/:id',    auth(), ahf(c.kategoriyaUpdate));
router.delete('/kategoriya/:id',   auth(), ahf(c.kategoriyaDelete));

module.exports = router;
