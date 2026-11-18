/**
 * ═══════════════════════════════════════════════════════════════════
 *  PREZENTATSIYA SEED — barcha jarayonlarni HOZIRGI daqiqagacha to'ldiradi
 * ═══════════════════════════════════════════════════════════════════
 *
 * Bazadagi demo ma'lumot 20-avgustda tugagan. Bu skript 21-avgustdan
 * hozirgacha distribyutorlikning har bir ish kunini simulyatsiya qiladi.
 * Har bir yozuv dasturning o'zi yozadigan yon-effektlar bilan yaratiladi
 * (ariza.controller, prixod.controller, mobile/savdo, arizaYetkazildi.utils):
 *
 *   Ombor      — yetkazuvchilardan jadval bo'yicha prixod, partiya va yaroqlilik
 *                muddati, yetkazuvchi qarzi/to'lovi, bugun 1 ta qoralama prixod
 *   Agentlar   — marshrut rejasi, tashrif (check-in/out, GPS trek), sotmaslik,
 *                audit, mijozdan qarz undirish (mobil to'lov → inkassatsiya)
 *   Sotuv      — ariza: yangi → tasdiqlangan → yig'ilmoqda → yo'lda → yetkazildi
 *                (+ bekor), ombor chiqimi, naqd → kassa, qarz → mijoz balansi,
 *                agent plan-fakt va bonus (agent_register)
 *   Dostavka   — trip sheet, dostavchi GPS, yetkazishda qisman qaytarish/brak
 *   Qaytarish  — agent qaytargan tovar → "Agent: ..." ombori → skladchi qabuli
 *   Moliya     — mijoz to'lovlari (naqd/bank), ijara, ish haqi, bonus, xarajatlar
 *
 * Har bir bosqich vaqti hisoblanadi va HOZIRGI vaqtdan keyingilari
 * qo'llanmaydi — shuning uchun bugungi buyurtmalar tabiiy ravishda turli
 * holatlarda turadi (yangi, yig'ilmoqda, yo'lda...), xuddi jonli tizimdagidek.
 * Taqdimotdan oldin qayta ishga tushirilsa, "bugun" hozirgi vaqtga yangilanadi
 * (tarix urug'li tasodif bilan qurilgani uchun o'zgarmaydi).
 *
 * Ishga tushirish:   npm run demo:prezentatsiya
 * Sinov (yozmaydi):  npm run demo:prezentatsiya -- --sinov
 * Tozalash:          npm run demo:prezentatsiya -- --tozala
 *
 * XAVFSIZLIK: yaratilgan har bir yozuv demo_prez_log ga yoziladi; o'zgartirilgan
 * mavjud qiymatlar (mijoz/yetkazuvchi balansi, iyuldan qolib ketgan arizalar
 * holati) demo_prez_balans / demo_prez_ariza ga saqlanadi. --tozala hammasini
 * aniq asl holiga qaytaradi.
 *
 * DIQQAT: seed-agent-nazorat.js 1-avgustdan keyingi BARCHA tashrif/reja/GPS ni
 * o'chiradi — u ishga tushirilsa, bu skriptni qayta ishga tushiring.
 */

require('dotenv').config();
const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

// Mavjud demo ma'lumot tugagan kundan keyingi kun. Bazada boshqa davr bo'lsa DEMO_BOSHLANISH bilan
// beriladi (masalan 185.76.14.214 da demo:all 17-oktabrgacha — savdo ikki marta sanalmasin)
const BOSHLANISH = process.env.DEMO_BOSHLANISH || '2026-08-21';
const TZ         = 5;                          // Toshkent (UTC+5) — baza UTC saqlaydi
const ASOSIY     = 'Основной склад';            // utils/ombor.utils.js bilan bir xil
const BRAK       = 'Brak ombori';               // mobile/delivery.controller.js bilan bir xil
const AGENT_PREF = 'Agent: ';
const KURS       = 12000;
const ADMIN_ID   = 1;
const OMBOR      = { lat: 40.3864, lng: 71.7864 };   // Farg'ona — asosiy ombor
const SINOV      = process.argv.includes('--sinov');
const HOZIR      = new Date();

/* Agentlar reja bajarilishi (id tartibida) — reytingda turlicha ko'rinsin */
const BAJARISH    = [1.15, 1.02, 0.94, 0.83];
/* k = 1 bo'lgan agentning taxminiy oylik savdosi — kalibrlash uchun */
const BAZA_OYLIK  = 48e6;
const SINF_K      = { A: 1.5, B: 1.15, C: 0.9, D: 0.7 };

const LOG_JADVALLAR = [
  // O'chirish tartibi: avval bog'liq (bola) yozuvlar
  'agent_location', 'audit_natija', 'sotmaslik', 'tashrif', 'marshrut_reja',
  'inkassatsiya', 'agent_register', 'yetkazish_qaytarish', 'kassa',
  'yetkazuvchi_harakatlar', 'tovar_register', 'ariza_qator', 'ariza', 'trip_sheet',
  'prixod_qator', 'prixod', 'mijoz', 'yetkazuvchi',
];

/* ── Urug'li tasodif — tarix har safar bir xil chiqadi ─────────── */
const URUG = 20260821;
let urug = URUG;
function rand() {
  urug = (urug + 0x6D2B79F5) | 0;
  let t = Math.imul(urug ^ (urug >>> 15), 1 | urug);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rnd     = (a, b) => a + Math.floor(rand() * (b - a + 1));
const chance  = (p) => rand() < p;
const pick    = (arr) => arr[Math.floor(rand() * arr.length)];
const aralash = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};
function vaznli(items, vazn) {
  const jami = items.reduce((s, x) => s + vazn(x), 0);
  let r = rand() * jami;
  for (const x of items) { r -= vazn(x); if (r <= 0) return x; }
  return items[items.length - 1];
}
const yaxlit = (n, q = 100) => Math.round(n / q) * q;
const pad    = (n, k) => String(n).padStart(k, '0');
const mln    = (n) => (n / 1e6).toFixed(1);

/* ── Vaqt: biznes Toshkent vaqtida, baza UTC da ──────────────────── */
const vaqt        = (kun, soat, daq = 0) =>
  new Date(Date.UTC(+kun.slice(0, 4), +kun.slice(5, 7) - 1, +kun.slice(8, 10), soat - TZ, daq));
