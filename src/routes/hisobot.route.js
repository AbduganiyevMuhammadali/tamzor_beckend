const express = require('express');
const router  = express.Router();
const hisobotController = require('../controllers/web/hisobot.controller');
const auth = require('../middleware/auth.middleware');
const awaitHandlerFactory = require('../middleware/awaitHandlerFactory.middleware');

router.get('/umumiy',         auth(), awaitHandlerFactory(hisobotController.umumiy));
router.get('/oylik-trend',    auth(), awaitHandlerFactory(hisobotController.oylikTrend));
router.get('/turkum',         auth(), awaitHandlerFactory(hisobotController.turkumHisobot));
router.get('/top-tovarlar',   auth(), awaitHandlerFactory(hisobotController.topTovarlar));
router.get('/sotuv-hisobot',  auth(), awaitHandlerFactory(hisobotController.sotuvHisobot));
router.get('/tovar-hisobot',            auth(), awaitHandlerFactory(hisobotController.tovarHisobot));
router.get('/tovar-hisobot/:tovar_id',  auth(), awaitHandlerFactory(hisobotController.tovarHisobotDetail));
router.get('/ombor',          auth(), awaitHandlerFactory(hisobotController.omborHisobot));
router.get('/ombor-kpi',      auth(), awaitHandlerFactory(hisobotController.omborKpi));
router.get('/ombor-trend',    auth(), awaitHandlerFactory(hisobotController.omborTrend));
router.get('/ombor-aylanish', auth(), awaitHandlerFactory(hisobotController.omborAylanish));
router.get('/ombor-jurnal',   auth(), awaitHandlerFactory(hisobotController.omborJurnal));
router.get('/register',         auth(), awaitHandlerFactory(hisobotController.registerRuyxat));
router.get('/register-kpi',     auth(), awaitHandlerFactory(hisobotController.registerKpi));
router.get('/qoldiqlar',        auth(), awaitHandlerFactory(hisobotController.qoldiqlar));
router.get('/qoldiqlar/:tovar_id/detail', auth(), awaitHandlerFactory(hisobotController.qoldiqDetail));
router.get('/partiya-qoldiqlar',auth(), awaitHandlerFactory(hisobotController.partiyaQoldiqlar));
router.get('/yetkazuvchilar',   auth(), awaitHandlerFactory(hisobotController.yetkazuvchilarHisobot));

/* ── Mobil hisobotlar (web'da ko'rsatish) ── */
router.get('/agentlar',    auth(), awaitHandlerFactory(hisobotController.agentlarRuyxat));
router.get('/audit',       auth(), awaitHandlerFactory(hisobotController.auditRuyxat));
router.get('/sotmaslik',   auth(), awaitHandlerFactory(hisobotController.sotmaslikRuyxat));
router.get('/agent-savdo', auth(), awaitHandlerFactory(hisobotController.agentSavdo));
router.get('/marshrut',    auth(), awaitHandlerFactory(hisobotController.agentMarshrut));

/* ── Inkassatsiya ── */
router.get('/inkassatsiya',  auth(), awaitHandlerFactory(hisobotController.inkassatsiyaRuyxat));
router.post('/inkassatsiya', auth(), awaitHandlerFactory(hisobotController.inkassatsiyaTopshir));
router.post('/inkassatsiya/kamomad', auth(), awaitHandlerFactory(hisobotController.inkassatsiyaKamomad)); // kamomadni keyin qabul qilish (qo'shiladi)
router.get('/inkassatsiya-hisobot', auth(), awaitHandlerFactory(hisobotController.inkassatsiyaHisobot));

/* ── Marshrut reja (Plan) + Plan-Fact ── */
router.get('/marshrut-reja',          auth(), awaitHandlerFactory(hisobotController.marshrutRejaRuyxat));
router.post('/marshrut-reja',         auth(), awaitHandlerFactory(hisobotController.marshrutRejaBelgila));
router.delete('/marshrut-reja/:id',   auth(), awaitHandlerFactory(hisobotController.marshrutRejaOchir));
router.post('/marshrut-reja/generate',auth(), awaitHandlerFactory(hisobotController.marshrutRejaGenerate));
router.get('/plan-fact',              auth(), awaitHandlerFactory(hisobotController.planFactHisobot));

/* ── Agent nazorati: tashrif jurnali + reja-fakt + KPI + anomaliya ── */
router.get('/agent-monitoring',       auth(), awaitHandlerFactory(hisobotController.agentMonitoring));
/* Kunlik marshrut — agent bugun qayerga borgani (xarita uchun).
   Diqqat: yuqoridagi '/marshrut' (agentMarshrut) boshqa metod — o'chirmang. */
router.get('/agent-marshrut',         auth(), awaitHandlerFactory(hisobotController.agentKunlikMarshrut));

/* Agentlar hozir qayerda — real vaqt xaritasi */
router.get('/agent-online',           auth(), awaitHandlerFactory(hisobotController.agentOnline));

module.exports = router;
