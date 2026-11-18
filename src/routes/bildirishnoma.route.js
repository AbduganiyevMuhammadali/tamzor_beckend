const express = require('express');
const router = express.Router();
const c = require('../controllers/web/bildirishnoma.controller');
const auth = require('../middleware/auth.middleware');
const ahf = require('../middleware/awaitHandlerFactory.middleware');

router.get('/', auth(), ahf(c.royxat));

module.exports = router;
