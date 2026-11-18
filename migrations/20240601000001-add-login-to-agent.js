'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    // Mobil ilova uchun agent login/parol
    await queryInterface.addColumn('agent', 'login', {
      type: Sequelize.STRING(50),
      allowNull: true,
      unique: true,
      after: 'fullname',
    });
    await queryInterface.addColumn('agent', 'parol', {
      type: Sequelize.STRING(60),  // bcrypt hash
      allowNull: true,
      after: 'login',
    });
    await queryInterface.addIndex('agent', ['login']);
  },

  async down(queryInterface) {
    await queryInterface.removeColumn('agent', 'login');
    await queryInterface.removeColumn('agent', 'parol');
  },
};
