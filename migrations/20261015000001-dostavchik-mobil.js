'use strict';

/**
 * Dostavchik mobil ilovasi — yetkazish jarayoni tafsilotlari.
 *
 *   ariza.yetkazgan_dostavchi_id — haqiqatda kim yetkazgani (tayinlangandan farq qilishi mumkin)
 *   ariza.yetkazish_lat / lng     — yetkazish qayerda tasdiqlangani
 *   ariza.yetkazish_masofa_m      — mijoz nuqtasigacha masofa
 *   ariza.tolangan_summa          — yetkazishda joyida olingan naqd (qisman bo'lishi mumkin)
 *   ariza.yetkazish_urinish       — nechta marta borildi (mijoz yo'q, yopiq, …)
 *   ariza.yetkazish_izoh          — oxirgi urinish sababi
 *   yetkazish_urinish             — har bir muvaffaqiyatsiz urinish (sabab, vaqt, GPS)
 *   trip_sheet.boshlangan_lat/lng, tugagan_lat/lng, yurilgan_km
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const ariza = await queryInterface.describeTable('ariza');
    const ust = {
      yetkazgan_dostavchi_id: { type: Sequelize.INTEGER, allowNull: true },
      yetkazish_lat:          { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      yetkazish_lng:          { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      yetkazish_masofa_m:     { type: Sequelize.INTEGER, allowNull: true },
      tolangan_summa:         { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },
      yetkazish_urinish:      { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
      yetkazish_izoh:         { type: Sequelize.STRING(255), allowNull: true },
    };
    for (const [nom, tur] of Object.entries(ust)) {
      if (!ariza[nom]) await queryInterface.addColumn('ariza', nom, tur);
    }

    const trip = await queryInterface.describeTable('trip_sheet');
    const tust = {
      boshlangan_lat: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      boshlangan_lng: { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      tugagan_lat:    { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      tugagan_lng:    { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      naqd_elon:      { type: Sequelize.DECIMAL(18, 2), allowNull: true },
    };
    for (const [nom, tur] of Object.entries(tust)) {
      if (!trip[nom]) await queryInterface.addColumn('trip_sheet', nom, tur);
    }

    const jadvallar = await queryInterface.showAllTables();
    if (!jadvallar.includes('yetkazish_urinish')) {
      await queryInterface.createTable('yetkazish_urinish', {
        id:           { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        ariza_id:     { type: Sequelize.INTEGER, allowNull: false },
        dostavchi_id: { type: Sequelize.INTEGER, allowNull: true },
        sabab:        { type: Sequelize.STRING(60), allowNull: false },   // yopiq | mijoz_yoq | rad_etdi | pul_yoq | manzil | boshqa
        izoh:         { type: Sequelize.STRING(255), allowNull: true },
        lat:          { type: Sequelize.DECIMAL(10, 7), allowNull: true },
        lng:          { type: Sequelize.DECIMAL(10, 7), allowNull: true },
        masofa_m:     { type: Sequelize.INTEGER, allowNull: true },
        sana:         { type: Sequelize.DATE, allowNull: false },
        createdAt:    { type: Sequelize.DATE, allowNull: false },
        updatedAt:    { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('yetkazish_urinish', ['ariza_id']);
      await queryInterface.addIndex('yetkazish_urinish', ['dostavchi_id', 'sana']);
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('yetkazish_urinish');
    for (const nom of ['naqd_elon', 'tugagan_lng', 'tugagan_lat', 'boshlangan_lng', 'boshlangan_lat']) {
      await queryInterface.removeColumn('trip_sheet', nom);
    }
    for (const nom of ['yetkazish_izoh', 'yetkazish_urinish', 'tolangan_summa', 'yetkazish_masofa_m', 'yetkazish_lng', 'yetkazish_lat', 'yetkazgan_dostavchi_id']) {
      await queryInterface.removeColumn('ariza', nom);
    }
  },
};
