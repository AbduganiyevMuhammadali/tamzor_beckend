const express = require('express');
const router = express.Router();
const c = require('../controllers/web/ishlab.controller');
const auth = require('../middleware/auth.middleware');
const ahf = require('../middleware/awaitHandlerFactory.middleware');

/* Ishlab chiqarish: qoralama → boshlash (xom ashyo chiqadi) → yakunlash (mahsulot kiradi, tannarx) */
router.get('/spravochnik',  auth(), ahf(c.spravochnik));   // /:id dan oldin
router.get('/',             auth(), ahf(c.getAll));
router.get('/:id',          auth(), ahf(c.getById));
router.post('/',            auth(), ahf(c.create));
router.post('/tartibla',    auth(), ahf(c.tartibla));   // noto'g'ri omborda turgan qoldiqni turi omboriga
router.patch('/:id',        auth(), ahf(c.update));
router.post('/:id/boshla',  auth(), ahf(c.boshla));
router.post('/:id/yakunla', auth(), ahf(c.yakunla));
router.post('/:id/bekor',   auth(), ahf(c.bekor));
router.post('/:id/nusxa',   auth(), ahf(c.nusxa));

module.exports = router;
