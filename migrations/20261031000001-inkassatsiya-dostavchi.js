'use strict';

/* Dostavchik inkassatsiyasi — `inkassatsiya` jadvali endi dostavchiklarni ham saqlaydi
   (dostavchi_id to'ldirilgan, agent_id NULL).
   Ilgari dostavchik kassirga pul topshirgani kassa.chiqim ('dostavchik_inkassatsiya') bo'lib
   yozilar edi — Kassa sahifasi, KPI va dashboard uni xarajat deb ayirib, kun qoldig'ini
   kamaytirardi (29.10.2026: 2 554 000 kirim + 2 554 000 "chiqim"). Mavjud chiqim qatorlari
   inkassatsiya yozuviga ko'chiriladi va kassadan o'chiriladi (down — teskarisi). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    await queryInterface.changeColumn('inkassatsiya', 'agent_id', { type: DataTypes.INTEGER, allowNull: true });
    await queryInterface.addColumn('inkassatsiya', 'dostavchi_id', { type: DataTypes.INTEGER, allowNull: true, after: 'agent_id' });
    await queryInterface.addIndex('inkassatsiya', ['dostavchi_id', 'sana'], { name: 'inkassatsiya_dostavchi_sana' });

    const db = queryInterface.sequelize;
    const S = db.QueryTypes.SELECT;
    await db.transaction(async (transaction) => {
      const rows = await db.query(`
        SELECT k.id, COALESCE(k.manba_id, k.user_id) dostavchi_id, DATE(k.sana) sana, k.sana vaqt, k.summa, k.izoh, d.ism
        FROM kassa k LEFT JOIN dostavchi d ON d.id = COALESCE(k.manba_id, k.user_id)
        WHERE k.manba_tur = 'dostavchik_inkassatsiya' ORDER BY k.sana, k.id`, { type: S, transaction });
      for (const r of rows) {
        if (!r.dostavchi_id) continue;
        const sana = typeof r.sana === 'string' ? r.sana.slice(0, 10) : new Date(r.sana).toISOString().slice(0, 10);
        const [yig] = await db.query(`
          SELECT COALESCE(SUM(summa), 0) s FROM kassa
          WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND user_id = :id
            AND manba_tur IN ('dostavchik','mijoz_dostavchik') AND DATE(sana) = :sana`,
          { replacements: { id: r.dostavchi_id, sana }, type: S, transaction });
        const [bor] = await db.query(`SELECT id, topshirilgan_summa FROM inkassatsiya WHERE dostavchi_id = :id AND sana = :sana LIMIT 1`,
          { replacements: { id: r.dostavchi_id, sana }, type: S, transaction });
        const yigildi = Number(yig.s) || 0;
        const topshirildi = (bor ? Number(bor.topshirilgan_summa) || 0 : 0) + (Number(r.summa) || 0);
        const farq = +(yigildi - topshirildi).toFixed(2);
        const holat = farq > 0.5 ? 'kamomad' : 'yopiq';
        if (bor) {
          await db.query(`UPDATE inkassatsiya SET yigilgan_summa = :yig, topshirilgan_summa = :top, farq = :farq, holat = :holat,
              tasdiqlagan_sana = :vaqt, updatedAt = NOW() WHERE id = :id`,
            { replacements: { id: bor.id, yig: yigildi, top: topshirildi, farq, holat, vaqt: r.vaqt }, transaction });
        } else {
          await db.query(`INSERT INTO inkassatsiya
              (agent_id, dostavchi_id, agent_nomi, sana, yigilgan_summa, topshirilgan_summa, farq, holat, izoh, tasdiqlagan_id, tasdiqlagan_sana, createdAt, updatedAt)
              VALUES (NULL, :did, :ism, :sana, :yig, :top, :farq, :holat, :izoh, NULL, :vaqt, NOW(), NOW())`,
            { replacements: { did: r.dostavchi_id, ism: r.ism || null, sana, yig: yigildi, top: topshirildi, farq, holat,
              izoh: r.izoh || null, vaqt: r.vaqt }, transaction });
        }
        await db.query(`DELETE FROM kassa WHERE id = :id`, { replacements: { id: r.id }, transaction });
      }
    });
  },

  /* down — XAVFSIZ: up()'dan keyin dastur dostavchik inkassatsiyasini faqat shu jadvalga
     yozadi va up() ko'chirgan qatorlarni keyingilaridan ajratib bo'lmaydi. Ilgari down()
     BARCHA dostavchik qatorlarini o'chirib, faqat topshirilgan > 0 bo'lganlarini kassa
     chiqimiga aylantirardi — kamomad/yig'ilgan ma'lumoti va keyingi kunlar yo'qolardi.
     Endi dostavchik qatorlari bo'lsa down() hech narsani o'zgartirmay to'xtaydi.
     Eski (kassa chiqimi) ko'rinishiga majburan qaytarish kerak bo'lsa:
       INKASSATSIYA_DOWN_MAJBURIY=1 npx sequelize-cli db:migrate:undo
     — shunda konvertatsiya bitta tranzaksiyada bajariladi. */
  async down(queryInterface) {
    const db = queryInterface.sequelize;
    const S = db.QueryTypes.SELECT;
    const [{ c }] = await db.query(`SELECT COUNT(*) c FROM inkassatsiya WHERE dostavchi_id IS NOT NULL`, { type: S });
    if (Number(c) > 0 && process.env.INKASSATSIYA_DOWN_MAJBURIY !== '1') {
      throw new Error(`[20261031000001 down] inkassatsiya'da ${c} ta dostavchik yozuvi bor — `
        + "ularni o'chirmaslik uchun down to'xtatildi. Majburan: INKASSATSIYA_DOWN_MAJBURIY=1");
    }
    await db.transaction(async (transaction) => {
      const rows = await db.query(`SELECT * FROM inkassatsiya WHERE dostavchi_id IS NOT NULL`, { type: S, transaction });
      for (const r of rows) {
        if (Number(r.topshirilgan_summa) > 0) {
          await db.query(`INSERT INTO kassa (tur, kategoriya, summa, tolov_usul, manba_tur, manba_id, mijoz_id, mijoz_nomi, izoh, sana, user_id, createdAt, updatedAt)
              VALUES ('chiqim', 'dostavchik_inkassatsiya', :summa, 'naqt', 'dostavchik_inkassatsiya', :did, NULL, NULL, :izoh, :sana, :did, NOW(), NOW())`,
            { replacements: { summa: r.topshirilgan_summa, did: r.dostavchi_id, izoh: r.izoh || `${r.agent_nomi || ''} — ${r.sana} naqd topshirdi`,
              sana: r.tasdiqlagan_sana || r.updatedAt }, transaction });
        }
        await db.query(`DELETE FROM inkassatsiya WHERE id = :id`, { replacements: { id: r.id }, transaction });
      }
    });
    await queryInterface.removeIndex('inkassatsiya', 'inkassatsiya_dostavchi_sana');
    await queryInterface.removeColumn('inkassatsiya', 'dostavchi_id');
    await queryInterface.changeColumn('inkassatsiya', 'agent_id', { type: queryInterface.sequelize.Sequelize.INTEGER, allowNull: false });
  },
};