const dbVaqt      = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const qosh        = (d, daq) => new Date(d.getTime() + daq * 60000);
const mahalliyKun = (d) => new Date(d.getTime() + TZ * 3600000).toISOString().slice(0, 10);
const soatMin     = (d) => new Date(d.getTime() + TZ * 3600000).toISOString().slice(11, 16);
const kunQosh     = (kun, n) => {
  const d = new Date(kun + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const haftaKuni      = (kun) => new Date(kun + 'T00:00:00Z').getUTCDay();   // 0 = yakshanba
const keyingiIshKuni = (kun, n = 1) => {
  let k = kun;
  for (let i = 0; i < n; i++) { k = kunQosh(k, 1); if (haftaKuni(k) === 0) k = kunQosh(k, 1); }
  return k;
};
const BUGUN    = mahalliyKun(HOZIR);
const KUN_KODI = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
const OY_NOMI  = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul',
                  'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr'];
const oyNomi   = (kun) => OY_NOMI[+kun.slice(5, 7) - 1];

/* ── Geografiya ───────────────────────────────────────────────── */
function masofaM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Nuqtani tasodifiy yo'nalishda `metr` ga siljitadi — GPS xatoligi */
function siljit(p, metr) {
  const b = rand() * 2 * Math.PI;
  return {
    lat: +(p.lat + (metr / 111320) * Math.cos(b)).toFixed(7),
    lng: +(p.lng + (metr / (111320 * Math.cos(p.lat * Math.PI / 180))) * Math.sin(b)).toFixed(7),
  };
}
const oraliq = (a, b, k) => ({ lat: a.lat + (b.lat - a.lat) * k, lng: a.lng + (b.lng - a.lng) * k });
/* Shahar ichida ~20 km/soat + to'xtash */
const yolDaq = (a, b) => Math.round(masofaM(a, b) / 1000 * 3) + rnd(4, 9);
function yaqinTartib(list, start) {
  const qolgan = [...list], natija = [];
  let pos = start;
  while (qolgan.length) {
    let bi = 0, bd = Infinity;
    qolgan.forEach((x, i) => { const d = masofaM(pos, x); if (d < bd) { bd = d; bi = i; } });
    pos = qolgan[bi];
    natija.push(qolgan.splice(bi, 1)[0]);
  }
  return natija;
}

/* ── Spravochniklar ───────────────────────────────────────────── */
/* Kirim narxi tarixi yo'q tovarlar uchun bozor narxi (so'm). Tarixi bor
   tovarlar o'sha tarixdagi o'rtacha narxda keladi — dashboard yalpi foydani
   tovarning BARCHA kirimlari o'rtacha narxidan hisoblaydi, narx keskin
   o'zgarsa foyda manfiy chiqadi. */
const NARX = {
  'Coca-Cola 1.5L': 11000, 'Fanta 1.5L': 10500, 'Suv 1.5L': 3000, 'Coca-Cola 0.5L': 6000,
  'Fanta 1L': 8500, 'Sprite 1.5L': 10500, 'Pepsi 0.5L': 5500, 'Nestea limon 1L': 9000,
  'Suv gazsiz 5L': 8000, 'Suv gazli 1L': 3500, 'Energetik ichimlik 0.45L': 11000,
  'Ayron 0.5L': 6000, 'Tabiiy sok olma 1L': 14000,
  'Sut 1L': 11000, 'Yogurt 500ml': 12000, 'Tvorog 250g': 16000, 'Sut 2.5% 1L': 11500,
  'Kefir 1L': 12000, 'Qatiq 0.5L': 6500, 'Smetana 20% 400g': 17000, 'Tvorog 5% 200g': 13000,
  "Sariyog' 180g": 24000, 'Pishloq Rossiyskiy 200g': 28000, 'Yogurt mevali 290g': 8500,
  'Yogurt 290g': 8000,
  'Non': 3500, 'Non oq': 3800, 'Pechenye 400g': 14000, 'Shokolad 100g': 12000,
  'Batonchik shokoladli': 7000, 'Pechenye yubileynoe 300g': 13000, 'Vafli 250g': 10000,
  'Tort medovik 700g': 55000, 'Keks vanilli 400g': 18000, 'Konfet assorti 500g': 38000,
  'Makaron 500g': 8500, 'Guruch lazer 1kg': 22000, 'Makaron spagetti 450g': 9500,
  'Un oliy nav 2kg': 16000, 'Shakar 1kg': 13500, 'Tuz yodlangan 1kg': 3000,
  "Yog' kungaboqar 1L": 21000, 'Grechka 900g': 17000, 'Yasmiq 800g': 19000,
  'Guruch 1kg': 18000, 'Makaron 450g': 8000, "Yog' 1L": 20000,
  'Tushonka mol 325g': 32000, 'Baliq konservasi 240g': 16000, "No'xat konserva 400g": 11000,
  "Makkajo'xori 340g": 13000, 'Tomat pastasi 500g': 15000,
  'Shampun 400ml': 32000, 'Sovun 90g': 5000, 'Tish pastasi 100ml': 14000,
  'Kir yuvish kukuni 3kg': 58000, 'Idish yuvish suyuqligi 500ml': 12000, 'Salfetka 100 dona': 6000,
};
const TURKUM_VAZN = {
  'Ichimliklar': 1.4, 'Sut mahsulotlari': 1.3, 'Non mahsulotlari': 1.2, 'Non va shirinlik': 1.0,
  'Qandolat': 0.9, 'Bakaleya': 1.0, 'Boshqa oziq-ovqat': 0.8, 'Konserva': 0.7, 'Gigiyena': 0.6,
};
/* Yaroqlilik muddati (kun) — sut va non qisqa: "muddati yaqin" ogohlantirishi shulardan */
const MUDDAT = {
  'Sut mahsulotlari': [14, 25], 'Non mahsulotlari': [4, 7], 'Ichimliklar': [180, 365],
  'Non va shirinlik': [60, 180], 'Qandolat': [120, 270], 'Bakaleya': [270, 540],
  'Boshqa oziq-ovqat': [270, 540], 'Konserva': [540, 900], 'Gigiyena': [720, 1095],
};
/* Yetkazuvchilar jadvali: hafta kunlari (1 = dushanba) va kelish soati */
const YETKAZUVCHI_REJA = [
  { ism: 'Mahalliy Sut Kombinati', turkumlar: ['Sut mahsulotlari', 'Non mahsulotlari'], kunlar: [1, 3, 5], soat: [7, 8] },
  { ism: 'Coca-Cola Ichimliklari', turkumlar: ['Ichimliklar'], kunlar: [2, 5], soat: [9, 11] },
  { ism: 'Nestle Uzbekiston', turkumlar: ['Non va shirinlik', 'Qandolat'], kunlar: [3], soat: [10, 12] },
  { ism: 'Baraka Savdo', turkumlar: ['Bakaleya', 'Konserva', 'Boshqa oziq-ovqat'], kunlar: [4], soat: [10, 13],
    yangi: { telefon: '+998732441520', manzil: "Farg'ona sh., Qo'qon yo'li 14", izoh: 'Bakaleya va konserva' } },
  { ism: 'Global Distribution', turkumlar: ['Gigiyena'], kunlar: [6], soat: [10, 12],
    yangi: { telefon: '+998712305577', manzil: "Toshkent sh., Chilonzor tumani", izoh: 'Gigiyena mahsulotlari' } },
];
const SABABLAR = [
  { id: 1, nomi: "Pul yo'q" }, { id: 2, nomi: 'Zaxira yetarli' }, { id: 3, nomi: 'Mijoz yopiq' },
  { id: 4, nomi: 'Narx qimmat' }, { id: 5, nomi: 'Keyinroq keling' },
];
const YANGI_MIJOZLAR = [
  'Sardor market', "Gulnora do'koni", 'Madina minimarket', 'Bobur savdo', 'Iroda oziq-ovqat',
  'Shahzod market', "Kamola do'kon", 'Jasur baza', 'Lola minimarket', "Ulug'bek savdo",
  "Nilufar do'koni", 'Akmal market', 'Durdona oziq-ovqat', 'Temur savdo uyi',
];
const KOCHALAR = [
  "Mustaqillik ko'chasi", "Al-Farg'oniy ko'chasi", "Navoiy ko'chasi", "Marg'ilon ko'chasi",
  "Ahmad Yassaviy ko'chasi", "Burhoniddin Marg'inoniy ko'chasi", 'Kirguli mavzesi', "Yangi Chek mahallasi",
];

/* ═══════════════════════════════════════════════════════════════
 *  TOZALASH
 * ═══════════════════════════════════════════════════════════════ */
async function jadvalBormi(nom) {
  const [r] = await sequelize.query(
    `SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`,
    { replacements: [nom] });
  return r[0].c > 0;
}

async function tozala() {
  if (!(await jadvalBormi('demo_prez_log'))) return false;
  const t = await sequelize.transaction();
  try {
    // 1. O'zgartirilgan mavjud qiymatlarni qaytaramiz
    if (await jadvalBormi('demo_prez_balans')) {
      await sequelize.query(`UPDATE mijoz m JOIN demo_prez_balans z ON z.jadval = 'mijoz' AND z.row_id = m.id
                             SET m.balans = z.balans`, { transaction: t });
      await sequelize.query(`UPDATE yetkazuvchi y JOIN demo_prez_balans z ON z.jadval = 'yetkazuvchi' AND z.row_id = y.id
                             SET y.balans = z.balans`, { transaction: t });
    }
    if (await jadvalBormi('demo_prez_ariza')) {
      await sequelize.query(`UPDATE ariza a JOIN demo_prez_ariza z ON z.id = a.id
                             SET a.holat = z.holat, a.yetkazilgan_sana = z.yetkazilgan_sana,
                                 a.bekor_sababi = z.bekor_sababi`, { transaction: t });
    }
    // 2. Yaratilgan yozuvlarni o'chiramiz (bolalardan boshlab)
    for (const j of LOG_JADVALLAR) {
      await sequelize.query(
        `DELETE FROM \`${j}\` WHERE id IN (SELECT row_id FROM demo_prez_log WHERE jadval = ?)`,
        { replacements: [j], transaction: t });
    }
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }
  await sequelize.query('DROP TABLE IF EXISTS demo_prez_log, demo_prez_balans, demo_prez_ariza');
  return true;
}

/* ═══════════════════════════════════════════════════════════════
 *  MA'LUMOTNI YUKLASH
 * ═══════════════════════════════════════════════════════════════ */
async function yuklash() {
  const q = async (sql, r) => (await sequelize.query(sql, { replacements: r }))[0];
  return {
    agentlar: await q(`SELECT id, fullname, plan_summa, bonus_foiz FROM agent
                       WHERE faol = 1 AND deletedAt IS NULL ORDER BY id`),
    mijozlar: await q(`SELECT id, nomi, agent_id, territoriya_id, kategoriya_id, sinf, narx_turi,
                              kredit_limit, tolov_muddati_kun, tashrif_kunlari, lat, lng
                       FROM mijoz WHERE deletedAt IS NULL AND faol = 1
                         AND lat IS NOT NULL AND agent_id IS NOT NULL ORDER BY id`),
    tovarlar: await q(`SELECT id, nomi, turkum, blokdagi_soni, qutidagi_bloklar FROM tovar
                       WHERE deletedAt IS NULL AND faol = 1 AND nomi NOT LIKE 'Test%' ORDER BY id`),
    qoldiq:   await q(`SELECT tovar_id, SUM(donada) q FROM tovar_register WHERE ombor = ? GROUP BY tovar_id`, [ASOSIY]),
    kirimNarx: await q(`SELECT tovar_id, AVG(kirim_narx) n FROM tovar_register
                        WHERE tur = 'kirim' AND kirim_narx > 0 GROUP BY tovar_id`),
    yetkazuvchilar: await q(`SELECT y.id, y.ism,
                               COALESCE(SUM(CASE WHEN h.tur = 'qarz' THEN h.summa ELSE -h.summa END), 0) qarz
                             FROM yetkazuvchi y LEFT JOIN yetkazuvchi_harakatlar h ON h.yetkazuvchi_id = y.id
                             GROUP BY y.id, y.ism`),
    dostavchilar: await q(`SELECT id, ism FROM dostavchi WHERE faol = 1 AND ism NOT LIKE '%(agent)%' ORDER BY id`),
    // Mijoz oldi-berdi: yetkazilgan savdo − to'lovlar (mijoz.controller oldiBerdi bilan bir xil)
    ledger:   await q(`SELECT m.id, COALESCE(o.s, 0) - COALESCE(b.s, 0) qarz FROM mijoz m
                       LEFT JOIN (SELECT mijoz_id, SUM(jami_summa) s FROM ariza WHERE deletedAt IS NULL
                                    AND turi = 'sotish' AND holat = 'yetkazildi' GROUP BY mijoz_id) o ON o.mijoz_id = m.id
                       LEFT JOIN (SELECT mijoz_id, SUM(summa) s FROM kassa WHERE tur = 'kirim'
                                    AND mijoz_id IS NOT NULL GROUP BY mijoz_id) b ON b.mijoz_id = m.id`),
    // Iyuldan "yo'lda" qolib ketgan va hech qachon tasdiqlanmagan arizalar
    eskiYolda: await q(`SELECT id, raqam, mijoz_id, mijoz_nomi, agent_id, jami_summa, tolov_turi,
                               jonatish_sana, createdAt
                        FROM ariza WHERE deletedAt IS NULL AND turi = 'sotish' AND holat = 'yolda'
                          AND createdAt < ?`, [BOSHLANISH]),
    eskiOchiq: await q(`SELECT id FROM ariza WHERE deletedAt IS NULL AND turi = 'sotish'
                          AND holat IN ('yangi','tasdiqlangan','yigilmoqda') AND createdAt < ?`, [BOSHLANISH]),
    // utils/arizaRaqam.utils.js: AR-YYYY-NNNN, yil boshidan (o'chirilganlar ham) sanaladi
    arizaSoni: (await q(`SELECT COUNT(*) n FROM ariza WHERE createdAt >= '2026-01-01'`))[0].n,
    prixodMax: (await q(`SELECT COALESCE(MAX(CAST(SUBSTRING(hujjat_raqam, 5) AS UNSIGNED)), 1000) n
                         FROM prixod WHERE hujjat_raqam REGEXP '^PRX-[0-9]+$'`))[0].n,
    kassaBalans: await q(`SELECT tolov_usul, SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END) b
                          FROM kassa GROUP BY tolov_usul`),
  };
}

/* ═══════════════════════════════════════════════════════════════
 *  SIMULYATSIYA
 * ═══════════════════════════════════════════════════════════════ */
function simulyatsiya(D, tuzatish = null) {
  urug = URUG;                                     // har o'tish bir xil tasodif bilan
  const R = {
    yetk: [], mijoz: [], prixod: [], prixodQator: [], register: [], harakat: [], kassa: [],
    trip: [], ariza: [], arizaQator: [], reja: [], tashrif: [], sotmaslik: [], audit: [], gps: [],
    agentReg: [], qaytarish: [], inkas: [], eskiYopish: [],
  };

  /* ── Tovarlar: narx, ommaboplik, zaxira me'yori ── */
  const stok = {};
  D.qoldiq.forEach(r => { stok[r.tovar_id] = Math.max(0, Math.floor(+r.q)); });
  const tarixNarx = new Map(D.kirimNarx.map(r => [r.tovar_id, yaxlit(+r.n)]));
  const tovarlar = D.tovarlar.map(t => {
    const kirim = tarixNarx.get(t.id) || NARX[t.nomi] || 12000;
    const ommabop = /Coca|Suv |Non|Sut /.test(t.nomi + ' ') ? 1.5 : 1;
    return {
      ...t, bs: Math.max(1, +t.blokdagi_soni || 1), qb: Math.max(1, +t.qutidagi_bloklar || 1),
      kirim, optom: yaxlit(kirim * 1.18), chakana: yaxlit(kirim * 1.28),
      vazn: (TURKUM_VAZN[t.turkum] || 0.8) * (0.6 + rand() * 0.9) * ommabop,
    };
  });
  tovarlar.forEach(t => { if (stok[t.id] === undefined) stok[t.id] = 0; });

  // "Kam qoldiq" ogohlantirishi uchun: 3 ta ommabop tovar qayta to'ldirilmaydi
  const kamlar = tovarlar.filter(t => stok[t.id] >= 30).sort((a, b) => stok[a.id] - stok[b.id]).slice(0, 3);
  kamlar.forEach(t => { t.kam = true; t.pol = rnd(4, 15); t.vazn *= 2.2; });

  const vaznJami = tovarlar.reduce((s, t) => s + t.vazn, 0);
  tovarlar.forEach(t => {
    const kunlik = 420 * t.vazn / vaznJami;             // taxminiy kunlik sotuv (dona)
    t.minStok = Math.max(t.bs * 3, Math.round(kunlik * 8));
    t.maxStok = Math.max(t.bs * 6, Math.round(kunlik * 21));
  });
  const sotsaBoladi = (t) => Math.max(0, stok[t.id] - (t.kam ? t.pol : 0));

  /* ── Yetkazuvchilar ── */
  const yetkazuvchilar = YETKAZUVCHI_REJA.map(r => {
    const bor = D.yetkazuvchilar.find(y => y.ism === r.ism);
    // Eski qarz (iyul-avgust prixodlari) haftama-hafta bo'lib to'lanadi — bir
    // martada to'lansa, naqd kassa minusga tushadi
    const y = { ...r, id: bor ? bor.id : undefined, eskiQarz: bor ? Math.max(0, +bor.qarz) : 0, navbat: [] };
    if (!bor) R.yetk.push(y);
    y.tovarlar = tovarlar.filter(t => r.turkumlar.includes(t.turkum));
    return y;
  });

  /* ── Mijozlar ── */
  const ledger = new Map(D.ledger.map(r => [r.id, +r.qarz]));
  function mijozTayyorla(m, faolKun) {
    const kunlar = m.tashrif_kunlari
      ? m.tashrif_kunlari.split(',').map(s => s.trim()).filter(Boolean)
      : aralash(KUN_KODI.slice(1)).slice(0, rnd(2, 3));
    const assort = [];
    const nomzod = [...tovarlar];
    for (let i = 0, n = rnd(10, 18); i < n && nomzod.length; i++) {
      const t = vaznli(nomzod, x => x.vazn);
      assort.push(t); nomzod.splice(nomzod.indexOf(t), 1);
    }
    const qarz = ledger.get(m.id) || 0;
    return Object.assign(m, {
      lat: +m.lat, lng: +m.lng, kunlar, assort, faolKun,
      naqtUlush: 0.25 + rand() * 0.45,
      toloqchi: chance(0.27) ? 'orta' : 'yaxshi',
      qarz, navbat: qarz > 0 ? [{ summa: qarz, sana: '2026-08-01' }] : [],
    });
  }
  const mijozlar = D.mijozlar.map(m => mijozTayyorla(m, '0000-00-00'));
  // To'lamaydigan 4 ta mijoz — "Top qarzdorlar" va muddati o'tgan qarz uchun
  aralash(mijozlar.filter(m => ['C', 'D', 'B'].includes(m.sinf))).slice(0, 4)
    .forEach(m => { m.toloqchi = 'yomon'; m.naqtUlush = 0.1; });
  const mijozMap = new Map(mijozlar.map(m => [m.id, m]));

  const agentlar = D.agentlar.map((a, i) => ({
    ...a,
    k: (+a.plan_summa || 35e6) * (BAJARISH[i] ?? 0.9) / BAZA_OYLIK * (tuzatish ? tuzatish[i] : 1),
    mijozlar: mijozlar.filter(m => m.agent_id === a.id),
    bonusFoiz: +a.bonus_foiz || 0,
  }));
  agentlar.forEach(a => { a.start = a.mijozlar[0] || OMBOR; });
  const agentMap = new Map(agentlar.map(a => [a.id, a]));
  const dostavchilar = D.dostavchilar;
  const dostavchiFor = (m) => dostavchilar[((m.territoriya_id || 1) - 1) % dostavchilar.length];

  /* ── Yordamchi yozuvchilar ── */
  const reg = (o) => R.register.push({
    bloklarda: 0, qutilarda: 0, hajm: 0, kirim_narx: 0, kirim_narx_usd: 0, sotuv_narx: 0, sotuv_narx_usd: 0,
    optom_narx: 0, optom_narx_usd: 0, chakana_narx: 0, chakana_narx_usd: 0, ...o,
    createdAt: o.sana, updatedAt: o.sana,
  });
  /* G'aznachilik: yetkazuvchiga naqd kassada 40 mln dan ortig'i bilan to'lanadi.
     Joriy oyda esa to'lov faqat oy boshidan beri sof kassa oqimi tushumning
     kamida 12% ida qoladigan bo'lsa qilinadi (yaqin ish haqi to'lovi
     ham hisobga olinadi) — dashboarddagi oylik kassa oqimi tasodifga qarab
     manfiyga tushmaydi, qolgani yetkazuvchi krediti bo'lib turadi. */
  const SHTAT = [
    { guruh: 'agentlar', soni: agentlar.length, oylik: 2500000 },
    { guruh: 'dostavchilar', soni: dostavchilar.length, oylik: 3000000 },
    { guruh: 'ombor va ofis xodimlari', soni: 2, oylik: 3500000 },
  ];
  const oylikFond = SHTAT.reduce((s, x) => s + x.soni * x.oylik, 0);
  let naqdQoldiq = D.kassaBalans.filter(r => r.tolov_usul === 'naqt').reduce((s, r) => s + +r.b, 0);
  const oyOqim = {};                                  // 'YYYY-MM' → { kirim, sof }
  const tolasaBoladi = (kun, kerak) => {
    const o = oyOqim[kun.slice(0, 7)] || { kirim: 0, sof: 0 };
    const sana = +kun.slice(8, 10);
    // Yaqinlashib kelayotgan ish haqi to'lovi uchun pul ajratib qo'yiladi
    const kutilayotgan = sana < 15 ? oylikFond * 0.6 + 4e6 : sana < 28 ? oylikFond * 0.4 : 0;
    let imkon = naqdQoldiq - 40e6;
    if (kun.slice(0, 7) === BUGUN.slice(0, 7)) imkon = Math.min(imkon, o.sof - 0.12 * o.kirim - kutilayotgan);
    return Math.max(0, Math.min(kerak, Math.floor(imkon / 1000) * 1000));
  };
  const kassa = (o) => {
    if (o.tolov_usul === 'naqt') naqdQoldiq += o.tur === 'kirim' ? o.summa : -o.summa;
    const oy = mahalliyKun(o.sana).slice(0, 7);
    const x = (oyOqim[oy] ||= { kirim: 0, sof: 0 });
    if (o.tur === 'kirim') { x.kirim += o.summa; x.sof += o.summa; } else x.sof -= o.summa;
    R.kassa.push({
      manba_tur: null, manba_id: null, mijoz_id: null, mijoz_nomi: null, izoh: null, user_id: null,
      chek_rasm: null, ...o, createdAt: o.sana, updatedAt: o.sana,
    });
  };
  const gps = (id, rol, p, d, bat) => {
    if (d > HOZIR) return;
    R.gps.push({ agent_id: id, rol, lat: p.lat, lng: p.lng, battery: Math.max(12, Math.round(bat)),
                 sana: d, createdAt: d, updatedAt: d });
  };
  const qarzQosh = (m, summa, kun) => { m.qarz += summa; m.navbat.push({ summa, sana: kun }); };
  const muddatliQarz = (m, kun) => {
    const chegara = kunQosh(kun, -5);
    const yangi = m.navbat.filter(x => x.sana > chegara).reduce((s, x) => s + x.summa, 0);
    return Math.max(0, m.qarz - yangi);
  };
  const tolovYoz = (m, summa) => {
    m.qarz -= summa;
    let q = summa;
    while (q > 0 && m.navbat.length) {
      const x = m.navbat[0];
      if (x.summa <= q) { q -= x.summa; m.navbat.shift(); } else { x.summa -= q; q = 0; }
    }
  };
  const mijozNarx = (m, t) => (m.narx_turi === 'optom' ? t.optom : t.chakana);
  const oyK = (kun) => (kun < '2026-09-01' ? 0.93 : kun < '2026-10-01' ? 1.0 : 1.07);
  const agentNaqd = {};   // `${kun}|${agent_id}` → agent yig'gan naqd (inkassatsiya)
  const bonusOy   = {};   // `${YYYY-MM}|${agent_id}` → bonus

  /* ── 0. Iyuldan qolib ketgan arizalarni yopamiz ── */
  // "Yo'lda" holatida 2 oydan beri turgani dostavchilar sahifasini buzadi —
  // ular yetkazilgan deb yopiladi (yon-effektlari bilan), tasdiqlanmaganlari bekor.
  for (const a of D.eskiYolda) {
    const js = a.jonatish_sana instanceof Date ? a.jonatish_sana.toISOString() : a.jonatish_sana;
    const kun = js ? String(js).slice(0, 10) : kunQosh(mahalliyKun(new Date(a.createdAt)), 1);
    const sana = vaqt(kun, 14, rnd(0, 59));
    const summa = +a.jami_summa || 0;
    R.eskiYopish.push({ id: a.id, holat: 'yetkazildi', yetkazilgan_sana: sana, bekor_sababi: null });
    if (a.tolov_turi === 'naqt' || a.tolov_turi === 'naqd') {
      kassa({ tur: 'kirim', kategoriya: 'sotuv', summa, tolov_usul: 'naqt', manba_tur: 'ariza', manba_id: a.id,
              mijoz_id: a.mijoz_id, mijoz_nomi: a.mijoz_nomi, izoh: `${a.raqam} — naqd sotuv`, sana });
    } else if (mijozMap.has(a.mijoz_id)) {
      qarzQosh(mijozMap.get(a.mijoz_id), summa, '2026-08-01');
    }
    const ag = agentMap.get(a.agent_id);
    if (ag) {
      R.agentReg.push({ agent_id: ag.id, ariza_id: a.id, tur: 'savdo', summa, bonus_foiz: ag.bonusFoiz,
        bonus_summa: Math.round(summa * ag.bonusFoiz / 100), sana, izoh: `${a.raqam} — ${a.mijoz_nomi || 'mijoz'}`,
        createdAt: sana, updatedAt: sana });
    }
  }
  D.eskiOchiq.forEach(a => R.eskiYopish.push({
    id: a.id, holat: 'bekor', yetkazilgan_sana: null, bekor_sababi: "Muddati o'tgan buyurtma — yopildi",
  }));

  /* ── Ish kunlari ── */
  const kunlar = [];
  for (let k = BOSHLANISH; k <= BUGUN; k = kunQosh(k, 1)) if (haftaKuni(k) !== 0) kunlar.push(k);

  // Yangi mijozlar: davr bo'ylab ~haftasiga 1-2 ta + bugun bitta
  const yangiKunlar = new Map();
  aralash(kunlar.slice(3, -1)).slice(0, YANGI_MIJOZLAR.length - 1).forEach((k, i) => yangiKunlar.set(k, i));
  yangiKunlar.set(BUGUN, YANGI_MIJOZLAR.length - 1);

  // Agent nazorati anomaliyalari — oxirgi ish kunlarida, sahifada darrov ko'rinsin
  const anomaliya = new Map();
  ['uzoq', 'qisqa', 'ochiq', 'uzun'].forEach((tur, i) => {
    const kun = kunlar[kunlar.length - 2 - i];
    if (kun && agentlar[i % agentlar.length]) anomaliya.set(`${kun}|${agentlar[i % agentlar.length].id}`, tur);
  });

  const kutayotgan = {};         // jonatish_sana → arizalar
  const qaytarishlar = [];
  let prixodNo = D.prixodMax;
  const oyBelgi = new Set();

  /* ── Ariza yaratish (agent mobil yoki operator web) ── */
  function arizaYarat({ m, agent, t0, kun, manba }) {
    const qatorSoni = rnd(2, 4) + (m.sinf === 'A' ? 1 : 0);
    const tanlov = aralash(m.assort).slice(0, qatorSoni);
    const qatorlar = [];
    for (const tv of tanlov) {
      const narx = mijozNarx(m, tv);
      const V = rnd(55, 200) * 1000 * (SINF_K[m.sinf] || 1) * agent.k * oyK(kun);
      let dona = Math.max(1, Math.round(V / narx));
      if (tv.bs > 1 && dona >= tv.bs && chance(0.6)) dona = Math.round(dona / tv.bs) * tv.bs;
      dona = Math.min(dona, sotsaBoladi(tv));
      if (dona <= 0) continue;
      stok[tv.id] -= dona;                                  // rezerv
      const blok = tv.bs > 1 ? Math.floor(dona / tv.bs) : 0;
      qatorlar.push({ tv, narx, jami_dona: dona, blok, dona: dona - blok * tv.bs, summa: dona * narx });
    }
    if (!qatorlar.length) return null;
    const summa = qatorlar.reduce((s, q) => s + q.summa, 0);
    const limit = +m.kredit_limit || 0;
    const naqt = chance(m.naqtUlush) || (limit > 0 && m.qarz + summa > limit);

    // Tasdiqlash: operator kun davomida 20 daqiqa – 2.5 soatda ko'radi;
    // kechki buyurtmalar ertasi ertalab tasdiqlanadi
    const tezkor = manba === 'web' && +soatMin(t0).slice(0, 2) < 12 && chance(0.4);
    let t1 = qosh(t0, tezkor ? rnd(10, 30) : rnd(20, 150));
    if (t1 > vaqt(kun, 18, 0)) t1 = vaqt(keyingiIshKuni(kun), 7, rnd(30, 55));

    const a = {
      turi: 'sotish', manba, mijoz: m, agent, qatorlar, jami_summa: summa,
      tolov_turi: naqt ? 'naqt' : 'qarz', ombor: ASOSIY, jonatish_sana: tezkor ? kun : keyingiIshKuni(kun),
      izoh: tezkor ? "Telefon orqali — tezkor, bugun yetkazish" : manba === 'web' ? 'Telefon orqali buyurtma' : null,
      tezkor,
      createdAt: t0, t1, holat: 'yangi',
      bekorTasdiqda: chance(0.025), bekorYolda: false,
    };
    a.bekorYolda = !a.bekorTasdiqda && chance(0.012);
    if (a.bekorTasdiqda) {
      qatorlar.forEach(q => { stok[q.tv.id] += q.jami_dona; });   // rezerv bo'shaydi
      a.bekor_sababi = pick(['Mijoz buyurtmani bekor qildi', 'Dublikat buyurtma', "Narx bo'yicha kelishilmadi"]);
    }
    R.ariza.push(a);
    (kutayotgan[a.jonatish_sana] ||= []).push(a);
    return a;
  }

  /* ── Agent qaytarishi (mobile saveVozvrat) ── */
  function qaytarishYarat(agent, m, t0, kun) {
    const tv = pick(m.assort);
    const narx = mijozNarx(m, tv);
    const dona = rnd(2, 8);
    const ombor = (AGENT_PREF + agent.fullname).slice(0, 80);
    const a = {
      turi: 'qaytarish', manba: 'mobil', mijoz: m, agent, jami_summa: dona * narx, tolov_turi: null,
      ombor, jonatish_sana: null, holat: 'qabul_kutilmoqda', createdAt: t0,
      izoh: pick(["Muddati o'tgan tovar", 'Qadoq shikastlangan', 'Sotilmay qoldi — qaytarildi', "Sifat bo'yicha shikoyat"]),
      qatorlar: [{ tv, narx, jami_dona: dona, blok: 0, dona, summa: dona * narx }],
      qabulVaqt: vaqt(keyingiIshKuni(kun, rnd(1, 3)), rnd(8, 10), rnd(0, 59)),
    };
    reg({ tovar_id: tv.id, tovar_nomi: tv.nomi, turkum: tv.turkum, ombor, tur: 'qaytarma_kirim',
          manba_tur: 'qaytarma', manba_id: () => a.id, donada: dona, sotuv_narx: narx, summa: dona * narx, sana: t0 });
    R.ariza.push(a);
    qaytarishlar.push(a);
  }

  /* ═════ KUNMA-KUN ═════ */
  for (const kun of kunlar) {
    const hk = haftaKuni(kun);
    const bugunmi = kun === BUGUN;

    /* ── 1. Yangi mijoz ── */
    if (yangiKunlar.has(kun)) {
      const i = yangiKunlar.get(kun);
      const agent = agentlar[i % agentlar.length];
      const t = bugunmi ? qosh(HOZIR, -rnd(20, 40)) : vaqt(kun, rnd(10, 15), rnd(0, 59));
      if (t <= HOZIR && t >= vaqt(kun, 8, 30)) {
        const markaz = agent.mijozlar[rnd(0, Math.max(0, agent.mijozlar.length - 1))] || OMBOR;
        const p = siljit(markaz, rnd(300, 1500));
        const m = {
          nomi: YANGI_MIJOZLAR[i], agent_id: agent.id, territoriya_id: rnd(1, 3), kategoriya_id: chance(0.8) ? 1 : 4,
          sinf: pick(['C', 'C', 'D', 'B']), narx_turi: 'chakana', kredit_limit: rnd(2, 5) * 1e6,
          tolov_muddati_kun: 14, tashrif_kunlari: null, lat: p.lat, lng: p.lng,
          telefon: '+998' + pick(['90', '91', '93', '94', '97', '99', '33', '88']) + rnd(1000000, 9999999),
          manzil: `Farg'ona sh., ${pick(KOCHALAR)}, ${rnd(1, 120)}-uy`, createdAt: t,
        };
        mijozTayyorla(m, keyingiIshKuni(kun));
        m.tashrif_kunlari = m.kunlar.join(', ');
        R.mijoz.push(m);
        agent.mijozlar.push(m);
        mijozlar.push(m);
      }
    }

    /* ── 2. Prixod — yetkazuvchilar o'z kunlarida keladi ── */
    for (const y of yetkazuvchilar) {
      if (!y.kunlar.includes(hk)) continue;
      const t = vaqt(kun, rnd(y.soat[0], y.soat[1]), rnd(0, 59));
      if (t > HOZIR) continue;
      const qatorlar = [];
      for (const tv of aralash(y.tovarlar.filter(x => !x.kam))) {
        let miqdor = 0;
        if (stok[tv.id] < tv.minStok) miqdor = Math.ceil((tv.maxStok - stok[tv.id]) / tv.bs) * tv.bs;
        else if (chance(kun >= '2026-10-01' ? 0.32 : 0.18)) miqdor = rnd(2, 5) * tv.bs;   // oktabr: kuzgi zaxira
        if (miqdor > 0) qatorlar.push({ tv, miqdor });
        if (qatorlar.length >= 10) break;
      }
      if (qatorlar.length < 2) continue;
      prixodYoz(y, kun, t, qatorlar, 'tasdiqlangan');
    }

    /* ── 3. Ertalab: shu kunga jo'natiladigan buyurtmalar → trip → yetkazish ── */
    const tripNo = { n: 0 };
    tripJarayon(kun, (kutayotgan[kun] || []).filter(a => !a.bekorTasdiqda), tripNo,
                () => vaqt(kun, 7, rnd(35, 55)), () => vaqt(kun, 8, rnd(40, 75)));

    /* ── 4. Agentlar: marshrut, tashrif, savdo, to'lov, sotmaslik, GPS ── */
    const tashrifQilingan = new Set();
    for (const agent of agentlar) {
      const ozlari = agent.mijozlar.filter(m => m.faolKun <= kun);
      if (!ozlari.length) continue;
      const kod = KUN_KODI[hk];
      const kerak = hk === 6 ? rnd(3, 5) : rnd(5, 8);
      let reja = ozlari.filter(m => m.kunlar.includes(kod));
      if (reja.length > kerak) reja = aralash(reja).slice(0, kerak);
      else if (reja.length < kerak - 1) {
        reja = reja.concat(aralash(ozlari.filter(m => !reja.includes(m))).slice(0, kerak - 1 - reja.length));
      }
      reja = yaqinTartib(reja, agent.start);

      // Reja oldingi kuni kechqurun tuziladi
      const rejaVaqt = vaqt(kunQosh(kun, -1), 18, rnd(0, 50));
      const rejaMap = new Map();
      reja.forEach((m, i) => {
        const r = { agent_id: agent.id, mijoz_id: () => m.id, sana: kun, tartib: i + 1, izoh: null,
                    createdAt: rejaVaqt, updatedAt: rejaVaqt };
        R.reja.push(r);
        rejaMap.set(m, r);
      });

      // Bajarilish: ko'pchiligi, ba'zan rejadan tashqari bitta mijoz
      const tashriflar = reja.filter(() => chance(0.88));
      if (chance(0.3)) {
        const tashqi = aralash(ozlari.filter(m => !reja.includes(m)))[0];
        if (tashqi) tashriflar.splice(rnd(0, tashriflar.length), 0, tashqi);
      }

      const anom = anomaliya.get(`${kun}|${agent.id}`);
      let t = vaqt(kun, 8, rnd(40, 70));
      let pos = agent.start, bat = rnd(88, 100);
      gps(agent.id, 'agent', siljit(pos, 30), t, bat);
      let toxtadi = false;

      for (const [i, m] of tashriflar.entries()) {
        const yol = yolDaq(pos, m);
        for (let k = 1; k <= (yol > 12 ? 2 : 1); k++) {
          gps(agent.id, 'agent', siljit(oraliq(pos, m, k / 3), 35), qosh(t, Math.round(yol * k / 3)), bat - k);
        }
        const kelish = qosh(t, yol);
        bat -= yol * 0.12;
        if (kelish > HOZIR) {
          // Bugun: agent hozir keyingi mijozga ketyapti — "online" nuqta
          if (bugunmi) gps(agent.id, 'agent', siljit(oraliq(pos, m, 0.5), 40), qosh(HOZIR, -rnd(1, 4)), bat);
          toxtadi = true;
          break;
        }
        t = kelish;
        tashrifQilingan.add(m);

        const anomTur = i === 1 ? anom : null;
        let natija = chance(0.66) ? 'savdo' : 'sotmaslik';
        let davom = natija === 'savdo' ? rnd(12, 28) : rnd(4, 11);
        if (anomTur === 'qisqa') davom = rnd(1, 2);
        if (anomTur === 'uzun') davom = rnd(95, 130);
        const masofa = anomTur === 'uzoq' ? rnd(250, 600) : rnd(5, 70);
        const ci = siljit(m, masofa);
        const checkout = qosh(t, davom);
        const hozirShuyerda = checkout > HOZIR;          // bugun: agent hozir mijozda
        const ochiq = anomTur === 'ochiq' || hozirShuyerda;
        if (ochiq) natija = 'ochiq';
        gps(agent.id, 'agent', ci, t, bat);

        const tashrif = {
          reja_id: rejaMap.has(m) ? () => rejaMap.get(m).id : null,
          agent_id: agent.id, agent_nomi: agent.fullname, mijoz_id: () => m.id, mijoz_nomi: m.nomi,
          checkin_vaqt: t, checkin_lat: ci.lat, checkin_lng: ci.lng, checkin_masofa: masofa,
          checkout_vaqt: ochiq ? null : checkout, checkout_lat: ochiq ? null : ci.lat,
          checkout_lng: ochiq ? null : ci.lng, davomiylik_sek: ochiq ? null : davom * 60,
          natija, ariza_id: null, sana: kun, createdAt: t, updatedAt: ochiq ? t : checkout,
        };

        if (!hozirShuyerda) {
          if (natija === 'savdo') {
            const a = arizaYarat({ m, agent, t0: qosh(t, Math.max(1, davom - rnd(1, 3))), kun, manba: 'mobil' });
            if (a) tashrif.ariza_id = () => a.id;
            else tashrif.natija = natija = 'sotmaslik';
          }
          if (natija === 'sotmaslik') {
            const sb = pick(SABABLAR);
            R.sotmaslik.push({ agent_id: agent.id, agent_nomi: agent.fullname, mijoz_id: () => m.id,
              mijoz_nomi: m.nomi, sabab_id: String(sb.id), sabab_nomi: sb.nomi, sana: checkout,
              createdAt: checkout, updatedAt: checkout });
          }
          // Qarz undirish — mobil savePayment (kassa.user_id = agent → inkassatsiya)
          const due = muddatliQarz(m, kun);
          const ehtimol = { yaxshi: 0.75, orta: 0.4, yomon: 0.07 }[m.toloqchi];
          if (due > 0 && chance(ehtimol)) {
            const ulush = m.toloqchi === 'yaxshi' ? (chance(0.6) ? 1 : 0.6 + rand() * 0.4)
                        : m.toloqchi === 'orta' ? 0.35 + rand() * 0.45 : 0.15 + rand() * 0.2;
            let summa = Math.min(due, Math.max(50000, yaxlit(due * ulush, 1000)));
            // Mayda "dum" qarz qolmasin: kredit tekshiruvi 1 so'mlik qarzni ham
            // muddati o'tgan deb buyurtmani bloklaydi — mijoz qoldiqni yopadi
            if (due - summa < 50000) summa = due;
            const sana = qosh(t, Math.max(1, Math.min(davom - 1, rnd(2, 8))));
            kassa({ tur: 'kirim', kategoriya: 'mijoz_tolov', summa, tolov_usul: 'naqt', manba_tur: 'mijoz',
                    manba_id: () => m.id, mijoz_id: () => m.id, mijoz_nomi: m.nomi,
                    izoh: chance(0.3) ? "Qarz to'lovi" : null, sana, user_id: agent.id });
            tolovYoz(m, summa);
            const kalit = `${kun}|${agent.id}`;
            agentNaqd[kalit] = (agentNaqd[kalit] || 0) + summa;
          }
          if (chance(0.045)) qaytarishYarat(agent, m, qosh(t, Math.max(1, davom - 1)), kun);
          if (chance(0.1)) {
            const bizBilan = rnd(35, 85);
            R.audit.push({
              agent_id: agent.id, agent_nomi: agent.fullname, mijoz_id: () => m.id, mijoz_nomi: m.nomi,
              maydon: rnd(12, 80), stend: rnd(0, 4), biz_bilan: bizBilan, bizsiz: 100 - bizBilan,
              sabab: pick(['Raqobatchi narxi past', 'Javon joyi yetarli emas', 'Talab past', 'Yetkazib berish kechikadi']),
              shikoyat: pick(['', '', 'Yetkazib berish kech qoldi', 'Ba\'zi tovarlar tez tugaydi', 'Qadoqlar shikastlangan keldi']),
              taklif: pick(['', 'Aksiya o\'tkazish kerak', 'Yangi ta\'mlar qo\'shilsin', 'Reklama stendi o\'rnatish', 'Muddatli to\'lov imkoniyati']),
              kirish_vaqt: soatMin(t), chiqish_vaqt: soatMin(checkout), lat: ci.lat, lng: ci.lng,
              tovarlar: JSON.stringify(Array.from({ length: rnd(1, 3) }, () =>
                ({ brand_id: String(rnd(1, 6)), cat_id: String(rnd(10, 15)), count: rnd(2, 24) }))),
              rasmlar: JSON.stringify([]), sana: t, createdAt: checkout, updatedAt: checkout,
            });
          }
        }
        R.tashrif.push(tashrif);
        pos = m;
        bat -= davom * 0.08;
        if (hozirShuyerda) {
          if (bugunmi) gps(agent.id, 'agent', siljit(ci, 8), qosh(HOZIR, -rnd(1, 4)), bat);
          toxtadi = true;
          break;
        }
        t = checkout;
      }
      if (!toxtadi) gps(agent.id, 'agent', siljit(oraliq(pos, OMBOR, 0.3), 50), qosh(t, rnd(10, 20)), bat - 3);
    }

    /* ── 5. Operator qabul qilgan telefon buyurtmalari (web) ── */
    for (let i = 0, n = rnd(1, 3); i < n; i++) {
      const m = pick(mijozlar.filter(x => x.faolKun <= kun && !tashrifQilingan.has(x)));
      if (!m) break;
      const t0 = vaqt(kun, rnd(10, 16), rnd(0, 59));
      if (t0 > HOZIR) continue;
      arizaYarat({ m, agent: agentMap.get(m.agent_id), t0, kun, manba: 'web' });
    }

    /* ── 5b. Tushdan keyingi to'lqin: bugun yetkaziladigan tezkor buyurtmalar ── */
    tripJarayon(kun, R.ariza.filter(a => a.tezkor && a.jonatish_sana === kun && !a.bekorTasdiqda && !a.trip), tripNo,
                () => vaqt(kun, 12, rnd(30, 50)), () => vaqt(kun, 14, rnd(0, 30)));

    /* ── 6. Bank o'tkazmalari — yirik mijozlar ── */
    if (chance(0.45)) {
      const m = pick(mijozlar.filter(x => (x.kategoriya_id === 2 || x.kategoriya_id === 3 || x.narx_turi === 'optom')
                                          && x.toloqchi !== 'yomon' && muddatliQarz(x, kun) >= 300000));
      const sana = vaqt(kun, rnd(11, 16), rnd(0, 59));
      if (m && sana <= HOZIR) {
        const due = muddatliQarz(m, kun);
        let summa = Math.min(due, yaxlit(due * (0.6 + rand() * 0.4), 1000));
        if (due - summa < 50000) summa = due;
        kassa({ tur: 'kirim', kategoriya: 'mijoz_tolov', summa, tolov_usul: 'bank', mijoz_id: () => m.id,
                mijoz_nomi: m.nomi, izoh: `Bank o'tkazmasi — to'lov topshiriqnomasi №${rnd(100, 999)}`,
                sana, user_id: ADMIN_ID });
        tolovYoz(m, summa);
      }
    }

    /* ── 7. Xarajatlar va yetkazuvchiga to'lov ── */
    xarajatlar(kun, hk);
    if (hk === 5) {
      for (const y of yetkazuvchilar) {
        const chegara = kunQosh(kun, -14);              // yetkazuvchi 2 hafta kredit beradi
        const due = y.navbat.filter(x => x.sana <= chegara).reduce((s, x) => s + x.summa, 0);
        const sana = vaqt(kun, 15, rnd(0, 59));
        const yangidan = tolasaBoladi(kun, Math.min(due, yaxlit(due * (0.7 + rand() * 0.3), 1000)));
        const eskidan = tolasaBoladi(kun, Math.min(y.eskiQarz, rnd(2, 5) * 1e6) + yangidan) - yangidan;
        const summa = yangidan + Math.max(0, eskidan);
        if (summa < 100000 || sana > HOZIR) continue;
        y.eskiQarz -= Math.max(0, eskidan);
        kassa({ tur: 'chiqim', kategoriya: 'yetkazuvchi_tolov', summa, tolov_usul: 'naqt', manba_tur: 'yetkazuvchi',
                manba_id: () => y.id, izoh: `${y.ism} ga to'lov`, sana });
        R.harakat.push({ yetkazuvchi_id: () => y.id, prixod_id: null, tur: 'tolov', summa, tolov_turi: 'naqt',
                         izoh: "Qarz to'lovi — kassa orqali", sana, createdAt: sana, updatedAt: sana });
        let q = yangidan;
        while (q > 0 && y.navbat.length) {
          const x = y.navbat[0];
          if (x.summa <= q) { q -= x.summa; y.navbat.shift(); } else { x.summa -= q; q = 0; }
        }
      }
    }

    /* ── 8. Kun oxiri: inkassatsiya — agent yig'gan naqdni topshiradi ── */
    for (const agent of agentlar) {
      const yigilgan = agentNaqd[`${kun}|${agent.id}`] || 0;
      const sana = vaqt(kun, 18, rnd(30, 59));
      if (yigilgan <= 0 || sana > HOZIR) continue;   // bugungisi hali topshirilmagan
      const kamomad = chance(0.12);
      const topshirilgan = kamomad ? yaxlit(yigilgan * (0.93 + rand() * 0.06), 1000) : yigilgan;
      const farq = topshirilgan - yigilgan;
      R.inkas.push({
        agent_id: agent.id, agent_nomi: agent.fullname, sana: kun, yigilgan_summa: yigilgan,
        topshirilgan_summa: topshirilgan, farq, holat: farq < 0 ? 'kamomad' : 'yopiq',
        izoh: farq < 0 ? `Kamomad ${String(-farq).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so'm — agent tushuntirish xati yozdi`
                       : "To'liq topshirildi",
        tasdiqlagan_id: ADMIN_ID, tasdiqlagan_sana: qosh(sana, rnd(10, 40)), createdAt: sana, updatedAt: sana,
      });
    }
  }

  /* ── Trip: yig'ish → yo'lga chiqish → yetkazish (ariza.controller changeHolat
     yon-effektlari bilan). Ertalabki va tushdan keyingi to'lqin uchun umumiy ── */
  function tripJarayon(kun, jonatish, tripNo, yigVaqti, yolVaqti) {
    const bugunmi = kun === BUGUN;
    const guruh = new Map();
    jonatish.forEach(a => {
      const d = dostavchiFor(a.mijoz);
      if (!guruh.has(d.id)) guruh.set(d.id, { d, list: [] });
      guruh.get(d.id).list.push(a);
    });
    for (const { d, list } of guruh.values()) {
      const tartib = yaqinTartib(list.map(a => Object.assign(a, { lat: a.mijoz.lat, lng: a.mijoz.lng })), OMBOR);
      const yigBosh = yigVaqti();
      if (yigBosh > HOZIR) continue;               // ombor hali ishni boshlamagan
      tartib.forEach((a, i) => { a.t2 = qosh(yigBosh, i * rnd(3, 6)); if (a.t2 < qosh(a.t1, 5)) a.t2 = qosh(a.t1, 5); });
      let yolVaqt = yolVaqti();
      const oxirgiYig = tartib.reduce((mx, a) => (a.t2 > mx ? a.t2 : mx), yigBosh);
      if (yolVaqt < qosh(oxirgiYig, 10)) yolVaqt = qosh(oxirgiYig, 10);

      const trip = {
        raqam: `TS-${kun}-${pad(++tripNo.n, 3)}`, dostavchi_id: d.id, dostavchi_nomi: d.ism, sana: kun,
        holat: 'yangi', boshlangan_vaqt: null, tugagan_vaqt: null, izoh: null,
        createdAt: yigBosh, updatedAt: yigBosh,
      };
      R.trip.push(trip);

      let t = yolVaqt, pos = OMBOR, bat = rnd(85, 100), oxirgi = OMBOR;
      gps(d.id, 'dostavchi', siljit(OMBOR, 20), yolVaqt, bat);
      tartib.forEach((a, i) => {
        a.trip = trip; a.trip_tartib = i + 1; a.dostavchi = d; a.t3 = yolVaqt;
        const yol = yolDaq(pos, a.mijoz);
        gps(d.id, 'dostavchi', siljit(oraliq(pos, a.mijoz, 0.5), 40), qosh(t, Math.round(yol / 2)), bat);
        t = qosh(t, yol + rnd(3, 8));
        a.t4 = t; pos = a.mijoz;
        bat -= rnd(2, 4);
        gps(d.id, 'dostavchi', siljit(a.mijoz, rnd(5, 40)), t, bat);
        if (t <= HOZIR) oxirgi = a.mijoz;
        t = qosh(t, rnd(5, 12));                   // tushirish, hujjat
      });
      const tugash = qosh(t, rnd(15, 35));
      // Jonli: yo'ldagi dostavchi hozir qayerda
      if (bugunmi && yolVaqt <= HOZIR && tugash > HOZIR) {
        const keyingi = tartib.find(a => a.t4 > HOZIR);
        gps(d.id, 'dostavchi', siljit(keyingi ? oraliq(oxirgi, keyingi.mijoz, 0.4) : oxirgi, 30),
            qosh(HOZIR, -rnd(1, 3)), bat);
      }
      if (yolVaqt <= HOZIR) { trip.holat = 'yolda'; trip.boshlangan_vaqt = yolVaqt; trip.updatedAt = yolVaqt; }
      if (tugash <= HOZIR) { trip.holat = 'yakunlandi'; trip.tugagan_vaqt = tugash; trip.updatedAt = tugash; }

      /* Holat va yon-effektlar — faqat HOZIRgacha bo'lgan bosqichlar */
      for (const a of tartib) {
        if (a.t3 <= HOZIR) {
          a.qatorlar.forEach(q => reg({
            tovar_id: q.tv.id, tovar_nomi: q.tv.nomi, turkum: q.tv.turkum, ombor: ASOSIY, tur: 'chiqim',
            manba_tur: 'sotuv', manba_id: () => a.id, donada: -q.jami_dona, bloklarda: -q.blok,
            sotuv_narx: q.narx, summa: -q.summa, sana: a.t3,
          }));
        }
        if (a.t4 > HOZIR) continue;
        if (a.bekorYolda) {
          a.bekor_sababi = pick(["Do'kon yopiq edi — mijoz qabul qilmadi", "Mijoz to'lovga tayyor emas"]);
          a.qatorlar.forEach(q => {
            stok[q.tv.id] += q.jami_dona;
            reg({ tovar_id: q.tv.id, tovar_nomi: q.tv.nomi, turkum: q.tv.turkum, ombor: ASOSIY,
                  tur: 'qaytarma_kirim', manba_tur: 'qaytarma', manba_id: () => a.id, donada: q.jami_dona,
                  bloklarda: q.blok, sotuv_narx: q.narx, summa: q.summa, sana: a.t4 });
          });
          continue;
        }
        a.yetkazilgan_sana = a.t4;
        const m = a.mijoz, ag = a.agent;
        if (a.tolov_turi === 'naqt') {
          kassa({ tur: 'kirim', kategoriya: 'sotuv', summa: a.jami_summa, tolov_usul: 'naqt', manba_tur: 'ariza',
                  manba_id: () => a.id, mijoz_id: () => m.id, mijoz_nomi: m.nomi,
                  izoh: () => `${a.raqam} — naqd sotuv`, sana: a.t4 });
        } else {
          qarzQosh(m, a.jami_summa, kun);
        }
        const bonus = Math.round(a.jami_summa * ag.bonusFoiz / 100);
        R.agentReg.push({ agent_id: ag.id, ariza_id: () => a.id, tur: 'savdo', summa: a.jami_summa,
          bonus_foiz: ag.bonusFoiz, bonus_summa: bonus, sana: a.t4, izoh: () => `${a.raqam} — ${m.nomi}`,
          createdAt: a.t4, updatedAt: a.t4 });
        const oyKalit = `${kun.slice(0, 7)}|${ag.id}`;
        bonusOy[oyKalit] = (bonusOy[oyKalit] || 0) + bonus;

        // Yetkazishda qisman qaytarish / brak (mobile returnDeliveryProducts)
        if (chance(0.045)) {
          const q = pick(a.qatorlar);
          const dona = rnd(1, Math.min(3, q.jami_dona));
          const brak = chance(0.35);
          R.qaytarish.push({
            ariza_id: () => a.id, tovar_id: q.tv.id, tovar_nomi: q.tv.nomi, dona, summa: dona * q.narx,
            tur: brak ? 'brak' : 'qaytarma', dostavchi_id: d.id, sana: a.t4, createdAt: a.t4, updatedAt: a.t4,
            sabab: brak ? pick(['Qadoq shikastlangan', "Muddati o'tgan", 'Ezilgan / singan'])
                        : pick(['Mijoz ortiqcha deb qaytardi', 'Buyurtmada xato', 'Tovar turi almashib ketgan']),
          });
          reg({ tovar_id: q.tv.id, tovar_nomi: q.tv.nomi, turkum: q.tv.turkum, ombor: brak ? BRAK : ASOSIY,
                tur: 'qaytarma_kirim', manba_tur: 'qaytarma', manba_id: () => a.id, donada: dona,
                sotuv_narx: q.narx, summa: dona * q.narx, sana: a.t4 });
          if (!brak) stok[q.tv.id] += dona;
        }
      }
    }
  }

  /* ── Prixod yozuvi (prixod.controller tasdiqla bilan bir xil yon-effektlar) ── */
  function prixodYoz(y, kun, t, qatorlar, holat) {
    const p = {
      hujjat_raqam: `PRX-${++prixodNo}`, sana: t, yetkazuvchi: y.ism, yetkazuvchi_id: () => y.id,
      tolov_turi: pick(['naqt', 'naqt', 'naqt', 'optom']), tolangan_summa: 0, ombor: ASOSIY,
      izoh: `Yuk xati № ${rnd(10000, 99999)}`, qoshimcha_xarajat: 0, jami_summa: 0, holat,
      createdAt: t, updatedAt: t,
    };
    for (const { tv, miqdor } of qatorlar) {
      const summa = miqdor * tv.kirim;
      p.jami_summa += summa;
      const [mn, mx] = MUDDAT[tv.turkum] || [180, 365];
      const ishlab = kunQosh(kun, -rnd(1, 4));
      R.prixodQator.push({
        prixod_id: () => p.id, tovar_id: tv.id, tovar_nomi: tv.nomi, turkum: tv.turkum,
        ishlab_chiqarish_sana: ishlab, yaroqlilik_muddati: kunQosh(ishlab, rnd(mn, mx)),
        narx: tv.kirim, narx_usd: +(tv.kirim / KURS).toFixed(4),
        sotuv_narx: tv.chakana, sotuv_narx_usd: +(tv.chakana / KURS).toFixed(4),
        optom_narx: tv.optom, optom_narx_usd: +(tv.optom / KURS).toFixed(4),
        chakana_narx: tv.chakana, chakana_narx_usd: +(tv.chakana / KURS).toFixed(4),
        kurs: KURS, qutilarda: +(miqdor / (tv.bs * tv.qb)).toFixed(3), bloklarda: +(miqdor / tv.bs).toFixed(3),
        donada: miqdor, hajm: 0, summa, createdAt: t, updatedAt: t,
      });
      if (holat !== 'tasdiqlangan') continue;
      reg({
        tovar_id: tv.id, tovar_nomi: tv.nomi, turkum: tv.turkum, ombor: ASOSIY, tur: 'kirim', manba_tur: 'prixod',
        manba_id: () => p.id, donada: miqdor, bloklarda: +(miqdor / tv.bs).toFixed(3),
        qutilarda: +(miqdor / (tv.bs * tv.qb)).toFixed(3), kirim_narx: tv.kirim,
        kirim_narx_usd: +(tv.kirim / KURS).toFixed(4), optom_narx: tv.optom,
        optom_narx_usd: +(tv.optom / KURS).toFixed(4), chakana_narx: tv.chakana,
        chakana_narx_usd: +(tv.chakana / KURS).toFixed(4), sotuv_narx: tv.chakana,
        sotuv_narx_usd: +(tv.chakana / KURS).toFixed(4), summa, sana: t,
      });
      stok[tv.id] += miqdor;
    }
    R.prixod.push(p);
    if (holat !== 'tasdiqlangan') return p;

    // To'lov: ko'pincha qisman yoki 2 haftalik kreditga — yetkazuvchi qarzi shundan
    const r = rand();
    let tolangan = r < 0.25 ? p.jami_summa : r < 0.55 ? yaxlit(p.jami_summa * (0.3 + rand() * 0.4), 1000) : 0;
    tolangan = tolasaBoladi(kun, tolangan);
    if (tolangan < 100000) tolangan = 0;
    p.tolangan_summa = tolangan;
    R.harakat.push({ yetkazuvchi_id: () => y.id, prixod_id: () => p.id, tur: 'qarz', summa: p.jami_summa,
                     tolov_turi: p.tolov_turi, izoh: `Prixod ${p.hujjat_raqam} bo'yicha qarz`, sana: t,
                     createdAt: t, updatedAt: t });
    if (tolangan > 0) {
      R.harakat.push({ yetkazuvchi_id: () => y.id, prixod_id: () => p.id, tur: 'tolov', summa: tolangan,
                       tolov_turi: p.tolov_turi, izoh: `Prixod ${p.hujjat_raqam} uchun oldindan to'lov`, sana: t,
                       createdAt: t, updatedAt: t });
      kassa({ tur: 'chiqim', kategoriya: 'yetkazuvchi_tolov', summa: tolangan, tolov_usul: 'naqt', manba_tur: 'prixod',
              manba_id: () => p.id, izoh: `Prixod ${p.hujjat_raqam} — ${y.ism} ga to'lov`, sana: t });
    }
    const qoldi = p.jami_summa - tolangan;
    if (qoldi > 0) y.navbat.push({ summa: qoldi, sana: kun });
    return p;
  }

  /* ── Oylik va haftalik xarajatlar ── */
  function xarajatlar(kun, hk) {
    const oy = kun.slice(0, 7), sana = +kun.slice(8, 10);
    const oylik = (n, kalit, fn) => {
      if (sana < n || oyBelgi.has(`${oy}|${kalit}`)) return;
      // Avgustning BOSHLANISH dan oldingi to'lovlari mavjud ma'lumotda bor
      if (oy === BOSHLANISH.slice(0, 7) && n < +BOSHLANISH.slice(8, 10)) return;
      const t = vaqt(kun, rnd(10, 15), rnd(0, 59));
      if (t > HOZIR) return;
      oyBelgi.add(`${oy}|${kalit}`);
      fn(t);
    };
    const oldingiOy = kunQosh(oy + '-01', -1);
    oylik(1, 'ijara', t => kassa({ tur: 'chiqim', kategoriya: 'ijara', summa: 6000000, tolov_usul: 'bank',
      izoh: `Ombor va ofis ijarasi — ${oyNomi(kun)}`, sana: t, user_id: ADMIN_ID }));
    oylik(15, 'ish_haqi', t => {
      SHTAT.forEach(s => kassa({ tur: 'chiqim', kategoriya: 'ish_haqi', summa: s.soni * s.oylik * 0.6,
        tolov_usul: 'naqt', izoh: `${oyNomi(oldingiOy)} oyi ish haqi (qoldiq) — ${s.guruh}, ${s.soni} kishi`,
        sana: t, user_id: ADMIN_ID }));
      agentlar.forEach(a => {
        const b = bonusOy[`${oldingiOy.slice(0, 7)}|${a.id}`] || 0;
        if (b > 0) kassa({ tur: 'chiqim', kategoriya: 'ish_haqi', summa: yaxlit(b, 1000), tolov_usul: 'naqt',
          izoh: `Savdo bonusi (${oyNomi(oldingiOy)}) — ${a.fullname}, ${a.bonusFoiz}%`, sana: qosh(t, 5), user_id: ADMIN_ID });
      });
    });
    // Yetkazuvchilarning marketing (retro) bonusi — distribyutorlikda odatiy daromad
    oylik(8, 'retro', t => yetkazuvchilar.slice(0, 3).forEach((y, i) => kassa({ tur: 'kirim',
      kategoriya: 'boshqa_daromad', summa: rnd(25, 45) * 100000, tolov_usul: 'bank',
      izoh: `${y.ism} — marketing bonusi (${oyNomi(oldingiOy)})`, sana: qosh(t, i * 37), user_id: ADMIN_ID })));
    oylik(10, 'kommunal', t => kassa({ tur: 'chiqim', kategoriya: 'xarajat', summa: rnd(15, 25) * 100000,
      tolov_usul: 'bank', izoh: `Kommunal to'lovlar (elektr, gaz, suv) — ${oyNomi(kun)}`, sana: t, user_id: ADMIN_ID }));
    oylik(12, 'aloqa', t => kassa({ tur: 'chiqim', kategoriya: 'xarajat', summa: 650000, tolov_usul: 'bank',
      izoh: 'Internet va mobil aloqa', sana: t, user_id: ADMIN_ID }));
    oylik(28, 'avans', t => kassa({ tur: 'chiqim', kategoriya: 'ish_haqi',
      summa: oylikFond * 0.4, tolov_usul: 'naqt',
      izoh: `Avans — ${oyNomi(kun)}`, sana: t, user_id: ADMIN_ID }));
    oylik(25, 'soliq', t => kassa({ tur: 'chiqim', kategoriya: 'boshqa_chiqim', summa: rnd(25, 35) * 100000,
      tolov_usul: 'bank', izoh: "Soliq to'lovi (aylanmadan)", sana: t, user_id: ADMIN_ID }));

    const t = vaqt(kun, rnd(9, 16), rnd(0, 59));
    if (t > HOZIR) return;
    if (hk === 1) kassa({ tur: 'chiqim', kategoriya: 'xarajat', summa: rnd(10, 15) * 100000, tolov_usul: 'naqt',
      izoh: "Yoqilg'i — yetkazib berish mashinalari", sana: t, user_id: ADMIN_ID });
    if (chance(0.06)) kassa({ tur: 'chiqim', kategoriya: 'boshqa_chiqim', summa: rnd(2, 15) * 100000, tolov_usul: 'naqt',
      izoh: pick(["Mashina ta'miri", 'Kanselyariya tovarlari', 'Ombor uchun poddonlar', 'Xo\'jalik mollari']),
      sana: t, user_id: ADMIN_ID });
  }

  /* ── Bugun: tasdiqlanishi kutilayotgan qoralama prixod ── */
  const qoralamaVaqt = qosh(HOZIR, -rnd(10, 30));
  if (haftaKuni(BUGUN) !== 0 && qoralamaVaqt >= vaqt(BUGUN, 8, 0)) {
    const y = yetkazuvchilar.find(x => !x.kunlar.includes(haftaKuni(BUGUN))) || yetkazuvchilar[0];
    const qatorlar = aralash(y.tovarlar.filter(x => !x.kam)).slice(0, rnd(3, 6)).map(tv => ({ tv, miqdor: rnd(3, 8) * tv.bs }));
    if (qatorlar.length) prixodYoz(y, BUGUN, qoralamaVaqt, qatorlar, 'qoralama');
  }

  /* ── Qaytarish qabuli (skladchi) — ariza.controller qaytarishQabul ── */
  // Qabul sahifasi bo'sh qolmasin: oxirgi 3 tasi hali kutilmoqda
  const kutilmoqda = qaytarishlar.filter(a => a.qabulVaqt > HOZIR).length;
  if (kutilmoqda < 3) {
    qaytarishlar.filter(a => a.qabulVaqt <= HOZIR).slice(-(3 - kutilmoqda))
      .forEach(a => { a.qabulVaqt = qosh(HOZIR, 600); });
  }
  for (const a of qaytarishlar) {
    if (a.qabulVaqt > HOZIR) continue;
    const q = a.qatorlar[0];
    const farqli = chance(0.15) && q.jami_dona > 2;
    const qabul = farqli ? q.jami_dona - rnd(1, 2) : q.jami_dona;
    q.qabul_dona = qabul;
    const summa = qabul * q.narx;
    reg({ tovar_id: q.tv.id, tovar_nomi: q.tv.nomi, turkum: q.tv.turkum, ombor: a.ombor, tur: 'qaytarma_chiqim',
          manba_tur: 'qaytarma', manba_id: () => a.id, donada: -qabul, sotuv_narx: q.narx, summa: -summa, sana: a.qabulVaqt });
    reg({ tovar_id: q.tv.id, tovar_nomi: q.tv.nomi, turkum: q.tv.turkum, ombor: ASOSIY, tur: 'qaytarma_kirim',
          manba_tur: 'qaytarma', manba_id: () => a.id, donada: qabul, sotuv_narx: q.narx, summa, sana: a.qabulVaqt });
    a.holat = 'qabul_qilindi';
    a.ombor = ASOSIY;
    a.qabul_qilgan_id = ADMIN_ID;
    a.qabul_sana = a.qabulVaqt;
    a.updatedAt = a.qabulVaqt;
    if (farqli) a.izoh += ` | Skladchi: ${q.jami_dona - qabul} dona kam keldi`;
  }

  /* ── Sotuv arizalarining yakuniy holati (HOZIR bo'yicha) ── */
  for (const a of R.ariza) {
    if (a.turi !== 'sotish') continue;
    let holat = 'yangi', yangilangan = a.createdAt;
    if (a.t1 <= HOZIR) { holat = a.bekorTasdiqda ? 'bekor' : 'tasdiqlangan'; yangilangan = a.t1; }
    if (!a.bekorTasdiqda && a.t1 <= HOZIR) { a.tasdiqlagan_id = ADMIN_ID; a.tasdiqlagan_sana = a.t1; }
    if (a.t2 && a.t2 <= HOZIR) { holat = 'yigilmoqda'; yangilangan = a.t2; }
    if (a.t3 && a.t3 <= HOZIR) { holat = 'yolda'; yangilangan = a.t3; }
    if (a.t4 && a.t4 <= HOZIR) { holat = a.bekorYolda ? 'bekor' : 'yetkazildi'; yangilangan = a.t4; }
    if (holat !== 'bekor') a.bekor_sababi = null;
    a.holat = holat;
    a.updatedAt = yangilangan;
  }

  return { R, mijozlar, agentlar, tovarlar, stok, kamlar, yetkazuvchilar, kunlar };
}

/* ═══════════════════════════════════════════════════════════════
 *  BAZAGA YOZISH
 * ═══════════════════════════════════════════════════════════════ */
const qiymat = (v) => {
  if (typeof v === 'function') return qiymat(v());
  if (v instanceof Date) return dbVaqt(v);
  return v === undefined ? null : v;
};
async function bitta(jadval, row, t) {
  const cols = Object.keys(row);
  const [id] = await sequelize.query(
    `INSERT INTO \`${jadval}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    { replacements: cols.map(c => qiymat(row[c])), transaction: t });
  return id;
}
async function kop(jadval, rows, t) {
  if (!rows.length) return;
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  for (let i = 0; i < rows.length; i += 250) {
    const b = rows.slice(i, i + 250);
    await sequelize.query(
      `INSERT INTO \`${jadval}\` (${cols.map(c => '`' + c + '`').join(',')})
       VALUES ${b.map(() => '(' + cols.map(() => '?').join(',') + ')').join(',')}`,
      { replacements: b.flatMap(r => cols.map(c => qiymat(r[c]))), transaction: t });
  }
}

