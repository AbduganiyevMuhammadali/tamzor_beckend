/**
 * Kassa boshlang'ich qoldig'i — tizimga o'tish paytida biznesda bor naqd pul.
 *
 *   node scripts/kassa-boshlangich.js <summa> [--usul naqt|karta|bank] [--sana 2026-10-20] [--tozala]
 *
 * Bitta `kassa` kirim yozuvi: kategoriya='boshlangich_kapital' ("Kapital kiritildi"),
 * manba_tur='boshlangich'. Moliyalar "Umumiy qoldiq", dashboard kassa, Biznes hisobotidagi
 * aktivlar uni oddiy kirim deb qo'shadi; foyda-zarar esa qo'shmaydi — tahlil.controller
 * DAROMAD ro'yxatida faqat "Boshqa daromad" bor, kapital daromad emas.
 * Bir usul uchun bitta yozuv: qayta ishga tushirilsa summa YANGILANADI (ikkinchisi yozilmaydi).
 * `--tozala` — shu usuldagi boshlang'ich yozuvni o'chiradi.
 */
process.chdir(require('path').join(__dirname, '..'));
require('dotenv').config();
const sequelize = require('../src/db/db-sequelize');
require('../src/models/index.js');
const KassaModel = require('../src/models/kassa.model');

const MANBA = 'boshlangich';
const argv = process.argv.slice(2);
const summa = parseFloat(String(argv.find(a => !a.startsWith('--')) || '').replace(/\s/g, '').replace(',', '.'));
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const usul = arg('--usul', 'naqt');
const sanaArg = arg('--sana', null);
const sana = sanaArg && /^\d{4}-\d{2}-\d{2}$/.test(sanaArg) ? sanaArg : new Date().toISOString().slice(0, 10);
const fmt = (v) => Math.round(v).toLocaleString('ru-RU');

(async () => {
  if (!['naqt', 'karta', 'bank'].includes(usul)) throw new Error("--usul naqt | karta | bank bo'lishi kerak");
  const bor = await KassaModel.findOne({ where: { manba_tur: MANBA, tolov_usul: usul } });
  if (argv.includes('--tozala')) {
    if (!bor) console.log(`Boshlang'ich (${usul}) yozuvi yo'q`);
    else { await bor.destroy(); console.log(`Boshlang'ich (${usul}) ${fmt(Number(bor.summa))} so'm o'chirildi`); }
  } else {
    if (!(summa > 0)) throw new Error('Summa musbat son bo\'lishi kerak');
    const maydon = {
      tur: 'kirim', kategoriya: 'boshlangich_kapital', summa, tolov_usul: usul, manba_tur: MANBA, manba_id: null,
      izoh: "Boshlang'ich kassa qoldig'i — tizimga o'tishdagi " + (usul === 'naqt' ? 'naqd pul' : usul) + ' (Excel)',
      sana: new Date(`${sana}T08:00:00`), user_id: 1,
    };
    if (bor) { await bor.update(maydon); console.log(`Boshlang'ich (${usul}) yangilandi: ${fmt(summa)} so'm (${sana})`); }
    else { await KassaModel.create(maydon); console.log(`Boshlang'ich (${usul}) kiritildi: ${fmt(summa)} so'm (${sana})`); }
  }
  const [r] = await sequelize.query(`SELECT COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END), 0) AS qoldiq FROM kassa`, { type: sequelize.QueryTypes.SELECT });
  console.log(`Kassa umumiy qoldig'i hozir: ${fmt(parseFloat(r.qoldiq))} so'm`);
  await sequelize.close();
})().catch(e => { console.error('XATO:', e.message); process.exit(1); });
