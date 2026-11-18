'use strict';

/**
 * XOM ASHYO OMBORI — xom ashyo savdo tovarlaridan alohida saqlanadi.
 *
 *   tovar.turi                    — 'tovar' (savdo tovari) | 'xom_ashyo' (sotilmaydi, ishlab chiqarishga beriladi).
 *                                   Turi ombori: xom ashyo → "Xom ashyo ombori", savdo tovari → asosiy sklad.
 *   ishlab_chiqarish_qator.ombor  — qator tovari qaysi ombordan chiqqan / qaysi omborga kirgan
 *                                   (bekor qilinganda o'sha joyga qaytadi). Eski hujjatlarda hammasi asosiy sklad.
 *   tovar_register.manba_tur      — 'kochirish': tovar turi o'zgarganda qoldig'i turi omboriga ko'chadi
 *                                   (ikki yozuv tannarxda: chiqim + kirim; xarid ham, sotuv ham emas).
 */
const MANBA_ESKI = ['prixod', 'sotuv', 'qaytarma', 'inventar', 'yuklash', 'qabul', 'ishlab_chiqarish'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const tovar = await queryInterface.describeTable('tovar');
    if (!tovar.turi) {
      await queryInterface.addColumn('tovar', 'turi', {
        type: Sequelize.ENUM('tovar', 'xom_ashyo'), allowNull: false, defaultValue: 'tovar',
      });
    }

    const qator = await queryInterface.describeTable('ishlab_chiqarish_qator');
    if (!qator.ombor) {
      await queryInterface.addColumn('ishlab_chiqarish_qator', 'ombor', { type: Sequelize.STRING(80), allowNull: true });
      // Shu paytgacha xom ashyo ham, mahsulot ham hujjat omboridan (asosiy sklad) yurgan
      await queryInterface.sequelize.query(`
        UPDATE ishlab_chiqarish_qator q JOIN ishlab_chiqarish h ON h.id = q.hujjat_id
        SET q.ombor = h.ombor WHERE h.holat <> 'qoralama'`);
    }

    await queryInterface.changeColumn('tovar_register', 'manba_tur', {
      type: Sequelize.ENUM(...MANBA_ESKI, 'kochirish'), allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query("DELETE FROM tovar_register WHERE manba_tur = 'kochirish'");
    await queryInterface.changeColumn('tovar_register', 'manba_tur', { type: Sequelize.ENUM(...MANBA_ESKI), allowNull: false });
    await queryInterface.removeColumn('ishlab_chiqarish_qator', 'ombor');
    await queryInterface.removeColumn('tovar', 'turi');
  },
};