async function yozish(S, D) {
  const { R } = S;
  // DDL tranzaksiyani yopib qo'yadi — jadvallarni oldindan yaratamiz
  await sequelize.query(`CREATE TABLE IF NOT EXISTS demo_prez_log (
    jadval VARCHAR(40) NOT NULL, row_id INT NOT NULL, PRIMARY KEY (jadval, row_id))`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS demo_prez_balans (
    jadval VARCHAR(40) NOT NULL, row_id INT NOT NULL, balans DECIMAL(18,2), PRIMARY KEY (jadval, row_id))`);
  await sequelize.query(`CREATE TABLE IF NOT EXISTS demo_prez_ariza (
    id INT PRIMARY KEY, holat VARCHAR(30), yetkazilgan_sana DATETIME NULL, bekor_sababi VARCHAR(255) NULL)`);

  const t = await sequelize.transaction();
  try {
    // Suv belgisi: shu id dan kattalari — shu ishga tushirishda yaratilgan
    const belgi = {};
    for (const j of LOG_JADVALLAR) {
      const [r] = await sequelize.query(`SELECT COALESCE(MAX(id), 0) m FROM \`${j}\``, { transaction: t });
      belgi[j] = r[0].m;
    }

    for (const y of R.yetk) {
      y.id = await bitta('yetkazuvchi', { ism: y.ism, ...y.yangi, balans: 0,
        createdAt: vaqt(BOSHLANISH, 10), updatedAt: vaqt(BOSHLANISH, 10) }, t);
    }
    for (const m of R.mijoz) {
      m.id = await bitta('mijoz', {
        nomi: m.nomi, telefon: m.telefon, manzil: m.manzil, territoriya_id: m.territoriya_id,
        kategoriya_id: m.kategoriya_id, agent_id: m.agent_id, sinf: m.sinf, narx_turi: m.narx_turi, balans: 0,
        kredit_limit: m.kredit_limit, tolov_muddati_kun: m.tolov_muddati_kun, tashrif_kunlari: m.tashrif_kunlari,
        lat: m.lat, lng: m.lng, faol: 1, createdAt: m.createdAt, updatedAt: m.createdAt,
      }, t);
    }
    for (const p of R.prixod) p.id = await bitta('prixod', p, t);
    await kop('prixod_qator', R.prixodQator, t);

    for (const tr of R.trip) tr.id = await bitta('trip_sheet', tr, t);

    // Raqam: utils/arizaRaqam.utils.js formati, yaratilish tartibida davom etadi
    R.ariza.sort((a, b) => a.createdAt - b.createdAt);
    R.ariza.forEach((a, i) => { a.raqam = `AR-2026-${pad(D.arizaSoni + i + 1, 4)}`; });
    for (const a of R.ariza) {
      a.id = await bitta('ariza', {
        raqam: a.raqam, holat: a.holat, turi: a.turi, manba: a.manba,
        mijoz_id: a.mijoz.id, mijoz_nomi: a.mijoz.nomi, agent_id: a.agent.id, agent_nomi: a.agent.fullname,
        jami_summa: a.jami_summa, chegirma_foiz: 0, chegirma_summa: 0, bonus_summa: 0,
        tolov_turi: a.tolov_turi, ombor: a.ombor,
        dostavchi_id: a.dostavchi ? a.dostavchi.id : null, dostavchi_nomi: a.dostavchi ? a.dostavchi.ism : null,
        trip_sheet_id: a.trip ? a.trip.id : null, trip_tartib: a.trip_tartib || null,
        jonatish_sana: a.jonatish_sana, izoh: a.izoh, bekor_sababi: a.bekor_sababi || null,
        tasdiqlagan_id: a.tasdiqlagan_id || null, tasdiqlagan_sana: a.tasdiqlagan_sana || null,
        yetkazilgan_sana: a.yetkazilgan_sana || null, qabul_qilgan_id: a.qabul_qilgan_id || null,
        qabul_sana: a.qabul_sana || null, createdAt: a.createdAt, updatedAt: a.updatedAt || a.createdAt,
      }, t);
    }
    await kop('ariza_qator', R.ariza.flatMap(a => a.qatorlar.map(q => ({
      ariza_id: a.id, tovar_id: q.tv.id, tovar_nomi: q.tv.nomi, turkum: q.tv.turkum, narx: q.narx,
      blok: q.blok, dona: q.dona, hajm: 0, jami_dona: q.jami_dona, summa: q.summa, chegirma_foiz: 0,
      chegirma_summa: 0, qabul_dona: q.qabul_dona ?? null, createdAt: a.createdAt, updatedAt: a.createdAt,
    }))), t);

    for (const r of R.reja) r.id = await bitta('marshrut_reja', r, t);
    await kop('tashrif', R.tashrif, t);
    await kop('tovar_register', R.register, t);
    await kop('kassa', R.kassa, t);
    await kop('yetkazuvchi_harakatlar', R.harakat, t);
    await kop('agent_register', R.agentReg, t);
    await kop('yetkazish_qaytarish', R.qaytarish, t);
    await kop('inkassatsiya', R.inkas, t);
    await kop('sotmaslik', R.sotmaslik, t);
    await kop('audit_natija', R.audit, t);
    await kop('agent_location', R.gps, t);

    // Iyuldan qolib ketgan arizalar — asl holati zaxiraga
    for (const e of R.eskiYopish) {
      await sequelize.query(`INSERT IGNORE INTO demo_prez_ariza (id, holat, yetkazilgan_sana, bekor_sababi)
                             SELECT id, holat, yetkazilgan_sana, bekor_sababi FROM ariza WHERE id = ?`,
        { replacements: [e.id], transaction: t });
      await sequelize.query(`UPDATE ariza SET holat = ?, yetkazilgan_sana = ?, bekor_sababi = ? WHERE id = ?`,
        { replacements: [e.holat, qiymat(e.yetkazilgan_sana), e.bekor_sababi, e.id], transaction: t });
    }

    /* Balanslar: oldi-berdi tarixidan qayta hisoblanadi (manfiy = qarz).
       Ilgari demo-seed qarzdorlarga MUSBAT balans yozgan edi — ular "avans"
       bo'lib ko'rinib, Top qarzdorlar bo'sh chiqardi. Asl qiymat zaxirada. */
    await sequelize.query(`INSERT IGNORE INTO demo_prez_balans (jadval, row_id, balans)
                           SELECT 'mijoz', id, balans FROM mijoz WHERE id <= ?`,
      { replacements: [belgi.mijoz], transaction: t });
    await sequelize.query(`
      UPDATE mijoz m
      LEFT JOIN (SELECT mijoz_id, SUM(jami_summa) s FROM ariza WHERE deletedAt IS NULL AND turi = 'sotish'
                   AND holat = 'yetkazildi' GROUP BY mijoz_id) o ON o.mijoz_id = m.id
      LEFT JOIN (SELECT mijoz_id, SUM(summa) s FROM kassa WHERE tur = 'kirim' AND mijoz_id IS NOT NULL
                   GROUP BY mijoz_id) b ON b.mijoz_id = m.id
      SET m.balans = COALESCE(b.s, 0) - COALESCE(o.s, 0)
      WHERE m.deletedAt IS NULL`, { transaction: t });

    // Yetkazuvchi: harakatlar tarixidan (to'lov − qarz), hisobot bilan mos
    await sequelize.query(`INSERT IGNORE INTO demo_prez_balans (jadval, row_id, balans)
                           SELECT 'yetkazuvchi', id, balans FROM yetkazuvchi WHERE id <= ?`,
      { replacements: [belgi.yetkazuvchi], transaction: t });
    await sequelize.query(`
      UPDATE yetkazuvchi y
      LEFT JOIN (SELECT yetkazuvchi_id, SUM(CASE WHEN tur = 'tolov' THEN summa ELSE -summa END) s
                 FROM yetkazuvchi_harakatlar GROUP BY yetkazuvchi_id) h ON h.yetkazuvchi_id = y.id
      SET y.balans = COALESCE(h.s, 0)`, { transaction: t });

    for (const j of LOG_JADVALLAR) {
      await sequelize.query(`INSERT IGNORE INTO demo_prez_log (jadval, row_id) SELECT ?, id FROM \`${j}\` WHERE id > ?`,
        { replacements: [j, belgi[j]], transaction: t });
    }
    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

