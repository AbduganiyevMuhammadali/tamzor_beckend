'use strict';

/* Hujjat qatorlaridagi bo'sh turkumni tovarning joriy turkumi bilan to'ldirish.
   Mobil sotuv (createAriza) va web buyurtma formasi qatorga turkum yozmas edi, shuning uchun
   chek (turkum bo'yicha guruhlash), Buyurtmalar yig'ma ro'yxati va hisobotlar ko'p qatorni
   "Turkumsiz" ko'rsatardi. Bundan keyin yozish paytida utils/turkum.utils.js turkumToldir
   to'ldiradi; bu migratsiya eski qatorlarni bir marta tuzatadi (idempotent, down — hech narsa). */
const JADVALLAR = ['ariza_qator', 'prixod_qator', 'tovar_register', 'avtolavka_qator', 'ishlab_chiqarish_qator'];

module.exports = {
  async up(queryInterface) {
    const db = queryInterface.sequelize;
    for (const j of JADVALLAR) {
      const [bor] = await db.query(`SHOW TABLES LIKE '${j}'`, { type: db.QueryTypes.SELECT });
      if (!bor) continue;
      await db.query(`UPDATE \`${j}\` q JOIN tovar t ON t.id = q.tovar_id
        SET q.turkum = t.turkum
        WHERE (q.turkum IS NULL OR q.turkum = '') AND t.turkum IS NOT NULL AND t.turkum <> ''`);
    }
  },
  async down() {},
};
