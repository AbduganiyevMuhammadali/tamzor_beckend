const express = require('express');
const router  = express.Router();
const c       = require('../controllers/web/ariza.controller');
const auth    = require('../middleware/auth.middleware');
const joiMW   = require('../middleware/joi.middleware');
const ahf     = require('../middleware/awaitHandlerFactory.middleware');
const { arizaSchemas } = require('../middleware/validators/arizaValidator.middleware');

// Spravochnik va statistika — oldin aniq routelar
router.get('/spravochnik', auth(), ahf(c.spravochnik));
router.get('/statistika',  auth(), ahf(c.statistika));

// ── Qaytarishni qabul qilish (skladchi) ──
// '/:id' dan OLDIN turishi shart, aks holda "qabul-kutilmoqda" va
// "agent-ombor-qoldiq" id sifatida ushlanib qoladi
router.get('/qabul-kutilmoqda',   auth(), ahf(c.qabulKutilmoqda));
router.get('/agent-ombor-qoldiq', auth(), ahf(c.agentOmborQoldiq));

// Hududdagi bir nechta zakazni birga yo'lga chiqarish — '/:id' dan oldin
// turishi shart, aks holda "toplu-yolda" id sifatida ushlanib qoladi
router.patch('/toplu-yolda', auth(), joiMW(arizaSchemas.topluYolda), ahf(c.topluYolda));

// CRUD
router.get('/',      auth(), ahf(c.getAll));
router.get('/:id',   auth(), ahf(c.getById));
router.post('/',     auth(), joiMW(arizaSchemas.create), ahf(c.create));
router.patch('/:id', auth(), joiMW(arizaSchemas.update), ahf(c.update));
router.delete('/:id', auth(), ahf(c.delete));

// Holat o'zgartirish (asosiy jarayon)
router.patch('/:id/holat', auth(), joiMW(arizaSchemas.holatChange), ahf(c.changeHolat));

// Qaytarishni asosiy omborga qabul qilish
router.patch('/:id/qabul',  auth(), ahf(c.qaytarishQabul));

module.exports = router;