/* ═══════════════════════════════════════════════════════════════
 *  HISOBOT
 * ═══════════════════════════════════════════════════════════════ */
function hisobot(S, D) {
  const { R, agentlar, mijozlar, stok, kamlar } = S;
  const sotuv = R.ariza.filter(a => a.turi === 'sotish' && a.holat !== 'bekor');
  console.log(`\n  Davr           : ${S.kunlar[0]} … ${BUGUN} (${S.kunlar.length} ish kuni), hozir ${soatMin(HOZIR)} Toshkent`);
  console.log(`  Ariza          : ${R.ariza.length} (sotish ${sotuv.length}, qaytarish ${R.ariza.filter(a => a.turi === 'qaytarish').length})`);
  console.log(`  Prixod         : ${R.prixod.length} hujjat, ${R.prixodQator.length} qator`);
  console.log(`  Tashrif / reja : ${R.tashrif.length} / ${R.reja.length}   GPS: ${R.gps.length}`);
  console.log(`  Kassa          : ${R.kassa.length}   Trip: ${R.trip.length}   Inkassatsiya: ${R.inkas.length}`);
  console.log(`  Yangi mijoz    : ${R.mijoz.length}   Audit: ${R.audit.length}   Sotmaslik: ${R.sotmaslik.length}`);

  console.log('\n  Agent savdosi (mln) va reja:');
  for (const a of agentlar) {
    const oy = (o) => sotuv.filter(x => x.agent.id === a.id && mahalliyKun(x.createdAt).startsWith(o))
      .reduce((s, x) => s + x.jami_summa, 0);
    console.log(`    ${a.fullname.padEnd(18)} reja ${mln(+a.plan_summa).padStart(5)} · sen ${mln(oy('2026-09')).padStart(5)} ` +
      `(${Math.round(oy('2026-09') / a.plan_summa * 100)}%) · okt ${mln(oy('2026-10')).padStart(5)}`);
  }

  const bugun = R.ariza.filter(a => mahalliyKun(a.createdAt) === BUGUN);
  const holatlar = {};
  R.ariza.filter(a => a.turi === 'sotish' && a.createdAt >= vaqt(BUGUN.slice(0, 8) + '01', 0))
    .forEach(a => { holatlar[a.holat] = (holatlar[a.holat] || 0) + 1; });
  const bugunJonatish = {};
  R.ariza.filter(a => a.jonatish_sana === BUGUN).forEach(a => { bugunJonatish[a.holat] = (bugunJonatish[a.holat] || 0) + 1; });
  console.log(`\n  Bu oy holatlar : ${JSON.stringify(holatlar)}`);
  console.log(`  Bugun jo'natish: ${JSON.stringify(bugunJonatish)}`);
  console.log(`  Bugun yaratildi: ${bugun.length} ariza · to'lov ${mln(R.kassa.filter(k => k.kategoriya === 'mijoz_tolov' && mahalliyKun(k.sana) === BUGUN).reduce((s, k) => s + k.summa, 0))} mln`);
  console.log(`  Bugungi triplar: ${R.trip.filter(x => x.sana === BUGUN).map(x => x.holat).join(', ') || '—'}`);
  console.log(`  Qabul kutmoqda : ${R.ariza.filter(a => a.holat === 'qabul_kutilmoqda').length} ta qaytarish`);

  const qarzdorlar = mijozlar.filter(m => m.qarz > 50000).sort((a, b) => b.qarz - a.qarz);
  console.log(`\n  Qarz (sim)     : ${mln(qarzdorlar.reduce((s, m) => s + m.qarz, 0))} mln, ${qarzdorlar.length} mijoz; top: ` +
    qarzdorlar.slice(0, 4).map(m => `${m.nomi} ${mln(m.qarz)}`).join(', '));
  if (process.argv.includes('--batafsil')) {
    const oylar = {};
    const qo = (oy, k, v) => { (oylar[oy] ||= {}); oylar[oy][k] = (oylar[oy][k] || 0) + v; };
    sotuv.forEach(a => qo(mahalliyKun(a.createdAt).slice(0, 7), 'sotuv', a.jami_summa));
    R.prixod.filter(p => p.holat === 'tasdiqlangan').forEach(p => qo(mahalliyKun(p.sana).slice(0, 7), 'prixod', p.jami_summa));
    R.kassa.forEach(k => qo(mahalliyKun(k.sana).slice(0, 7), `${k.tur === 'kirim' ? '+' : '-'}${k.kategoriya}/${k.tolov_usul}`, k.summa));
    for (const [oy, v] of Object.entries(oylar)) {
      console.log(`  ${oy}: ` + Object.entries(v).map(([k, x]) => `${k} ${mln(x)}`).join(' · '));
    }
  }
  const kb = {};
  D.kassaBalans.forEach(r => { kb[r.tolov_usul] = +r.b; });
  R.kassa.forEach(k => { kb[k.tolov_usul] = (kb[k.tolov_usul] || 0) + (k.tur === 'kirim' ? k.summa : -k.summa); });
  console.log(`  Kassa qoldig'i : naqd ${mln(kb.naqt || 0)} · bank ${mln(kb.bank || 0)} · karta ${mln(kb.karta || 0)} mln`);
  console.log(`  Kam qoldiq     : ${kamlar.map(t => `${t.nomi} (${stok[t.id]})`).join(', ')}`);
  const minStok = Math.min(...S.tovarlar.filter(t => !t.kam).map(t => stok[t.id]));
  console.log(`  Eng kam boshqa : ${minStok} dona`);
}

