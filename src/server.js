// Biznes kuni (bugun, kun yopish, hisobot kunlari) jarayon vaqt mintaqasidan olinadi —
// server UTC'da bo'lsa kun Toshkentda 05:00 da almashardi. Boshqa mintaqa: .env TZ=...
// (dotenv'dan oldin, birinchi Date'dan oldin o'rnatiladi)
try { require('dotenv').config(); } catch (_) {}
process.env.TZ = process.env.TZ || 'Asia/Tashkent';

const express = require("express");
const app = express();
require('./startup/logging')();
require('./startup/db')();
// Barcha modellar va ular orasidagi associations ni ro'yxatdan o'tkazish
require('./models/index');
const {port, secret_jwt} = require('./startup/config');
require('./startup/routes')(app);
const migrate = require('./startup/migration');

// JWT siri bo'lmasa server ishga tushmaydi (aks holda token tekshiruvi ishlamaydi)
if (!secret_jwt || String(secret_jwt).length < 16) {
    console.error('SECRET_JWT .env da o\'rnatilmagan yoki juda qisqa (kamida 16 belgi). Server to\'xtatildi.');
    process.exit(1);
}

// Avval migratsiyalar, keyin so'rov qabul qilish — yarim yangilangan sxema bilan ishlamaslik uchun
(async () => {
    const ok = await migrate();
    if (!ok) {
        console.error('Migratsiya muvaffaqiyatsiz — server ishga tushmadi. Xatoni tuzatib qayta ishga tushiring.');
        process.exit(1);
    }
    // 0.0.0.0 — barcha tarmoq interfeyslarini tinglaydi, shunda telefon LAN IP orqali ulana oladi
    app.listen(port, '0.0.0.0', () => console.log(`🚀 Server running on port ${port}!`))
        .on('error', (e) => {
            console.log('Error happened: ', e.message)
         });
})();

module.exports = app;