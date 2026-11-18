const express = require('express');
const router = express.Router();
const c = require('../controllers/web/navbat.controller');
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');

router.get('/', auth(), h(c.ishNavbati));

module.exports = router;
