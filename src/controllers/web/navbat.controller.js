/**
 * ISH NAVBATI — asosiy menyu uchun jonli sonlar.
 *
 * Menyudagi har badge "shu yerda sizni kutayotgan ish" ni bildiradi:
 * tasdiqlanmagan buyurtma, yig'ish navbati, qabul kutayotgan qaytarish,
 * yuklanmagan mashina, kassaga topshirilmagan naqd va h.k. Har 60 soniyada
 * so'raladi, shuning uchun faqat arzon COUNT so'rovlari.
 */
const sequelize = require('../../db/db-sequelize');

const bir = async (sql, replacements = {}) =>
  (await sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT }))[0] || {};
const n = (v) => Number(v) || 0;

class NavbatController {
  // GET /navbat
  ishNavbati = async (req, res) => {
    const [ariza, prixod, ishlab, qoldiq, qarz, avto, naqd, dnaqd, gps] = await Promise.all([
      bir(`SELECT
             SUM(turi = 'sotish' AND holat = 'yangi') yangi,
             SUM(turi = 'sotish' AND holat IN ('tasdiqlangan','yigilmoqda')) yigish,
             SUM(turi = 'sotish' AND holat = 'yolda') yolda,
             SUM(turi = 'qaytarish' AND holat = 'qabul_kutilmoqda') qaytarish
           FROM ariza WHERE deletedAt IS NULL`),
      bir(`SELECT COUNT(*) qoralama FROM prixod WHERE deletedAt IS NULL AND holat = 'qoralama'`),
      bir(`SELECT SUM(holat = 'jarayonda') jarayonda, SUM(holat = 'qoralama') qoralama FROM ishlab_chiqarish`),
      bir(`SELECT COUNT(*) kam FROM (
             SELECT t.id, COALESCE(SUM(r.donada), 0) q FROM tovar t
             LEFT JOIN tovar_register r ON r.tovar_id = t.id AND r.ombor = 'Основной склад'
             WHERE t.faol = 1 AND t.deletedAt IS NULL GROUP BY t.id HAVING q < 20) x`),
      bir(`SELECT COUNT(*) qarzdor, COALESCE(-SUM(balans), 0) summa FROM mijoz
           WHERE deletedAt IS NULL AND balans < 0`),
      bir(`SELECT
             (SELECT COUNT(*) FROM agent WHERE faol = 1 AND deletedAt IS NULL AND avtolavka = 1 AND diller = 0) jami,
             (SELECT COUNT(DISTINCT agent_id) FROM avtolavka_hujjat
                WHERE tur = 'yuklash' AND holat = 'tasdiqlangan' AND sana = CURDATE()) yuklangan,
             (SELECT COUNT(DISTINCT agent_id) FROM avtolavka_hujjat
                WHERE tur = 'qabul' AND holat = 'tasdiqlangan' AND sana = CURDATE()) qaytgan,
             (SELECT COUNT(*) FROM avtolavka_hujjat
                WHERE tur = 'yuklash' AND manba = 'mobil' AND holat = 'qoralama' AND sana = CURDATE()) sorov,
             (SELECT COUNT(*) FROM avtolavka_kun k WHERE k.sana = CURDATE() AND k.yopish_vaqt IS NOT NULL
                AND (k.ochish_vaqt IS NULL OR k.yopish_vaqt >= k.ochish_vaqt)
                AND NOT EXISTS (SELECT 1 FROM avtolavka_hujjat h WHERE h.agent_id = k.agent_id AND h.sana = k.sana
                                  AND h.tur = 'qabul' AND h.holat = 'tasdiqlangan'
                                  AND (k.ochish_vaqt IS NULL OR h.tasdiqlagan_sana >= k.ochish_vaqt))) topshirish`),
      // Agent bugun yig'gan naqd, kassaga hali topshirilmagan
      // Topshirilgandan keyin yana naqd yig'ilsa (Won Sell: kun qayta ochilgan, yangi reys) — qolgani yana kutiladi
      bir(`SELECT COUNT(*) agent, COALESCE(SUM(k.s - COALESCE(i.topshirilgan_summa, 0)), 0) summa FROM (
             SELECT user_id, SUM(summa) s, MAX(sana) oxirgi FROM kassa
             WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND manba_tur IN ('mijoz','avtolavka')
               AND user_id IS NOT NULL AND DATE(sana) = CURDATE() GROUP BY user_id) k
           LEFT JOIN inkassatsiya i ON i.agent_id = k.user_id AND i.sana = CURDATE()
           WHERE i.id IS NULL OR COALESCE(i.tasdiqlagan_sana, i.updatedAt) < k.oxirgi`),
      // Dostavchik bugun yetkazishda/qarz undirishda olgan naqd, kassirga hali topshirilmagan
      // (topshirgani — inkassatsiya.dostavchi_id yozuvi, kassa chiqimi emas)
      bir(`SELECT COUNT(*) dostavchi, COALESCE(SUM(k.s - COALESCE(i.topshirilgan_summa, 0)), 0) summa FROM (
             SELECT user_id, SUM(summa) s FROM kassa
             WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND manba_tur IN ('dostavchik','mijoz_dostavchik')
               AND user_id IS NOT NULL AND DATE(sana) = CURDATE() GROUP BY user_id) k
           LEFT JOIN inkassatsiya i ON i.dostavchi_id = k.user_id AND i.sana = CURDATE()
           WHERE k.s - COALESCE(i.topshirilgan_summa, 0) > 0.5`),
      bir(`SELECT
             (SELECT COUNT(*) FROM agent WHERE faol = 1 AND deletedAt IS NULL AND diller = 0) jami,
             (SELECT COUNT(DISTINCT agent_id) FROM agent_location
                WHERE rol = 'agent' AND sana >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)) online`),
    ]);

    const avtoYuklanmagan = Math.max(0, n(avto.jami) - n(avto.yuklangan));
    const avtoYolda = Math.max(0, n(avto.yuklangan) - n(avto.qaytgan));

    res.send({
      vaqt: new Date().toISOString(),
      sotuvlar:  { yangi: n(ariza.yangi), yolda: n(ariza.yolda) },
      ombor:     { yigish: n(ariza.yigish), qaytarish: n(ariza.qaytarish), prixod: n(prixod.qoralama), kam: n(qoldiq.kam) },
      ishlab:    { jarayonda: n(ishlab.jarayonda), qoralama: n(ishlab.qoralama) },
      avtolavka: { jami: n(avto.jami), yuklanmagan: avtoYuklanmagan, yolda: avtoYolda,
                   sorov: n(avto.sorov), topshirish: n(avto.topshirish) },
      moliya:    { inkassatsiya: n(naqd.agent), inkassatsiya_summa: n(naqd.summa),
                   dostavchik_naqd: n(dnaqd.dostavchi), dostavchik_naqd_summa: n(dnaqd.summa) },
      mijozlar:  { qarzdor: n(qarz.qarzdor), qarz_summa: n(qarz.summa) },
      agentlar:  { jami: n(gps.jami), online: n(gps.online) },
    });
  };
}

module.exports = new NavbatController();
