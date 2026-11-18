const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/uchinchiShaxs.controller');
const auth    = require('../middleware/auth.middleware');
const ahf     = require('../middleware/awaitHandlerFactory.middleware');

/* Moliya → Qarz oldi-berdi (uchinchi shaxslar). /harakat/:hid — /:id dan oldin */
router.get('/',                 auth(), ahf(c.getAll));
router.post('/',                auth(), ahf(c.create));
router.delete('/harakat/:hid',  auth(), ahf(c.harakatOchir));
router.get('/:id',              auth(), ahf(c.getById));
router.patch('/:id',            auth(), ahf(c.update));
router.delete('/:id',           auth(), ahf(c.delete));
router.post('/:id/harakat',     auth(), ahf(c.harakat));

module.exports = router;
