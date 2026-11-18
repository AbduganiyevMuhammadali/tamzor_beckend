const express = require('express');
const router = express.Router();
const c = require('../controllers/web/tripSheet.controller');
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');

router.get('/tayinlanmagan',      auth(), h(c.tayinlanmaganArizalar));
router.get('/qaytarish',          auth(), h(c.qaytarishRuyxat));
router.get('/',                   auth(), h(c.getAll));
router.get('/:id',                auth(), h(c.getById));
router.post('/',                  auth(), h(c.create));
router.post('/:id/arizalar',      auth(), h(c.addArizalar));
router.delete('/:id/arizalar/:arizaId', auth(), h(c.removeAriza));

module.exports = router;
