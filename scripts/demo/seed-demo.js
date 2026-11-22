/**
 * Tekshiruv (App Store / Play Market) demo bazasini to'ldiradi — FAQAT demo instansiyada
 * (alohida baza, alohida port). Ishchi bazaga hech qachon ishga tushirilmaydi.
 *
 *   DEMO_API=http://127.0.0.1:3024/api/v1  DEMO_SIRLAR=/home/sellz/tamzor/demo.sirlar  node seed-demo.js
 *
 * DEMO_SIRLAR fayli (git'ga kirmaydi):  REVIEW_LOGIN=...  REVIEW_PAROL=...  ADMIN_PAROL=...
 * Natija (2026-11 modeli: mobil ilovada faqat agent va super agent):
 *   - REVIEW_LOGIN — super agent: o'z ombori, mijozlari, savdolari + 2 ta biriktirilgan agentni kuzatadi;
 *   - viloyat "Farg'ona viloyati", naqd kassa va shu viloyatga bog'langan plastik kassa;
 *   - shu viloyatda barcha tovarlarga chakana (= sotuv narxi) va optom (≈ 95%) viloyat narxi;
 *   - namunaviy savdolar: naqd, qarz (vozvrat va qarz to'lovi uchun), tasdiq kutayotgan plastik (chek bilan).
 */
// Sanalar Toshkent kuni bo'yicha (server UTC'da, cron 03:00 Toshkent = 22:00 UTC)
process.env.TZ = process.env.TZ || 'Asia/Tashkent';
const fs = require('fs');

const API = process.env.DEMO_API || 'http://127.0.0.1:3024/api/v1';
const sir = Object.fromEntries(fs.readFileSync(process.env.DEMO_SIRLAR, 'utf8').split('\n')
  .map(l => l.trim()).filter(l => l && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));

