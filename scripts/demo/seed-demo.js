/**
 * Tekshiruv (App Store / Play Market) demo bazasini to'ldiradi — FAQAT demo instansiyada
 * (alohida baza, alohida port). Ishchi bazaga hech qachon ishga tushirilmaydi.
 *
 *   DEMO_API=http://127.0.0.1:3024/api/v1  DEMO_SIRLAR=/home/sellz/tamzor/demo.sirlar  node seed-demo.js
 *
 * DEMO_SIRLAR fayli (git'ga kirmaydi):  REVIEW_LOGIN=...  REVIEW_PAROL=...  ADMIN_PAROL=...
 * Natija: bitta login (REVIEW_LOGIN) — distributsiya agenti + Won Sell jufti + dostavchik (dual_role).
 */
// Sanalar Toshkent kuni bo'yicha (server UTC'da, cron 03:00 Toshkent = 22:00 UTC)
process.env.TZ = process.env.TZ || 'Asia/Tashkent';
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const API = process.env.DEMO_API || 'http://127.0.0.1:3024/api/v1';
const sir = Object.fromEntries(fs.readFileSync(process.env.DEMO_SIRLAR, 'utf8').split('\n')
  .map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const env = Object.fromEntries(fs.readFileSync(path.join(__dirname, '../../.env'), 'utf8').split('\n')
  .map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const bugun = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let T;
async function w(m, ep, b) {
  const r = await fetch(API + ep, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 300) throw new Error(`${m} ${ep} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

(async () => {
  // Yangi baza: migratsiya Admin'ni standart parol bilan yaratadi — darhol almashtiriladi
  const kir = async (p) => (await (await fetch(API + '/users/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Admin', password: p }) })).json()).token;
  T = await kir('123456') || await kir(sir.ADMIN_PAROL);
  if (!T) throw new Error('Admin login xato');

  const tovarlar = [
    { nomi: 'Sut 2.5% 1L', turkum: 'Sut mahsulotlari', blok: 12, kirim: 9000, sotuv: 12500 },
    { nomi: 'Kefir 1L', turkum: 'Sut mahsulotlari', blok: 12, kirim: 10000, sotuv: 13800 },
    { nomi: 'Qatiq 0.5L', turkum: 'Sut mahsulotlari', blok: 20, kirim: 5000, sotuv: 7200 },
    { nomi: "Sariyog' 200g", turkum: 'Sut mahsulotlari', blok: 10, kirim: 18000, sotuv: 24000 },
    { nomi: 'Non oq', turkum: 'Non mahsulotlari', blok: 1, kirim: 3000, sotuv: 4500 },
    { nomi: 'Coca-Cola 1.5L', turkum: 'Ichimliklar', blok: 6, kirim: 11000, sotuv: 14500 },
  ];
  for (const t of tovarlar) t.id = (await w('POST', '/tovar', { nomi: t.nomi, turkum: t.turkum, blokdagi_soni: t.blok, olchov_birligi: 'dona' })).id;
  const yz = await w('POST', '/yetkazuvchilar', { ism: 'Asosiy yetkazuvchi' });
  const px = await w('POST', '/prixod', {
    sana: iso(bugun), yetkazuvchi_id: yz.id, yetkazuvchi: yz.ism, tolov_turi: 'naqt',
    qatorlar: tovarlar.map(t => ({ tovar_id: t.id, tovar_nomi: t.nomi, turkum: t.turkum, narx: t.kirim, chakana_narx: t.sotuv, optom_narx: Math.round(t.sotuv * 0.95), donada: 500 })),
  });
  await w('PATCH', `/prixod/${px.id}/tasdiq`);

  const kunlar = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
  const agent = await w('POST', '/agents', { fullname: 'Tekshiruv agenti', plan_summa: 10000000, login: sir.REVIEW_LOGIN, parol: sir.REVIEW_PAROL, tashrif_kunlari: kunlar });
  const ws = await w('POST', '/agents', { fullname: 'Tekshiruv Won Sell', plan_summa: 10000000, avtolavka: true, tashrif_kunlari: kunlar, transport: 'avto', mashina_raqam: '40 A 123 AA' });
  const dost = await w('POST', '/dostavchilar', { ism: 'Tekshiruv dostavchik', transport: 'Damas' });

  // Bitta login — uch rol: agent + Won Sell jufti + dostavchik (bu maydonlar web API'da yozilmaydi)
  const e = (k) => (process.env[k] !== undefined ? process.env[k] : env[k]);
  const db = await mysql.createConnection({ host: e('HOST') || '127.0.0.1', port: Number(e('DB_PORT') || 3306), user: e('DB_USER'), password: e('DB_PASS') || '', database: process.env.DB_DATABASE });
  await db.query('UPDATE agent SET juft_agent_id = ?, dual_role = 1, linked_dostavchi_id = ? WHERE id = ?', [ws.id, dost.id, agent.id]);
  await db.end();

  const mijozlar = [
    ["Mehribon do'koni", "Farg'ona sh., Marg'ilon ko'chasi, 31-uy", 40.3842, 71.7843, agent.id],
    ['Yulduzcha market', "Farg'ona sh., Mustaqillik ko'chasi, 12", 40.3891, 71.7801, agent.id],
    ['Sohil savdo', "Farg'ona sh., Yangi Chek mahallasi, 49-uy", 40.3790, 71.7920, agent.id],
    ["Guliston do'koni", "Farg'ona sh., Kirguli mavzesi, 36-uy", 40.3955, 71.7702, ws.id],
    ['Baxt minimarket', "Farg'ona sh., Al-Farg'oniy ko'chasi, 8", 40.3712, 71.7861, ws.id],
  ];
  const mid = [];
  for (const [nomi, manzil, lat, lng, agent_id] of mijozlar) {
    mid.push((await w('POST', '/mijozlar', { nomi, manzil, lat, lng, agent_id, tashrif_kunlari: kunlar.join(', '), telefon: '+998901234567', narx_turi: 'chakana', kredit_limit: 3000000 })).id);
  }
  // Bugungi marshrut: agentga o'z mijozlari, Won Sell'ga hammasi
  await w('POST', '/hisobot/marshrut-reja', { agent_id: agent.id, sana: iso(bugun), mijoz_idlar: mid.slice(0, 3) });
  await w('POST', '/hisobot/marshrut-reja', { agent_id: ws.id, sana: iso(bugun), mijoz_idlar: mid });
  // Won Sell mashinasi — yuk tasdiqlangan (ilovada "Yuk keldi → Sanadim")
  await w('POST', '/avtolavka/yuklash', { agent_id: ws.id, tasdiqla: true, qatorlar: tovarlar.map(t => ({ tovar_id: t.id, dona: t.blok * 4, narx: t.sotuv })) });
  // Dostavchik: 2 ta buyurtma yo'lda
  for (const m of mid.slice(0, 2)) {
    const a = await w('POST', '/arizalar', {
      mijoz_id: m, agent_id: agent.id, tolov_turi: 'naqt', jonatish_sana: iso(bugun),
      qatorlar: tovarlar.slice(0, 3).map(t => ({ tovar_id: t.id, tovar_nomi: t.nomi, narx: t.sotuv, dona: 6 })),
    });
    for (const holat of ['tasdiqlangan', 'yigilmoqda']) await w('PATCH', `/arizalar/${a.id}/holat`, { holat });
    await w('PATCH', `/arizalar/${a.id}/holat`, { holat: 'yolda', dostavchi_id: dost.id });
  }
  console.log('OK demo:', { agent: agent.id, wonsell: ws.id, dostavchi: dost.id, mijoz: mid.length, tovar: tovarlar.length });
})().catch(e => { console.error('XATO:', e.message); process.exit(1); });
