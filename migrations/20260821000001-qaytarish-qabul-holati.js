'use strict';

/**
 * Qaytarish jarayonini ikki bosqichli qilish.
 *
 * Ilgari agent qaytargan tovar hech qayerga tushmasdi — faqat ariza
 * yozuvi qolardi. Endi:
 *   1) agent qaytaradi  → "Agent: <ism>" omboriga kiradi (qabul kutilmoqda)
 *   2) skladchi qabul qiladi → asosiy omborga o'tadi
 *
 * Buning uchun ariza holatiga ikkita qiymat qo'shiladi:
 *   qabul_kutilmoqda — agent omborida, skladchi tekshirishi kerak
 *   qabul_qilindi    — asosiy omborga o'tkazildi
 *
 * Mavjud holatlarga tegilmaydi, shuning uchun sotuv oqimi buzilmaydi.
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE ariza MODIFY COLUMN holat
      ENUM('yangi','tasdiqlangan','yigilmoqda','yolda','yetkazildi','bekor',
           'qabul_kutilmoqda','qabul_qilindi')
      NOT NULL DEFAULT 'yangi'
    `);

    // Qabulni kim va qachon tasdiqlagani
    const ustunlar = await queryInterface.describeTable('ariza');
    if (!ustunlar.qabul_qilgan_id) {
      await queryInterface.addColumn('ariza', 'qabul_qilgan_id', {
        type: Sequelize.INTEGER, allowNull: true,
      });
    }
    if (!ustunlar.qabul_sana) {
      await queryInterface.addColumn('ariza', 'qabul_sana', {
        type: Sequelize.DATE, allowNull: true,
      });
    }

    // Agent aytgan va haqiqatda qabul qilingan miqdor farqi qatorda saqlanadi
    const qatorlar = await queryInterface.describeTable('ariza_qator');
    if (!qatorlar.qabul_dona) {
      await queryInterface.addColumn('ariza_qator', 'qabul_dona', {
        type: Sequelize.DECIMAL(10, 3), allowNull: true,
      });
    }
  },

  async down(queryInterface) {
    const qatorlar = await queryInterface.describeTable('ariza_qator');
    if (qatorlar.qabul_dona) await queryInterface.removeColumn('ariza_qator', 'qabul_dona');

    const ustunlar = await queryInterface.describeTable('ariza');
    if (ustunlar.qabul_sana)      await queryInterface.removeColumn('ariza', 'qabul_sana');
    if (ustunlar.qabul_qilgan_id) await queryInterface.removeColumn('ariza', 'qabul_qilgan_id');

    // Yangi holatdagi arizalarni xavfsiz qiymatga o'tkazamiz
    await queryInterface.sequelize.query(
      `UPDATE ariza SET holat = 'yetkazildi' WHERE holat IN ('qabul_kutilmoqda','qabul_qilindi')`);
    await queryInterface.sequelize.query(`
      ALTER TABLE ariza MODIFY COLUMN holat
      ENUM('yangi','tasdiqlangan','yigilmoqda','yolda','yetkazildi','bekor')
      NOT NULL DEFAULT 'yangi'
    `);
  },
};
