/**
 * Demo/seed skriptlari uchun umumiy xavfsizlik yordamchilari.
 *
 *  • ishlabChiqarishTaqiq() — NODE_ENV=production bo'lsa skript ishlamaydi,
 *    faqat aniq --majburiy bayrog'i bilan ruxsat (tasodifan real bazaga demo
 *    yozish yoki "tozalash" bilan real ma'lumotni o'chirishning oldini oladi).
 *
 *  • Demo yozuvlar jurnali (demo_yozuv jadvali): skript qo'shgan HAR bir qator
 *    id'si qo'shilgan paytda yoziladi. Tozalashda faqat shu id'lar o'chiriladi —
 *    "MAX(id) dan kattalar" yoki sana/nom bo'yicha taxmin qilinmaydi, shuning
 *    uchun shu vaqtda real foydalanuvchi yaratgan qatorlar tegilmaydi.
 *    Balans o'zgarishlari (mijoz.balans, yetkazuvchi.balans ...) ham delta
 *    sifatida yoziladi va tozalashda faqat o'sha delta teskari qo'llanadi —
 *    snapshot bilan ustidan yozilmaydi, oradagi real to'lovlar saqlanadi.
 */
require('dotenv').config();

function ishlabChiqarishTaqiq(skriptNomi) {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--majburiy')) {
    console.error(`  XATO: ${skriptNomi} NODE_ENV=production muhitida ishga tushirilmaydi.`);
    console.error('  Haqiqatan ham kerak bo\'lsa, --majburiy bayrog\'ini qo\'shing.');
    process.exit(1);
  }
}

const JADVAL_RE = /^[a-z_][a-z0-9_]*$/i;
function nomTekshir(nom) {
  if (!JADVAL_RE.test(nom)) throw new Error(`Noto'g'ri jadval/ustun nomi: ${nom}`);
  return nom;
}

/** demo_yozuv jadvalini yaratadi (DDL — tranzaksiyadan TASHQARIDA chaqiring) */
async function jurnalTayyorla(sequelize) {
  await sequelize.query(`CREATE TABLE IF NOT EXISTS demo_yozuv (
    id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    skript VARCHAR(60) NOT NULL,
    jadval VARCHAR(60) NOT NULL,
    yozuv_id INT NOT NULL,
    ustun VARCHAR(60) NULL,
    delta DECIMAL(20,2) NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY demo_yozuv_skript_jadval (skript, jadval)
  )`);
}

async function jurnalBormi(sequelize) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'demo_yozuv'`);
  return Number(r[0].c) > 0;
}

/** Skript qo'shgan qatorlar id'larini jurnalga yozadi */
async function belgila(sequelize, skript, jadval, ids, transaction) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(x => x != null);
  for (let i = 0; i < list.length; i += 500) {
    const b = list.slice(i, i + 500);
    await sequelize.query(
      `INSERT INTO demo_yozuv (skript, jadval, yozuv_id) VALUES ${b.map(() => '(?,?,?)').join(',')}`,
      { replacements: b.flatMap(id => [skript, nomTekshir(jadval), id]), transaction });
  }
}

/** Balansga qo'shilgan deltani yozadi va shu deltani qatorga qo'llaydi */
async function deltaQollash(sequelize, skript, jadval, id, ustun, delta, transaction) {
  const d = Number(delta) || 0;
  if (!d) return;
  await sequelize.query(
    `UPDATE \`${nomTekshir(jadval)}\` SET \`${nomTekshir(ustun)}\` = COALESCE(\`${ustun}\`, 0) + ? WHERE id = ?`,
    { replacements: [d, id], transaction });
  await sequelize.query(
    `INSERT INTO demo_yozuv (skript, jadval, yozuv_id, ustun, delta) VALUES (?,?,?,?,?)`,
    { replacements: [skript, jadval, id, ustun, d], transaction });
}

/** Jurnaldagi id'lar (qator yozuvlari, deltasiz) */
async function idlar(sequelize, skript, jadval, transaction) {
  const [r] = await sequelize.query(
    `SELECT yozuv_id FROM demo_yozuv WHERE skript = ? AND jadval = ? AND ustun IS NULL`,
    { replacements: [skript, jadval], transaction });
  return r.map(x => x.yozuv_id);
}

/** Jurnaldagi qatorlarni o'chiradi (jadvallar FK tartibida berilishi kerak) */
async function ochir(sequelize, skript, jadvallar, transaction) {
  const natija = {};
  for (const j of jadvallar) {
    const [r] = await sequelize.query(
      `DELETE FROM \`${nomTekshir(j)}\` WHERE id IN (
         SELECT yozuv_id FROM (SELECT yozuv_id FROM demo_yozuv WHERE skript = ? AND jadval = ? AND ustun IS NULL) x)`,
      { replacements: [skript, j], transaction });
    natija[j] = r?.affectedRows ?? 0;
  }
  return natija;
}

/** Skript qo'llagan balans deltalarini teskari qaytaradi (o'chirilmagan qatorlar uchun) */
async function deltalarniQaytar(sequelize, skript, transaction) {
  const [rows] = await sequelize.query(
    `SELECT jadval, yozuv_id, ustun, SUM(delta) d FROM demo_yozuv
     WHERE skript = ? AND ustun IS NOT NULL GROUP BY jadval, yozuv_id, ustun`,
    { replacements: [skript], transaction });
  for (const r of rows) {
    await sequelize.query(
      `UPDATE \`${nomTekshir(r.jadval)}\` SET \`${nomTekshir(r.ustun)}\` = COALESCE(\`${r.ustun}\`, 0) - ? WHERE id = ?`,
      { replacements: [Number(r.d) || 0, r.yozuv_id], transaction });
  }
  return rows.length;
}

/** Skript jurnalini tozalaydi */
async function jurnalniOchir(sequelize, skript, transaction) {
  await sequelize.query(`DELETE FROM demo_yozuv WHERE skript = ?`, { replacements: [skript], transaction });
}

module.exports = {
  ishlabChiqarishTaqiq, jurnalTayyorla, jurnalBormi, belgila, deltaQollash,
  idlar, ochir, deltalarniQaytar, jurnalniOchir, nomTekshir,
};
