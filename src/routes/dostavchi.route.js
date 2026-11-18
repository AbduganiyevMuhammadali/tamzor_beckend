const express = require('express');
const router  = express.Router();
const ctrl    = require('../controllers/web/dostavchi.controller');
const auth    = require('../middleware/auth.middleware');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');
const joiMiddleware = require('../middleware/joi.middleware');
const { dostavchiSchemas } = require('../middleware/validators/dostavchiValidator.middleware');

router.get('/',           auth(), awaitHandlerFactory(ctrl.getAll));
router.get('/tavsiya',    auth(), awaitHandlerFactory(ctrl.tavsiya));
router.get('/hudud-tavsiya', auth(), awaitHandlerFactory(ctrl.hududTavsiya));
router.get('/:id',        auth(), awaitHandlerFactory(ctrl.getById));
router.get('/:id/reja',       auth(), awaitHandlerFactory(ctrl.reja));
router.get('/:id/statistika', auth(), awaitHandlerFactory(ctrl.statistika));
router.get('/:id/kassa',        auth(), awaitHandlerFactory(ctrl.kassa));
router.post('/:id/kassa-qabul', auth(), awaitHandlerFactory(ctrl.kassaQabul));
router.post('/',          auth(), joiMiddleware(dostavchiSchemas.create), awaitHandlerFactory(ctrl.create));
router.patch('/:id',      auth(), joiMiddleware(dostavchiSchemas.update), awaitHandlerFactory(ctrl.update));
router.patch('/:id/faol', auth(), awaitHandlerFactory(ctrl.toggleFaol));
router.delete('/:id',     auth(), awaitHandlerFactory(ctrl.delete));

module.exports = router;