/* ═══════════════════════════════════════════════════════════════ */
(async () => {
  try {
    await sequelize.authenticate();
    console.log('');
    if (process.argv.includes('--tozala')) {
      console.log((await tozala()) ? '  Tozalandi: prezentatsiya ma\'lumotlari olib tashlandi, balanslar qaytarildi'
                                   : '  Tozalanadigan narsa yo\'q');
      console.log('');
      process.exit(0);
    }
    if (!SINOV) await tozala();
    const D = await yuklash();
    if (SINOV && (await jadvalBormi('demo_prez_log'))) {
      console.log('  (diqqat: avvalgi prezentatsiya ma\'lumoti bazada — sinov natijasi aniq emas)');
    }
    // Kalibrlash: agentlarning sentabr savdosini o'lchab, rejaga moslaymiz
    // (zaxira va tasodif o'zgargani uchun bir necha o'tishda yaqinlashadi)
    // Tasodif zaxira orqali tarqalgani uchun aniq yaqinlashmaydi — eng yaqin o'tish olinadi.
    let tuzatish = null, S = null, engKam = Infinity;
    for (let otish = 0; otish < 6; otish++) {
      const sin = simulyatsiya(structuredClone(D), tuzatish);
      let xato = 0;
      const yangi = sin.agentlar.map((a, i) => {
        const sen = sin.R.ariza.filter(x => x.turi === 'sotish' && x.holat !== 'bekor' && x.agent.id === a.id
          && mahalliyKun(x.createdAt).startsWith('2026-09')).reduce((s, x) => s + x.jami_summa, 0);
        const k = sen > 0 ? (+a.plan_summa * (BAJARISH[i] ?? 0.9)) / sen : 1;
        xato += Math.abs(1 - 1 / k);
        return (tuzatish ? tuzatish[i] : 1) * Math.pow(k, 0.7);
      });
      if (xato < engKam) { engKam = xato; S = sin; }
      tuzatish = yangi;
    }
    hisobot(S, D);
    if (SINOV) {
      console.log('\n  Sinov rejimi — bazaga hech narsa yozilmadi\n');
      process.exit(0);
    }
    console.log('\n  Bazaga yozilmoqda...');
    await yozish(S, D);
    const [[c]] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM demo_prez_log) jami,
        (SELECT COUNT(*) FROM mijoz WHERE balans < 0 AND deletedAt IS NULL) qarzdor,
        (SELECT ROUND(-SUM(balans)/1e6, 1) FROM mijoz WHERE balans < 0 AND deletedAt IS NULL) qarz`);
    console.log(`  Tayyor: ${c.jami} ta yozuv · qarzdorlar ${c.qarzdor} ta, ${c.qarz} mln so'm\n`);
    process.exit(0);
  } catch (e) {
    console.error('  XATO:', e.message);
    process.exit(1);
  }
})();
