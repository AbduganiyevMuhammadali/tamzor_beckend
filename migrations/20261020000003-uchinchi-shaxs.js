'use strict';

/**
 * Uchinchi shaxslar bilan qarz oldi-berdi (Moliya → Qarz oldi-berdi).
 * Mijoz ham, yetkazuvchi ham bo'lmagan odam/tashkilot: unga qarz beramiz yoki undan qarz olamiz.
 *
 *   uchinchi_shaxs          — kim (ism, telefon, izoh)
 *   uchinchi_shaxs_harakat  — har bir oldi-berdi; pulli harakat kassaga ham yoziladi (kassa_id):
 *       qarz_berdik  → kassa chiqim 'qarz_berildi'      (u bizga qarzdor bo'ladi)
 *       qaytardi     → kassa kirim  'qarz_qaytdi'       (uning qarzi kamayadi)
 *       qarz_oldik   → kassa kirim  'qarz_olindi'       (biz qarzdor bo'lamiz)
 *       qaytardik    → kassa chiqim 'qarz_qaytarildi'   (bizning qarzimiz kamayadi)
 *       bosh_qarzdor / bosh_haqdor — tizimga o'tishdagi qoldiq, kassaga yozilmaydi
 *   Qoldiq = Σ(qarz_berdik, qaytardik, bosh_qarzdor) − Σ(qaytardi, qarz_oldik, bosh_haqdor):
 *   musbat — shaxs bizga qarzdor, manfiy — biz shaxsga qarzdormiz.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const jadvallar = await queryInterface.showAllTables();
    if (!jadvallar.includes('uchinchi_shaxs')) {
      await queryInterface.createTable('uchinchi_shaxs', {
        id:        { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        ism:       { type: Sequelize.STRING(150), allowNull: false },
        telefon:   { type: Sequelize.STRING(30), allowNull: true },
        izoh:      { type: Sequelize.TEXT, allowNull: true },
        faol:      { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
        deletedAt: { type: Sequelize.DATE, allowNull: true },
      });
    }
    if (!jadvallar.includes('uchinchi_shaxs_harakat')) {
      await queryInterface.createTable('uchinchi_shaxs_harakat', {
        id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        shaxs_id:   { type: Sequelize.INTEGER, allowNull: false },
        tur:        { type: Sequelize.ENUM('qarz_berdik', 'qaytardi', 'qarz_oldik', 'qaytardik', 'bosh_qarzdor', 'bosh_haqdor'), allowNull: false },
        summa:      { type: Sequelize.DECIMAL(18, 2), allowNull: false },
        tolov_usul: { type: Sequelize.ENUM('naqt', 'karta', 'bank'), allowNull: true },
        sana:       { type: Sequelize.DATE, allowNull: false },
        muddat:     { type: Sequelize.DATEONLY, allowNull: true },   // qaytarish muddati (qarz berish/olishda)
        izoh:       { type: Sequelize.STRING(255), allowNull: true },
        kassa_id:   { type: Sequelize.INTEGER, allowNull: true },
        user_id:    { type: Sequelize.INTEGER, allowNull: true },
        createdAt:  { type: Sequelize.DATE, allowNull: false },
        updatedAt:  { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('uchinchi_shaxs_harakat', ['shaxs_id', 'sana'], { name: 'ix_ush_harakat_shaxs_sana' });
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('uchinchi_shaxs_harakat');
    await queryInterface.dropTable('uchinchi_shaxs');
  },
};
