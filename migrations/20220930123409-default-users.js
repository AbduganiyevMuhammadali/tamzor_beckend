'use strict';

const sequelize = require('sequelize');

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {
      await queryInterface.bulkInsert(
        'user', 
        [ 
          { 
            username: 'Programmer',
            password: '$2a$08$YLZ7gtHc5KgiF3TlX/12r.boof4dIvGSoViUYxaRL8f7yHhKjPh0i', 
            fullname: 'Dasturchi',  
            role: `Programmer`,
            deletedAt: null
          } 
        ], 
        { transaction }
      );

      await queryInterface.bulkInsert(
        'user', 
        [ 
          { 
            username: 'Admin',
            password: '$2a$08$YLZ7gtHc5KgiF3TlX/12r.boof4dIvGSoViUYxaRL8f7yHhKjPh0i', 
            fullname: 'Admin',  
            role: `Admin`,
            deletedAt: null
          } 
        ], 
        { transaction }
      );
      
      // Programmer → id 0, Admin → id 1. So'rovlar ketma-ket va shu tranzaksiya
      // ichida bajarilishi shart: ilgari await'siz yuborilgani uchun bo'sh
      // bazaga o'rnatish gohida "Duplicate entry '1'" bilan yiqilardi.
      await queryInterface.sequelize.query('UPDATE user SET id = 0 WHERE id = 1', { transaction });
      await queryInterface.sequelize.query('UPDATE user SET id = 1 WHERE id = 2', { transaction });

      await transaction.commit();
    } catch (errors) {
      await transaction.rollback();
      throw errors;
    }
    // ALTER TABLE tranzaksiyani yashirincha yopadi — shuning uchun undan keyin
    await queryInterface.sequelize.query('ALTER TABLE user AUTO_INCREMENT = 1');
  },

  async down (queryInterface, Sequelize) {
    const transaction = await queryInterface.sequelize.transaction();
    try {

      await transaction.commit();
    } catch (errors) {
      await transaction.rollback();
      throw errors;
    }
  }
};
