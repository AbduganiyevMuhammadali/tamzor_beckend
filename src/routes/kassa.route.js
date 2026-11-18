const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/web/kassa.controller');
const auth    = require('../middleware/auth.middleware');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');

router.get('/',       auth(), awaitHandlerFactory(ctrl.hisobot));
router.get('/kpi',    auth(), awaitHandlerFactory(ctrl.kpi));
router.post('/',      auth(), awaitHandlerFactory(ctrl.create));
router.delete('/:id', auth(), awaitHandlerFactory(ctrl.delete));

module.exports = router;
