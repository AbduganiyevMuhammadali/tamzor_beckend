'use strict';

/**
 * Mijozning boshlang'ich qoldig'i — tizimga o'tishdan oldingi hisob.
 *
 *   mijoz.boshlangich_balans  — ishora `balans` bilan bir xil: manfiy = mijoz qarzdor, musbat = mijoz haqdor (biz qarzdormiz)
 *   mijoz.boshlangich_sana    — qoldiq qaysi sanaga tegishli (ixtiyoriy)
 *   mijoz.boshlangich_izoh    — manbasi: "eski daftar", "import" …
 *
 * Joriy balans = boshlang'ich qoldiq + to'lovlar − yetkazilgan savdolar. Boshlang'ich qoldiq o'zgartirilsa,
 * balans shu farqga suriladi (mijoz.controller update). Oldi-berdi ko'chirmasida birinchi qator bo'lib ko'rinadi.
 *
 * Ma'lumot: hali birorta savdo/to'lovi bo'lmagan, lekin balansi nol bo'lmagan mijozlar (Excel importidan kelganlar)
 * uchun boshlang'ich qoldiq = joriy balans deb yoziladi.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const t = await queryInterface.describeTable('mijoz');
    if (!t.boshlangich_balans) await queryInterface.addColumn('mijoz', 'boshlangich_balans', { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 });
    if (!t.boshlangich_sana)   await queryInterface.addColumn('mijoz', 'boshlangich_sana',   { type: Sequelize.DATEONLY, allowNull: true });
    if (!t.boshlangich_izoh)   await queryInterface.addColumn('mijoz', 'boshlangich_izoh',   { type: Sequelize.STRING(255), allowNull: true });
    await queryInterface.sequelize.query(`
      UPDATE mijoz m SET
        m.boshlangich_balans = m.balans,
        m.boshlangich_sana   = DATE(m.createdAt),
        m.boshlangich_izoh   = CASE WHEN m.izoh LIKE '%Eski tizimdan%' THEN 'Eski tizimdan import' ELSE 'Tizimga o''tishdagi qoldiq' END
      WHERE m.deletedAt IS NULL AND m.balans <> 0 AND m.boshlangich_balans = 0
        AND NOT EXISTS (SELECT 1 FROM ariza a WHERE a.mijoz_id = m.id AND a.deletedAt IS NULL AND a.turi = 'sotish' AND a.holat = 'yetkazildi')
        AND NOT EXISTS (SELECT 1 FROM kassa k WHERE k.mijoz_id = m.id AND k.tur = 'kirim')`);
  },
  async down(queryInterface) {
    const t = await queryInterface.describeTable('mijoz');
    for (const c of ['boshlangich_izoh', 'boshlangich_sana', 'boshlangich_balans']) if (t[c]) await queryInterface.removeColumn('mijoz', c);
  },
};
