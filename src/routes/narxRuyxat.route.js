const express = require('express');
const router = express.Router();
const c = require('../controllers/web/narxRuyxat.controller');
const auth = require('../middleware/auth.middleware');
const joiMW = require('../middleware/joi.middleware');
const ahf = require('../middleware/awaitHandlerFactory.middleware');
const { narxRuyxatSchemas } = require('../middleware/validators/narxRuyxatValidator.middleware');

router.get('/',                    auth(), ahf(c.getAll));
router.get('/mijoz/:mijozId',      auth(), ahf(c.mijozNarxlari));
router.get('/:id',                 auth(), ahf(c.getById));
router.post('/',                   auth(), joiMW(narxRuyxatSchemas.create), ahf(c.create));
router.patch('/:id',               auth(), joiMW(narxRuyxatSchemas.update), ahf(c.update));
router.delete('/:id',              auth(), ahf(c.remove));
router.put('/:id/narxlar',         auth(), joiMW(narxRuyxatSchemas.narxlar), ahf(c.saveNarxlar));

module.exports = router;
