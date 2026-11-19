/**
 * ═══════════════════════════════════════════════════════════════════
 *  BUGUNGI QOLGAN BO'LIMLAR — inkassatsiya + trip sheet
 * ═══════════════════════════════════════════════════════════════════
 *
 * demo-seed.js va seed-agent-nazorat.js sakkiz bo'limni to'ldiradi,
 * lekin ikkitasiga tegmaydi:
 *   · inkassatsiya — agent kun oxirida yig'gan pulni kassaga topshirishi
 *   · trip_sheet   — dostavchining kunlik marshrut varag'i
 *
 * Bu skript o'sha ikkisini oxirgi kunlar uchun to'ldiradi.
 *
 * Ishga tushirish:  npm run demo:bugun
 * Tozalash:         npm run demo:bugun -- --tozala
 *
 * XAVFSIZLIK: faqat shu skript yozgan yozuvlar o'chiriladi
 * (izoh maydonida DEMO_TAG, trip raqami 'TS-DEMO-' bilan boshlanadi).
 */

require('dotenv').config();
const sequelize = require('../src/db/db-sequelize');
// NODE_ENV=production da ishlamaydi (faqat --majburiy bilan)
require('./lib/demo-utils').ishlabChiqarishTaqiq('seed-bugun-qolgan');
sequelize.options.logging = false;

const TAG       = '[demo-bugun]';
const TRIP_PREF = 'TS-DEMO';
const KUNLAR    = 7;               // oxirgi shuncha kun

const rnd  = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const iso  = (d) => d.toISOString().slice(0, 10);

async function tozala() {
  // Arizalarni trip'dan uzamiz, so'ng triplarni o'chiramiz
  await sequelize.query(`
    UPDATE ariza SET trip_sheet_id = NULL, trip_tartib = NULL
    WHERE trip_sheet_id IN (SELECT id FROM trip_sheet WHERE raqam LIKE '${TRIP_PREF}%')`);
  await sequelize.query(`DELETE FROM trip_sheet   WHERE raqam LIKE '${TRIP_PREF}%'`);
  await sequelize.query(`DELETE FROM inkassatsiya WHERE izoh LIKE '%${TAG}%'`);
  console.log(`  Tozalandi: ${TRIP_PREF}* triplar va ${TAG} inkassatsiyalar`);
}

