const express = require("express");
const cors = require("cors");
const path = require("path");
const cookieParser = require('cookie-parser')
const i18n = require('./i18n.config')
const errorMiddleware = require('../middleware/error.middleware');
const userRouter        = require('../routes/user.route');
const tovarRouter       = require('../routes/tovar.route');
const turkumRouter      = require('../routes/turkum.route');
const prixodRouter      = require('../routes/prixod.route');
const hisobotRouter     = require('../routes/hisobot.route');
const yetkazuvchiRouter = require('../routes/yetkazuvchi.route');
const uchinchiShaxsRouter = require('../routes/uchinchiShaxs.route');
const xarajatRouter = require('../routes/xarajat.route');
const mijozRouter       = require('../routes/mijoz.route');
const agentRouter       = require('../routes/agent.route');
const dashboardRouter   = require('../routes/dashboard.route');
const arizaRouter       = require('../routes/ariza.route');
const ishlabRouter      = require('../routes/ishlab.route');
const dostavchiRouter   = require('../routes/dostavchi.route');
const narxRuyxatRouter  = require('../routes/narxRuyxat.route');
const bildirishnomaRouter = require('../routes/bildirishnoma.route');
const kassaRouter       = require('../routes/kassa.route');
const tripSheetRouter   = require('../routes/tripSheet.route');
const sozlamaRouter     = require('../routes/sozlama.route');
const avtolavkaRouter   = require('../routes/avtolavka.route');
const navbatRouter      = require('../routes/navbat.route');
const tahlilRouter      = require('../routes/tahlil.route');
const mobileRouter      = require('../routes/mobile.route');
const HttpException = require('../utils/HttpException.utils');
const { biznesRejim } = require('../utils/rejim.utils');

const MAXFIY_KALITLAR = /^(password|parol|token|userToken|confirmPassword|secret)$/i;
const maxfiyniYashir = (k, v) => (MAXFIY_KALITLAR.test(k) ? '***' : v);

module.exports = async function(app){
     // parse requests of content-type: application/json
        // parses incoming requests with JSON payloads
        app.use(express.json({ limit: "10mb" }));   // Excel import: bir necha ming qatorli JSON
        // enabling cors for all requests by using cors middleware
        app.use(cors());
        // Enable pre-flight
        app.options("*", cors());
        app.use(express.static(path.join(__dirname, '../../dist')));
        // Yuklangan fayllar (audit rasmlari va h.k.)
        // nosniff + CSP: yuklangan fayl (masalan .html/.svg) brauzerda skript sifatida ishlamasin
        app.use('/uploads', (req, res, next) => {
          res.setHeader('X-Content-Type-Options', 'nosniff');
          res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
          next();
        }, express.static(path.join(__dirname, '../../uploads')));
        // Maxfiylik siyosati (Play Market / App Store talab qiladi)
        app.get(['/privacy', '/maxfiylik'], (req, res) => res.sendFile(path.join(__dirname, '../../static/privacy.html')));
        // i18n.setLocale('uz');
        app.use(cookieParser());
        app.use(i18n.init)

        // Mobil API prefikslari: asl server kabi (RashMilkNew/hs/AgentDostavshik)
        // + eski /api/mobile (moslik uchun)
        const MOBILE_PREFIXES = ['/RashMilkNew/hs/AgentDostavshik', '/api/mobile'];

        // DIAGNOSTIKA: barcha mobil so'rovlarni to'liq logga yozamiz (APK debug)
        app.use(MOBILE_PREFIXES, (req, res, next) => {
          const start = Date.now();
          // Parol va tokenlar logga yozilmaydi
          const bodyStr = req.body && Object.keys(req.body).length ? JSON.stringify(req.body, maxfiyniYashir) : '';
          const url = req.originalUrl.replace(/([?&](?:token|userToken|password|parol)=)[^&]*/gi, '$1***');
          res.on('finish', () => {
            console.log(`[MOBILE] ${req.method} ${url} → ${res.statusCode} (${Date.now() - start}ms) ${bodyStr ? 'body=' + bodyStr.slice(0, 200) : ''}`);
          });
          next();
        });

        // Biznes rejimi (distributsiya | optom) — menyu va sahifalar shunga qarab quriladi.
        // Ochiq: login sahifasidan oldin ham kerak, maxfiy ma'lumot emas.
        app.get('/api/v1/rejim', (req, res) => res.send({ rejim: biznesRejim() }));

        app.use(`/api/v1/users`,          userRouter);
        app.use(`/api/v1/tovar`,          tovarRouter);
        app.use(`/api/v1/turkumlar`,      turkumRouter);           // Sozlamalar → Turkumlar
        app.use(`/api/v1/prixod`,         prixodRouter);
        app.use(`/api/v1/hisobot`,        hisobotRouter);
        app.use(`/api/v1/yetkazuvchilar`, yetkazuvchiRouter);
        app.use(`/api/v1/uchinchi-shaxslar`, uchinchiShaxsRouter);   // Moliya → Qarz oldi-berdi
        app.use(`/api/v1/xarajatlar`, xarajatRouter);                 // Moliya → Kunlik xarajatlar
        app.use(`/api/v1/mijozlar`,       mijozRouter);
        app.use(`/api/v1/narx-ruyxatlar`, narxRuyxatRouter);
        app.use(`/api/v1/bildirishnoma`,  bildirishnomaRouter);
        app.use(`/api/v1/agents`,         agentRouter);
        app.use(`/api/v1/dashboard`,      dashboardRouter);
        app.use(`/api/v1/arizalar`,       arizaRouter);
        app.use(`/api/v1/ishlab`,         ishlabRouter);
        app.use(`/api/v1/dostavchilar`,   dostavchiRouter);
        app.use(`/api/v1/kassa`,          kassaRouter);
        app.use(`/api/v1/trip-sheet`,     tripSheetRouter);
        app.use(`/api/v1/sozlama`,        sozlamaRouter);
        app.use(`/api/v1/avtolavka`,      avtolavkaRouter);
        app.use(`/api/v1/navbat`,         navbatRouter);
        app.use(`/api/v1/tahlil`,         tahlilRouter);
        app.use(MOBILE_PREFIXES,          mobileRouter);

        // 404 error
        app.all('*', (req, res, next) => {
            // DIAGNOSTIKA: topilmagan yo'lni aniq logga yozamiz (mobil debug uchun)
            console.log(`[404] ${req.method} ${req.originalUrl}`);
            const err = new HttpException(404, req.mf('Endpoint not found'));
            next(err);
        });

        app.use(errorMiddleware);
}