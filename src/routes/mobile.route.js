const express = require('express');
const router = express.Router();
const c = require('../controllers/mobile');
const mobileAuth = require('../middleware/mobileAuth.middleware');
const uploadAudit = require('../middleware/uploadAudit.middleware');
const uploadKassa = require('../middleware/uploadKassa.middleware');
const h = require('../middleware/awaitHandlerFactory.middleware');

/* ── 14. Bootstrap config (token kerak emas) ─────────────────────────────────── */
router.get('/url1c',      h(c.url1c));
router.get('/LoadConfig', h(c.loadConfig));

/* ── 1. Auth (token kerak emas) ────────────────────────────────────────── */
router.post('/Login',    h(c.login));
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
router.get('/getDokDelivery',          mobileAuth(), h(c.getDokDelivery));
router.get('/getDokDeliveryLocation',  mobileAuth(), h(c.getDokDeliveryLocation));
router.post('/orderDelivery',          mobileAuth(), h(c.orderDelivery));
router.post('/returnDeliveryProducts', mobileAuth(), h(c.returnDeliveryProducts));
router.get('/getReturnDocDelivery',    mobileAuth(), h(c.getReturnDocDelivery));

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
router.post('/chekUp',    mobileAuth(), h(c.chekUp));

/* ── 10. Regions & Locations ───────────────────────────────────────────── */
router.get('/region',   mobileAuth(), h(c.region));
router.get('/getXudud', mobileAuth(), h(c.getXudud));
router.get('/city',     mobileAuth(), h(c.city));

/* ── 11. Confirmations & Filters ───────────────────────────────────────── */
router.get('/getConfirms',  mobileAuth(), h(c.getConfirms));
router.post('/postConfirm', mobileAuth(), h(c.postConfirm));
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
router.get('/getTripSheet',        mobileAuth(), h(c.getTripSheet));
router.post('/startTrip',          mobileAuth(), h(c.startTrip));
router.post('/finishTrip',         mobileAuth(), h(c.finishTrip));

/* ── 17. Avtolavka (ko'chma savdo agenti) ────────────────────────────────── */
router.get('/avtolavkaHolat',      mobileAuth(), h(c.avtolavkaHolat));
router.get('/mijozNarxlari',       mobileAuth(), h(c.mijozNarxlari));
router.get('/avtolavkaSinxron',    mobileAuth(), h(c.avtolavkaSinxron));
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
router.get('/dostavchikHolat',     mobileAuth(), h(c.dostavchikHolat));
router.get('/dostavchikSinxron',   mobileAuth(), h(c.dostavchikSinxron));
router.get('/marshrut',            mobileAuth(), h(c.marshrut));
router.get('/buyurtma',            mobileAuth(), h(c.buyurtma));
router.post('/reysBoshla',         mobileAuth(), h(c.reysBoshla));
router.post('/yetkazdim',          mobileAuth(), h(c.yetkazdim));
router.post('/yetkazilmadi',       mobileAuth(), h(c.yetkazilmadi));
router.post('/qarzTolov',          mobileAuth(), h(c.qarzTolov));
router.get('/dostavchikKunYakuni', mobileAuth(), h(c.dKunYakuni));
router.post('/reysYakunla',        mobileAuth(), h(c.reysYakunla));

module.exports = router;
