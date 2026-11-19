/**
 * Agent nazorati sahifasi uchun test ma'lumot generatori.
 *
 * Nima yaratadi (1-avgustdan bugungacha, ish kunlari):
 *   · marshrut_reja  — har agentga kunlik mijoz rejasi
 *   · tashrif        — check-in/check-out, GPS masofa, davomiylik, natija
 *   · ariza          — "savdo" natijali tashriflarga mos sotuv hujjati
 *   · sotmaslik      — "sotmaslik" natijasiga sabab yozuvi
 *   · agent_location — GPS trek nuqtalari
 *
 * Ataylab kiritilgan holatlar (sahifaning HAMMA funksiyasi ishlashi uchun):
 *   · rejadan tashqari tashriflar   → "rejasiz" belgisi
 *   · bajarilmagan rejalar          → "Qoldi" ustuni
 *   · 200m dan uzoq check-in        → anomaliya (uzoq)
 *   · 3 daqiqadan qisqa tashrif     → anomaliya (qisqa)
 *   · check-out qilinmagan tashrif  → anomaliya (ochiq)
 *   · 1.5 soatdan uzun tashrif      → anomaliya (uzun)
 *
 * Ishga tushirish:  node scripts/seed-agent-nazorat.js
 * Tozalash:         node scripts/seed-agent-nazorat.js --tozala
 *
 * Faqat shu skript yaratgan yozuvlar o'chiriladi — mavjud ma'lumotga tegmaydi.
 * Har bir qo'shilgan qator id'si demo_yozuv jurnaliga (scripts/lib/demo-utils.js)
 * yoziladi va tozalash FAQAT shu id'larni o'chiradi. Ilgari sana bo'yicha
 * (sana >= 2026-08-01) o'chirilardi — bu real tashrif/reja/GPS'ni ham yo'q qilardi.
 *
 * NODE_ENV=production da ishlamaydi (faqat --majburiy bilan).
 */

require('dotenv').config();
const sequelize = require('../src/db/db-sequelize');
const D = require('./lib/demo-utils');
D.ishlabChiqarishTaqiq('seed-agent-nazorat');
const SKRIPT = 'seed-agent-nazorat';
// FK tartibida: avval bog'langanlar
const JADVALLAR = ['tashrif', 'marshrut_reja', 'sotmaslik', 'agent_location', 'tovar_register', 'ariza_qator', 'ariza'];

// Skript chiqishi o'qilishi uchun SQL loglarini o'chiramiz
sequelize.options.logging = false;

const ARIZA_PREFIX = 'AR-NZ';           // shu skript yaratgan arizalar belgisi
const BOSHLANISH   = '2026-08-01';      // shu sanadan bugungacha

const SABABLAR = [
  { id: 1, nomi: "Pul yo'q" },
  { id: 2, nomi: "Tovar yo'q" },
  { id: 3, nomi: 'Mijoz yopiq' },
  { id: 4, nomi: 'Narx qimmat' },
  { id: 5, nomi: 'Keyinroq keling' },
];

const rnd  = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const iso  = (d) => d.toISOString().slice(0, 10);

/** Koordinatani biroz siljitadi — GPS check-in nuqtasi mijozdan biroz farq qiladi */
function siljit(lat, lng, metr) {
  const burchak = Math.random() * 2 * Math.PI;
  const dLat = (metr / 111320) * Math.cos(burchak);
  const dLng = (metr / (111320 * Math.cos(lat * Math.PI / 180))) * Math.sin(burchak);
  return [lat + dLat, lng + dLng];
}

/** '2026-08-05' + soat/daqiqa → MySQL DATETIME satri (mahalliy vaqt) */
function dt(sana, soat, daqiqa) {
  const p = (n) => String(n).padStart(2, '0');
  return `${sana} ${p(soat)}:${p(daqiqa)}:00`;
}

