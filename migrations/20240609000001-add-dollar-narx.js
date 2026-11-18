'use strict';

// $ narx funksiyasi: (1) global "sozlama" key-value jadvali — hozircha faqat
// dollar kursini saqlaydi, kelajakda boshqa global sozlamalar ham shu yerga
// qo'shilishi mumkin; (2) prixod_qator va tovar_register ga $ narx ustunlari —
// so'm narxi bilan bir qatorda saqlanadi (foydalanuvchi $ kiritadi, so'm
// backend'da kursga ko'paytirib avtomatik hisoblanadi va ikkalasi ham saqlanadi,
// shunda tarixiy hujjatlar keyinchalik kurs o'zgarsa ham o'zining haqiqiy $ va
// o'sha kundagi so'm qiymatini saqlab qoladi).
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('sozlama', {
      kalit:     { type: Sequelize.STRING(60), primaryKey: true, allowNull: false },
      qiymat:    { type: Sequelize.STRING(255), allowNull: true },
      izoh:      { type: Sequelize.STRING(255), allowNull: true },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
    });

    await queryInterface.bulkInsert('sozlama', [{
      kalit: 'dollar_kurs',
      qiymat: '12650',
      izoh: "1 USD necha so'm (prixodda $ narx kiritilganda ishlatiladi)",
      createdAt: new Date(),
      updatedAt: new Date(),
    }]);

    await queryInterface.addColumn('prixod_qator', 'narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'narx',
    });
    await queryInterface.addColumn('prixod_qator', 'sotuv_narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'sotuv_narx',
    });
    await queryInterface.addColumn('prixod_qator', 'kurs', {
      type: Sequelize.DECIMAL(12, 2), allowNull: true,
      comment: 'Ushbu qator saqlangan paytdagi kurs (tarixiy audit uchun)',
      after: 'sotuv_narx_usd',
    });

    await queryInterface.addColumn('tovar_register', 'kirim_narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'kirim_narx',
    });
    await queryInterface.addColumn('tovar_register', 'sotuv_narx_usd', {
      type: Sequelize.DECIMAL(18, 4), allowNull: true, defaultValue: 0, after: 'sotuv_narx',
    });
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('tovar_register', 'sotuv_narx_usd');
    await queryInterface.removeColumn('tovar_register', 'kirim_narx_usd');
    await queryInterface.removeColumn('prixod_qator', 'kurs');
    await queryInterface.removeColumn('prixod_qator', 'sotuv_narx_usd');
    await queryInterface.removeColumn('prixod_qator', 'narx_usd');
    await queryInterface.dropTable('sozlama');
  },
};
