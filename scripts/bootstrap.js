/**
 * ═══════════════════════════════════════════════════════════════════
 *  BOOTSTRAP — bo'sh bazani ishga tayyor holatga keltiradi
 * ═══════════════════════════════════════════════════════════════════
 *
 * Yangi serverda migratsiyalar jadvallarni yaratadi, lekin ular BO'SH
 * qoladi — hatto tizimga kirish uchun foydalanuvchi ham yo'q.
 * demo-seed.js esa mavjud agent/mijoz/territoriyaga tayanadi.
 *
 * Bu skript o'sha bo'shliqni to'ldiradi:
 *   1. Foydalanuvchilar  — Admin va Programmer (tizimga kirish uchun)
 *   2. Territoriyalar    — hududlar
 *   3. Mijoz kategoriyalari
 *   4. Agentlar          — mobil login bilan
 *   5. Dostavchilar
 *   6. Boshlang'ich tovarlar
 *   7. Boshlang'ich mijozlar (koordinata bilan)
 *
 * Ishga tushirish:  npm run db:bootstrap
 *
 * XAVFSIZ: mavjud yozuvlarga tegmaydi — faqat yo'qlarini qo'shadi.
 * Qayta ishga tushirish zararsiz (idempotent).
 *
 * PAROLLAR: yangi yaratilgan har bir foydalanuvchi/agent/dostavchiga TASODIFIY
 * parol beriladi va oxirida BIR MARTA ekranga chiqariladi (bazada faqat hash).
 * Demo uchun ma'lum parol kerak bo'lsa: BOOTSTRAP_PAROL=... yoki --parol <qiymat>
 * (kamida 8 belgi).
 */

require('dotenv').config();
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

/* Parol manbai: --parol argument > BOOTSTRAP_PAROL env > tasodifiy (har biriga alohida) */
const parolArgIdx = process.argv.indexOf('--parol');
const BERILGAN_PAROL = (parolArgIdx !== -1 ? process.argv[parolArgIdx + 1] : null) || process.env.BOOTSTRAP_PAROL || null;
if (BERILGAN_PAROL && BERILGAN_PAROL.length < 8) {
  console.error('  XATO: --parol / BOOTSTRAP_PAROL kamida 8 belgi bo\'lishi kerak');
  process.exit(1);
}
const yangiParol = () => BERILGAN_PAROL || crypto.randomBytes(9).toString('base64url');
const yaratilganKirishlar = [];   // [{ tur, login, parol }] — oxirida bir marta chiqariladi

/* ── Ma'lumot namunalari ─────────────────────────────────── */
/* Odatda bu ikkisini '20220930123409-default-users' migratsiyasi yaratadi.
   Bu yerdagi ro'yxat — migratsiya o'tmagan yoki user jadvali qo'lda
   tozalangan holat uchun zaxira. Parol — tasodifiy (yuqoriga qarang). */
const FOYDALANUVCHILAR = [
  { id: 0, username: 'Programmer', fullname: 'Dasturchi',     role: 'Programmer' },
  { id: 1, username: 'Admin',      fullname: 'Administrator', role: 'Admin' },
];

const TERRITORIYALAR = ["Farg'ona shahar", "Marg'ilon", 'Qo\'qon'];

const KATEGORIYALAR = ['Supermarket', "Do'kon", 'Optom baza', 'Kafe/Restoran'];

const AGENTLAR = [
  { fullname: 'Sherzod Karimov',  telefon: '+998901112233', login: 'sherzod',  plan: 40000000 },
  { fullname: 'Dilshod Yusupov',  telefon: '+998901112244', login: 'dilshod',  plan: 35000000 },
  { fullname: "Bekzod G'ulomov",  telefon: '+998901112255', login: 'bekzod',   plan: 38000000 },
  { fullname: 'Otabek Rashidov',  telefon: '+998901112266', login: 'otabek',   plan: 30000000 },
];

const DOSTAVCHILAR = [
  { ism: 'Jasur Toshmatov', telefon: '+998907773311', transport: 'mashina', raqam: '01A123BC', login: 'jasur' },
  { ism: "Islom Ne'matov",  telefon: '+998907773322', transport: 'mashina', raqam: '01B456DE', login: 'islom' },
  { ism: 'Ravshan Aliyev',  telefon: '+998907773333', transport: 'moto',    raqam: '01C789FG', login: 'ravshan' },
];

