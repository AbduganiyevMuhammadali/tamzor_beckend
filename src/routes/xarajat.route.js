const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/xarajat.controller');
const auth    = require('../middleware/auth.middleware');
const ahf     = require('../middleware/awaitHandlerFactory.middleware');
const uploadKassa = require('../middleware/uploadKassa.middleware');   // chek rasmi: uploads/kassa/

/* Moliya → Kunlik xarajatlar. /turlar — /:id dan oldin */
router.get('/turlar',        auth(), ahf(c.turlar));
router.post('/turlar',       auth(), ahf(c.turQosh));
router.patch('/turlar/:id',  auth(), ahf(c.turTahrir));
router.get('/',              auth(), ahf(c.royxat));
router.post('/',             auth(), uploadKassa.single('rasm'), ahf(c.create));
router.patch('/:id',         auth(), uploadKassa.single('rasm'), ahf(c.update));
router.delete('/:id',        auth(), ahf(c.delete));

module.exports = router;
