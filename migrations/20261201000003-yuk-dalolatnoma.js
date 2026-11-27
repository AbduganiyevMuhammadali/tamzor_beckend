'use strict';

/* YUK DALOLATNOMASI VA AGENT IMZOSI (2026-11-27)
   avtolavka_hujjat (tur 'yuklash'):
     imzo_holat — NULL: imzo talab qilinmagan (eski / sozlama o'chiq paytdagi yuklash);
                  'kutilmoqda' — omborchi tasdiqladi, agent imzolashi kerak (imzogacha agent sota olmaydi);
                  'imzolangan' — agent imzo chizib tasdiqladi; 'rad_etildi' — agent soni mos emas deb rad etdi
                  (omborchi tuzatadi → yana 'kutilmoqda').
     agent_imzo (rasm yo'li), imzo_vaqt, agent_rad_sababi, imzo_mobil_id (oflayn navbat takrori).
   sozlama 'yuk_imzo_majburiy' ('1' | '0', standart '0') — admin yangi ilova o'rnatilgach yoqadi. */
module.exports = {
  async up(queryInterface, Sequelize) {
    const { DataTypes } = Sequelize;
    const u = await queryInterface.describeTable('avtolavka_hujjat');
    const qosh = async (nom, def) => { if (!u[nom]) await queryInterface.addColumn('avtolavka_hujjat', nom, def); };
    await qosh('imzo_holat', { type: DataTypes.ENUM('kutilmoqda', 'imzolangan', 'rad_etildi'), allowNull: true, defaultValue: null });
    await qosh('agent_imzo', { type: DataTypes.STRING(255), allowNull: true });
    await qosh('imzo_vaqt', { type: DataTypes.DATE, allowNull: true });
    await qosh('agent_rad_sababi', { type: DataTypes.STRING(255), allowNull: true });
    await qosh('imzo_mobil_id', { type: DataTypes.STRING(64), allowNull: true });
    if (!u.imzo_holat) await queryInterface.addIndex('avtolavka_hujjat', ['agent_id', 'imzo_holat'], { name: 'idx_avtolavka_hujjat_imzo' });
  },
  async down(queryInterface) {
    for (const c of ['imzo_holat', 'agent_imzo', 'imzo_vaqt', 'agent_rad_sababi', 'imzo_mobil_id']) {
      await queryInterface.removeColumn('avtolavka_hujjat', c).catch(() => {});
    }
  },
};
