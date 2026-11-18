'use strict';

/**
 * ISHLAB CHIQARISH — kichik sex: xom ashyo omborda → ishlab chiqarishga beriladi →
 * sof mahsulot (va qo'shimcha mahsulot) omborga kirim bo'ladi, tannarx hisoblanadi.
 *
 *   ishlab_chiqarish          — partiya hujjati (IC-2026-0001): holat, jami summalar, chiqish foizi
 *   ishlab_chiqarish_qator    — xom ashyo / mahsulot / qo'shimcha mahsulot qatorlari
 *   ishlab_chiqarish_xarajat  — qo'shimcha xarajatlar (ish haqi, elektr, qadoq…), kassadan to'langani bilan
 *
 * tovar_register.manba_tur ga 'ishlab_chiqarish' qo'shiladi: xom ashyo chiqimi va
 * mahsulot kirimi shu manba bilan yoziladi (tannarx xaritasi mahsulot kirimini ham o'qiydi).
 */
const MANBA_ESKI = ['prixod', 'sotuv', 'qaytarma', 'inventar', 'yuklash', 'qabul'];

module.exports = {
  async up(queryInterface, Sequelize) {
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    const vaqt = {
      createdAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
      updatedAt: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('CURRENT_TIMESTAMP') },
    };
    const pul = () => ({ type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 });
    const miqdor = () => ({ type: Sequelize.DECIMAL(14, 3), allowNull: false, defaultValue: 0 });

    if (!jadvallar.includes('ishlab_chiqarish')) {
      await queryInterface.createTable('ishlab_chiqarish', {
        id:               { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        raqam:            { type: Sequelize.STRING(30), allowNull: false, unique: true },
        sana:             { type: Sequelize.DATE, allowNull: false },
        holat:            { type: Sequelize.ENUM('qoralama', 'jarayonda', 'yakunlandi', 'bekor'), allowNull: false, defaultValue: 'qoralama' },
        ombor:            { type: Sequelize.STRING(80), allowNull: false, defaultValue: 'Основной склад' },
        // Bir nechta asosiy mahsulot bo'lsa tannarx qanday bo'linadi: sotuv qiymati yoki miqdor bo'yicha
        taqsimlash:       { type: Sequelize.ENUM('qiymat', 'miqdor'), allowNull: false, defaultValue: 'qiymat' },
        izoh:             { type: Sequelize.TEXT, allowNull: true },
        xom_ashyo_miqdor: miqdor(),
        xom_ashyo_summa: pul(),
        xarajat_summa: pul(),
        qoshimcha_summa: pul(),
        tannarx_jami: pul(),
        mahsulot_miqdor: miqdor(),
        yoqotish_miqdor: miqdor(),
        chiqish_foiz:     { type: Sequelize.DECIMAL(7, 2), allowNull: true },
        boshlangan_vaqt:  { type: Sequelize.DATE, allowNull: true },
        yakunlangan_vaqt: { type: Sequelize.DATE, allowNull: true },
        bekor_sababi:     { type: Sequelize.STRING(255), allowNull: true },
        user_id:          { type: Sequelize.INTEGER, allowNull: true },
        user_nomi:        { type: Sequelize.STRING(120), allowNull: true },
        ...vaqt,
      });
      await queryInterface.addIndex('ishlab_chiqarish', ['holat', 'sana'], { name: 'ix_ishlab_holat_sana' });
    }

    if (!jadvallar.includes('ishlab_chiqarish_qator')) {
      await queryInterface.createTable('ishlab_chiqarish_qator', {
        id:           { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        hujjat_id:    { type: Sequelize.INTEGER, allowNull: false },
        tur:          { type: Sequelize.ENUM('xom_ashyo', 'mahsulot', 'qoshimcha'), allowNull: false },
        tovar_id:     { type: Sequelize.INTEGER, allowNull: false },
        tovar_nomi:   { type: Sequelize.STRING(120), allowNull: false },
        turkum:       { type: Sequelize.STRING(80), allowNull: true },
        olchov:       { type: Sequelize.STRING(20), allowNull: true },
        reja_miqdor: miqdor(),                    // rejalashtirilgan (qoralamada)
        miqdor: miqdor(),                    // haqiqiy: xom ashyo — sarflangan, mahsulot — chiqqan
        narx: pul(),                       // birlik tannarxi (xom ashyo — ombordagi o'rtacha, mahsulot — hisoblangan)
        summa: pul(),
        ulush:        { type: Sequelize.DECIMAL(9, 6), allowNull: true },   // mahsulotga tushgan tannarx ulushi
        optom_narx: pul(),
        chakana_narx: pul(),
        ...vaqt,
      });
      await queryInterface.addIndex('ishlab_chiqarish_qator', ['hujjat_id'], { name: 'ix_ishlab_qator_hujjat' });
      await queryInterface.addIndex('ishlab_chiqarish_qator', ['tovar_id', 'tur'], { name: 'ix_ishlab_qator_tovar' });
    }

    if (!jadvallar.includes('ishlab_chiqarish_xarajat')) {
      await queryInterface.createTable('ishlab_chiqarish_xarajat', {
        id:         { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        hujjat_id:  { type: Sequelize.INTEGER, allowNull: false },
        nomi:       { type: Sequelize.STRING(120), allowNull: false },
        summa: pul(),
        kassadan:   { type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false },
        tolov_usul: { type: Sequelize.ENUM('naqt', 'karta', 'bank'), allowNull: false, defaultValue: 'naqt' },
        kassa_id:   { type: Sequelize.INTEGER, allowNull: true },
        ...vaqt,
      });
      await queryInterface.addIndex('ishlab_chiqarish_xarajat', ['hujjat_id'], { name: 'ix_ishlab_xarajat_hujjat' });
    }

    await queryInterface.changeColumn('tovar_register', 'manba_tur', {
      type: Sequelize.ENUM(...MANBA_ESKI, 'ishlab_chiqarish'), allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query("DELETE FROM tovar_register WHERE manba_tur = 'ishlab_chiqarish'");
    await queryInterface.changeColumn('tovar_register', 'manba_tur', { type: Sequelize.ENUM(...MANBA_ESKI), allowNull: false });
    await queryInterface.dropTable('ishlab_chiqarish_xarajat');
    await queryInterface.dropTable('ishlab_chiqarish_qator');
    await queryInterface.dropTable('ishlab_chiqarish');
  },
};
