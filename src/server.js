const express = require("express");
const app = express();
require('./startup/logging')();
require('./startup/db')();
// Barcha modellar va ular orasidagi associations ni ro'yxatdan o'tkazish
require('./models/index');
const {port} = require('./startup/config');
require('./startup/routes')(app);
require('./startup/migration')();

// 0.0.0.0 — barcha tarmoq interfeyslarini tinglaydi, shunda telefon LAN IP orqali ulana oladi
app.listen(port, '0.0.0.0', () => console.log(`🚀 Server running on port ${port}!`))
    .on('error', (e) => {
        console.log('Error happened: ', e.message)
     });

module.exports = app;