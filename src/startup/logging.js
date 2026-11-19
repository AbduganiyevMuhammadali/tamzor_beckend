require('express-async-errors');
const winston = require('winston');

module.exports = async function(){
    // winston.add(new winston.transports.Console());
    // winston.add(new winston.transports.File({filename: 'sellz-backend.log', level: 'error'}));

    // process.on('uncaughtException', exception => {
    //   winston.error(exception.message, exception);
    // })

    winston.exceptions.handle(new winston.transports.Console(),  new winston.transports.File({filename: 'sellz-backend.log', level: 'error'}));
    //const myPromise = Promise.reject('yana boshqa kutilmagan xatolik').then('tugadi');
    // Ushlanmagan promise xatosi butun serverni (va Electron ilovani) to'xtatmasin —
    // logga yoziladi. Avval qayta throw qilinardi va jarayon yopilardi.
    process.on('unhandledRejection', exception => {
        winston.error('unhandledRejection: ' + (exception && exception.message), exception);
        console.error('[unhandledRejection]', exception);
    })

    //throw new Error('Kutilmagan xato');
}