const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/agent.controller');
const auth    = require('../middleware/auth.middleware');
const joiMW   = require('../middleware/joi.middleware');
const ahf     = require('../middleware/awaitHandlerFactory.middleware');
const { agentSchemas } = require('../middleware/validators/agentValidator.middleware');

/* Spravochnik va statistika — oldin aniq routelar */
router.get('/spravochnik', auth(), ahf(c.spravochnik));
router.get('/statistika',  auth(), ahf(c.statistika));

/* CRUD */
router.get('/',     auth(), ahf(c.getAll));
router.get('/:id',  auth(), ahf(c.getById));
router.post('/',    auth(), joiMW(agentSchemas.create), ahf(c.create));
router.patch('/:id', auth(), joiMW(agentSchemas.update), ahf(c.update));
router.delete('/:id', auth(), ahf(c.delete));

/* Qo'shimcha */
router.get('/:id/mijozlar',  auth(), ahf(c.getMijozlar));
router.get('/:id/register',  auth(), ahf(c.register));
router.patch('/:id/faol',    auth(), ahf(c.toggleFaol));

module.exports = router;
