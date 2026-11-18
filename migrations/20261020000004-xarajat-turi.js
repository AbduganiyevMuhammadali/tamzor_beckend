'use strict';

/**
 * Kunlik xarajatlar (Moliya → Kunlik xarajatlar) — xarajat toifalari.
 * Xarajatning o'zi `kassa` jadvalida (tur='chiqim', kategoriya = toifa kodi, manba_tur='xarajat'),
 * shuning uchun kassa qoldig'i va foyda-zarar hisoboti uni o'zi hisobga oladi.
 * Toifalarni foydalanuvchi qo'sha / nomini o'zgartira / yashira oladi; kod o'zgarmaydi (kassa yozuvlari unga bog'liq).
 */
const STANDART = [
  ['transport_xarajat', "Transport va yoqilg'i", 'yoqilgi'],
  ['ovqat',             'Ovqat va choy',            'ovqat'],
  ['ish_haqi',          'Ish haqi va avans',        'odam'],
  ['ijara',             'Ijara',                    'uy'],
  ['kommunal',          'Kommunal (svet, gaz, suv)', 'chiroq'],
  ['aloqa',             'Aloqa va internet',        'telefon'],
  ['xojalik',           "Xo'jalik mollari",         'savat'],
  ['tamir',             "Ta'mirlash",               'asbob'],
  ['soliq',             "Soliq va yig'imlar",       'hujjat'],
  ['reklama',           'Reklama',                  'megafon'],
  ['xarajat',           'Boshqa xarajat',           'boshqa'],
];

module.exports = {
  async up(queryInterface, Sequelize) {
    const jadvallar = await queryInterface.showAllTables();
    if (!jadvallar.includes('xarajat_turi')) {
      await queryInterface.createTable('xarajat_turi', {
        id:        { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        kod:       { type: Sequelize.STRING(50), allowNull: false, unique: true },
        nomi:      { type: Sequelize.STRING(100), allowNull: false },
        ikon:      { type: Sequelize.STRING(30), allowNull: true },
        tartib:    { type: Sequelize.INTEGER, allowNull: false, defaultValue: 0 },
        faol:      { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: true },
        createdAt: { type: Sequelize.DATE, allowNull: false },
        updatedAt: { type: Sequelize.DATE, allowNull: false },
      });
      const now = new Date();
      await queryInterface.bulkInsert('xarajat_turi', STANDART.map(([kod, nomi, ikon], i) => ({ kod, nomi, ikon, tartib: i + 1, faol: true, createdAt: now, updatedAt: now })));
    }
  },
  async down(queryInterface) {
    await queryInterface.dropTable('xarajat_turi');
  },
};
