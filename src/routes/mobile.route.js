const express = require('express');
const router = express.Router();
const c = require('../controllers/mobile');
const mobileAuth = require('../middleware/mobileAuth.middleware');
const uploadAudit = require('../middleware/uploadAudit.middleware');
const uploadKassa = require('../middleware/uploadKassa.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');
const mobilRol = require('../middleware/mobilRol.middleware');
const { loginRateLimit } = require('../middleware/rateLimit.middleware');

// Parol tanlashdan himoya: IP + login bo'yicha 15 daqiqada 10 ta xato urinish → 429
const loginLimit = loginRateLimit({ maks: 10, oynaMs: 15 * 60 * 1000 });

// .env MOBIL_ROLLAR — rol o'chirilgan bo'lsa shu guruh 403 qaytaradi
const dostavchik = mobilRol('dostavchik');
const tasdiq = mobilRol('tasdiq');
const audit = mobilRol('audit');

/* ── 14. Bootstrap config (token kerak emas) ─────────────────────────────────── */
router.get('/url1c',      h(c.url1c));
router.get('/LoadConfig', h(c.loadConfig));
router.get('/mobilSozlama', h(c.mobilSozlama));   // yangi ilova: rollar, chek rekvizitlari

/* ── 1. Auth (token kerak emas) ────────────────────────────────────────── */
router.post('/Login',    loginLimit, h(c.login));
router.get('/getFilial', h(c.getFilial));

/* ── 1. User (token) ───────────────────────────────────────────────────── */
router.get('/getUser', mobileAuth(), h(c.getUser));

/* ── 2. Location ───────────────────────────────────────────────────────── */
router.post('/sendLocation', mobileAuth(), h(c.sendLocation));
router.post('/saveLocation', mobileAuth(), h(c.saveLocation));

/* ── 3. Pricing & Currency ─────────────────────────────────────────────── */
router.get('/getKurs',        mobileAuth(), h(c.getKurs));
router.get('/getValyuta',     mobileAuth(), h(c.getValyuta));
router.get('/getPriceType',   mobileAuth(), h(c.getPriceType));
router.get('/getPaymentType', mobileAuth(), h(c.getPaymentType));

/* ── 4. Clients ────────────────────────────────────────────────────────── */
router.get('/getKlient',         mobileAuth(), h(c.getKlient));
router.get('/getAllKlient',      mobileAuth(), h(c.getAllKlient));
router.get('/getAllKlientAudit', mobileAuth(), h(c.getAllKlientAudit));
router.get('/info',              mobileAuth(), h(c.info));
router.post('/saveKlient',       mobileAuth(), h(c.saveKlient));
router.post('/updateClient',     mobileAuth(), h(c.updateClient));

/* ── 5. Products ───────────────────────────────────────────────────────── */
router.get('/getProductSell',            mobileAuth(), h(c.getProductSell));
router.get('/getProductsVozvrat',        mobileAuth(), h(c.getProductsVozvrat));
router.get('/getProductSellOffline',     mobileAuth(), h(c.getProductSellOffline));
router.get('/getProductsVozvratOffline', mobileAuth(), h(c.getProductsVozvratOffline));
router.get('/checkProduct',              mobileAuth(), h(c.checkProduct));
router.get('/getCategories',             mobileAuth(), h(c.getCategories));
router.get('/getBrends',                 mobileAuth(), h(c.getBrends));

/* ── 6. Orders & Sales ─────────────────────────────────────────────────── */
router.post('/saveSell',      mobileAuth(), h(c.saveSell));
router.post('/saveVozvrat',   mobileAuth(), h(c.saveVozvrat));
router.post('/editSell',      mobileAuth(), h(c.editSell));
router.get('/clientNotSell',  mobileAuth(), h(c.clientNotSell));
router.post('/tolovSurildi',  mobileAuth(), h(c.tolovSurildi));   // mijoz reytingi: qarz to'lovi boshqa kunga surildi
router.post('/savePayment',   mobileAuth(), uploadKassa.single('chek'), h(c.savePayment));

/* ── 7. Delivery ───────────────────────────────────────────────────────── */
router.get('/getDokDelivery',          mobileAuth(), dostavchik, h(c.getDokDelivery));
router.get('/getDokDeliveryLocation',  mobileAuth(), dostavchik, h(c.getDokDeliveryLocation));
router.post('/orderDelivery',          mobileAuth(), dostavchik, h(c.orderDelivery));
router.post('/returnDeliveryProducts', mobileAuth(), dostavchik, h(c.returnDeliveryProducts));
router.get('/getReturnDocDelivery',    mobileAuth(), dostavchik, h(c.getReturnDocDelivery));

/* ── 8. Offline (Weekly Clients) ───────────────────────────────────────── */
router.get('/getKlientOfflineMonday',    mobileAuth(), h(c.getKlientOfflineMonday));
router.get('/getKlientOfflineTuesday',   mobileAuth(), h(c.getKlientOfflineTuesday));
router.get('/getKlientOfflineWednesday', mobileAuth(), h(c.getKlientOfflineWednesday));
router.get('/getKlientOfflineThursday',  mobileAuth(), h(c.getKlientOfflineThursday));
router.get('/getKlientOfflineFriday',    mobileAuth(), h(c.getKlientOfflineFriday));
router.get('/getKlientOfflineSaturday',  mobileAuth(), h(c.getKlientOfflineSaturday));
router.get('/getKlientOfflineSunday',    mobileAuth(), h(c.getKlientOfflineSunday));
router.get('/getKlientOfflineAllWeek',   mobileAuth(), h(c.getKlientOfflineAllWeek));