async function tozala() {
  await D.jurnalTayyorla(sequelize);   // DDL — tranzaksiyadan oldin
  const t = await sequelize.transaction();
  try {
    // 1) Jurnal bo'yicha: faqat shu skript qo'shgan qatorlar (id ro'yxati)
    const n = await D.ochir(sequelize, SKRIPT, JADVALLAR, t);
    await D.jurnalniOchir(sequelize, SKRIPT, t);

    // 2) Eski versiya yaratgan (jurnalsiz) arizalar — noyob AR-NZ- prefiksi bo'yicha.
    //    Tashrif/reja/GPS uchun bunday ishonchli belgi yo'q — ular taxmin bilan o'chirilmaydi.
    const prefiks = `${ARIZA_PREFIX}-%`;
    await sequelize.query(
      `DELETE FROM tovar_register WHERE manba_tur = 'sotuv'
         AND manba_id IN (SELECT id FROM ariza WHERE raqam LIKE ?)`,
      { replacements: [prefiks], transaction: t });
    await sequelize.query(
      `DELETE FROM ariza_qator WHERE ariza_id IN (SELECT id FROM ariza WHERE raqam LIKE ?)`,
      { replacements: [prefiks], transaction: t });
    await sequelize.query(`DELETE FROM ariza WHERE raqam LIKE ?`, { replacements: [prefiks], transaction: t });

    await t.commit();
    console.log('Tozalandi (faqat shu skript yaratgan yozuvlar):',
      Object.entries(n).map(([j, c]) => `${j}=${c}`).join(', '));
  } catch (e) {
    await t.rollback();
    throw e;
  }
}

