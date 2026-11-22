const express = require('express');
const router = express.Router();
const tovarController = require('../controllers/web/tovar.controller');
const auth = require('../middleware/auth.middleware');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');
const joiMiddleware = require('../middleware/joi.middleware');
const { tovarSchemas } = require('../middleware/validators/tovarValidator.middleware');
const ruxsat = require('../middleware/ruxsat.middleware');
const viloyatNarx = require('../controllers/web/tovarViloyatNarx.controller');

/* Viloyat narxlari (2026-11-25): o'qish — login yetarli; yozish — Admin/Programmer yoki perms.ombor 'edit'.
   /:id dan OLDIN turishi shart (aks holda "viloyat-narxlari" id deb olinadi). */
router.get('/viloyat-narxlari',                 auth(), awaitHandlerFactory(viloyatNarx.viloyatJadval));
router.put('/viloyat-narxlari/:territoriyaId',  auth(), ruxsat('ombor', 'edit'), awaitHandlerFactory(viloyatNarx.viloyatSaqla));
router.get('/:id/viloyat-narxlari',             auth(), awaitHandlerFactory(viloyatNarx.tovarNarxlari));
router.put('/:id/viloyat-narxlari',             auth(), ruxsat('ombor', 'edit'), awaitHandlerFactory(viloyatNarx.tovarNarxSaqla));

router.get('/',            auth(), awaitHandlerFactory(tovarController.getAll));
router.get('/:id',         auth(), awaitHandlerFactory(tovarController.getById));
router.post('/',           auth(), joiMiddleware(tovarSchemas.create), awaitHandlerFactory(tovarController.create));
router.patch('/:id/faol',  auth(), awaitHandlerFactory(tovarController.toggleFaol));
router.patch('/:id',       auth(), joiMiddleware(tovarSchemas.update), awaitHandlerFactory(tovarController.update));
router.delete('/bulk',     auth(), awaitHandlerFactory(tovarController.bulkDelete));
router.delete('/:id',      auth(), awaitHandlerFactory(tovarController.delete));

module.exports = router;
