/**
 * ═══════════════════════════════════════════════════════════════════
 *  AVTOLAVKA DEMO — ko'chma savdo jarayoni uchun ma'lumot
 * ═══════════════════════════════════════════════════════════════════
 *
 * Uchta avtolavka agenti (login avto / avto2 / avto3, parol test123) va
 * ularning mijozlari yaratiladi. 29-sentabrdan bugungacha har ish kuni:
 *
 *   07:55  yuklash hujjati (YK-…)   — tovar asosiy ombordan agent omboriga
 *   09:00  tashriflar, GPS          — mijozlarga sotuv (naqd / qarz), qarz undirish,
 *                                     sotmaslik, chiqim agent omboridan
 *   17:45  qabul hujjati (QB-…)     — qoldiq skladga; ba'zan farq yoki brak
 *   18:20  inkassatsiya              — naqd kassaga; ba'zan kamomad
 *
 * Bugungi kun hozirgi vaqtgacha to'ldiriladi. Markazda turli holatlar
 * ko'rinsin deb: Jahongir va Sardor bugun savdoda; Rustam hali yuklanmagan
 * (ertalabki "Tavsiya bo'yicha yuklash" ni jonli ko'rsatish uchun); Sardorning
 * o'tgan shanbadagi puli kassaga topshirilmagan (kalendarda sariq).
 *
 * Ishga tushirish:  npm run demo:avtolavka
 * Tozalash:         npm run demo:avtolavka -- --tozala
 *
 * Yozuvlar avtolavka_hujjat/avtolavka_qator (agent bo'yicha), ariza/kassa/
 * tovar_register (manba orqali) va demo_avto_log jadvali orqali topiladi;
 * --tozala hammasini o'chiradi, asosiy ombor qoldig'i o'z-o'zidan tiklanadi.
 *
 * demo_avto_log'ga har qatorning id'si AYNAN qo'shilgan paytda yoziladi
 * (ilgari "MAX(id) dan kattalar" deb olinardi — shu orada real foydalanuvchi
 * yaratgan qatorlar ham demo deb belgilanib, --tozala bilan o'chib ketardi).
 * NODE_ENV=production da ishlamaydi (faqat --majburiy bilan).
 */

require('dotenv').config();
const bcrypt = require('bcryptjs');
const sequelize = require('../src/db/db-sequelize');
const { ishlabChiqarishTaqiq } = require('./lib/demo-utils');
ishlabChiqarishTaqiq('seed-avtolavka');
sequelize.options.logging = false;

const TAG        = 'DEMO-AVTO';
const BOSHLANISH = '2026-09-29';
const TZ         = 5;
const ASOSIY     = 'Основной склад';
const BRAK       = 'Brak ombori';
const ADMIN_ID   = 1;
const HOZIR      = new Date();

/* Uch mashina — markazda turli holatlar ko'rinsin:
     bugunYuklanmaydi: ertalab hali yuklanmagan (jonli yuklashni ko'rsatish uchun)
     pulTopshirmagan:  shu kuni qabul bo'lgan, lekin pul kassaga topshirilmagan */
const AGENTLAR = [
  { fullname: 'Jahongir Mirzayev', login: 'avto', telefon: '+998912004455', mashina_raqam: '40 A 777 BA',
    markaz: { lat: 40.3864, lng: 71.7864 }, kamomad: 0.12, farq: 0.2,
    mijozlar: [
      ["Oqtepa do'koni", 'A', 'naqd'], ['Yulduzcha market', 'B', 'naqd'], ["Baxt do'koni", 'C', 'qarz'],
      ['Chashma minimarket', 'B', 'naqd'], ["Mehribon do'koni", 'C', 'aralash'], ['Sohil savdo', 'A', 'qarz'],
      ["Dilbar do'koni", 'D', 'naqd'], ['Orzu market', 'B', 'aralash'], ["Guliston do'koni", 'C', 'naqd'],
      ['Navbahor minimarket', 'D', 'qarz'],
    ] },
  { fullname: 'Sardor Qodirov', login: 'avto2', telefon: '+998935557811', mashina_raqam: '40 B 512 CA',
    markaz: { lat: 40.4120, lng: 71.7450 }, kamomad: 0.2, farq: 0.25, pulTopshirmagan: '2026-10-10',
    mijozlar: [
      ["Kamalak do'koni", 'B', 'naqd'], ['Istiqbol market', 'A', 'aralash'], ["Shabnam do'koni", 'C', 'naqd'],
      ['Bog\'ishamol savdo', 'B', 'qarz'], ["Lazzat do'koni", 'D', 'naqd'], ['Tong minimarket', 'C', 'aralash'],
      ["Nur do'koni", 'C', 'naqd'], ['Xonobod market', 'B', 'qarz'],
    ] },
  { fullname: 'Rustam Ergashev', login: 'avto3', telefon: '+998977103366', mashina_raqam: '40 C 208 DA',
    markaz: { lat: 40.3610, lng: 71.8220 }, kamomad: 0.06, farq: 0.1, bugunYuklanmaydi: true,
    mijozlar: [
      ["Bahor do'koni", 'B', 'naqd'], ['Quvasoy market', 'A', 'naqd'], ["Ziyo do'koni", 'C', 'aralash'],
      ['Saxovat savdo', 'B', 'qarz'], ["Ipak yo'li do'koni", 'C', 'naqd'], ['Sharq minimarket', 'D', 'naqd'],
      ["Umid do'koni", 'C', 'aralash'], ['Vodiy market', 'B', 'naqd'],
    ] },
];
const AGENT_UMUMIY = {
  territoriya_id: 1, plan_summa: 45000000, bonus_foiz: 2, kredit_limit: 3000000, transport: 'avto',
  tashrif_kunlari: 'Du,Se,Ch,Pa,Ju,Sh', radius_km: 40, boshlanish_manzil: "Farg'ona sh.", izoh: TAG,
};
const SABABLAR = [[1, "Pul yo'q"], [2, 'Zaxira yetarli'], [3, 'Mijoz yopiq'], [5, 'Keyinroq keling']];
const LOG_JADVALLAR = [
  'agent_location', 'sotmaslik', 'tashrif', 'marshrut_reja', 'inkassatsiya', 'agent_register',
  'kassa', 'tovar_register', 'ariza_qator', 'ariza', 'avtolavka_qator', 'avtolavka_hujjat', 'mijoz', 'agent',
];

