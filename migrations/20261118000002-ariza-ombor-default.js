'use strict';

/* ariza.ombor standart qiymati.
   20240301000001-create-ariza migratsiyasi DB default'ni 'Asosiy sklad' qilgan, lekin
   dastur asosiy omborni ASOSIY_OMBOR = 'Основной склад' (src/utils/ombor.utils.js)
   nomi bilan yuritadi: model default, zaxira tekshiruvi, tovar_register va hisobotlar
   shu qiymat bilan ishlaydi. 'Asosiy sklad' — faqat UI'dagi KO'RINADIGAN nom
   (omborNomi()), src/ ichida bazaga hech qayerda ataylab yozilmaydi. Shuning uchun
   ombor = 'Asosiy sklad' bo'lgan arizalar — ombor ko'rsatilmagan xom INSERT'lardan
   (DB default) yoki eski scripts/seed-test-data.js dan qolgan va aslida asosiy sklad
   arizalari; ular ham konstantaga o'tkaziladi. */
const ASOSIY_OMBOR = 'Основной склад';
const ESKI_DEFAULT = 'Asosiy sklad';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn('ariza', 'ombor', {
      type: Sequelize.STRING(80), allowNull: true, defaultValue: ASOSIY_OMBOR,
    });
    await queryInterface.sequelize.query(
      'UPDATE ariza SET ombor = :yangi WHERE ombor = :eski',
      { replacements: { yangi: ASOSIY_OMBOR, eski: ESKI_DEFAULT } });
  },

  /* Faqat standart qiymat qaytariladi. Yangilangan qatorlar qaytarilmaydi: ular endi
     haqiqiy 'Основной склад' arizalaridan ajralmaydi va eski qiymat baribir xato edi. */
  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn('ariza', 'ombor', {
      type: Sequelize.STRING(80), allowNull: true, defaultValue: ESKI_DEFAULT,
    });
  },
};
