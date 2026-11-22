'use strict';

/* VILOYAT NARXLARI (2026-11-25)
   tovar_viloyat_narx — har tovar uchun har viloyatda (territoriya) alohida chakana va optom narx.
                        Agent sotuvida AGENTNING viloyati olinadi (mijozniki emas). Ustunlik:
                        mijoz toifasi ro'yxati → agent viloyati narxi (mijoz narx_turi bo'yicha) → sotilmaydi.
                        Viloyati yo'q agent — eski qoida (toifa → standart → eski narx).
                        Narx saqlangan zahoti amal qiladi; kim o'zgartirgani (user_id, user_nomi) va updatedAt saqlanadi.
                        Tovar yoki viloyat o'chirilsa — qatorlari ham o'chadi (CASCADE).
   agent.narx_ozgartirish — mobil ilovada narxni o'zgartirish ruxsati (login → editPrice), standart 0. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const jadvallar = (await queryInterface.showAllTables()).map(t => (typeof t === 'string' ? t : t.tableName));
    if (!jadvallar.includes('tovar_viloyat_narx')) {
      await queryInterface.createTable('tovar_viloyat_narx', {
        id:             { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false },
        tovar_id:       { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'tovar', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        territoriya_id: { type: DataTypes.INTEGER, allowNull: false,
          references: { model: 'territoriya', key: 'id' }, onDelete: 'CASCADE', onUpdate: 'CASCADE' },
        chakana_narx:   { type: DataTypes.DECIMAL(18, 2), allowNull: true },
        optom_narx:     { type: DataTypes.DECIMAL(18, 2), allowNull: true },
        user_id:        { type: DataTypes.INTEGER, allowNull: true },
        user_nomi:      { type: DataTypes.STRING(100), allowNull: true },
        createdAt:      { type: DataTypes.DATE, allowNull: false },
        updatedAt:      { type: DataTypes.DATE, allowNull: false },
      });
      await queryInterface.addIndex('tovar_viloyat_narx', ['tovar_id', 'territoriya_id'], { unique: true, name: 'uq_tovar_viloyat_narx' });
      await queryInterface.addIndex('tovar_viloyat_narx', ['territoriya_id'], { name: 'idx_tovar_viloyat_narx_ter' });
    }
    const agent = await queryInterface.describeTable('agent');
    if (!agent.narx_ozgartirish) {
      await queryInterface.addColumn('agent', 'narx_ozgartirish', { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false });
    }
  },
  async down(queryInterface) {
    const agent = await queryInterface.describeTable('agent');
    if (agent.narx_ozgartirish) await queryInterface.removeColumn('agent', 'narx_ozgartirish');
    await queryInterface.dropTable('tovar_viloyat_narx').catch(() => {});
  },
};
