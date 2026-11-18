const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/web/yetkazuvchi.controller');
const auth    = require('../middleware/auth.middleware');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');
const joiMiddleware = require('../middleware/joi.middleware');
const { yetkazuvchiSchemas } = require('../middleware/validators/yetkazuvchiValidator.middleware');

router.get('/',               auth(), awaitHandlerFactory(ctrl.getAll));
router.get('/qoldiqlar',      auth(), awaitHandlerFactory(ctrl.qoldiqlar));   // /:id dan OLDIN turishi shart
router.get('/:id',            auth(), awaitHandlerFactory(ctrl.getById));
router.post('/',              auth(), joiMiddleware(yetkazuvchiSchemas.create), awaitHandlerFactory(ctrl.create));
router.patch('/:id',          auth(), joiMiddleware(yetkazuvchiSchemas.update), awaitHandlerFactory(ctrl.update));
router.delete('/:id',         auth(), awaitHandlerFactory(ctrl.delete));
router.post('/:id/tolov',     auth(), joiMiddleware(yetkazuvchiSchemas.tolov),  awaitHandlerFactory(ctrl.tolov));
router.get('/:id/harakatlar', auth(), awaitHandlerFactory(ctrl.harakatlar));

module.exports = router;
