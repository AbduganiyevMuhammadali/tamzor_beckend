const db = require('../db/db-sequelize');
// let migration = require('./migration');

module.exports = async function(){
    //await db.sync();
    return db.authenticate()
    .then(() => {
        console.log('Baza bilan aloqa ulandi');
        // migration();
    })
    .catch(err => {
        console.error('Baza bilan aloqa o\'rnatilmadi:', err.message);
    })
    // .catch(err => { Global exception hadler borligi uchun
    //     console.error('Baza bilan aloqa uzildi xatolik ->:', err);
    // });
}