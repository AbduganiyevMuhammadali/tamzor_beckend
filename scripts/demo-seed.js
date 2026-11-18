/**
 * ═══════════════════════════════════════════════════════════════════
 *  DEMO SEED — prezentatsiya uchun dasturni "jonli" holatga keltiradi
 * ═══════════════════════════════════════════════════════════════════
 *
 * Muammo: bazadagi ma'lumot iyulda tugagan. Bugungi sanada ochilganda
 * dashboardda "kirim = 0", "o'sish = −100%", moliya sahifasi bo'sh,
 * qarzdorlar ro'yxati bo'm-bo'sh chiqadi.
 *
 * Bu skript oxirgi 60 kunni bugungi kunga qadar to'ldiradi:
 *   1. Tovar katalogi   — turkumlar bo'yicha kengaytiriladi
 *   2. Mijozlar         — koordinata, sinf, tashrif kunlari bilan
 *   3. Prixod (kirim)   — dashboarddagi "Kirim" va trend grafigi uchun
 *   4. Kassa harakati   — moliya sahifasi va kunlik oqim uchun
 *   5. Qarzdorlik       — "Top qarzdorlar" va debitorlik bloki uchun
 *
 * Ishga tushirish:  npm run demo:seed
 * Tozalash:         npm run demo:seed -- --tozala
 *
 * XAVFSIZLIK: faqat shu skript yaratgan yozuvlar o'chiriladi.
 * Belgilar: prixod.hujjat_raqam LIKE 'PR-DEMO%', kassa.izoh LIKE '%[demo]%',
 * tovar/mijoz — izoh maydonida DEMO_TAG. Mavjud ma'lumotga tegilmaydi.
 */

require('dotenv').config();
const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const TAG          = 'DEMO-SEED';
const PRIXOD_PREF  = 'PR-DEMO';
const KUNLAR_ORQA  = 60;

const rnd  = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const iso  = (d) => d.toISOString().slice(0, 10);

/* ── Katalog uchun namunalar ───────────────────────────────── */
const TOVARLAR = [
  ['Ichimliklar', ['Coca-Cola 0.5L','Fanta 1L','Sprite 1.5L','Pepsi 0.5L','Nestea limon 1L',
                   'Suv gazsiz 5L','Suv gazli 1L','Energetik ichimlik 0.45L','Ayron 0.5L','Tabiiy sok olma 1L']],
  ['Sut mahsulotlari', ['Sut 2.5% 1L','Kefir 1L','Qatiq 0.5L','Smetana 20% 400g','Tvorog 5% 200g',
                        'Sariyog\' 180g','Pishloq Rossiyskiy 200g','Yogurt mevali 290g']],
  ['Non va shirinlik', ['Non oq','Batonchik shokoladli','Pechenye yubileynoe 300g','Vafli 250g',
                        'Tort medovik 700g','Keks vanilli 400g','Konfet assorti 500g']],
  ['Bakaleya', ['Guruch lazer 1kg','Makaron spagetti 450g','Un oliy nav 2kg','Shakar 1kg',
                'Tuz yodlangan 1kg','Yog\' kungaboqar 1L','Grechka 900g','Yasmiq 800g']],
  ['Konserva', ['Tushonka mol 325g','Baliq konservasi 240g','No\'xat konserva 400g',
                'Makkajo\'xori 340g','Tomat pastasi 500g']],
  ['Gigiyena', ['Shampun 400ml','Sovun 90g','Tish pastasi 100ml','Kir yuvish kukuni 3kg',
                'Idish yuvish suyuqligi 500ml','Salfetka 100 dona']],
];

const MIJOZ_NOMLARI = [
  'Zafar market','Nodirabegim savdo','Chinor do\'kon','Shodlik baza','Oybek supermarket',
  'Diyor market','Sarbon savdo','Humo do\'kon','Registon baza','Navro\'z market',
  'Bunyodkor do\'kon','Zilola savdo','Mehnat market','Chorsu baza','Farovon do\'kon',
  'Buyuk ipak yo\'li','Sharq yulduzi','Ittifoq market','Hamkor savdo','Barokat baza',
  'Yangi asr market','Oltin vodiy','Do\'stlik savdo','Kelajak baza','Ravnaq market',
];

