'use strict';

/* AGENT TOPSHIRUVI — KARTA ORQALI (2026-11-23)
   pul_topshiruv.usul      — 'naqd' (kassirga naqd, web tasdiqda naqd kassa tanlanadi) |
                             'karta' (agent pulni kartadan kompaniya plastik kassasiga o'tkazadi; kassa_id
                             yaratilishda agent tanlagan plastik kassa, tasdiqda o'zgarmaydi).
   pul_topshiruv.chek_rasm — o'tkazma cheki rasmi (/uploads/kassa/...), karta uchun majburiy. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const ustunlar = await queryInterface.describeTable('pul_topshiruv');
    if (!ustunlar.usul) {
      await queryInterface.addColumn('pul_topshiruv', 'usul', {
        type: DataTypes.ENUM('naqd', 'karta'), allowNull: false, defaultValue: 'naqd',
      });
    }
    if (!ustunlar.chek_rasm) {
      await queryInterface.addColumn('pul_topshiruv', 'chek_rasm', { type: DataTypes.STRING(255), allowNull: true });
    }
  },
  async down(queryInterface) {
    const ustunlar = await queryInterface.describeTable('pul_topshiruv');
    if (ustunlar.chek_rasm) await queryInterface.removeColumn('pul_topshiruv', 'chek_rasm');
    if (ustunlar.usul) await queryInterface.removeColumn('pul_topshiruv', 'usul');
  },
};
