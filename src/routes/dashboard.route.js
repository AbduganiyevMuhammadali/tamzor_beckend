const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/dashboard.controller');
const auth    = require('../middleware/auth.middleware');
const ahf     = require('../middleware/awaitHandlerFactory.middleware');

router.get('/', auth(), ahf(c.main));

module.exports = router;
