const express = require('express');
const router = express.Router();
const userController = require('../controllers/web/user.controller');
const auth = require('../middleware/auth.middleware');
const Role = require('../utils/userRoles.utils');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');
const joiMiddleware = require('../middleware/joi.middleware');
const { userSchemas } = require('../middleware/validators/userValidator.middleware');


router.get('/', auth(), awaitHandlerFactory(userController.getAll));
router.get('/id/:id', auth(), awaitHandlerFactory(userController.getById));
router.get('/username/:username', auth(), awaitHandlerFactory(userController.getByUsername));
router.get('/whoami', auth(), awaitHandlerFactory(userController.getCurrentUser));
// Yangi foydalanuvchini faqat Admin yaratadi (avval auth yo'q edi — istalgan kishi Admin yarata olardi)
router.post('/', auth(Role.Admin), joiMiddleware(userSchemas.create), awaitHandlerFactory(userController.create));
// Admin — istalgan foydalanuvchini; boshqalar — faqat o'zini (rol/perms'siz), controllerda tekshiriladi
router.patch('/id/:id', auth(), joiMiddleware(userSchemas.update), awaitHandlerFactory(userController.update));
router.delete('/id/:id', auth(Role.Admin), awaitHandlerFactory(userController.delete));

router.post('/login', joiMiddleware(userSchemas.login), awaitHandlerFactory(userController.userLogin));

module.exports = router;