const TOVARLAR = [
  ['Sut 1L',            'Sut mahsulotlari'], ['Kefir 1L',        'Sut mahsulotlari'],
  ['Yogurt 290g',       'Sut mahsulotlari'], ['Non oq',          'Non mahsulotlari'],
  ['Coca-Cola 1.5L',    'Ichimliklar'],      ['Suv 1.5L',        'Ichimliklar'],
  ['Pechenye 400g',     'Qandolat'],         ['Shokolad 100g',   'Qandolat'],
  ['Guruch 1kg',        'Bakaleya'],         ['Makaron 450g',    'Bakaleya'],
  ['Yog\' 1L',          'Bakaleya'],
];

const MIJOZLAR = [
  'Baraka baza', 'Quyosh do\'koni', 'Bahor market', 'Anvar do\'koni', 'Nodira do\'koni',
  'Osiyo supermarket', "Do'stlik do'koni", 'Kelajak market', 'Najot do\'koni',
  'Farrux savdo markazi', 'Vatan bozori', 'Tinchlik kafe', 'Marvarid do\'kon',
  'Sadoqat market', 'Oltin bozor optom', 'Yulduz kafe', 'Zumrad savdo',
  'Yagona baza', 'Chorsu do\'kon', 'Istiqlol market', 'Oq tepa savdo',
];

/* Farg'ona vodiysi doirasi */
const koord = () => [40.32 + Math.random() * 0.17, 71.70 + Math.random() * 0.22];
const KUNLAR = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

