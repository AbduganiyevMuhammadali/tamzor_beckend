const express = require('express');
const router = express.Router();
const c = require('../controllers/web/turkum.controller');
const auth = require('../middleware/auth.middleware');
const ahf = require('../middleware/awaitHandlerFactory.middleware');

// /tartib `/:id`dan oldin turishi shart (aks holda "tartib" id sifatida ushlanadi)
router.get('/',                 auth(), ahf(c.getAll));
router.patch('/tartib',         auth(), ahf(c.tartib));
router.get('/:id',              auth(), ahf(c.getById));
router.get('/:id/tanlash',      auth(), ahf(c.tanlash));
router.post('/',                auth(), ahf(c.create));
router.patch('/:id',            auth(), ahf(c.update));
router.patch('/:id/faol',       auth(), ahf(c.faol));
router.patch('/:id/tovarlar',   auth(), ahf(c.tovarlar));
router.delete('/:id',           auth(), ahf(c.delete));

module.exports = router;