async function seed() {
  await tozala();   // qayta ishga tushirilganda dublikat bo'lmasin

  const [agentlar] = await sequelize.query('SELECT id, fullname FROM agent WHERE faol = 1 ORDER BY id');
  if (!agentlar.length) throw new Error('Faol agent topilmadi');

  const [mijozlar] = await sequelize.query(
    'SELECT id, nomi, lat, lng, agent_id FROM mijoz WHERE deletedAt IS NULL AND lat IS NOT NULL');
  if (!mijozlar.length) throw new Error('Koordinatali mijoz topilmadi');

  const [tovarlar] = await sequelize.query('SELECT id, nomi, turkum FROM tovar WHERE deletedAt IS NULL LIMIT 40');
  if (!tovarlar.length) throw new Error('Tovar topilmadi');

  // Har agentga o'z mijozlari; biriktirilmaganlarga umumiy ro'yxat
  const agentMijoz = {};
  agentlar.forEach(a => {
    const oz = mijozlar.filter(m => m.agent_id === a.id);
    agentMijoz[a.id] = oz.length ? oz : mijozlar;
  });

  const bugun = new Date();
  const kunlar = [];
  for (let d = new Date(BOSHLANISH); d <= bugun; d.setDate(d.getDate() + 1)) {
    if (d.getDay() !== 0) kunlar.push(iso(d));   // yakshanba dam
  }

  const rejaRows = [], tashrifRows = [], arizaRows = [], sotmaslikRows = [], gpsRows = [];
  let arizaNo = 0;

  // Anomaliyalarni oxirgi kunlarga joylaymiz — sahifada darrov ko'rinsin
  const anomKun = kunlar.slice(-4);
  const anomReja = [];   // { kun, agent_id, mijoz_id, tur }
  ['uzoq', 'qisqa', 'ochiq', 'uzun'].forEach((tur, i) => {
    const kun = anomKun[i % anomKun.length];
    const ag  = agentlar[i % agentlar.length];
    anomReja.push({ kun, agent_id: ag.id, tur });
  });

  for (const kun of kunlar) {
    for (const agent of agentlar) {
      const oz = agentMijoz[agent.id];
      // Rejaga hamma mijozni tiqmaymiz — 1-2 tasi zaxirada qolsin, shunda
      // "rejadan tashqari tashrif" holatini ham hosil qila olamiz
      const maxReja = Math.max(2, oz.length - 2);
      const rejaSoni = Math.min(maxReja, rnd(4, 7));

      // Kunlik reja — takrorlanmas mijozlar
      const aralash = [...oz].sort(() => Math.random() - 0.5);
      const rejaMijozlar = aralash.slice(0, rejaSoni);

      rejaMijozlar.forEach((m, i) => {
        rejaRows.push([agent.id, m.id, kun, i + 1]);
      });

      // Rejadagilarning bir qismiga kiradi (qolgani "Qoldi" bo'lib turadi)
      const bajarish = rnd(Math.max(1, rejaSoni - 3), rejaSoni);
      const kirganlar = rejaMijozlar.slice(0, bajarish);

      // Ba'zi kunlarda rejadan tashqari 1 ta mijozga kiradi
      const tashqari = (Math.random() < 0.35)
        ? aralash.slice(rejaSoni).find(m => !kirganlar.includes(m))
        : null;
      if (tashqari) kirganlar.push(tashqari);

      /* Bugungi kun uchun tashriflar hozirgi soatdan OSHMASLIGI kerak —
         aks holda yozuv kelajakda qolib, dashboard "today" oralig'iga
         (00:00 → NOW) tushmaydi. Baza UTC saqlagani uchun UTC soat. */
      const nowUTC = new Date().getUTCHours();
      const bugungiKun = kun === iso(new Date());
      // Ish kuni 09:00 da boshlanadi; bugun erta bo'lsa oldinroqdan
      let soat = bugungiKun ? Math.max(6, Math.min(9, nowUTC - 2)) : 9;
      let daqiqa = rnd(0, 20);

      kirganlar.forEach((m, idx) => {
        const lat = Number(m.lat), lng = Number(m.lng);

        // Shu agent/kun uchun anomaliya rejalashtirilganmi?
        const anom = anomReja.find(a => a.kun === kun && a.agent_id === agent.id && !a.ishlatildi);
        const anomTur = (anom && idx === 0) ? (anom.ishlatildi = true, anom.tur) : null;

        // Check-in masofasi: odatda 5–80m, "uzoq" anomaliyada 250–600m
        const masofa = anomTur === 'uzoq' ? rnd(250, 600) : rnd(5, 80);
        const [ciLat, ciLng] = siljit(lat, lng, masofa);

        // Davomiylik: odatda 10–35 daq
        let davomDaq = rnd(10, 35);
        if (anomTur === 'qisqa') davomDaq = rnd(1, 2);
        if (anomTur === 'uzun')  davomDaq = rnd(95, 130);

        const ciVaqt = dt(kun, soat, daqiqa);
        const tugash = new Date(`${kun}T${String(soat).padStart(2,'0')}:${String(daqiqa).padStart(2,'0')}:00`);
        tugash.setMinutes(tugash.getMinutes() + davomDaq);
        const coVaqt = dt(kun, tugash.getHours(), tugash.getMinutes());

        // Natija: 65% savdo, 28% sotmaslik, qolgani ochiq
        const r = Math.random();
        let natija = r < 0.65 ? 'savdo' : (r < 0.93 ? 'sotmaslik' : 'ochiq');
        if (anomTur === 'ochiq') natija = 'ochiq';

        const rejada = rejaMijozlar.includes(m);

        tashrifRows.push({
          agent_id: agent.id, agent_nomi: agent.fullname,
          mijoz_id: m.id, mijoz_nomi: m.nomi,
          checkin_vaqt: ciVaqt, checkin_lat: ciLat, checkin_lng: ciLng, checkin_masofa: masofa,
          // "ochiq" anomaliyada check-out yo'q
          checkout_vaqt: anomTur === 'ochiq' ? null : coVaqt,
          checkout_lat:  anomTur === 'ochiq' ? null : ciLat,
          checkout_lng:  anomTur === 'ochiq' ? null : ciLng,
          davomiylik_sek: anomTur === 'ochiq' ? null : davomDaq * 60,
          natija, sana: kun, rejada,
        });

        // Savdo bo'lsa — ariza yaratamiz (jurnaldagi "Summa" ustuni uchun)
        if (natija === 'savdo') {
          const tovar = pick(tovarlar);
          const dona  = rnd(3, 25);
          const narx  = rnd(8, 60) * 1000;
          arizaRows.push({
            raqam: `${ARIZA_PREFIX}-${++arizaNo}`,
            agent_id: agent.id, agent_nomi: agent.fullname,
            mijoz_id: m.id, mijoz_nomi: m.nomi,
            summa: dona * narx, sana: ciVaqt,
            tovar_id: tovar.id, tovar_nomi: tovar.nomi, turkum: tovar.turkum, dona, narx,
          });
        }

        if (natija === 'sotmaslik') {
          const sb = pick(SABABLAR);
          sotmaslikRows.push([agent.id, agent.fullname, m.id, m.nomi, sb.id, sb.nomi, ciVaqt]);
        }

        // GPS trek — tashrif nuqtasi
        gpsRows.push([agent.id, 'agent', ciLat, ciLng, rnd(35, 100), ciVaqt]);

        // Keyingi mijozga o'tish: tashrif + yo'l vaqti
        const oraliq = davomDaq + rnd(12, 30);
        daqiqa += oraliq;
        while (daqiqa >= 60) { daqiqa -= 60; soat++; }
        /* Bugun uchun yuqori chegara. Faqat soatni cheklash yetarli emas:
           hozir 09:45 bo'lsa, chegara 09 bilan ham 09:54 yozilib kelajakda
           qolardi. Shuning uchun oxirgi to'liq soatdan oshmaydi. */
        const chegara = bugungiKun ? Math.max(7, nowUTC - 1) : 18;
        if (soat > chegara) { soat = chegara; daqiqa = Math.min(daqiqa, 55); }
      });
    }
  }

  /* ── Bazaga yozish ──
     Har qator alohida qo'shiladi va id'si jurnalga yoziladi (ko'p qatorli
     INSERT'da id'lar parallel yozuvlar bilan aralashishi mumkin). */
  const t = await sequelize.transaction();
  const yangi = {};   // jadval → [id]
  const ins = async (jadval, sql, replacements) => {
    const [id] = await sequelize.query(sql, { replacements, transaction: t });
    (yangi[jadval] = yangi[jadval] || []).push(id);
    return id;
  };
  try {
    // 1. Reja — tashrifga bog'lash uchun id'lar xotirada saqlanadi
    const rejaMap = {};
    for (const r of rejaRows) {
      const id = await ins('marshrut_reja',
        `INSERT INTO marshrut_reja (agent_id, mijoz_id, sana, tartib, createdAt, updatedAt)
         VALUES (?,?,?,?,NOW(),NOW())`, r);
      rejaMap[`${r[0]}|${r[1]}|${r[2]}`] = id;
    }

    // 2. Arizalar — tashrifga bog'lash uchun id kerak
    const arizaIdMap = {};
    for (const a of arizaRows) {
      const res = await ins('ariza',
        /* yetkazilgan_sana ham to'ldiriladi — dashboard "Bugun yetkazildi"
           ni holat emas, aynan shu maydon bo'yicha sanaydi. */
        `INSERT INTO ariza (raqam, holat, turi, manba, mijoz_id, mijoz_nomi, agent_id, agent_nomi,
                            jami_summa, ombor, jonatish_sana, yetkazilgan_sana, createdAt, updatedAt)
         VALUES (?, 'yetkazildi', 'sotish', 'mobil', ?, ?, ?, ?, ?, 'Основной склад', DATE(?), ?, ?, ?)`,
        [a.raqam, a.mijoz_id, a.mijoz_nomi, a.agent_id, a.agent_nomi,
         a.summa, a.sana, a.sana, a.sana, a.sana]);
      const arizaId = res;
      arizaIdMap[`${a.agent_id}|${a.mijoz_id}|${a.sana.slice(0, 10)}`] = arizaId;

      await ins('ariza_qator',
        `INSERT INTO ariza_qator (ariza_id, tovar_id, tovar_nomi, narx, dona, jami_dona, summa, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,NOW(),NOW())`,
        [arizaId, a.tovar_id, a.tovar_nomi, a.narx, a.dona, a.dona, a.summa]);

      /* Ombordan chiqim — "Turkum ulushi" va "Top tovarlar" bloklari
         aynan tovar_register (tur='chiqim', manba_tur='sotuv') ustidan
         hisoblanadi. Busiz sotuv bo'lsa ham grafiklar bo'sh chiqadi. */
      await ins('tovar_register',
        `INSERT INTO tovar_register
           (tovar_id, tovar_nomi, turkum, ombor, tur, manba_tur, manba_id,
            donada, bloklarda, qutilarda, hajm, kirim_narx, sotuv_narx, summa,
            sana, createdAt, updatedAt)
         VALUES (?,?,?,'Основной склад','chiqim','sotuv',?,?,0,0,0,0,?,?,?,NOW(),NOW())`,
        [a.tovar_id, a.tovar_nomi, a.turkum || null, arizaId,
         -Math.abs(a.dona), a.narx, -Math.abs(a.summa), a.sana]);
    }

    // 3. Tashriflar — reja_id (faqat shu skript yaratgan rejalar) va ariza_id bilan bog'lab
    for (const x of tashrifRows) {
      const k = `${x.agent_id}|${x.mijoz_id}|${x.sana}`;
      await ins('tashrif',
        `INSERT INTO tashrif (reja_id, agent_id, agent_nomi, mijoz_id, mijoz_nomi,
            checkin_vaqt, checkin_lat, checkin_lng, checkin_masofa,
            checkout_vaqt, checkout_lat, checkout_lng, davomiylik_sek,
            natija, ariza_id, sana, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),NOW())`,
        [
          x.rejada ? (rejaMap[k] || null) : null,
          x.agent_id, x.agent_nomi, x.mijoz_id, x.mijoz_nomi,
          x.checkin_vaqt, x.checkin_lat, x.checkin_lng, x.checkin_masofa,
          x.checkout_vaqt, x.checkout_lat, x.checkout_lng, x.davomiylik_sek,
          x.natija, arizaIdMap[k] || null, x.sana,
        ]);
    }

    // 4. Sotmaslik
    for (const r of sotmaslikRows) {
      await ins('sotmaslik',
        `INSERT INTO sotmaslik (agent_id, agent_nomi, mijoz_id, mijoz_nomi, sabab_id, sabab_nomi, sana, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,NOW(),NOW())`, r);
    }

    /* 5a. Bugungi "jonli" nuqtalar.
       GPS faqat tashrif paytida yozilardi, shuning uchun kun o'rtasida
       sahifa ochilsa hamma agent "oflayn" ko'rinardi. Real ilova har
       bir necha daqiqada joylashuv yuboradi — shuni taqlid qilamiz:
       oxirgi 40 daqiqa ichida bir nechta nuqta, eng oxirgisi 0-4 daqiqa
       oldin (ya'ni "online"). */
    const bugunIso = iso(new Date());
    if (kunlar.includes(bugunIso)) {
      const hozir = new Date();
      agentlar.forEach((agent, idx) => {
        const oz = agentMijoz[agent.id];
        if (!oz || !oz.length) return;
        const m = oz[idx % oz.length];
        const bazaLat = Number(m.lat), bazaLng = Number(m.lng);

        /* Oxirgi signal yoshi. Kamida 1 daqiqa — 0 bo'lsa, skript tugagunicha
           o'tgan soniyalar tufayli yosh manfiy chiqib, agent "kelajakda"
           ko'rinadi. Birinchi agent eng yangi, keyingilar bir oz eskiroq. */
        const oxirgiYosh = 1 + idx * 3 + rnd(0, 2);      // 1-3, 4-6, 7-9, 10-12 daq
        for (let k = 4; k >= 0; k--) {
          const yosh = oxirgiYosh + k * rnd(6, 10);       // orqaga qarab
          const t = new Date(hozir.getTime() - yosh * 60000);
          // Har nuqta biroz siljigan — harakat izi ko'rinsin
          const [la, ln] = siljit(bazaLat, bazaLng, rnd(40, 400));
          // Baza UTC saqlaydi — mahalliy soat (UTC+5) yozilsa yosh manfiy
          // chiqib, agent "kelajakda" ko'rinadi
          const vaqt = t.toISOString().slice(0, 19).replace('T', ' ');
          gpsRows.push([agent.id, 'agent', la, ln, rnd(35, 95), vaqt]);
        }
      });
    }

    // 5. GPS
    for (const r of gpsRows) {
      await ins('agent_location',
        `INSERT INTO agent_location (agent_id, rol, lat, lng, battery, sana, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,NOW(),NOW())`, r);
    }

    // 6. Jurnal — aynan shu tranzaksiyada (yozuvlar bilan birga commit/rollback)
    for (const [jadval, ids] of Object.entries(yangi)) await D.belgila(sequelize, SKRIPT, jadval, ids, t);

    await t.commit();
  } catch (e) {
    await t.rollback();
    throw e;
  }

  const anomSoni = tashrifRows.filter(x =>
    x.checkin_masofa > 200 || !x.checkout_vaqt ||
    (x.davomiylik_sek && (x.davomiylik_sek < 180 || x.davomiylik_sek > 5400))).length;

  console.log('');
  console.log(`  Kunlar          : ${kunlar.length} (${kunlar[0]} … ${kunlar[kunlar.length - 1]})`);
  console.log(`  Agentlar        : ${agentlar.length}`);
  console.log(`  Reja            : ${rejaRows.length}`);
  console.log(`  Tashrif         : ${tashrifRows.length}`);
  console.log(`    · savdo       : ${tashrifRows.filter(x => x.natija === 'savdo').length}`);
  console.log(`    · sotmaslik   : ${tashrifRows.filter(x => x.natija === 'sotmaslik').length}`);
  console.log(`    · rejasiz     : ${tashrifRows.filter(x => !x.rejada).length}`);
  console.log(`  Ariza           : ${arizaRows.length}`);
  console.log(`  Anomaliya       : ${anomSoni}`);
  console.log(`  GPS nuqta       : ${gpsRows.length}`);
  console.log('');
}

(async () => {
  try {
    await sequelize.authenticate();
    if (process.argv.includes('--tozala')) await tozala();
    else await seed();
    process.exit(0);
  } catch (e) {
    console.error('XATO:', e.message);
    process.exit(1);
  }
})();