async function seed() {
  await tozala();

  const bugun = new Date();
  const natija = { inkassatsiya: 0, trip: 0, biriktirilgan: 0 };

  const [agentlar]    = await sequelize.query('SELECT id, fullname FROM agent     WHERE faol = 1');
  const [dostavchilar]= await sequelize.query('SELECT id, ism      FROM dostavchi WHERE faol = 1');
  if (!agentlar.length)     throw new Error('Faol agent yo\'q');
  if (!dostavchilar.length) throw new Error('Faol dostavchi yo\'q');

  for (let k = KUNLAR - 1; k >= 0; k--) {
    const sana = new Date(bugun);
    sana.setDate(bugun.getDate() - k);
    if (sana.getDay() === 0) continue;          // yakshanba ishlanmaydi
    const sanaStr = iso(sana);
    const bugunmi = k === 0;

    /* ── 1. INKASSATSIYA — har agent kunlik tushumini topshiradi ── */
    for (const a of agentlar) {
      // O'sha agent o'sha kuni qancha savdo qilgan — asos shu
      const [savdo] = await sequelize.query(`
        SELECT COALESCE(SUM(jami_summa), 0) s FROM ariza
        WHERE agent_id = :id AND DATE(createdAt) = :sana
          AND turi = 'sotish' AND deletedAt IS NULL`,
        { replacements: { id: a.id, sana: sanaStr } });

      const yigilgan = Math.round(Number(savdo[0].s) || 0);
      if (yigilgan <= 0) continue;              // savdosi yo'q — topshirmaydi

      // Ko'p holatda to'liq topshiradi; ba'zida kamomad chiqadi
      const kamomadli = Math.random() < 0.18;
      const topshirilgan = kamomadli
        ? Math.round(yigilgan * (0.82 + Math.random() * 0.13))
        : yigilgan;
      const farq = topshirilgan - yigilgan;

      // Bugungi topshiriqlar hali tekshirilmagan bo'lishi tabiiy
      const holat = bugunmi ? 'ochiq' : (farq < 0 ? 'kamomad' : 'yopiq');

      await sequelize.query(`
        INSERT INTO inkassatsiya
          (agent_id, agent_nomi, sana, yigilgan_summa, topshirilgan_summa, farq,
           holat, izoh, tasdiqlagan_id, tasdiqlagan_sana, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
        { replacements: [
            a.id, a.fullname, sanaStr, yigilgan, topshirilgan, farq, holat,
            `${TAG} ${farq < 0 ? 'kamomad qayd etildi' : 'to\'liq topshirildi'}`,
            holat === 'ochiq' ? null : 1,
            holat === 'ochiq' ? null : `${sanaStr} 18:30:00`,
          ] });
      natija.inkassatsiya++;
    }

    /* ── 2. TRIP SHEET — dostavchining kunlik marshrut varag'i ── */
    // Faqat mashinali dostavchilar (agent-dostavchi emas)
    const haydovchilar = dostavchilar.filter(d => !/agent/i.test(d.ism));
    const kunlikSoni = Math.min(haydovchilar.length, rnd(2, 3));
    const tanlangan = [...haydovchilar].sort(() => Math.random() - 0.5).slice(0, kunlikSoni);

    for (let i = 0; i < tanlangan.length; i++) {
      const d = tanlangan[i];

      // Bugun: bir qismi yo'lda, qolgani yakunlangan.
      // O'tgan kunlar: hammasi yakunlangan.
      const holat = bugunmi ? (i === 0 ? 'yolda' : 'yakunlandi') : 'yakunlandi';
      const boshVaqt = `${sanaStr} ${String(rnd(8, 9)).padStart(2, '0')}:${String(rnd(0, 55)).padStart(2, '0')}:00`;
      const tugVaqt  = holat === 'yakunlandi'
        ? `${sanaStr} ${String(rnd(15, 18)).padStart(2, '0')}:${String(rnd(0, 55)).padStart(2, '0')}:00`
        : null;

      const [res] = await sequelize.query(`
        INSERT INTO trip_sheet
          (raqam, dostavchi_id, dostavchi_nomi, sana, holat,
           boshlangan_vaqt, tugagan_vaqt, izoh, createdAt, updatedAt)
        VALUES (?,?,?,?,?,?,?,?,NOW(),NOW())`,
        { replacements: [
            `${TRIP_PREF}-${sanaStr.replace(/-/g, '')}-${i + 1}`,
            d.id, d.ism, sanaStr, holat, boshVaqt, tugVaqt, `${TAG} kunlik marshrut`,
          ] });
      const tripId = res;
      natija.trip++;

      // O'sha kunning yetkazilgan arizalarini shu tripga biriktiramiz
      const [arizalar] = await sequelize.query(`
        SELECT id FROM ariza
        WHERE DATE(createdAt) = :sana AND deletedAt IS NULL
          AND trip_sheet_id IS NULL AND holat IN ('yetkazildi','yolda')
        LIMIT :lim`,
        { replacements: { sana: sanaStr, lim: rnd(3, 6) } });

      for (let t = 0; t < arizalar.length; t++) {
        await sequelize.query(
          `UPDATE ariza SET trip_sheet_id = ?, trip_tartib = ?,
                            dostavchi_id = ?, dostavchi_nomi = ?
           WHERE id = ?`,
          { replacements: [tripId, t + 1, d.id, d.ism, arizalar[t].id] });
        natija.biriktirilgan++;
      }
    }
  }

  return natija;
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('');
    if (process.argv.includes('--tozala')) {
      await tozala();
      console.log('');
      process.exit(0);
    }

    const n = await seed();

    const [chk] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM inkassatsiya WHERE sana = CURDATE()) ink_bugun,
        (SELECT COUNT(*) FROM trip_sheet   WHERE sana = CURDATE()) trip_bugun,
        (SELECT COUNT(*) FROM inkassatsiya WHERE holat = 'kamomad') kamomad,
        (SELECT ROUND(SUM(topshirilgan_summa)/1e6) FROM inkassatsiya WHERE sana = CURDATE()) ink_mln`);
    const c = chk[0];

    console.log(`  + inkassatsiya : ${n.inkassatsiya} ta yozuv`);
    console.log(`  + trip sheet   : ${n.trip} ta varaqa (${n.biriktirilgan} ariza biriktirildi)`);
    console.log('');
    console.log(`  Bugun          : ${c.ink_bugun} inkassatsiya (${c.ink_mln || 0} mln) · ${c.trip_bugun} trip`);
    console.log(`  Kamomad holati : ${c.kamomad} ta`);
    console.log('');
    process.exit(0);
  } catch (e) {
    console.error('  XATO:', e.message);
    process.exit(1);
  }
})();
