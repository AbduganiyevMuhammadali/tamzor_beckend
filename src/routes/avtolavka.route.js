const express = require('express');
const router = express.Router();
const c = require('../controllers/web/avtolavka.controller');
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');

router.get('/doska',          auth(), h(c.doska));
router.get('/kalendar',       auth(), h(c.kalendar));
router.get('/tavsiya',        auth(), h(c.tavsiya));
router.get('/agentlar',       auth(), h(c.agentlar));
router.get('/tovarlar',       auth(), h(c.tovarlar));
router.get('/qoldiq',         auth(), h(c.qoldiq));
router.get('/solishtirma',    auth(), h(c.solishtirma));
router.get('/kunlar',         auth(), h(c.kunlar));
router.get('/sotuvlar',       auth(), h(c.sotuvlar));

router.get('/hujjatlar',      auth(), h(c.ruyxat));
router.get('/hujjatlar/:id',  auth(), h(c.getById));

router.post('/yuklash',                auth(), h(c.yuklashCreate));
router.patch('/yuklash/:id',           auth(), h(c.yuklashUpdate));
router.patch('/yuklash/:id/tasdiqla',  auth(), h(c.yuklashTasdiqla));
router.patch('/yuklash/:id/rad',       auth(), h(c.yuklashRad));
router.delete('/yuklash/:id',          auth(), h(c.yuklashDelete));

router.post('/qabul',                  auth(), h(c.qabulCreate));
// Yopilgan kunni qayta ochish — bir kunda yangi reys
router.post('/kun/qayta-och',          auth(), h(c.kunQaytaOch));

// Sotuv qilish — xodim ilovadan sota olmasa, web'dan uning nomidan (mobil saveSell bilan bir xil yo'l)
router.get('/sotuv/tayyor',            auth(), h(c.sotuvTayyor));
router.post('/sotuv',                  auth(), h(c.sotuvCreate));
// Takror/xato chekni bekor qilish — faqat Admin (ombor, kassa, mijoz qarzi, bonus teskari yoziladi)
router.post('/sotuv/:id/bekor',        auth('Admin', 'Programmer'), h(c.sotuvBekor));

module.exports = router;
