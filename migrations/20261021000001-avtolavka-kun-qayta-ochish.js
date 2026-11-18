'use strict';

/**
 * Won Sell: to'liq yopilgan kunni qayta ochish (bir kunda ikkinchi reys).
 * Kun bitta birlik bo'lib qoladi (tovar va pul solishtirmasi butun kun bo'yicha jami),
 * lekin "topshirildi" belgisi faqat oxirgi qayta ochilishdan KEYINGI qabul va
 * inkassatsiyadan olinadi — aks holda ertalabki topshirish yangi reysni ham "yopiq" ko'rsatardi.
 *   ochish_vaqt — oxirgi qayta ochilgan vaqt, ochish_soni — necha marta qayta ochilgan.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ustunlar = await queryInterface.describeTable('avtolavka_kun');
    if (!ustunlar.ochish_vaqt) {
      await queryInterface.addColumn('avtolavka_kun', 'ochish_vaqt', { type: Sequelize.DATE, allowNull: true });
    }
    if (!ustunlar.ochish_soni) {
      await queryInterface.addColumn('avtolavka_kun', 'ochish_soni', { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 });
    }
  },
  async down(queryInterface) {
    await queryInterface.removeColumn('avtolavka_kun', 'ochish_soni');
    await queryInterface.removeColumn('avtolavka_kun', 'ochish_vaqt');
  },
};
