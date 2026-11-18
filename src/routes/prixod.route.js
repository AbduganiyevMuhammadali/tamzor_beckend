const express = require('express');
const router = express.Router();
const prixodController = require('../controllers/web/prixod.controller');
const auth = require('../middleware/auth.middleware');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');
const joiMiddleware = require('../middleware/joi.middleware');
const { prixodSchemas } = require('../middleware/validators/prixodValidator.middleware');

router.get('/',             auth(), awaitHandlerFactory(prixodController.getAll));
router.get('/:id',          auth(), awaitHandlerFactory(prixodController.getById));
router.post('/',            auth(), joiMiddleware(prixodSchemas.create), awaitHandlerFactory(prixodController.create));
router.patch('/:id',        auth(), joiMiddleware(prixodSchemas.update), awaitHandlerFactory(prixodController.update));
router.patch('/:id/tasdiq',  auth(), awaitHandlerFactory(prixodController.tasdiqla));
router.patch('/:id/narxlar', auth(), joiMiddleware(prixodSchemas.narxlar), awaitHandlerFactory(prixodController.narxlar));
router.patch('/:id/bekor',   auth(), awaitHandlerFactory(prixodController.bekorqilish));
router.delete('/:id',        auth(), awaitHandlerFactory(prixodController.delete));

module.exports = router;