const bugun = new Date();
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
let T;
async function w(m, ep, b) {
  const r = await fetch(API + ep, { method: m, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + T }, body: b ? JSON.stringify(b) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 300) throw new Error(`${m} ${ep} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// Plastik sotuv cheki uchun kichik PNG (1×1) — web chek-yuklash orqali
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
async function chekYukla() {
  const fd = new FormData();
  fd.append('chek', new Blob([PNG], { type: 'image/png' }), 'chek.png');
  const r = await fetch(API + '/kassalar/chek-yuklash', { method: 'POST', headers: { Authorization: 'Bearer ' + T }, body: fd });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 300 || !j.chekRasm) throw new Error(`chek-yuklash → ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j.chekRasm;
}

(async () => {
  // Yangi baza: migratsiya Admin'ni standart parol bilan yaratadi — darhol almashtiriladi (reset-demo.sh)
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
    qatorlar: tovarlar.map(t => ({ tovar_id: t.id, tovar_nomi: t.nomi, turkum: t.turkum, narx: t.kirim, chakana_narx: t.sotuv, optom_narx: Math.round(t.sotuv * 0.95), donada: 1000 })),
  });
  await w('PATCH', `/prixod/${px.id}/tasdiq`);

  // Viloyat va kassalar
  const vil = await w('POST', '/mijozlar/territoriya', { nomi: "Farg'ona viloyati" });
  await w('POST', '/kassalar', { nomi: 'Asosiy naqd kassa', tur: 'naqd', viloyatlar: [] });
  const plastik = await w('POST', '/kassalar', { nomi: "Uzcard Farg'ona", tur: 'plastik', viloyatlar: [vil.id] });
  // Viloyat narxlari (2026-11-25): viloyati bor agent faqat viloyat narxi bilan sotadi — hamma tovarga
  // chakana = sotuv narxi, optom ≈ 95% (kirimdagi optom_narx bilan bir xil)
  await w('PUT', `/tovar/viloyat-narxlari/${vil.id}`, {
    narxlar: tovarlar.map(t => ({ tovar_id: t.id, chakana_narx: t.sotuv, optom_narx: Math.round(t.sotuv * 0.95) })),
  });

  // Super agent (tekshiruv logini) + unga biriktirilgan 2 agent
  const kunlar = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
  const sa = await w('POST', '/agents', { fullname: 'Tekshiruv agenti', plan_summa: 10000000, login: sir.REVIEW_LOGIN, parol: sir.REVIEW_PAROL, tashrif_kunlari: kunlar, territoriya_id: vil.id, super_agent: true });
  const a1 = await w('POST', '/agents', { fullname: 'Anvar Karimov', plan_summa: 8000000, tashrif_kunlari: kunlar, territoriya_id: vil.id, super_agent_id: sa.id });
  const a2 = await w('POST', '/agents', { fullname: 'Bobur Aliyev', plan_summa: 8000000, tashrif_kunlari: kunlar, territoriya_id: vil.id, super_agent_id: sa.id });

  const mijozlar = [
    ["Mehribon do'koni", "Farg'ona sh., Marg'ilon ko'chasi, 31-uy", 40.3842, 71.7843, sa.id],
    ['Yulduzcha market', "Farg'ona sh., Mustaqillik ko'chasi, 12", 40.3891, 71.7801, sa.id],
    ['Sohil savdo', "Farg'ona sh., Yangi Chek mahallasi, 49-uy", 40.3790, 71.7920, sa.id],
    ['Baxt minimarket', "Farg'ona sh., Al-Farg'oniy ko'chasi, 8", 40.3712, 71.7861, sa.id],
    ["Guliston do'koni", "Farg'ona sh., Kirguli mavzesi, 36-uy", 40.3955, 71.7702, a1.id],
    ['Oila market', "Farg'ona sh., Bog'ishamol ko'chasi, 5", 40.3808, 71.7755, a1.id],
    ['Nur savdo', "Marg'ilon sh., Burhoniddin Marg'iloniy ko'chasi, 20", 40.4710, 71.7246, a2.id],
    ['Sarbon minimarket', "Marg'ilon sh., Toshloq ko'chasi, 3", 40.4655, 71.7302, a2.id],
  ];
  const M = {};
  for (const [nomi, manzil, lat, lng, agent_id] of mijozlar) {
    const m = await w('POST', '/mijozlar', { nomi, manzil, lat, lng, agent_id, territoriya_id: vil.id, tashrif_kunlari: kunlar.join(', '), telefon: '+998901234567', narx_turi: 'chakana', kredit_limit: 3000000 });
    (M[agent_id] ||= []).push(m.id);
  }
  // Bugungi marshrut va agent omborlariga tovar (darhol, agent qabulisiz)
  for (const a of [sa, a1, a2]) {
    await w('POST', '/hisobot/marshrut-reja', { agent_id: a.id, sana: iso(bugun), mijoz_idlar: M[a.id] });
    await w('POST', '/avtolavka/yuklash', { agent_id: a.id, tasdiqla: true, qatorlar: tovarlar.map(t => ({ tovar_id: t.id, dona: t.blok * 5, narx: t.sotuv })) });
  }

  // Namunaviy savdolar (agent nomidan, web orqali)
  let n = 0;
  const qator = (k) => tovarlar.slice(0, k).map(t => ({ tovar_id: t.id, dona: t.blok, narx: t.sotuv }));
  const sotuv = (agent, mijoz, b) => w('POST', '/avtolavka/sotuv', { agent_id: agent.id, mijoz_id: mijoz, sorov_id: `demo-${Date.now()}-${++n}`, ...b });
  const muddat = iso(new Date(bugun.getTime() + 7 * 864e5));
  // Super agent: naqd (qo'lida pul), qarz (vozvrat va qarz to'lovi), plastik — tasdiq kutilmoqda
  await sotuv(sa, M[sa.id][0], { qatorlar: qator(3), tolov: 'naqd' });
  await sotuv(sa, M[sa.id][1], { qatorlar: qator(2), tolov: 'qarz', tolov_sana: muddat });
  await sotuv(sa, M[sa.id][2], { qatorlar: qator(2), tolov: 'naqd', tolov_usuli: 'plastik', kassa_id: plastik.id, chek_rasm: await chekYukla(), chek_izoh: 'Karta orqali' });
  // Biriktirilgan agentlar — kuzatuvda ko'rinadigan savdolar
  await sotuv(a1, M[a1.id][0], { qatorlar: qator(4), tolov: 'naqd' });
  await sotuv(a1, M[a1.id][1], { qatorlar: qator(2), tolov: 'qarz', tolov_sana: muddat });
  await sotuv(a2, M[a2.id][0], { qatorlar: qator(3), tolov: 'naqd' });

  console.log('OK demo:', { superAgent: sa.id, agentlar: [a1.id, a2.id], viloyat: vil.id, plastikKassa: plastik.id, tovar: tovarlar.length });
})().catch(e => { console.error('XATO:', e.message); process.exit(1); });
