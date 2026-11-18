'use strict';

// Agent inkassatsiyasi: agent kun davomida naqd yig'gan pulni (savePayment orqali
// kelgan kirimlar) kassaga rasman topshiradi. Solishtiruv: yig'ilgan vs topshirilgan.
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('inkassatsiya', {
      id:              { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
      agent_id:        { type: Sequelize.INTEGER, allowNull: false },
      agent_nomi:      { type: Sequelize.STRING(120), allowNull: true },
      sana:            { type: Sequelize.DATEONLY, allowNull: false },
      yigilgan_summa:  { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 }, // shu kun agent naqd qabul qilgani
      topshirilgan_summa: { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 }, // kassaga real topshirgani
      farq:            { type: Sequelize.DECIMAL(18, 2), allowNull: false, defaultValue: 0 },   // yigilgan - topshirilgan (kamomad/ortiqcha)
      holat:           { type: Sequelize.ENUM('ochiq', 'yopiq', 'kamomad'), allowNull: false, defaultValue: 'ochiq' },
      izoh:            { type: Sequelize.TEXT, allowNull: true },
      tasdiqlagan_id:  { type: Sequelize.INTEGER, allowNull: true },   // qaysi web user qabul qildi
      tasdiqlagan_sana:{ type: Sequelize.DATE, allowNull: true },
      createdAt:       { type: Sequelize.DATE, allowNull: false },
      updatedAt:       { type: Sequelize.DATE, allowNull: false },
    });
    await queryInterface.addIndex('inkassatsiya', ['agent_id', 'sana']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('inkassatsiya');
  },
};