/* ── Urug'li tasodif ── */
let urug = 20260929;
function rand() {
  urug = (urug + 0x6D2B79F5) | 0;
  let t = Math.imul(urug ^ (urug >>> 15), 1 | urug);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rnd = (a, b) => a + Math.floor(rand() * (b - a + 1));
const chance = (p) => rand() < p;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const aralash = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const pad = (n, k) => String(n).padStart(k, '0');
const vaqt = (kun, soat, daq = 0) => new Date(Date.UTC(+kun.slice(0, 4), +kun.slice(5, 7) - 1, +kun.slice(8, 10), soat - TZ, daq));
const qosh = (d, daq) => new Date(d.getTime() + daq * 60000);
const dbVaqt = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
const mahalliyKun = (d) => new Date(d.getTime() + TZ * 3600000).toISOString().slice(0, 10);
const kunQosh = (kun, n) => { const d = new Date(kun + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const haftaKuni = (kun) => new Date(kun + 'T00:00:00Z').getUTCDay();
const BUGUN = mahalliyKun(HOZIR);
const siljit = (p, m) => { const b = rand() * 2 * Math.PI; return { lat: +(p.lat + (m / 111320) * Math.cos(b)).toFixed(7), lng: +(p.lng + (m / (111320 * Math.cos(p.lat * Math.PI / 180))) * Math.sin(b)).toFixed(7) }; };

const q = async (sql, r) => (await sequelize.query(sql, { replacements: r }))[0];
async function jadvalBormi(nom) {
  const [r] = await sequelize.query(`SELECT COUNT(*) c FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, { replacements: [nom] });
  return r[0].c > 0;
}
const qiymat = (v) => (v instanceof Date ? dbVaqt(v) : v === undefined ? null : v);
/* Skript qo'shgan qatorlar: jadval → [id]. Faqat shu ro'yxat demo_avto_log'ga yoziladi. */
const yangiIdlar = {};
async function bitta(jadval, row, t) {
  const cols = Object.keys(row);
  const [id] = await sequelize.query(
    `INSERT INTO \`${jadval}\` (${cols.map(c => '`' + c + '`').join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    { replacements: cols.map(c => qiymat(row[c])), transaction: t });
  (yangiIdlar[jadval] = yangiIdlar[jadval] || []).push(id);
  return id;
}
/* Ko'p qatorli INSERT o'rniga qatorma-qator: har id aniq ma'lum bo'ladi
   (bulk INSERT'da parallel yozuvlar bilan id'lar aralashishi mumkin) */
async function kop(jadval, rows, t) {
  for (const r of rows) await bitta(jadval, r, t);
}

/* ── Tozalash ── */
async function tozala() {
  if (!(await jadvalBormi('demo_avto_log'))) return false;
  const t = await sequelize.transaction();
  try {
    /* Demo agentlar bilan keyin (UI yoki mobil orqali) qilingan amallar ham
       o'chiriladi — aks holda qayta seed'da agent ombori eski qoldiq bilan qoladi */
    const agentlar = await q(`SELECT a.id, a.fullname FROM agent a
      JOIN demo_avto_log l ON l.jadval = 'agent' AND l.row_id = a.id`);
    if (agentlar.length) {
      const ids = agentlar.map(a => a.id);
      // Demo agentlarning mijozlari (ham jurnal orqali) — kassa.user_id boshqa jadvallar
      // (dostavchi/user) id'lari bilan ustma-ust tushishi mumkin, shuning uchun mijoz bilan cheklaymiz
      const mijozIds = (await q(`SELECT row_id id FROM demo_avto_log WHERE jadval = 'mijoz'`)).map(x => x.id);
      const r = { ids, mijozIds: mijozIds.length ? mijozIds : [0] };
      const d = (sql) => sequelize.query(sql, { replacements: r, transaction: t });
      await d(`DELETE FROM tovar_register WHERE manba_tur IN ('yuklash','qabul')
               AND manba_id IN (SELECT id FROM avtolavka_hujjat WHERE agent_id IN (:ids))`);
      /* Ilgari ombor NOMI bo'yicha ham o'chirilardi ('Agent: <ism>') — bir xil ismli
         real agent omboriga tegib ketishi mumkin edi. Agent omboridagi demo
         yozuvlar baribir yuklash/qabul/sotuv manbalari orqali topiladi. */
      await d(`DELETE FROM tovar_register WHERE manba_tur IN ('sotuv','qaytarma')
               AND manba_id IN (SELECT id FROM ariza WHERE agent_id IN (:ids))`);
      await d(`DELETE FROM avtolavka_qator WHERE hujjat_id IN (SELECT id FROM avtolavka_hujjat WHERE agent_id IN (:ids))`);
      await d(`DELETE FROM avtolavka_hujjat WHERE agent_id IN (:ids)`);
      await d(`DELETE FROM kassa WHERE user_id IN (:ids) AND manba_tur IN ('mijoz','avtolavka') AND mijoz_id IN (:mijozIds)`);
      await d(`DELETE FROM kassa WHERE manba_tur = 'ariza' AND manba_id IN (SELECT id FROM ariza WHERE agent_id IN (:ids))`);
      await d(`DELETE FROM agent_register WHERE agent_id IN (:ids)`);
      await d(`DELETE FROM ariza_qator WHERE ariza_id IN (SELECT id FROM ariza WHERE agent_id IN (:ids))`);
      await d(`DELETE FROM ariza WHERE agent_id IN (:ids)`);
      await d(`DELETE FROM inkassatsiya WHERE agent_id IN (:ids)`);
      for (const j of ['tashrif', 'marshrut_reja', 'sotmaslik']) await d(`DELETE FROM ${j} WHERE agent_id IN (:ids)`);
      await d(`DELETE FROM agent_location WHERE agent_id IN (:ids) AND rol = 'agent'`);
    }
    for (const j of LOG_JADVALLAR) {
      await sequelize.query(`DELETE FROM \`${j}\` WHERE id IN (SELECT row_id FROM demo_avto_log WHERE jadval = ?)`,
        { replacements: [j], transaction: t });
    }
    await t.commit();
  } catch (e) { await t.rollback(); throw e; }
  await sequelize.query('DROP TABLE IF EXISTS demo_avto_log');
  return true;
}

/* ── Seed ── */
async function seed() {
  await tozala();
  await sequelize.query(`CREATE TABLE IF NOT EXISTS demo_avto_log (jadval VARCHAR(40) NOT NULL, row_id INT NOT NULL, PRIMARY KEY (jadval, row_id))`);


  /* Tovarlar: asosiy ombordagi qoldiq + narxlar (controller bilan bir xil manba) */
  const tovarlar = await q(`
    SELECT t.id, t.nomi, t.turkum, t.blokdagi_soni bs,
      COALESCE((SELECT SUM(donada) FROM tovar_register r WHERE r.tovar_id = t.id AND r.ombor = :ombor), 0) qoldiq,
      (SELECT AVG(kirim_narx) FROM tovar_register r WHERE r.tovar_id = t.id AND r.tur = 'kirim' AND r.kirim_narx > 0) kirim_narx,
      (SELECT r2.optom_narx FROM tovar_register r2 WHERE r2.tovar_id = t.id AND r2.optom_narx > 0 ORDER BY r2.sana DESC, r2.id DESC LIMIT 1) optom_narx,
      (SELECT r3.chakana_narx FROM tovar_register r3 WHERE r3.tovar_id = t.id AND r3.chakana_narx > 0 ORDER BY r3.sana DESC, r3.id DESC LIMIT 1) chakana_narx
    FROM tovar t WHERE t.deletedAt IS NULL AND t.faol = 1 AND t.nomi NOT LIKE 'Test%'`, { ombor: ASOSIY });
  const stok = {};
  const katalog = tovarlar
    .map(t => ({ ...t, bs: Math.max(1, +t.bs || 1), qoldiq: +t.qoldiq, kirim_narx: Math.round(+t.kirim_narx || 0),
                 optom_narx: +t.optom_narx || 0, chakana_narx: +t.chakana_narx || 0,
                 vazn: (/Coca|Fanta|Sprite|Pepsi|Suv|Non|Sut |Kefir|Yogurt|Shakar|Yog'|Makaron|Pechenye|Shokolad|Sovun|Salfetka/.test(t.nomi) ? 2 : 1) * (0.6 + rand()) }))
    .filter(t => t.chakana_narx > 0 && t.kirim_narx > 0 && t.qoldiq >= 60)
    .sort((a, b) => b.vazn - a.vazn).slice(0, 18);
  if (katalog.length < 8) throw new Error('Asosiy omborda yetarli tovar yo\'q — avval npm run demo:prezentatsiya');
  katalog.forEach(t => { stok[t.id] = Math.floor(t.qoldiq); });

  const [ag] = await q(`SELECT COUNT(*) n FROM agent WHERE login IN (:l)`, { l: AGENTLAR.map(a => a.login) });
  if (ag.n) throw new Error('avto/avto2/avto3 loginli agent allaqachon bor');

  /* Hujjat raqamlari — mavjudlardan davom etadi */
  const sonlar = {};
  for (const [tur, pref] of [['yuklash', 'YK'], ['qabul', 'QB']]) {
    const [r] = await q(`SELECT COALESCE(MAX(CAST(SUBSTRING(raqam, 9) AS UNSIGNED)), 0) n FROM avtolavka_hujjat WHERE raqam LIKE '${pref}-2026-%'`);
    sonlar[tur] = +r.n;
  }
  const [ar] = await q(`SELECT COALESCE(MAX(CAST(SUBSTRING(raqam, 9) AS UNSIGNED)), 0) n FROM ariza WHERE raqam REGEXP '^AR-2026-[0-9]+$'`);
  let arizaNo = +ar.n;

  const t = await sequelize.transaction();
  try {
    /* 1. Agentlar va mijozlar */
    const parol = await bcrypt.hash('test123', 8);
    const vanlar = [];
    for (const [ai, cfg] of AGENTLAR.entries()) {
      const { mijozlar: mList, markaz, kamomad, farq, pulTopshirmagan, bugunYuklanmaydi, ...maydon } = cfg;
      const agentId = await bitta('agent', {
        ...AGENT_UMUMIY, ...maydon, parol, faol: 1, dual_role: 0, avtolavka: 1,
        ish_boshlagan: '2026-09-25', createdAt: vaqt('2026-09-25', 10, ai * 9), updatedAt: vaqt('2026-09-25', 10, ai * 9),
      }, t);
      const mijozlar = [];
      for (const [i, [nomi, sinf, tolov]] of mList.entries()) {
        const p = siljit(markaz, rnd(800, 4500));
        const id = await bitta('mijoz', {
          nomi, telefon: '+9989' + pick(['0', '1', '3', '4', '7', '9']) + rnd(1000000, 9999999),
          manzil: `Farg'ona sh., ${pick(["Mustaqillik ko'chasi", "Al-Farg'oniy ko'chasi", "Marg'ilon ko'chasi", "Yangi Chek mahallasi", 'Kirguli mavzesi'])}, ${rnd(2, 90)}-uy`,
          territoriya_id: 1, kategoriya_id: sinf === 'A' ? 2 : 1, agent_id: agentId, sinf, narx_turi: 'chakana',
          balans: 0, kredit_limit: sinf === 'A' ? 5000000 : 2500000, tolov_muddati_kun: 14,
          tashrif_kunlari: 'Du, Se, Ch, Pa, Ju, Sh', lat: p.lat, lng: p.lng, faol: 1, izoh: TAG,
          createdAt: vaqt('2026-09-26', 11, ai * 20 + i), updatedAt: vaqt('2026-09-26', 11, ai * 20 + i),
        }, t);
        mijozlar.push({ id, nomi, sinf, tolov, lat: p.lat, lng: p.lng, assort: aralash(katalog).slice(0, rnd(7, 11)), qarz: 0 });
      }
      vanlar.push({
        id: agentId, fullname: cfg.fullname, bonus: AGENT_UMUMIY.bonus_foiz, markaz, kamomad, farq, pulTopshirmagan, bugunYuklanmaydi,
        OMBOR: ('Agent: ' + cfg.fullname).slice(0, 80), mijozlar, mashina: {},
      });
    }

    /* Register yozuvi (controller regYozuv bilan bir xil) */
    const reg = (tv, ombor, tur, manba_tur, manba_id, dona, sana, sotuvNarx = null) => {
      const ishora = tur === 'kirim' ? 1 : -1;
      return {
        tovar_id: tv.id, tovar_nomi: tv.nomi, turkum: tv.turkum, ombor, tur, manba_tur, manba_id,
        donada: ishora * dona, bloklarda: 0, qutilarda: 0, hajm: 0,
        kirim_narx: manba_tur === 'sotuv' ? 0 : tv.kirim_narx, optom_narx: tv.optom_narx, chakana_narx: tv.chakana_narx,
        sotuv_narx: sotuvNarx ?? tv.chakana_narx,
        summa: ishora * dona * (manba_tur === 'sotuv' ? (sotuvNarx ?? tv.chakana_narx) : tv.kirim_narx),
        sana, createdAt: sana, updatedAt: sana,
      };
    };

    const kunlar = [];
    for (let k = BOSHLANISH; k <= BUGUN; k = kunQosh(k, 1)) if (haftaKuni(k) !== 0) kunlar.push(k);
    const natija = { kun: 0, yuklash: 0, qabul: 0, sotuv: 0, tolov: 0, tashrif: 0, inkas: 0, kamomad: 0, farq: 0 };

    for (const kun of kunlar) {
     const bugunmi = kun === BUGUN;
     if (vaqt(kun, 7, 50) > HOZIR) break;
     natija.kun++;
     for (const [vi, van] of vanlar.entries()) {
      const { id: agentId, OMBOR, mijozlar, mashina, markaz } = van;
      const agent = van;
      const yukVaqt = vaqt(kun, 7, 52 + vi * 6);
      if (yukVaqt > HOZIR || (bugunmi && van.bugunYuklanmaydi)) continue;

      /* ── YUKLASH ── */
      const qatorlar = [];
      for (const tv of katalog) {
        const kerak = Math.max(0, tv.bs * rnd(2, 4) * (tv.vazn > 1.6 ? 2 : 1) - (mashina[tv.id] || 0));
        const mumkin = Math.max(0, stok[tv.id] - 20);
        const dona = Math.min(kerak, Math.floor(mumkin / tv.bs) * tv.bs);
        if (dona <= 0 || chance(0.15)) continue;
        qatorlar.push({ tv, dona });
      }
      const yuk = {
        raqam: `YK-2026-${pad(++sonlar.yuklash, 4)}`, tur: 'yuklash', agent_id: agentId, agent_nomi: agent.fullname,
        ombor: OMBOR, sana: kun, holat: 'tasdiqlangan',
        jami_dona: qatorlar.reduce((s2, x) => s2 + x.dona, 0),
        jami_summa: qatorlar.reduce((s, x) => s + x.dona * x.tv.chakana_narx, 0),
        farq_dona: 0, brak_dona: 0, izoh: 'Ertalabki yuklash', yaratgan_id: ADMIN_ID,
        tasdiqlagan_id: ADMIN_ID, tasdiqlagan_sana: yukVaqt, createdAt: qosh(yukVaqt, -6), updatedAt: yukVaqt,
      };
      yuk.id = await bitta('avtolavka_hujjat', yuk, t);
      await kop('avtolavka_qator', qatorlar.map(x => ({
        hujjat_id: yuk.id, tovar_id: x.tv.id, tovar_nomi: x.tv.nomi, turkum: x.tv.turkum,
        narx: x.tv.chakana_narx, kirim_narx: x.tv.kirim_narx, blok: Math.floor(x.dona / x.tv.bs), dona: x.dona,
        brak_dona: 0, farq_dona: 0, summa: x.dona * x.tv.chakana_narx, createdAt: yukVaqt, updatedAt: yukVaqt,
      })), t);
      await kop('tovar_register', qatorlar.flatMap(x => [
        reg(x.tv, ASOSIY, 'chiqim', 'yuklash', yuk.id, x.dona, yukVaqt),
        reg(x.tv, OMBOR,  'kirim',  'yuklash', yuk.id, x.dona, yukVaqt),
      ]), t);
      qatorlar.forEach(x => { stok[x.tv.id] -= x.dona; mashina[x.tv.id] = (mashina[x.tv.id] || 0) + x.dona; });
      natija.yuklash++;

      /* ── TASHRIFLAR ── */
      const reja = aralash(mijozlar).slice(0, rnd(7, 9));
      const rejaVaqt = vaqt(kunQosh(kun, -1), 18, 10);
      const rejaIds = {};
      for (const [i, m] of reja.entries()) {
        rejaIds[m.id] = await bitta('marshrut_reja', { agent_id: agentId, mijoz_id: m.id, sana: kun, tartib: i + 1, createdAt: rejaVaqt, updatedAt: rejaVaqt }, t);
      }
      let tVaqt = qosh(yukVaqt, rnd(40, 65));
      let pos = markaz, bat = rnd(90, 100);
      const gps = [], kunNaqd = [];
      gps.push({ agent_id: agentId, rol: 'agent', ...siljit(pos, 20), battery: bat, sana: tVaqt, createdAt: tVaqt, updatedAt: tVaqt });
      let toxtadi = false;

      for (const m of reja) {
        if (chance(0.1)) continue;                                   // rejadagi bittasiga kirolmadi
        const yol = rnd(8, 22);
        gps.push({ agent_id: agentId, rol: 'agent', ...siljit({ lat: (pos.lat + m.lat) / 2, lng: (pos.lng + m.lng) / 2 }, 60), battery: bat, sana: qosh(tVaqt, yol / 2), createdAt: qosh(tVaqt, yol / 2), updatedAt: qosh(tVaqt, yol / 2) });
        const kelish = qosh(tVaqt, yol);
        if (kelish > HOZIR) { if (bugunmi) gps.push({ agent_id: agentId, rol: 'agent', ...siljit({ lat: (pos.lat + m.lat) / 2, lng: (pos.lng + m.lng) / 2 }, 60), battery: bat, sana: qosh(HOZIR, -2), createdAt: qosh(HOZIR, -2), updatedAt: qosh(HOZIR, -2) }); toxtadi = true; break; }
        tVaqt = kelish; pos = m; bat -= rnd(2, 4);
        const ci = siljit(m, rnd(5, 60));
        gps.push({ agent_id: agentId, rol: 'agent', ...ci, battery: bat, sana: tVaqt, createdAt: tVaqt, updatedAt: tVaqt });

        const savdo = chance(0.78);
        const davom = savdo ? rnd(12, 26) : rnd(4, 10);
        const chiqish = qosh(tVaqt, davom);
        const hozirShuyerda = chiqish > HOZIR;
        const tashrif = {
          reja_id: rejaIds[m.id] || null, agent_id: agentId, agent_nomi: agent.fullname, mijoz_id: m.id, mijoz_nomi: m.nomi,
          checkin_vaqt: tVaqt, checkin_lat: ci.lat, checkin_lng: ci.lng, checkin_masofa: rnd(5, 60),
          checkout_vaqt: hozirShuyerda ? null : chiqish, checkout_lat: hozirShuyerda ? null : ci.lat, checkout_lng: hozirShuyerda ? null : ci.lng,
          davomiylik_sek: hozirShuyerda ? null : davom * 60, natija: hozirShuyerda ? 'ochiq' : (savdo ? 'savdo' : 'sotmaslik'),
          ariza_id: null, sana: kun, createdAt: tVaqt, updatedAt: hozirShuyerda ? tVaqt : chiqish,
        };

        if (!hozirShuyerda && savdo) {
          /* Sotuv — mashinadagi tovardan */
          const satr = [];
          for (const tv of aralash(m.assort).slice(0, rnd(3, 6))) {
            const bor = mashina[tv.id] || 0;
            if (bor <= 0) continue;
            // DEMO_VAN_KICHIK=1 — narxlari yuqori bazada bitta sotuv haddan oshmasin, zaxira butun davrga yetsin
            let dona = Math.min(bor, process.env.DEMO_VAN_KICHIK === '1' ? rnd(2, 6) : (tv.bs > 1 ? tv.bs * rnd(1, 3) : rnd(4, 15)));
            if (m.sinf === 'A') dona = Math.min(bor, dona * 2);
            satr.push({ tv, dona, narx: tv.chakana_narx, summa: dona * tv.chakana_narx });
          }
          if (satr.length) {
            const summa = satr.reduce((s, x) => s + x.summa, 0);
            const naqd = m.tolov === 'naqd' || (m.tolov === 'aralash' && chance(0.5));
            const sVaqt = qosh(tVaqt, davom - rnd(1, 3));
            const raqam = `AR-2026-${pad(++arizaNo, 4)}`;
            const arizaId = await bitta('ariza', {
              raqam, holat: 'yetkazildi', turi: 'sotish', manba: 'mobil', kanal: 'avtolavka', mijoz_id: m.id, mijoz_nomi: m.nomi,
              agent_id: agentId, agent_nomi: agent.fullname, jami_summa: summa, chegirma_foiz: 0, chegirma_summa: 0, bonus_summa: 0,
              tolov_turi: naqd ? 'naqt' : 'qarz', ombor: OMBOR, jonatish_sana: kun, yetkazilgan_sana: sVaqt,
              createdAt: sVaqt, updatedAt: sVaqt,
            }, t);
            await kop('ariza_qator', satr.map(x => ({
              ariza_id: arizaId, tovar_id: x.tv.id, tovar_nomi: x.tv.nomi, turkum: x.tv.turkum, narx: x.narx,
              blok: x.tv.bs > 1 ? Math.floor(x.dona / x.tv.bs) : 0, dona: x.tv.bs > 1 ? x.dona % x.tv.bs : x.dona,
              hajm: 0, jami_dona: x.dona, summa: x.summa, chegirma_foiz: 0, chegirma_summa: 0, createdAt: sVaqt, updatedAt: sVaqt,
            })), t);
            await kop('tovar_register', satr.map(x => reg(x.tv, OMBOR, 'chiqim', 'sotuv', arizaId, x.dona, sVaqt, x.narx)), t);
            satr.forEach(x => { mashina[x.tv.id] -= x.dona; });
            const bonus = Math.round(summa * agent.bonus / 100);
            await bitta('agent_register', { agent_id: agentId, ariza_id: arizaId, tur: 'savdo', summa, bonus_foiz: agent.bonus, bonus_summa: bonus, sana: sVaqt, izoh: `${raqam} — ${m.nomi}`, createdAt: sVaqt, updatedAt: sVaqt }, t);
            if (naqd) {
              // mobile/savdo.controller: naqd sotuv → kassa 'avtolavka', user_id = agent
              await bitta('kassa', { tur: 'kirim', kategoriya: 'sotuv', summa, tolov_usul: 'naqt', manba_tur: 'avtolavka', manba_id: arizaId, mijoz_id: m.id, mijoz_nomi: m.nomi, izoh: `${raqam} — naqd sotuv`, sana: sVaqt, user_id: agentId, createdAt: sVaqt, updatedAt: sVaqt }, t);
              kunNaqd.push(summa);
            } else {
              m.qarz += summa;
            }
            tashrif.ariza_id = arizaId;
            natija.sotuv++;
          } else {
            tashrif.natija = 'sotmaslik';
          }
        }
        if (!hozirShuyerda && tashrif.natija === 'sotmaslik') {
          const sb = pick(SABABLAR);
          await bitta('sotmaslik', { agent_id: agentId, agent_nomi: agent.fullname, mijoz_id: m.id, mijoz_nomi: m.nomi, sabab_id: String(sb[0]), sabab_nomi: sb[1], sana: chiqish, createdAt: chiqish, updatedAt: chiqish }, t);
        }
        /* Eski qarzni undirish */
        if (!hozirShuyerda && m.qarz >= 100000 && chance(m.tolov === 'qarz' ? 0.45 : 0.7)) {
          const summa = chance(0.5) ? m.qarz : Math.round(m.qarz * (0.4 + rand() * 0.5) / 1000) * 1000;
          const pVaqt = qosh(tVaqt, Math.max(1, davom - 1));
          await bitta('kassa', { tur: 'kirim', kategoriya: 'mijoz_tolov', summa, tolov_usul: 'naqt', manba_tur: 'mijoz', manba_id: m.id, mijoz_id: m.id, mijoz_nomi: m.nomi, izoh: "Qarz to'lovi", sana: pVaqt, user_id: agentId, createdAt: pVaqt, updatedAt: pVaqt }, t);
          m.qarz -= summa; m.tolovlar += summa; kunNaqd.push(summa); natija.tolov++;
        }
        await bitta('tashrif', tashrif, t);
        natija.tashrif++;
        if (hozirShuyerda) { if (bugunmi) gps.push({ agent_id: agentId, rol: 'agent', ...siljit(ci, 8), battery: bat, sana: qosh(HOZIR, -1), createdAt: qosh(HOZIR, -1), updatedAt: qosh(HOZIR, -1) }); toxtadi = true; break; }
        tVaqt = chiqish;
      }
      await kop('agent_location', gps, t);

      /* ── QABUL (kun oxiri) ── */
      const qabVaqt = vaqt(kun, 17, 30 + vi * 9 + rnd(0, 6));
      if (!toxtadi && qabVaqt <= HOZIR) {
        const kutilgan = katalog.filter(tv => (mashina[tv.id] || 0) > 0).map(tv => ({ tv, kutilgan: mashina[tv.id] }));
        const farqTovar = chance(van.farq) ? pick(kutilgan) : null;
        const brakTovar = chance(0.18) ? pick(kutilgan.filter(x => x !== farqTovar)) : null;
        const qab = {
          raqam: `QB-2026-${pad(++sonlar.qabul, 4)}`, tur: 'qabul', agent_id: agentId, agent_nomi: agent.fullname, ombor: OMBOR,
          sana: kun, holat: 'tasdiqlangan', jami_dona: 0, jami_summa: 0, farq_dona: 0, brak_dona: 0,
          izoh: 'Kun oxiri qabul', yaratgan_id: ADMIN_ID, tasdiqlagan_id: ADMIN_ID, tasdiqlagan_sana: qabVaqt, createdAt: qabVaqt, updatedAt: qabVaqt,
        };
        qab.id = await bitta('avtolavka_hujjat', qab, t);
        const qRows = [], rRows = [];
        for (const x of kutilgan) {
          const brak = x === brakTovar ? Math.min(x.kutilgan, rnd(1, 2)) : 0;
          const farq = x === farqTovar ? Math.min(x.kutilgan - brak, rnd(1, 2)) : 0;
          const qabul = x.kutilgan - brak - farq;
          qRows.push({ hujjat_id: qab.id, tovar_id: x.tv.id, tovar_nomi: x.tv.nomi, turkum: x.tv.turkum, narx: x.tv.chakana_narx, kirim_narx: x.tv.kirim_narx, blok: 0,
            dona: qabul, kutilgan_dona: x.kutilgan, qabul_dona: qabul, brak_dona: brak, farq_dona: farq, summa: qabul * x.tv.chakana_narx, createdAt: qabVaqt, updatedAt: qabVaqt });
          if (qabul > 0) { rRows.push(reg(x.tv, OMBOR, 'chiqim', 'qabul', qab.id, qabul, qabVaqt), reg(x.tv, ASOSIY, 'kirim', 'qabul', qab.id, qabul, qabVaqt)); stok[x.tv.id] += qabul; }
          if (brak > 0)  rRows.push(reg(x.tv, OMBOR, 'chiqim', 'qabul', qab.id, brak, qabVaqt), reg(x.tv, BRAK, 'kirim', 'qabul', qab.id, brak, qabVaqt));
          mashina[x.tv.id] = farq;                       // farq agent omborida qoladi
          qab.jami_dona += qabul; qab.jami_summa += qabul * x.tv.chakana_narx; qab.farq_dona += farq; qab.brak_dona += brak;
        }
        await kop('avtolavka_qator', qRows, t);
        await kop('tovar_register', rRows, t);
        await sequelize.query(`UPDATE avtolavka_hujjat SET jami_dona = ?, jami_summa = ?, farq_dona = ?, brak_dona = ?,
            izoh = ? WHERE id = ?`,
          { replacements: [qab.jami_dona, qab.jami_summa, qab.farq_dona, qab.brak_dona,
            qab.farq_dona > 0 ? `Kun oxiri qabul. ${qab.farq_dona} dona yetishmadi — agent tushuntirish xati yozdi` : 'Kun oxiri qabul', qab.id], transaction: t });
        natija.qabul++; if (qab.farq_dona > 0) natija.farq++;

        /* ── INKASSATSIYA ── */
        const yigilgan = kunNaqd.reduce((s2, x) => s2 + x, 0);
        if (yigilgan > 0 && van.pulTopshirmagan !== kun) {
          const iVaqt = vaqt(kun, 18, rnd(15, 35));
          const kamomad = chance(van.kamomad);
          const topshirilgan = kamomad ? yigilgan - rnd(2, 6) * 10000 : yigilgan;
          await bitta('inkassatsiya', {
            agent_id: agentId, agent_nomi: agent.fullname, sana: kun, yigilgan_summa: yigilgan, topshirilgan_summa: topshirilgan,
            farq: topshirilgan - yigilgan, holat: kamomad ? 'kamomad' : 'yopiq',
            izoh: kamomad ? `Kamomad ${yigilgan - topshirilgan} so'm — agent ertaga to'laydi` : "To'liq topshirildi",
            tasdiqlagan_id: ADMIN_ID, tasdiqlagan_sana: qosh(iVaqt, 15), createdAt: iVaqt, updatedAt: iVaqt,
          }, t);
          natija.inkas++; if (kamomad) natija.kamomad++;
        }
      }
     }
    }

    /* Mijoz balansi: to'lovlar − qarz (manfiy = qarz) */
    for (const m of vanlar.flatMap(v => v.mijozlar)) {
      await sequelize.query('UPDATE mijoz SET balans = ? WHERE id = ?', { replacements: [-m.qarz, m.id], transaction: t });
    }

    // Faqat shu skript qo'shgan id'lar (bitta()/kop() yig'gan ro'yxat)
    for (const [j, ids] of Object.entries(yangiIdlar)) {
      for (let i = 0; i < ids.length; i += 500) {
        const b = ids.slice(i, i + 500);
        await sequelize.query(`INSERT IGNORE INTO demo_avto_log (jadval, row_id) VALUES ${b.map(() => '(?,?)').join(',')}`,
          { replacements: b.flatMap(id => [j, id]), transaction: t });
      }
    }
    await t.commit();
    return { natija, vanlar };
  } catch (e) {
    await t.rollback();
    await sequelize.query('DROP TABLE IF EXISTS demo_avto_log');
    throw e;
  }
}

(async () => {
  try {
    await sequelize.authenticate();
    console.log('');
    if (process.argv.includes('--tozala')) {
      console.log((await tozala()) ? '  Tozalandi: avtolavka demo agenti, mijozlari va hujjatlari olib tashlandi' : '  Tozalanadigan narsa yo\'q');
      console.log(''); process.exit(0);
    }
    const { natija, vanlar } = await seed();
    for (const v of vanlar) {
      const mashinada = Object.values(v.mashina).reduce((s, x) => s + x, 0);
      console.log(`  ${v.fullname.padEnd(18)}: ${v.mijozlar.length} mijoz · hozir mashinada ${mashinada} dona`);
    }
    console.log(`  Loginlar       : avto / avto2 / avto3, parol test123`);
    console.log(`  Ish kunlari    : ${natija.kun} (${BOSHLANISH} … ${BUGUN})`);
    console.log(`  Yuklash / qabul: ${natija.yuklash} / ${natija.qabul}   (farqli kun ${natija.farq})`);
    console.log(`  Sotuv / to'lov : ${natija.sotuv} / ${natija.tolov}   tashrif ${natija.tashrif}`);
    console.log(`  Inkassatsiya   : ${natija.inkas} (kamomad ${natija.kamomad})`);
    console.log('');
    process.exit(0);
  } catch (e) {
    console.error('  XATO:', e.message);
    process.exit(1);
  }
})();
