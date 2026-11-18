'use strict';

/**
 * Avtolavka — mobil tomoni va joylashuv.
 *
 *   avtolavka_hujjat.manba            — 'web' (omborchi) yoki 'mobil' (agent so'rovi)
 *   avtolavka_hujjat.agent_qabul_vaqt — agent yuklangan tovarni mobilda qabul qilgan vaqt
 *   avtolavka_hujjat.rad_sababi       — omborchi agent so'rovini rad etganda
 *   avtolavka_kun                     — agent kun oxirida "topshirishga tayyorman" deb
 *                                        e'lon qiladi (o'zi sanagan naqd bilan)
 *   ariza.lat / lng / masofa_m        — mobil sotuv qayerda qilingani va mijozgacha masofa
 *   ariza.tashrif_id                  — sotuv qaysi tashrif (check-in) ichida bo'lgani
 */
module.exports = {
  async up(queryInterface, Sequelize) {
    const hujjat = await queryInterface.describeTable('avtolavka_hujjat');
    if (!hujjat.manba) {
      await queryInterface.addColumn('avtolavka_hujjat', 'manba', {
        type: Sequelize.ENUM('web', 'mobil'), allowNull: false, defaultValue: 'web', after: 'tur',
      });
    }
    if (!hujjat.agent_qabul_vaqt) {
      await queryInterface.addColumn('avtolavka_hujjat', 'agent_qabul_vaqt', {
        type: Sequelize.DATE, allowNull: true, after: 'tasdiqlagan_sana',
      });
    }
    if (!hujjat.rad_sababi) {
      await queryInterface.addColumn('avtolavka_hujjat', 'rad_sababi', {
        type: Sequelize.STRING(255), allowNull: true, after: 'izoh',
      });
    }

    const ariza = await queryInterface.describeTable('ariza');
    const arizaUst = {
      lat:        { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      lng:        { type: Sequelize.DECIMAL(10, 7), allowNull: true },
      masofa_m:   { type: Sequelize.INTEGER, allowNull: true },
      tashrif_id: { type: Sequelize.INTEGER, allowNull: true },
    };
    for (const [nom, tur] of Object.entries(arizaUst)) {
      if (!ariza[nom]) await queryInterface.addColumn('ariza', nom, tur);
    }

    const jadvallar = await queryInterface.showAllTables();
    if (!jadvallar.includes('avtolavka_kun')) {
      await queryInterface.createTable('avtolavka_kun', {
        id:          { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true },
        agent_id:    { type: Sequelize.INTEGER, allowNull: false },
        sana:        { type: Sequelize.DATEONLY, allowNull: false },
        yopish_vaqt: { type: Sequelize.DATE, allowNull: true },
        naqd_elon:   { type: Sequelize.DECIMAL(18, 2), allowNull: true },
        izoh:        { type: Sequelize.TEXT, allowNull: true },
        createdAt:   { type: Sequelize.DATE, allowNull: false },
        updatedAt:   { type: Sequelize.DATE, allowNull: false },
      });
      await queryInterface.addIndex('avtolavka_kun', ['agent_id', 'sana'], { unique: true });
    }
  },

  async down(queryInterface) {
    await queryInterface.dropTable('avtolavka_kun');
    for (const nom of ['tashrif_id', 'masofa_m', 'lng', 'lat']) {
      await queryInterface.removeColumn('ariza', nom);
    }
    for (const nom of ['rad_sababi', 'agent_qabul_vaqt', 'manba']) {
      await queryInterface.removeColumn('avtolavka_hujjat', nom);
    }
  },
};
