'use strict';

/**
 * Avtolavka (ko'chma savdo): agent ertalab tovarni mashinaga yuklab, mijozlarga
 * bevosita sotadi, kechqurun naqdni kassaga, qolgan tovarni skladga topshiradi.
 *
 *   avtolavka_hujjat — ikki turdagi hujjat:
 *     yuklash: asosiy ombor → agent ombori ("Agent: <ism>")
 *     qabul:   agent ombori → asosiy ombor (farq agent omborida qoladi, brak alohida)
 *   avtolavka_qator  — hujjat qatorlari
 *   agent.avtolavka  — belgilangan agentning mobil sotuvi darhol "yetkazildi"
 *                      bo'ladi va chiqim uning omboridan tushadi
 *   tovar_register.manba_tur — 'yuklash' va 'qabul' manbalari qo'shiladi
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const agent = await queryInterface.describeTable('agent');
    if (!agent.avtolavka) {
      await queryInterface.addColumn('agent', 'avtolavka', {
        type: Sequelize.BOOLEAN, allowNull: false, defaultValue: false, after: 'dual_role',
      });
    }

    await queryInterface.sequelize.query(`
      ALTER TABLE tovar_register MODIFY COLUMN manba_tur
      ENUM('prixod','sotuv','qaytarma','inventar','yuklash','qabul') NOT NULL
    `);

    await queryInterface.createTable('avtolavka_hujjat', {
      id:               { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      raqam:            { type: Sequelize.STRING(30), allowNull: true },
      tur:              { type: Sequelize.ENUM('yuklash', 'qabul'), allowNull: false },
      agent_id:         { type: Sequelize.INTEGER, allowNull: false },
      agent_nomi:       { type: Sequelize.STRING(120), allowNull: true },
      ombor:            { type: Sequelize.STRING(80), allowNull: true },
      sana:             { type: Sequelize.DATEONLY, allowNull: false },
      holat:            { type: Sequelize.ENUM('qoralama', 'tasdiqlangan', 'bekor'), defaultValue: 'qoralama' },
      // Sotuv narxida — "xodimga shuncha tovar berildi" hisoboti shu bilan
      jami_dona:        { type: Sequelize.DECIMAL(14, 3), defaultValue: 0 },
      jami_summa:       { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      // Faqat qabul: kutilgan − qabul − brak
      farq_dona:        { type: Sequelize.DECIMAL(14, 3), defaultValue: 0 },
      brak_dona:        { type: Sequelize.DECIMAL(14, 3), defaultValue: 0 },
      izoh:             { type: Sequelize.TEXT, allowNull: true },
      yaratgan_id:      { type: Sequelize.INTEGER, allowNull: true },
      tasdiqlagan_id:   { type: Sequelize.INTEGER, allowNull: true },
      tasdiqlagan_sana: { type: Sequelize.DATE, allowNull: true },
      createdAt:        { type: Sequelize.DATE, allowNull: false },
      updatedAt:        { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('avtolavka_hujjat', ['agent_id', 'sana']);
    await queryInterface.addIndex('avtolavka_hujjat', ['tur', 'sana']);

    await queryInterface.createTable('avtolavka_qator', {
      id:            { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      hujjat_id:     { type: Sequelize.INTEGER, allowNull: false },
      tovar_id:      { type: Sequelize.INTEGER, allowNull: false },
      tovar_nomi:    { type: Sequelize.STRING(120), allowNull: false },
      turkum:        { type: Sequelize.STRING(80), allowNull: true },
      narx:          { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },   // sotuv narxi
      kirim_narx:    { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },   // tannarx
      blok:          { type: Sequelize.DECIMAL(10, 3), defaultValue: 0 },
      // Harakat miqdori: yuklashda berilgan, qabulda asosiyga qaytgan dona
      dona:          { type: Sequelize.DECIMAL(14, 3), defaultValue: 0 },
      kutilgan_dona: { type: Sequelize.DECIMAL(14, 3), allowNull: true },
      qabul_dona:    { type: Sequelize.DECIMAL(14, 3), allowNull: true },
      brak_dona:     { type: Sequelize.DECIMAL(14, 3), defaultValue: 0 },
      farq_dona:     { type: Sequelize.DECIMAL(14, 3), defaultValue: 0 },
      summa:         { type: Sequelize.DECIMAL(18, 2), defaultValue: 0 },
      createdAt:     { type: Sequelize.DATE, allowNull: false },
      updatedAt:     { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('avtolavka_qator', ['hujjat_id']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('avtolavka_qator');
    await queryInterface.dropTable('avtolavka_hujjat');
    await queryInterface.sequelize.query(
      `DELETE FROM tovar_register WHERE manba_tur IN ('yuklash','qabul')`);
    await queryInterface.sequelize.query(`
      ALTER TABLE tovar_register MODIFY COLUMN manba_tur
      ENUM('prixod','sotuv','qaytarma','inventar') NOT NULL
    `);
    const agent = await queryInterface.describeTable('agent');
    if (agent.avtolavka) await queryInterface.removeColumn('agent', 'avtolavka');
  },
};