const YETKAZUVCHILAR = ['Coca-Cola Ichimlik', 'Nestle Uzbekistan', 'Milk Group', 'Baraka Savdo', 'Global Distribution'];
/* Dastur kategoriyani snake_case kutadi — dashboard "Bugungi to'lov"
   ni aynan kategoriya='mijoz_tolov' bo'yicha sanaydi. Chiroyli nom
   yozilsa hisobot nol chiqadi. */
const KASSA_KIRIM_KAT  = ['mijoz_tolov', 'mijoz_tolov', 'sotuvdan_tushum', 'qarz_qaytarish'];
const KASSA_CHIQIM_KAT = ['Yetkazuvchiga to\'lov', 'Ish haqi', 'Transport', 'Ijara', 'Kommunal'];

/* Farg'ona vodiysi koordinata doirasi */
const koord = () => [40.32 + Math.random() * 0.17, 71.70 + Math.random() * 0.22];

async function tozala() {
  const t = await sequelize.transaction();
  try {
    // Ombor yozuvlari demo prixodlarga manba_id orqali bog'langan —
    // prixodlarni o'chirishdan OLDIN ularni tozalaymiz
    await sequelize.query(
      `DELETE FROM tovar_register
       WHERE manba_tur = 'prixod'
         AND manba_id IN (SELECT id FROM prixod WHERE hujjat_raqam LIKE '${PRIXOD_PREF}%')`,
      { transaction: t });
    await sequelize.query(
      `DELETE FROM prixod_qator WHERE prixod_id IN (SELECT id FROM prixod WHERE hujjat_raqam LIKE '${PRIXOD_PREF}%')`,
      { transaction: t });
    await sequelize.query(`DELETE FROM prixod WHERE hujjat_raqam LIKE '${PRIXOD_PREF}%'`, { transaction: t });
    await sequelize.query(`DELETE FROM kassa  WHERE izoh LIKE '%[demo]%'`, { transaction: t });

    // Demo mijozlar — avval ularga bog'liq yozuvlar
    const [dm] = await sequelize.query(
      `SELECT id FROM mijoz WHERE izoh = '${TAG}'`, { transaction: t });
    const ids = dm.map(r => r.id);
    if (ids.length) {
      await sequelize.query(`DELETE FROM tashrif       WHERE mijoz_id IN (${ids.join(',')})`, { transaction: t });
      await sequelize.query(`DELETE FROM marshrut_reja WHERE mijoz_id IN (${ids.join(',')})`, { transaction: t });
      await sequelize.query(`DELETE FROM sotmaslik     WHERE mijoz_id IN (${ids.join(',')})`, { transaction: t });
      await sequelize.query(
        `DELETE FROM ariza_qator WHERE ariza_id IN (SELECT id FROM ariza WHERE mijoz_id IN (${ids.join(',')}))`,
        { transaction: t });
      await sequelize.query(`DELETE FROM ariza WHERE mijoz_id IN (${ids.join(',')})`, { transaction: t });
      await sequelize.query(`DELETE FROM mijoz WHERE id IN (${ids.join(',')})`, { transaction: t });
    }

    await sequelize.query(`DELETE FROM tovar WHERE tavsif = '${TAG}'`, { transaction: t });

    // Qarzdorlikni asl holiga qaytaramiz. Demo balansni o'zgartirishdan oldin
    // eski qiymatni demo_balans_zaxira jadvaliga yozib qo'yadi — shunda
    // mavjud mijozlarning haqiqiy balansi yo'qolmaydi.
    const [zaxiraBor] = await sequelize.query(
      `SELECT COUNT(*) c FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'demo_balans_zaxira'`,
      { transaction: t });
    if (zaxiraBor[0].c) {
      await sequelize.query(
        `UPDATE mijoz m JOIN demo_balans_zaxira z ON z.mijoz_id = m.id
         SET m.balans = z.eski_balans`, { transaction: t });
      await sequelize.query(`DROP TABLE demo_balans_zaxira`, { transaction: t });
    }

    await t.commit();
    console.log('  Tozalandi: demo prixod, kassa, tovar, mijoz va qarzdorliklar');
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

async function seed() {
  await tozala();

  const bugun = new Date();
  const natija = { tovar: 0, mijoz: 0, prixod: 0, kassa: 0, qarzdor: 0 };

  /* ── 1. TOVAR KATALOGI ──────────────────────────────────── */
  const [mavjudTovar] = await sequelize.query('SELECT nomi FROM tovar WHERE deletedAt IS NULL');
  const bor = new Set(mavjudTovar.map(t => t.nomi));

  const yangiTovarlar = [];
  TOVARLAR.forEach(([turkum, nomlar]) => {
    nomlar.forEach(nomi => { if (!bor.has(nomi)) yangiTovarlar.push({ nomi, turkum }); });
  });

  for (const t of yangiTovarlar) {
    await sequelize.query(
      `INSERT INTO tovar (nomi, turkum, olchov_birligi, blokdagi_soni, qutidagi_bloklar,
                          faol, tavsif, createdAt, updatedAt)
       VALUES (?,?,'dona',?,?,1,?,NOW(),NOW())`,
      { replacements: [t.nomi, t.turkum, rnd(6, 24), rnd(4, 12), TAG] });
    natija.tovar++;
  }

  const [tovarlar] = await sequelize.query('SELECT id, nomi, turkum FROM tovar WHERE deletedAt IS NULL');

  /* ── 2. MIJOZLAR ────────────────────────────────────────── */
  const [agentlar]   = await sequelize.query('SELECT id FROM agent WHERE faol = 1');
  const [terr]       = await sequelize.query('SELECT id FROM territoriya');
  const [kategoriya] = await sequelize.query('SELECT id FROM mijoz_kategoriya');
  const [mavjudMijoz]= await sequelize.query('SELECT nomi FROM mijoz WHERE deletedAt IS NULL');
  const mBor = new Set(mavjudMijoz.map(m => m.nomi));

  const KUNLAR = ['Du','Se','Ch','Pa','Ju','Sh'];
  for (const nomi of MIJOZ_NOMLARI) {
    if (mBor.has(nomi)) continue;
    const [lat, lng] = koord();
    const kunlari = [...KUNLAR].sort(() => Math.random() - 0.5).slice(0, rnd(2, 3)).join(', ');
    await sequelize.query(
      `INSERT INTO mijoz (nomi, telefon, manzil, lat, lng, agent_id, territoriya_id, kategoriya_id,
                          sinf, narx_turi, balans, kredit_limit, tolov_muddati_kun,
                          tashrif_kunlari, faol, izoh, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,1,?,NOW(),NOW())`,
      { replacements: [
          nomi, '+9989' + rnd(10000000, 99999999), `Farg'ona vodiysi, ${rnd(1, 120)}-uy`,
          lat, lng,
          agentlar.length ? pick(agentlar).id : null,
          terr.length ? pick(terr).id : null,
          kategoriya.length ? pick(kategoriya).id : null,
          pick(['A','B','C','D']), pick(['optom','chakana']),
          rnd(5, 40) * 1000000, pick([14, 21, 30]), kunlari, TAG,
        ] });
    natija.mijoz++;
  }

  /* ── 3. PRIXOD (ombor kirimi) — dashboarddagi "Kirim" ───── */
  // Dashboard "bu oy (1-sanadan bugungacha)" ni "o'tgan to'liq oy" bilan
  // taqqoslaydi. Joriy oy hali tugamagani uchun kunlik zichlik teng bo'lsa
  // o'sish doim salbiy chiqadi. Shuning uchun kunlik zichlikni joriy oyda
  // yuqori, o'tgan oyda past qilamiz — o'sish ijobiy va real ko'rinadi.
  const oyBoshi = new Date(bugun.getFullYear(), bugun.getMonth(), 1);

  for (let k = KUNLAR_ORQA; k >= 0; k--) {
    const sana = new Date(bugun); sana.setDate(bugun.getDate() - k);
    if (sana.getDay() === 0) continue;              // yakshanba yuk kelmaydi

    // Joriy oyda deyarli har kuni, oldingi oylarda ~har uchinchi kuni
    const joriyOy = sana >= oyBoshi;
    if (!joriyOy && Math.random() > 0.34) continue;

    const sanaStr = iso(sana);
    /* Vaqt: o'tgan kunlar uchun ish boshi 09:00. Bugungi hujjat esa
       hozirgi soatdan OLDIN bo'lishi shart — dashboard "today" oralig'i
       00:00 dan NOW gacha, kelajakdagi vaqt hisobga olinmaydi. */
    const hozir = new Date();
    // Baza UTC saqlaydi — mahalliy soat (UTC+5) ishlatilsa yozuv
    // kelajakda qolib, "today" oralig'iga tushmaydi.
    const vaqt = (k === 0)
      ? `${String(Math.max(0, hozir.getUTCHours() - 1)).padStart(2, '0')}:${String(rnd(0, 55)).padStart(2, '0')}:00`
      : '09:00:00';
    const damga = `${sanaStr} ${vaqt}`;

    const qatorSoni = rnd(4, 9);
    const qatorlar = [];
    let jami = 0;

    for (let i = 0; i < qatorSoni; i++) {
      const tv = pick(tovarlar);
      const dona   = rnd(60, 400);
      const narx   = rnd(3, 45) * 1000;
      const summa  = dona * narx;
      jami += summa;
      qatorlar.push({
        tovar_id: tv.id, tovar_nomi: tv.nomi, turkum: tv.turkum,
        narx, dona, summa,
        sotuv:   Math.round(narx * 1.18),
        optom:   Math.round(narx * 1.14),
        chakana: Math.round(narx * 1.25),
      });
    }

    const [res] = await sequelize.query(
      `INSERT INTO prixod (hujjat_raqam, sana, yetkazuvchi, tolov_turi, tolangan_summa,
                           ombor, jami_summa, holat, izoh, createdAt, updatedAt)
       VALUES (?,?,?,?,?,'Основной склад',?,'tasdiqlangan',?,?,?)`,
      { replacements: [
          `${PRIXOD_PREF}-${sanaStr.replace(/-/g, '')}-${rnd(100, 999)}`,
          sanaStr, pick(YETKAZUVCHILAR), pick(['naqt', 'optom', 'chaka']),
          jami, jami, `[demo] ${TAG}`, damga, damga,
        ] });
    const prixodId = res;

    for (const q of qatorlar) {
      await sequelize.query(
        `INSERT INTO prixod_qator (prixod_id, tovar_id, tovar_nomi, turkum, narx,
             sotuv_narx, optom_narx, chakana_narx, donada, bloklarda, qutilarda, hajm, summa,
             createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,0,0,0,?,NOW(),NOW())`,
        { replacements: [prixodId, q.tovar_id, q.tovar_nomi, q.turkum, q.narx,
                         q.sotuv, q.optom, q.chakana, q.dona, q.summa] });

      // Ombor qoldig'i oshsin — "Ombor qiymati" KPI si uchun.
      // manba_tur enum bo'lgani uchun 'prixod' ishlatamiz; demo yozuvlar
      // manba_id orqali demo prixodlarga bog'lanadi (tozalashda shu bo'yicha topiladi).
      await sequelize.query(
        `INSERT INTO tovar_register (tovar_id, tovar_nomi, turkum, ombor, tur, manba_tur, manba_id,
             donada, bloklarda, qutilarda, hajm, kirim_narx, sotuv_narx, summa, sana, createdAt, updatedAt)
         VALUES (?,?,?,'Основной склад','kirim','prixod',?,?,0,0,0,?,?,?,?,NOW(),NOW())`,
        { replacements: [q.tovar_id, q.tovar_nomi, q.turkum, prixodId,
                         q.dona, q.narx, q.sotuv, q.summa, damga] });
    }
    natija.prixod++;
  }

  /* ── 4. KASSA HARAKATI — moliya sahifasi ────────────────── */
  const [mijozlar] = await sequelize.query(
    'SELECT id, nomi FROM mijoz WHERE deletedAt IS NULL AND faol = 1 LIMIT 60');

  /* Har mijozning to'lanmagan qarzi — to'lov summasi shundan hisoblanadi.
     Mavjud yetkazilgan savdolardan boshlang'ich holatni yig'amiz. */
  const qarzHolati = {};
  const [savdoJami] = await sequelize.query(`
    SELECT mijoz_id, COALESCE(SUM(jami_summa), 0) s
    FROM ariza
    WHERE deletedAt IS NULL AND holat = 'yetkazildi' AND mijoz_id IS NOT NULL
    GROUP BY mijoz_id`);
  savdoJami.forEach(r => { qarzHolati[r.mijoz_id] = parseFloat(r.s) || 0; });

  /* Bazada bu skript yaratmagan eski to'lovlar ham bor. Ular ham qarzni
     kamaytiradi — hisobga olmasak, jami to'lov savdodan oshib ketadi va
     oldi-berdi tarixida hamma mijoz "avans"da ko'rinadi. */
  const [eskiTolov] = await sequelize.query(`
    SELECT mijoz_id, COALESCE(SUM(summa), 0) s
    FROM kassa
    WHERE tur = 'kirim' AND mijoz_id IS NOT NULL
      AND (izoh IS NULL OR izoh NOT LIKE '%[demo]%')
    GROUP BY mijoz_id`);
  eskiTolov.forEach(r => {
    const bor = qarzHolati[r.mijoz_id] ?? 0;
    qarzHolati[r.mijoz_id] = Math.max(0, bor - (parseFloat(r.s) || 0));
  });

  for (let k = KUNLAR_ORQA; k >= 0; k--) {
    const sana = new Date(bugun); sana.setDate(bugun.getDate() - k);
    if (sana.getDay() === 0) continue;              // yakshanba
    const sanaStr = iso(sana);

    // Kunlik tushum. Joriy oyda ko'proq — dashboard/moliya taqqoslashida
    // o'sish ijobiy chiqishi uchun (yuqoridagi prixod bilan bir mantiq)
    const joriyOyK = sana >= new Date(bugun.getFullYear(), bugun.getMonth(), 1);
    /* Bugungi yozuvlar hozirgi UTC soatdan oshmasin — kelajakdagi vaqt
       dashboard "today" oralig'iga (00:00 → NOW) tushmaydi. */
    const kMax = (k === 0) ? Math.max(1, new Date().getUTCHours()) : 17;
    for (let i = 0, n = joriyOyK ? rnd(6, 11) : rnd(3, 6); i < n; i++) {
      const m = pick(mijozlar);
      const soat = rnd(Math.min(9, kMax), kMax);

      /* To'lov summasi mijozning shu paytgacha to'lanmagan qarzidan
         kelib chiqadi. Ilgari tasodifiy (400k–6.5mln) edi va savdodan
         mustaqil bo'lgani uchun jami to'lov savdodan 3 barobar oshib,
         oldi-berdi tarixida hamma mijoz "avans"da ko'rinardi. */
      const qarz = qarzHolati[m.id] ?? 0;
      if (qarz < 50000) continue;              // qarzi yo'q — to'lamaydi
      /* Ulush: ko'pincha qisman to'laydi (30–80%), ba'zan to'liq yopadi.
         Hammasi to'liq yopsa qoldiq nolga tushib, jadval sun'iy ko'rinadi —
         real distribyutorlikda mijozlarning bir qismi doim qarzda qoladi. */
      const ulush = Math.random() < 0.18 ? 1 : (0.25 + Math.random() * 0.5);
      const summa = Math.max(50000, Math.round(qarz * ulush / 1000) * 1000);
      qarzHolati[m.id] = Math.max(0, qarz - summa);

      await sequelize.query(
        `INSERT INTO kassa (tur, kategoriya, summa, tolov_usul, mijoz_id, mijoz_nomi,
                            izoh, sana, createdAt, updatedAt)
         VALUES ('kirim',?,?,?,?,?,?,?,NOW(),NOW())`,
        { replacements: [
            pick(KASSA_KIRIM_KAT), summa,
            pick(['naqt', 'karta', 'bank']),
            m.id, m.nomi, '[demo] mijoz to\'lovi',
            `${sanaStr} ${String(soat).padStart(2, '0')}:${String(rnd(0, 59)).padStart(2, '0')}:00`,
          ] });
      natija.kassa++;
    }

    // Chiqim kamroq — haftada bir necha marta
    if (Math.random() < 0.45) {
      await sequelize.query(
        `INSERT INTO kassa (tur, kategoriya, summa, tolov_usul, izoh, sana, createdAt, updatedAt)
         VALUES ('chiqim',?,?,?,?,?,NOW(),NOW())`,
        { replacements: [
            pick(KASSA_CHIQIM_KAT), rnd(800, 12000) * 1000,
            pick(['naqt', 'bank']), '[demo] xarajat',
            `${sanaStr} ${String(rnd(Math.min(10, kMax), kMax)).padStart(2, '0')}:00:00`,
          ] });
      natija.kassa++;
    }
  }

  /* ── 5. QARZDORLIK — "Top qarzdorlar" bloki ─────────────── */
  // Mijozlarning bir qismiga turli muddatdagi qarz beramiz.
  // Eski balansni zaxiraga yozamiz — --tozala uni tiklaydi.
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS demo_balans_zaxira (
      mijoz_id INT PRIMARY KEY,
      eski_balans DECIMAL(18,2) NOT NULL
    )`);

  const qarzdorlar = [...mijozlar].sort(() => Math.random() - 0.5).slice(0, Math.min(12, mijozlar.length));
  for (const m of qarzdorlar) {
    await sequelize.query(
      `INSERT IGNORE INTO demo_balans_zaxira (mijoz_id, eski_balans)
       SELECT id, balans FROM mijoz WHERE id = ?`, { replacements: [m.id] });
    await sequelize.query('UPDATE mijoz SET balans = ? WHERE id = ?',
      { replacements: [rnd(800, 14000) * 1000, m.id] });
    natija.qarzdor++;
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

    console.log('  Demo ma\'lumot tayyorlanmoqda...');
    const n = await seed();

    const [chk] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM tovar WHERE deletedAt IS NULL) tovar,
        (SELECT COUNT(*) FROM mijoz WHERE deletedAt IS NULL) mijoz,
        (SELECT ROUND(SUM(jami_summa)/1e6) FROM prixod WHERE deletedAt IS NULL
          AND sana >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) kirim30,
        (SELECT ROUND(SUM(summa)/1e6) FROM kassa WHERE tur='kirim'
          AND sana >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)) kassa30,
        (SELECT ROUND(SUM(balans)/1e6) FROM mijoz WHERE balans > 0) qarz
    `);
    const c = chk[0];

    console.log('');
    console.log(`  + tovar        : ${n.tovar} ta yangi   (jami ${c.tovar})`);
    console.log(`  + mijoz        : ${n.mijoz} ta yangi   (jami ${c.mijoz})`);
    console.log(`  + prixod       : ${n.prixod} ta hujjat`);
    console.log(`  + kassa        : ${n.kassa} ta harakat`);
    console.log(`  + qarzdor      : ${n.qarzdor} ta mijoz`);
    console.log('');
    console.log(`  Oxirgi 30 kun  : kirim ${c.kirim30 || 0} mln · kassa ${c.kassa30 || 0} mln · qarz ${c.qarz || 0} mln`);
    console.log('');
    process.exit(0);
  } catch (e) {
    console.error('  XATO:', e.message);
    process.exit(1);
  }
})();
