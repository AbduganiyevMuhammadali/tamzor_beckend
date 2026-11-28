'use strict';

/* AGENT BRAKINI KOMPANIYAGA QAYTARISH (2026-11-28)
   avtolavka_hujjat.tur + 'brak_qabul': agentning brak omboridagi ("Agent: <ism> (brak)") yaroqsiz tovar
   kompaniyaning "Brak ombori"ga qabul qilinadi. Oddiy 'qabul' emas — agent kunini yopmaydi. */
module.exports = {
  async up(queryInterface) {
    await queryInterface.sequelize.query("ALTER TABLE avtolavka_hujjat MODIFY tur ENUM('yuklash','qabul','brak_qabul') NOT NULL");
  },
  async down(queryInterface) {
    await queryInterface.sequelize.query("DELETE FROM avtolavka_hujjat WHERE tur = 'brak_qabul'");
    await queryInterface.sequelize.query("ALTER TABLE avtolavka_hujjat MODIFY tur ENUM('yuklash','qabul') NOT NULL");
  },
};
