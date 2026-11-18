'use strict';

// Mobil hisobotlar uchun jadvallar: audit natijasi, sotmaslik sabablari,
// agent GPS marshruti. Bular web "Hisobot" sahifasida ko'rsatiladi.
module.exports = {
  async up(queryInterface, Sequelize) {
    const { INTEGER, STRING, DECIMAL, DATE, TEXT, JSON } = Sequelize;

    // ── Audit natijasi (chekUp) ──
    await queryInterface.createTable('audit_natija', {
      id:           { type: INTEGER, primaryKey: true, autoIncrement: true },
      agent_id:     { type: INTEGER, allowNull: true },
      agent_nomi:   { type: STRING(120), allowNull: true },
      mijoz_id:     { type: INTEGER, allowNull: true },
      mijoz_nomi:   { type: STRING(150), allowNull: true },
      maydon:       { type: DECIMAL(10, 2), allowNull: true },   // area (m²)
      stend:        { type: DECIMAL(10, 2), allowNull: true },
      biz_bilan:    { type: DECIMAL(5, 2), allowNull: true },    // shopWithUs %
      bizsiz:       { type: DECIMAL(5, 2), allowNull: true },    // showWithoutUs %
      sabab:        { type: STRING(120), allowNull: true },
      shikoyat:     { type: TEXT, allowNull: true },             // complaint
      taklif:       { type: TEXT, allowNull: true },             // offer
      kirish_vaqt:  { type: STRING(20), allowNull: true },       // enterTime
      chiqish_vaqt: { type: STRING(20), allowNull: true },       // exitTime
      lat:          { type: DECIMAL(10, 7), allowNull: true },
      lng:          { type: DECIMAL(10, 7), allowNull: true },
      tovarlar:     { type: JSON, allowNull: true },             // goods massivi
      rasmlar:      { type: JSON, allowNull: true },             // media fayl yo'llari
      sana:         { type: DATE, allowNull: true },
      createdAt:    { type: DATE, allowNull: false },
      updatedAt:    { type: DATE, allowNull: false },
    });

    // ── Sotmaslik sabablari (clientNotSell) ──
    await queryInterface.createTable('sotmaslik', {
      id:         { type: INTEGER, primaryKey: true, autoIncrement: true },
      agent_id:   { type: INTEGER, allowNull: true },
      agent_nomi: { type: STRING(120), allowNull: true },
      mijoz_id:   { type: INTEGER, allowNull: true },
      mijoz_nomi: { type: STRING(150), allowNull: true },
      sabab_id:   { type: STRING(30), allowNull: true },
      sabab_nomi: { type: STRING(120), allowNull: true },
      sana:       { type: DATE, allowNull: true },
      createdAt:  { type: DATE, allowNull: false },
      updatedAt:  { type: DATE, allowNull: false },
    });

    // ── Agent GPS marshruti (sendLocation batch) ──
    await queryInterface.createTable('agent_location', {
      id:         { type: INTEGER, primaryKey: true, autoIncrement: true },
      agent_id:   { type: INTEGER, allowNull: true },
      lat:        { type: DECIMAL(10, 7), allowNull: true },
      lng:        { type: DECIMAL(10, 7), allowNull: true },
      battery:    { type: INTEGER, allowNull: true },
      sana:       { type: DATE, allowNull: true },
      createdAt:  { type: DATE, allowNull: false },
      updatedAt:  { type: DATE, allowNull: false },
    });
    await queryInterface.addIndex('agent_location', ['agent_id', 'sana']);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('agent_location');
    await queryInterface.dropTable('sotmaslik');
    await queryInterface.dropTable('audit_natija');
  },
};