/* ── 9. Audit ──────────────────────────────────────────────────────────── */
router.get('/getReason',  mobileAuth(), h(c.getReason));
router.post('/SendMedia', mobileAuth(), uploadAudit.array('img', 10), h(c.sendMedia));
router.post('/chekUp',    mobileAuth(), audit, h(c.chekUp));

/* ── 10. Regions & Locations ───────────────────────────────────────────── */
router.get('/region',   mobileAuth(), h(c.region));
router.get('/getXudud', mobileAuth(), h(c.getXudud));
router.get('/city',     mobileAuth(), h(c.city));

/* ── 11. Confirmations & Filters ───────────────────────────────────────── */
router.get('/getConfirms',  mobileAuth(), tasdiq, h(c.getConfirms));
router.post('/postConfirm', mobileAuth(), tasdiq, h(c.postConfirm));
router.get('/getBronFiltr', mobileAuth(), h(c.getBronFiltr));

/* ── 12. History ───────────────────────────────────────────────────────── */
router.get('/getAgentDocHistory',  mobileAuth(), h(c.getAgentDocHistory));
router.get('/getClientDocHistory', mobileAuth(), h(c.getClientDocHistory));
router.get('/mijozCheklar',        mobileAuth(), h(c.mijozCheklar));   // 20.1 mijoz chek tarixi

/* ── 13. Reports ───────────────────────────────────────────────────────── */
router.get('/getSellsReport',      mobileAuth(), h(c.getSellsReport));
router.get('/getSellsReportMonth', mobileAuth(), h(c.getSellsReportMonth));
router.get('/getBranches',         mobileAuth(), h(c.getBranches));
router.get('/getCircleReports',    mobileAuth(), h(c.getCircleReports));
router.get('/getLinearReports',    mobileAuth(), h(c.getLinearReports));
router.get('/getSections',         mobileAuth(), h(c.getSections));
router.post('/table',              mobileAuth(), h(c.table));

/* ── 15. Tashrif (Check-in / Check-out) — yangi maxsus endpoint ─────────── */
router.post('/checkIn',            mobileAuth(), h(c.checkIn));
router.post('/checkOut',           mobileAuth(), h(c.checkOut));
router.get('/bugungiTashriflar',   mobileAuth(), h(c.bugungiTashriflar));
/* Marshrut reja (Plan) — agentga tayinlangan kunlik ro'yxat */
router.get('/marshrutReja',        mobileAuth(), h(c.marshrutReja));

/* ── 16. Trip Sheet (dostavchik marshrut varag'i) ────────────────────────── */
router.get('/getTripSheet',        mobileAuth(), dostavchik, h(c.getTripSheet));
router.post('/startTrip',          mobileAuth(), dostavchik, h(c.startTrip));
router.post('/finishTrip',         mobileAuth(), dostavchik, h(c.finishTrip));

/* ── 17. Avtolavka (ko'chma savdo agenti) ────────────────────────────────── */
router.get('/avtolavkaHolat',      mobileAuth(), h(c.avtolavkaHolat));
router.get('/mijozNarxlari',       mobileAuth(), h(c.mijozNarxlari));
router.get('/avtolavkaSinxron',    mobileAuth(), h(c.avtolavkaSinxron));   // 2026-11-21: agent sinxroni (mijozlar, ombor, brak, savdolar)
router.post('/savdoQaytarish',     mobileAuth(), h(c.savdoQaytarish));     // sotuvga bog'langan qaytarish
router.post('/pulTopshirish',      mobileAuth(), h(c.pulTopshirish));      // 2026-11-22: agent naqdni kassaga topshiradi
router.get('/agentlarim',          mobileAuth(), h(c.agentlarim));         // super agent: biriktirilgan agentlar
router.get('/agentSinxron',        mobileAuth(), h(c.agentSinxron));   // distributsiya agenti (zakaz) oflayn nusxasi
router.get('/mashinaQoldiq',       mobileAuth(), h(c.mashinaQoldiq));
router.get('/yuklashTavsiya',      mobileAuth(), h(c.yuklashTavsiya));
router.get('/yuklashTovarlar',     mobileAuth(), h(c.yuklashTovarlar));
router.post('/yuklashSorov',       mobileAuth(), h(c.yuklashSorov));
router.get('/yuklashlar',          mobileAuth(), h(c.yuklashlar));
router.post('/yuklashQabul',       mobileAuth(), h(c.yuklashQabul));
router.post('/yuklashBekor',       mobileAuth(), h(c.yuklashBekor));
router.get('/kunYakuni',           mobileAuth(), h(c.kunYakuni));
router.post('/kunniYopish',        mobileAuth(), h(c.kunniYopish));

/* ── 18. Dostavchik (pre-sale yetkazish) ─────────────────────────────────── */
router.get('/dostavchikHolat',     mobileAuth(), dostavchik, h(c.dostavchikHolat));
router.get('/dostavchikSinxron',   mobileAuth(), dostavchik, h(c.dostavchikSinxron));
router.get('/marshrut',            mobileAuth(), dostavchik, h(c.marshrut));
router.get('/buyurtma',            mobileAuth(), dostavchik, h(c.buyurtma));
router.post('/reysBoshla',         mobileAuth(), dostavchik, h(c.reysBoshla));
router.post('/yetkazdim',          mobileAuth(), dostavchik, h(c.yetkazdim));
router.post('/yetkazilmadi',       mobileAuth(), dostavchik, h(c.yetkazilmadi));
router.post('/qarzTolov',          mobileAuth(), dostavchik, h(c.qarzTolov));
router.get('/dostavchikKunYakuni', mobileAuth(), dostavchik, h(c.dKunYakuni));
router.post('/reysYakunla',        mobileAuth(), dostavchik, h(c.reysYakunla));

module.exports = router;