async function bor(jadval, shart, qiymat) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) c FROM ${jadval} WHERE ${shart}`, { replacements: qiymat });
  return r[0].c > 0;
}

async function bootstrap() {
  const n = { user: 0, territoriya: 0, kategoriya: 0, agent: 0, dostavchi: 0, tovar: 0, mijoz: 0 };

  /* ── 1. FOYDALANUVCHILAR ── */
  for (const u of FOYDALANUVCHILAR) {
    if (await bor('user', 'username = ?', [u.username])) continue;
    const parol = yangiParol();
    const hash = await bcrypt.hash(parol, 10);
    await sequelize.query(
      `INSERT INTO user (id, username, password, fullname, role, createdAt, updatedAt)
       VALUES (?,?,?,?,?,NOW(),NOW())`,
      { replacements: [u.id, u.username, hash, u.fullname, u.role] });
    yaratilganKirishlar.push({ tur: 'web', login: u.username, parol });
    n.user++;
  }

  /* ── 2. TERRITORIYALAR ──
     Katalog jadvallari faqat BO'SH bo'lganda to'ldiriladi. Nom bo'yicha
     tekshirsak, mavjud bazada boshqa nomlar bo'lsa (masalan "Markaziy
     hudud") ustiga yana uchtasi qo'shilib dublikat hosil bo'lardi. */
  const [tBor] = await sequelize.query('SELECT COUNT(*) c FROM territoriya');
  if (tBor[0].c === 0) {
    for (const t of TERRITORIYALAR) {
      await sequelize.query(
        'INSERT INTO territoriya (nomi, createdAt, updatedAt) VALUES (?,NOW(),NOW())',
        { replacements: [t] });
      n.territoriya++;
    }
  }
  const [terr] = await sequelize.query('SELECT id FROM territoriya');

  /* ── 3. MIJOZ KATEGORIYALARI ── */
  const [kBor] = await sequelize.query('SELECT COUNT(*) c FROM mijoz_kategoriya');
  if (kBor[0].c === 0) {
    for (const k of KATEGORIYALAR) {
      await sequelize.query(
        'INSERT INTO mijoz_kategoriya (nomi, createdAt, updatedAt) VALUES (?,NOW(),NOW())',
        { replacements: [k] });
      n.kategoriya++;
    }
  }
  const [kats] = await sequelize.query('SELECT id FROM mijoz_kategoriya');

  /* ── 4. AGENTLAR ── */
  for (let i = 0; i < AGENTLAR.length; i++) {
    const a = AGENTLAR[i];
    if (await bor('agent', 'fullname = ?', [a.fullname])) continue;
    const parol = yangiParol();
    const hash = await bcrypt.hash(parol, 10);
    yaratilganKirishlar.push({ tur: 'agent (mobil)', login: a.login, parol });
    await sequelize.query(
      `INSERT INTO agent (fullname, telefon, login, parol, territoriya_id, plan_summa,
                          bonus_foiz, faol, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,1,NOW(),NOW())`,
      { replacements: [a.fullname, a.telefon, a.login, hash,
                       terr[i % terr.length]?.id ?? null, a.plan, 2] });
    n.agent++;
  }
  const [agentlar] = await sequelize.query('SELECT id FROM agent WHERE faol = 1');

  /* ── 5. DOSTAVCHILAR ── */
  for (const d of DOSTAVCHILAR) {
    if (await bor('dostavchi', 'ism = ?', [d.ism])) continue;
    const parol = yangiParol();
    const hash = await bcrypt.hash(parol, 10);
    yaratilganKirishlar.push({ tur: 'dostavchi (mobil)', login: d.login, parol });
    await sequelize.query(
      `INSERT INTO dostavchi (ism, telefon, transport, mashina_raqam, login, parol,
                              faol, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,1,NOW(),NOW())`,
      { replacements: [d.ism, d.telefon, d.transport, d.raqam, d.login, hash] });
    n.dostavchi++;
  }

  /* ── 6. TOVARLAR ── */
  for (const [nomi, turkum] of TOVARLAR) {
    if (await bor('tovar', 'nomi = ? AND deletedAt IS NULL', [nomi])) continue;
    await sequelize.query(
      `INSERT INTO tovar (nomi, turkum, olchov_birligi, blokdagi_soni, qutidagi_bloklar,
                          faol, createdAt, updatedAt)
       VALUES (?,?,'dona',?,?,1,NOW(),NOW())`,
      { replacements: [nomi, turkum, rnd(6, 24), rnd(4, 12)] });
    n.tovar++;
  }

  /* ── 7. MIJOZLAR ── */
  for (let i = 0; i < MIJOZLAR.length; i++) {
    const nomi = MIJOZLAR[i];
    if (await bor('mijoz', 'nomi = ? AND deletedAt IS NULL', [nomi])) continue;
    const [lat, lng] = koord();
    const kunlari = [...KUNLAR].sort(() => Math.random() - 0.5).slice(0, rnd(2, 3)).join(', ');
    await sequelize.query(
      `INSERT INTO mijoz (nomi, telefon, manzil, lat, lng, agent_id, territoriya_id,
                          kategoriya_id, sinf, narx_turi, balans, kredit_limit,
                          tolov_muddati_kun, tashrif_kunlari, faol, createdAt, updatedAt)
       VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,1,NOW(),NOW())`,
      { replacements: [
          nomi, '+9989' + rnd(10000000, 99999999), `Farg'ona vodiysi, ${rnd(1, 120)}-uy`,
          lat, lng,
          agentlar[i % agentlar.length]?.id ?? null,
          terr[i % terr.length]?.id ?? null,
          kats[i % kats.length]?.id ?? null,
          ['A', 'B', 'C', 'D'][i % 4],
          i % 3 === 0 ? 'optom' : 'chakana',
          rnd(5, 40) * 1000000, [14, 21, 30][i % 3], kunlari,
        ] });
    n.mijoz++;
  }

  return n;
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('');
    console.log('  Bazaga ulanildi. Boshlang\'ich ma\'lumot tekshirilmoqda...');
    console.log('');

    const n = await bootstrap();

    const [chk] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM user)             u,
        (SELECT COUNT(*) FROM territoriya)      t,
        (SELECT COUNT(*) FROM mijoz_kategoriya) k,
        (SELECT COUNT(*) FROM agent)            a,
        (SELECT COUNT(*) FROM dostavchi)        d,
        (SELECT COUNT(*) FROM tovar WHERE deletedAt IS NULL) tv,
        (SELECT COUNT(*) FROM mijoz WHERE deletedAt IS NULL) m`);
    const c = chk[0];

    const q = (yangi, jami) => `${String(yangi).padStart(3)} yangi  (jami ${jami})`;
    console.log(`  Foydalanuvchi : ${q(n.user, c.u)}`);
    console.log(`  Territoriya   : ${q(n.territoriya, c.t)}`);
    console.log(`  Kategoriya    : ${q(n.kategoriya, c.k)}`);
    console.log(`  Agent         : ${q(n.agent, c.a)}`);
    console.log(`  Dostavchi     : ${q(n.dostavchi, c.d)}`);
    console.log(`  Tovar         : ${q(n.tovar, c.tv)}`);
    console.log(`  Mijoz         : ${q(n.mijoz, c.m)}`);
    console.log('');
    if (yaratilganKirishlar.length) {
      // Parollar faqat SHU YERDA bir marta ko'rsatiladi — bazada faqat hash saqlanadi
      console.log('  ── Yangi yaratilgan kirish ma\'lumotlari (saqlab qo\'ying, qayta ko\'rsatilmaydi) ──');
      for (const k of yaratilganKirishlar) console.log(`    ${k.tur.padEnd(18)}: ${k.login} / ${k.parol}`);
    } else {
      console.log('  Yangi foydalanuvchi yaratilmadi — mavjud parollar o\'zgarmadi.');
    }
    console.log('');
    console.log('  Keyingi qadam: npm run demo:all  (savdo, to\'lov, tashrif ma\'lumoti)');
    console.log('');
    process.exit(0);
  } catch (e) {
    console.error('  XATO:', e.message);
    process.exit(1);
  }
})();
