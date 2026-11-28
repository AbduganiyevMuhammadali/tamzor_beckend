const express = require('express');
const router = express.Router();
const c = require('../controllers/web/avtolavka.controller');
const auth = require('../middleware/auth.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');
const ruxsat = require('../middleware/ruxsat.middleware');
const uploadKassa = require('../middleware/uploadKassa.middleware');
const kc = require('../controllers/web/agentKochirish.controller');

/* Agentdan agentga ko'chirish (2026-11-26): yozish — avtolavka 'create' YOKI ombor 'edit'.
   O'qish (ro'yxat, bitta hujjat, agent-qoldiq) — yozish ruxsati o'qishni ham beradi (2026-11-27):
   avtolavka 'view'|'create' YOKI ombor 'view'|'edit' */
const KOCHIRISH_YOZISH = ruxsat.biri([['avtolavka', 'create'], ['ombor', 'edit']]);
const KOCHIRISH_OQISH = ruxsat.biri([['avtolavka', ['view', 'create']], ['ombor', ['view', 'edit']]]);

router.get('/doska',          auth(), h(c.doska));
router.get('/kalendar',       auth(), h(c.kalendar));
router.get('/tavsiya',        auth(), h(c.tavsiya));
router.get('/agentlar',       auth(), h(c.agentlar));
router.get('/tovarlar',       auth(), h(c.tovarlar));
router.get('/qoldiq',         auth(), h(c.qoldiq));
router.get('/solishtirma',    auth(), h(c.solishtirma));
router.get('/kunlar',         auth(), h(c.kunlar));
router.get('/sotuvlar',       auth(), h(c.sotuvlar));

// 2026-11-24: sotuvga bog'langan qaytarishlar tarixi (mobil savdoQaytarish) — avtolavka 'view'
router.get('/qaytarishlar',     auth(), ruxsat('avtolavka', 'view'), h(c.qaytarishlar));
router.get('/qaytarishlar/:id', auth(), ruxsat('avtolavka', 'view'), h(c.qaytarishBitta));

router.get('/hujjatlar',      auth(), h(c.ruyxat));
router.get('/hujjatlar/:id',  auth(), h(c.getById));

router.post('/yuklash',                auth(), h(c.yuklashCreate));
router.patch('/yuklash/:id',           auth(), h(c.yuklashUpdate));
router.patch('/yuklash/:id/tasdiqla',  auth(), h(c.yuklashTasdiqla));
router.patch('/yuklash/:id/rad',       auth(), h(c.yuklashRad));
router.patch('/yuklash/:id/tuzat',     auth(), h(c.yuklashTuzat));    // 2026-11-27: agent rad etgan dalolatnomani tuzatish
router.get('/yuklash/:id/dalolatnoma', auth(), h(c.dalolatnoma));     // 2026-11-27: yuk dalolatnomasi
router.delete('/yuklash/:id',          auth(), h(c.yuklashDelete));

router.post('/qabul',                  auth(), h(c.qabulCreate));
router.get('/brak',                    auth(), h(c.brakRuyxat));     // 2026-11-28: agent braki
router.get('/almashtirishlar',         auth(), h(c.almashtirishlar)); // 2026-11-28: tovar almashtirish jurnali
router.post('/brak-qabul',             auth(), h(c.brakQabul));      // 2026-11-28: agent braki → kompaniya Brak ombori
// Yopilgan kunni qayta ochish — bir kunda yangi reys
router.post('/kun/qayta-och',          auth(), h(c.kunQaytaOch));

// Sotuv qilish — xodim ilovadan sota olmasa, web'dan uning nomidan (mobil saveSell bilan bir xil yo'l)
router.get('/sotuv/tayyor',            auth(), h(c.sotuvTayyor));
// 2026-11-24: tolov_usuli 'plastik' — chek multipart `chek` fayli yoki JSON chek_rasm (POST /kassalar/chek-yuklash)
router.post('/sotuv',                  auth(), uploadKassa.single('chek'), h(c.sotuvCreate));
// Takror/xato chekni bekor qilish — faqat Admin (ombor, kassa, mijoz qarzi, bonus teskari yoziladi)
router.post('/sotuv/:id/bekor',        auth('Admin', 'Programmer'), h(c.sotuvBekor));

router.get('/agent-qoldiq',            auth(), KOCHIRISH_OQISH, h(kc.agentQoldiq));
router.get('/kochirish',               auth(), KOCHIRISH_OQISH, h(kc.royxat));
router.post('/kochirish',              auth(), KOCHIRISH_YOZISH, h(kc.yarat));
router.get('/kochirish/:id',           auth(), KOCHIRISH_OQISH, h(kc.bitta));
router.patch('/kochirish/:id',         auth(), KOCHIRISH_YOZISH, h(kc.tahrirla));
router.post('/kochirish/:id/bekor',    auth(), KOCHIRISH_YOZISH, h(kc.bekor));

module.exports = router;
