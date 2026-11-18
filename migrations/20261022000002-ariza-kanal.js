'use strict';

/* ariza.kanal — savdo kanali aniq ustunda: distributsiya | avtolavka | sklad.
   Ilgari kanal ombor nomidan ("Agent: …") aniqlanardi; endi admin asosiy skladdan
   xodimsiz sotganda (Won Sell → Sotuv qilish → Skladdan) ombor asosiy bo'lsa ham
   u distributsiya emas — shuning uchun alohida ustun. Mavjud hujjatlar ombor bo'yicha to'ldiriladi. */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn('ariza', 'kanal', {
      type: Sequelize.DataTypes.ENUM('distributsiya', 'avtolavka', 'sklad'),
      allowNull: false, defaultValue: 'distributsiya', after: 'manba',
    });
    await queryInterface.sequelize.query("UPDATE ariza SET kanal = 'avtolavka' WHERE ombor LIKE 'Agent: %'");
    await queryInterface.addIndex('ariza', ['kanal', 'holat'], { name: 'ariza_kanal_holat' });
  },

  async down(queryInterface) {
    await queryInterface.removeIndex('ariza', 'ariza_kanal_holat');
    await queryInterface.removeColumn('ariza', 'kanal');
  },
};
