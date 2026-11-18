const express = require('express');
const router = express.Router();
const tovarController = require('../controllers/web/tovar.controller');
const auth = require('../middleware/auth.middleware');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');
const joiMiddleware = require('../middleware/joi.middleware');
const { tovarSchemas } = require('../middleware/validators/tovarValidator.middleware');

router.get('/',            auth(), awaitHandlerFactory(tovarController.getAll));
router.get('/:id',         auth(), awaitHandlerFactory(tovarController.getById));
router.post('/',           auth(), joiMiddleware(tovarSchemas.create), awaitHandlerFactory(tovarController.create));
router.patch('/:id/faol',  auth(), awaitHandlerFactory(tovarController.toggleFaol));
router.patch('/:id',       auth(), joiMiddleware(tovarSchemas.update), awaitHandlerFactory(tovarController.update));
router.delete('/bulk',     auth(), awaitHandlerFactory(tovarController.bulkDelete));
router.delete('/:id',      auth(), awaitHandlerFactory(tovarController.delete));

module.exports = router;
