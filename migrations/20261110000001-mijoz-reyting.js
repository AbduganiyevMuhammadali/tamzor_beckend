'use strict';

/* Mijoz reytingi (foydalanuvchi so'rovi 2026-11-10): har mijozning ball hisobi va uning tarixi.
   mijoz.reyting — joriy ball (0…200, boshlanishi 100); reyting_savdo / reyting_moliya — shu
   boshlanishdan beri buyurtma intizomi va to'lov intizomi bo'yicha yig'ilgan ball;
   rad_ketma_ket — oxirgi zakazdan beri ketma-ket rad etishlar (kunlar) soni;
   tolov_vada_sana — mijoz "falon kuni to'layman" degan sana.
   mijoz_reyting — har o'zgarish: tur, ball (qo'llangan), sabab, manba (ariza/kassa/sotmaslik). */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const ustunlar = await queryInterface.describeTable('mijoz');
    const qosh = async (nom, def) => { if (!ustunlar[nom]) await queryInterface.addColumn('mijoz', nom, def); };
    await qosh('reyting',         { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 });
    await qosh('reyting_savdo',   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    await qosh('reyting_moliya',  { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    await qosh('rad_ketma_ket',   { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });
    await qosh('tolov_vada_sana', { type: DataTypes.DATEONLY, allowNull: true });
    await qosh('reyting_vaqt',    { type: DataTypes.DATE, allowNull: true });
    await queryInterface.addIndex('mijoz', ['reyting'], { name: 'mijoz_reyting_idx' });

    await queryInterface.createTable('mijoz_reyting', {
      id:          { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
      mijoz_id:    { type: DataTypes.INTEGER, allowNull: false },
      tur:         { type: DataTypes.ENUM('buyurtma', 'rad_etildi', 'kritik', 'tolov_qabul', 'tolov_surildi', 'qolda'), allowNull: false },
      yonalish:    { type: DataTypes.ENUM('savdo', 'moliya'), allowNull: false },
      ball:        { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },     // haqiqatda qo'llangan (0…200 chegarasida)
      reyting_keyin: { type: DataTypes.INTEGER, allowNull: false },
      sabab_id:    { type: DataTypes.STRING(30), allowNull: true },
      sabab:       { type: DataTypes.STRING(150), allowNull: true },
      izoh:        { type: DataTypes.STRING(255), allowNull: true },
      summa:       { type: DataTypes.DECIMAL(18, 2), allowNull: true },
      vada_sana:   { type: DataTypes.DATEONLY, allowNull: true },
      manba_tur:   { type: DataTypes.STRING(30), allowNull: true },               // ariza | kassa | sotmaslik | mobil | web
      manba_id:    { type: DataTypes.INTEGER, allowNull: true },
      xodim_rol:   { type: DataTypes.STRING(20), allowNull: true },               // agent | dostavchi | web
      xodim_id:    { type: DataTypes.INTEGER, allowNull: true },
      xodim_nomi:  { type: DataTypes.STRING(150), allowNull: true },
      mobil_id:    { type: DataTypes.STRING(64), allowNull: true, unique: true },
      sana:        { type: DataTypes.DATE, allowNull: false },
      createdAt:   { type: DataTypes.DATE, allowNull: false },
      updatedAt:   { type: DataTypes.DATE, allowNull: false },
    });
    await queryInterface.addIndex('mijoz_reyting', ['mijoz_id', 'sana'], { name: 'mijoz_reyting_mijoz_sana' });
    await queryInterface.addIndex('mijoz_reyting', ['manba_tur', 'manba_id'], { name: 'mijoz_reyting_manba' });
  },

  async down(queryInterface) {
    await queryInterface.dropTable('mijoz_reyting');
    await queryInterface.removeIndex('mijoz', 'mijoz_reyting_idx');
    for (const u of ['reyting', 'reyting_savdo', 'reyting_moliya', 'rad_ketma_ket', 'tolov_vada_sana', 'reyting_vaqt']) {
      await queryInterface.removeColumn('mijoz', u);
    }
  },
};
