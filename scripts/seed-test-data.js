'use strict';
/**
 * Test ma'lumotlarni to'ldirish skripti — barcha sahifalar ishlashi uchun.
 * Ishlatish: node scripts/seed-test-data.js
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const sequelize = require('../src/db/db-sequelize');

const AgentModel = require('../src/models/agent.model');
const { MijozModel, TerritoriyaModel, MijozKategoriyaModel } = require('../src/models/mijoz.model');
const DostavchiModel = require('../src/models/dostavchi.model');
const { YetkazuvchiModel, YetkazuvchiHarakatlarModel } = require('../src/models/yetkazuvchi.model');
const TovarModel = require('../src/models/tovar.model');
const { PrixodModel, PrixodQatorModel } = require('../src/models/prixod.model');
const TovarRegisterModel = require('../src/models/tovar_register.model');
const { ArizaModel, ArizaQatorModel } = require('../src/models/ariza.model');
const KassaModel = require('../src/models/kassa.model');
const { TripSheetModel, YetkazishQaytarishModel } = require('../src/models/tripSheet.model');
const { InkassatsiyaModel } = require('../src/models/inkassatsiya.model');
const AgentRegisterModel = require('../src/models/agent_register.model');
const { MarshrutRejaModel, TashrifModel } = require('../src/models/marshrut.model');
const { AuditModel, SotmaslikModel, AgentLocationModel } = require('../src/models/hisobot.model');

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}
function dateOnly(d) {
  return d.toISOString().slice(0, 10);
}
function rnd(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function pick(arr) {
  return arr[rnd(0, arr.length - 1)];
}

async function main() {
  await sequelize.authenticate();
  console.log('Baza bilan bog\'landi. Seed boshlanmoqda...');

  // ── 1. TERRITORIYA ──
  const territoriyalar = await TerritoriyaModel.bulkCreate([
    { nomi: "Markaziy hudud", izoh: "Shahar markazi" },
    { nomi: "Shimoliy hudud", izoh: "Shimoliy tumanlar" },
    { nomi: "Janubiy hudud", izoh: "Janubiy tumanlar" },
  ]);
  console.log(`✓ territoriya: ${territoriyalar.length}`);

  // ── 2. MIJOZ KATEGORIYA ──
  const kategoriyalar = await MijozKategoriyaModel.bulkCreate([
    { nomi: "Do'kon", izoh: "Chakana savdo do'koni" },
    { nomi: "Supermarket", izoh: "Yirik chakana tarmoq" },
    { nomi: "Optom baza", izoh: "Optom sotuvchi" },
    { nomi: "Kafe/Restoran", izoh: "Umumiy ovqatlanish" },
  ]);
  console.log(`✓ mijoz_kategoriya: ${kategoriyalar.length}`);

  // ── 3. AGENT ──
  const agentParol = await bcrypt.hash('test123', 8);
  const agentData = [
    { fullname: 'Sherzod Karimov', telefon: '+998901112233', territoriya_id: territoriyalar[0].id, plan_summa: 50000000, bonus_foiz: 2.5, kredit_limit: 5000000, transport: 'avto', tashrif_kunlari: 'Du,Se,Ch,Pa,Ju', faol: true },
    { fullname: 'Dilshod Yusupov', telefon: '+998901112244', territoriya_id: territoriyalar[1].id, plan_summa: 40000000, bonus_foiz: 2.0, kredit_limit: 4000000, transport: 'moto', tashrif_kunlari: 'Du,Ch,Ju', faol: true },
    { fullname: "Bekzod G'ulomov", telefon: '+998901112255', territoriya_id: territoriyalar[2].id, plan_summa: 35000000, bonus_foiz: 2.0, kredit_limit: 3000000, transport: 'avto', tashrif_kunlari: 'Se,Pa,Sh', faol: true },
    { fullname: 'Otabek Rashidov', telefon: '+998901112266', territoriya_id: territoriyalar[0].id, plan_summa: 30000000, bonus_foiz: 1.5, kredit_limit: 3000000, transport: 'piyoda', faol: true },
  ];
  agentData[0].login = 'test';
  agentData[0].parol = agentParol;
  const agentlar = await AgentModel.bulkCreate(agentData);
  console.log(`✓ agent: ${agentlar.length}`);

  // ── 4. MIJOZ ──
  const mijozNomlari = [
    "Anvar do'koni", "Malika supermarket", "Oltin bozor optom", "Yulduz kafe",
    "Farrux savdo markazi", "Nodira do'koni", "Sadoqat market", "Baraka baza",
    "Do'stlik do'koni", "Osiyo supermarket", "Vatan bozori", "Kelajak market",
    "Najot do'koni", "Tinchlik kafe", "Yagona baza", "Marvarid do'kon",
  ];
  const mijozData = mijozNomlari.map((nomi, i) => ({
    nomi,
    yuridik_nomi: `${nomi} MChJ`,
    telefon: `+99890${rnd(1000000, 9999999)}`,
    manzil: `Farg'ona sh., ${rnd(1, 50)}-uy`,
    territoriya_id: pick(territoriyalar).id,
    kategoriya_id: pick(kategoriyalar).id,
    agent_id: pick(agentlar).id,
    sinf: pick(['A', 'B', 'C', 'D']),
    balans: 0, // keyin kassa/ariza orqali yangilanadi
    kredit_limit: rnd(1, 10) * 1000000,
    tolov_muddati_kun: pick([15, 30, 45]),
    inn: String(rnd(100000000, 999999999)),
    lat: (40.3 + Math.random() * 0.2).toFixed(7),
    lng: (71.7 + Math.random() * 0.2).toFixed(7),
    faol: true,
  }));
  const mijozlar = await MijozModel.bulkCreate(mijozData);
  console.log(`✓ mijoz: ${mijozlar.length}`);

  // ── 5. DOSTAVCHI ──
  const dostavchiParol = await bcrypt.hash('test123', 8);
  const dostavchiData = [
    { ism: "Jasur Toshmatov", telefon: '+998907773311', transport: 'mashina', mashina_raqam: '01A123BC', faol: true, login: 'dostavchi1', parol: dostavchiParol },
    { ism: "Islom Ne'matov", telefon: '+998907773322', transport: 'mashina', mashina_raqam: '01B456DE', faol: true },
    { ism: "Ravshan Aliyev", telefon: '+998907773333', transport: 'moto', mashina_raqam: '01C789FG', faol: true },
  ];
  const dostavchilar = await DostavchiModel.bulkCreate(dostavchiData);
  console.log(`✓ dostavchi: ${dostavchilar.length}`);

  // ── 6. YETKAZUVCHI (supplier) ──
  const yetkazuvchiData = [
    { ism: "Nestle Uzbekiston", telefon: '+998712001122', manzil: "Toshkent sh.", balans: 0 },
    { ism: "Coca-Cola Ichimliklari", telefon: '+998712003344', manzil: "Toshkent sh.", balans: 0 },
    { ism: "Mahalliy Sut Kombinati", telefon: '+998732005566', manzil: "Farg'ona sh.", balans: 0 },
  ];
  const yetkazuvchilar = await YetkazuvchiModel.bulkCreate(yetkazuvchiData);
  console.log(`✓ yetkazuvchi: ${yetkazuvchilar.length}`);

  // ── 7. TOVAR ──
  const tovarData = [
    { nomi: "Sut 1L", turkum: "Sut mahsulotlari", olchov_birligi: 'dona', blokdagi_soni: 12, brend: "Mahalliy", faol: true },
    { nomi: "Yogurt 500ml", turkum: "Sut mahsulotlari", olchov_birligi: 'dona', blokdagi_soni: 12, brend: "Mahalliy", faol: true },
    { nomi: "Tvorog 250g", turkum: "Sut mahsulotlari", olchov_birligi: 'dona', blokdagi_soni: 20, brend: "Mahalliy", faol: true },
    { nomi: "Coca-Cola 1.5L", turkum: "Ichimliklar", olchov_birligi: 'dona', blokdagi_soni: 6, brend: "Coca-Cola", faol: true },
    { nomi: "Fanta 1.5L", turkum: "Ichimliklar", olchov_birligi: 'dona', blokdagi_soni: 6, brend: "Coca-Cola", faol: true },
    { nomi: "Suv 1.5L", turkum: "Ichimliklar", olchov_birligi: 'dona', blokdagi_soni: 12, brend: "Mahalliy", faol: true },
    { nomi: "Non", turkum: "Non mahsulotlari", olchov_birligi: 'dona', blokdagi_soni: 20, brend: "Mahalliy", faol: true },
    { nomi: "Pechenye 400g", turkum: "Qandolat", olchov_birligi: 'dona', blokdagi_soni: 15, brend: "Nestle", faol: true },
    { nomi: "Shokolad 100g", turkum: "Qandolat", olchov_birligi: 'dona', blokdagi_soni: 24, brend: "Nestle", faol: true },
    { nomi: "Makaron 500g", turkum: "Boshqa oziq-ovqat", olchov_birligi: 'dona', blokdagi_soni: 10, brend: "Mahalliy", faol: true },
  ];
  const tovarlar = await TovarModel.bulkCreate(tovarData);
  console.log(`✓ tovar: ${tovarlar.length}`);

  // Narxlar (tovar bo'yicha kirim/sotuv narxi) — takror ishlatiladi
  const narxMap = {};
  tovarlar.forEach(t => {
    const kirimNarx = rnd(2000, 25000);
    const sotuvNarx = Math.round(kirimNarx * 1.25 / 100) * 100; // ~25% marja
    narxMap[t.id] = { kirimNarx, sotuvNarx };
  });

  // ── 8. PRIXOD + PRIXOD_QATOR + TOVAR_REGISTER (kirim) ──
  let tovarRegisterRows = [];
  const prixodlar = [];
  for (let i = 0; i < 8; i++) {
    const sana = daysAgo(rnd(1, 60));
    const yetkazuvchi = pick(yetkazuvchilar);
    const tanlanganTovarlar = tovarlar.slice(0, rnd(3, tovarlar.length));
    let jamiSumma = 0;
    const qatorlar = tanlanganTovarlar.map(t => {
      const { kirimNarx } = narxMap[t.id];
      const dona = rnd(50, 300);
      const summa = dona * kirimNarx;
      jamiSumma += summa;
      return {
        tovar_id: t.id, tovar_nomi: t.nomi, turkum: t.turkum,
        narx: kirimNarx, sotuv_narx: narxMap[t.id].sotuvNarx,
        donada: dona, bloklarda: Math.floor(dona / (t.blokdagi_soni || 1)), qutilarda: 0,
        summa,
      };
    });

    const prixod = await PrixodModel.create({
      hujjat_raqam: `PRX-${1000 + i}`,
      sana,
      yetkazuvchi: yetkazuvchi.ism,
      yetkazuvchi_id: yetkazuvchi.id,
      tolov_turi: pick(['naqt', 'optom', 'chaka']),
      tolangan_summa: jamiSumma,
      ombor: 'Основной склад',
      jami_summa: jamiSumma,
      holat: 'tasdiqlangan',
    });
    prixodlar.push(prixod);

    await PrixodQatorModel.bulkCreate(qatorlar.map(q => ({ ...q, prixod_id: prixod.id })));

    tovarRegisterRows.push(...qatorlar.map(q => ({
      tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum,
      ombor: 'Основной склад', tur: 'kirim', manba_tur: 'prixod', manba_id: prixod.id,
      donada: q.donada, bloklarda: q.bloklarda, qutilarda: 0, hajm: 0,
      kirim_narx: narxMap[q.tovar_id].kirimNarx, sotuv_narx: q.sotuv_narx,
      summa: q.summa, sana,
    })));
  }
  console.log(`✓ prixod: ${prixodlar.length} (+ prixod_qator, tovar_register kirim)`);

  // ── 9. ARIZA (sotish) + ARIZA_QATOR + TOVAR_REGISTER (chiqim) + KASSA ──
  const holatlar = ['yangi', 'tasdiqlangan', 'yolda', 'yetkazildi', 'yetkazildi', 'yetkazildi', 'bekor'];
  const arizalar = [];
  let kassaRows = [];
  let mijozBalans = {}; // mijoz_id -> jami balans o'zgarishi

  for (let i = 0; i < 40; i++) {
    const sana = daysAgo(rnd(0, 45));
    const mijoz = pick(mijozlar);
    const agent = agentlar.find(a => a.id === mijoz.agent_id) || pick(agentlar);
    const holat = pick(holatlar);
    const tanlanganTovarlar = tovarlar.slice(0, rnd(2, 6));

    let jamiSumma = 0;
    const qatorlar = tanlanganTovarlar.map(t => {
      const { sotuvNarx } = narxMap[t.id];
      const dona = rnd(5, 50);
      const summa = dona * sotuvNarx;
      jamiSumma += summa;
      return {
        tovar_id: t.id, tovar_nomi: t.nomi, turkum: t.turkum,
        narx: sotuvNarx, dona, jami_dona: dona, blok: 0, hajm: 0, summa,
      };
    });

    const dostavchi = holat === 'yolda' || holat === 'yetkazildi' ? pick(dostavchilar) : null;
    const tolovTuri = pick(['naqt', 'naqt', 'naqt', 'plastik', 'qarz']);

    const ariza = await ArizaModel.create({
      raqam: `AR-${2000 + i}`,
      holat, turi: 'sotish', manba: pick(['web', 'mobil']),
      mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
      agent_id: agent.id, agent_nomi: agent.fullname,
      jami_summa: jamiSumma,
      tolov_turi: tolovTuri,
      ombor: 'Asosiy sklad',
      dostavchi_id: dostavchi ? dostavchi.id : null,
      dostavchi_nomi: dostavchi ? dostavchi.ism : null,
      jonatish_sana: dateOnly(sana),
      yetkazilgan_sana: holat === 'yetkazildi' ? sana : null,
      createdAt: sana,
    });
    arizalar.push(ariza);

    await ArizaQatorModel.bulkCreate(qatorlar.map(q => ({ ...q, ariza_id: ariza.id })));

    // Chiqim faqat yolda/yetkazildi holatlarida (ombordan chiqqan)
    if (holat === 'yolda' || holat === 'yetkazildi') {
      tovarRegisterRows.push(...qatorlar.map(q => ({
        tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum,
        ombor: 'Asosiy sklad', tur: 'chiqim', manba_tur: 'sotuv', manba_id: ariza.id,
        donada: -q.dona, bloklarda: 0, qutilarda: 0, hajm: 0,
        kirim_narx: 0, sotuv_narx: q.narx, summa: -q.summa, sana,
      })));
    }

    // Yetkazilgan buyurtmalar uchun to'lov (naqt bo'lsa kassaga kirim)
    if (holat === 'yetkazildi') {
      if (tolovTuri === 'naqt') {
        kassaRows.push({
          tur: 'kirim', kategoriya: 'mijoz_tolov', summa: jamiSumma,
          tolov_usul: 'naqt', manba_tur: 'ariza', manba_id: ariza.id,
          mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
          izoh: `${ariza.raqam} uchun to'lov`, sana,
        });
      } else if (tolovTuri === 'plastik') {
        kassaRows.push({
          tur: 'kirim', kategoriya: 'mijoz_tolov', summa: jamiSumma,
          tolov_usul: 'karta', manba_tur: 'ariza', manba_id: ariza.id,
          mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
          izoh: `${ariza.raqam} uchun to'lov (plastik)`, sana,
        });
      } else {
        // qarz — mijoz balansiga manfiy yoziladi (qarzdorlik)
        mijozBalans[mijoz.id] = (mijozBalans[mijoz.id] || 0) - jamiSumma;
      }
    }
  }
  await TovarRegisterModel.bulkCreate(tovarRegisterRows);
  console.log(`✓ ariza: ${arizalar.length} (+ ariza_qator, tovar_register chiqim)`);

  // ── 10. Yetkazuvchiga to'lovlar (prixod uchun kassa chiqim) ──
  for (const prixod of prixodlar) {
    kassaRows.push({
      tur: 'chiqim', kategoriya: 'yetkazuvchi_tolov', summa: Number(prixod.tolangan_summa),
      tolov_usul: 'naqt', manba_tur: 'prixod', manba_id: prixod.id,
      izoh: `${prixod.hujjat_raqam} uchun to'lov`, sana: prixod.sana,
    });
  }

  // ── 11. Boshqa xarajatlar (ijara, ish haqi va h.k.) ──
  const xarajatTurlari = ['ijara', 'ish_haqi', 'transport_xarajat', 'kommunal', 'boshqa_chiqim'];
  for (let i = 0; i < 15; i++) {
    kassaRows.push({
      tur: 'chiqim', kategoriya: pick(xarajatTurlari), summa: rnd(500000, 5000000),
      tolov_usul: pick(['naqt', 'bank']), izoh: 'Oylik xarajat',
      sana: daysAgo(rnd(0, 30)),
    });
  }
  await KassaModel.bulkCreate(kassaRows);
  console.log(`✓ kassa: ${kassaRows.length}`);

  // ── Mijoz balanslarini yangilash (qarzdorlik) ──
  for (const [mijozId, delta] of Object.entries(mijozBalans)) {
    await MijozModel.increment('balans', { by: delta, where: { id: mijozId } });
  }
  console.log(`✓ mijoz balanslari yangilandi (${Object.keys(mijozBalans).length} mijoz)`);

  // ── 12. TRIP SHEET + YETKAZISH_QAYTARISH ──
  const tripSheets = [];
  for (let i = 0; i < 6; i++) {
    const dostavchi = pick(dostavchilar);
    const sana = daysAgo(rnd(0, 10));
    const trip = await TripSheetModel.create({
      raqam: `TS-${100 + i}`,
      dostavchi_id: dostavchi.id, dostavchi_nomi: dostavchi.ism,
      sana: dateOnly(sana),
      holat: pick(['yangi', 'yolda', 'yakunlandi']),
      boshlangan_vaqt: sana,
    });
    tripSheets.push(trip);
  }
  console.log(`✓ trip_sheet: ${tripSheets.length}`);

  const yetkazilganArizalar = arizalar.filter(a => a.holat === 'yetkazildi');
  const qaytarishRows = [];
  for (let i = 0; i < 8; i++) {
    const ariza = pick(yetkazilganArizalar.length ? yetkazilganArizalar : arizalar);
    const tovar = pick(tovarlar);
    qaytarishRows.push({
      ariza_id: ariza.id, tovar_id: tovar.id, tovar_nomi: tovar.nomi,
      dona: rnd(1, 5), summa: rnd(10000, 100000),
      tur: pick(['qaytarma', 'brak']), sabab: pick(['Muddati tugagan', "Sifatsiz", "Mijoz rad etdi"]),
      dostavchi_id: pick(dostavchilar).id, sana: daysAgo(rnd(0, 15)),
    });
  }
  await YetkazishQaytarishModel.bulkCreate(qaytarishRows);
  console.log(`✓ yetkazish_qaytarish: ${qaytarishRows.length}`);

  // ── 13. AGENT_REGISTER (bonus/plan-fakt ledger) ──
  const agentRegisterRows = arizalar
    .filter(a => a.holat === 'yetkazildi')
    .map(a => {
      const agent = agentlar.find(ag => ag.id === a.agent_id);
      const bonusFoiz = Number(agent?.bonus_foiz || 0);
      const summa = Number(a.jami_summa);
      return {
        agent_id: a.agent_id, ariza_id: a.id, tur: 'savdo',
        summa, bonus_foiz: bonusFoiz, bonus_summa: +(summa * bonusFoiz / 100).toFixed(2),
        sana: a.createdAt,
      };
    });
  await AgentRegisterModel.bulkCreate(agentRegisterRows);
  console.log(`✓ agent_register: ${agentRegisterRows.length}`);

  // ── 14. INKASSATSIYA ──
  const inkassatsiyaRows = agentlar.map(a => {
    const yigilgan = rnd(500000, 5000000);
    const topshirilgan = yigilgan - rnd(0, 50000);
    return {
      agent_id: a.id, agent_nomi: a.fullname,
      sana: dateOnly(daysAgo(rnd(0, 10))),
      yigilgan_summa: yigilgan, topshirilgan_summa: topshirilgan,
      farq: topshirilgan - yigilgan,
      holat: topshirilgan === yigilgan ? 'yopiq' : 'kamomad',
    };
  });
  await InkassatsiyaModel.bulkCreate(inkassatsiyaRows);
  console.log(`✓ inkassatsiya: ${inkassatsiyaRows.length}`);

  // ── 15. MARSHRUT_REJA + TASHRIF ──
  const marshrutRows = [];
  for (const agent of agentlar) {
    const agentMijozlari = mijozlar.filter(m => m.agent_id === agent.id);
    for (let d = 0; d < 5; d++) {
      const sana = dateOnly(daysAgo(d));
      agentMijozlari.slice(0, 4).forEach((m, idx) => {
        marshrutRows.push({ agent_id: agent.id, mijoz_id: m.id, sana, tartib: idx + 1 });
      });
    }
  }
  const marshrutlar = marshrutRows.length ? await MarshrutRejaModel.bulkCreate(marshrutRows) : [];
  console.log(`✓ marshrut_reja: ${marshrutlar.length}`);

  const tashrifRows = marshrutlar.slice(0, 20).map(r => {
    const agent = agentlar.find(a => a.id === r.agent_id);
    const mijoz = mijozlar.find(m => m.id === r.mijoz_id);
    const checkin = new Date(r.sana);
    checkin.setHours(rnd(9, 17), rnd(0, 59));
    return {
      reja_id: r.id, agent_id: r.agent_id, agent_nomi: agent?.fullname,
      mijoz_id: r.mijoz_id, mijoz_nomi: mijoz?.nomi,
      checkin_vaqt: checkin, checkin_lat: mijoz?.lat, checkin_lng: mijoz?.lng,
      checkout_vaqt: new Date(checkin.getTime() + rnd(5, 30) * 60000),
      davomiylik_sek: rnd(300, 1800),
      natija: pick(['savdo', 'savdo', 'sotmaslik', 'ochiq']),
      sana: r.sana,
    };
  });
  await TashrifModel.bulkCreate(tashrifRows);
  console.log(`✓ tashrif: ${tashrifRows.length}`);

  // ── 16. YETKAZUVCHI_HARAKATLAR ──
  const harakatRows = prixodlar.map(p => ({
    yetkazuvchi_id: p.yetkazuvchi_id, prixod_id: p.id,
    tur: 'qarz', summa: Number(p.jami_summa), izoh: `${p.hujjat_raqam} bo'yicha qarz`,
    sana: p.sana,
  })).concat(prixodlar.slice(0, 4).map(p => ({
    yetkazuvchi_id: p.yetkazuvchi_id, prixod_id: p.id,
    tur: 'tolov', summa: Number(p.tolangan_summa), tolov_turi: 'naqt',
    izoh: `${p.hujjat_raqam} uchun to'lov`, sana: p.sana,
  })));
  await YetkazuvchiHarakatlarModel.bulkCreate(harakatRows);
  console.log(`✓ yetkazuvchi_harakatlar: ${harakatRows.length}`);

  // ── 17. AUDIT / SOTMASLIK / AGENT_LOCATION (mobil hisobot) ──
  const auditRows = [];
  for (let i = 0; i < 10; i++) {
    const agent = pick(agentlar);
    const mijoz = pick(mijozlar);
    auditRows.push({
      agent_id: agent.id, agent_nomi: agent.fullname,
      mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
      maydon: rnd(10, 100), stend: rnd(0, 5),
      biz_bilan: rnd(20, 80), bizsiz: rnd(10, 50),
      sabab: pick(['Narx baland', "Talab yo'q", 'Muqobil bor']),
      shikoyat: pick(['Yetkazish kech', 'Sifat pasaygan', '']),
      taklif: pick(['Aksiya kerak', "Yangi ta'm qo'shilsin", '']),
      kirish_vaqt: '10:00', chiqish_vaqt: '10:20',
      lat: mijoz.lat, lng: mijoz.lng,
      tovarlar: JSON.stringify([{ brand_id: '1', cat_id: '10', count: rnd(1, 10) }]),
      sana: daysAgo(rnd(0, 20)),
    });
  }
  await AuditModel.bulkCreate(auditRows);
  console.log(`✓ audit_natija: ${auditRows.length}`);

  const sotmaslikRows = [];
  for (let i = 0; i < 8; i++) {
    const agent = pick(agentlar);
    const mijoz = pick(mijozlar);
    sotmaslikRows.push({
      agent_id: agent.id, agent_nomi: agent.fullname,
      mijoz_id: mijoz.id, mijoz_nomi: mijoz.nomi,
      sabab_id: String(rnd(1, 3)),
      sabab_nomi: pick(["Tovar yo'q", 'Mijoz yopiq', "Pul yo'q"]),
      sana: daysAgo(rnd(0, 20)),
    });
  }
  await SotmaslikModel.bulkCreate(sotmaslikRows);
  console.log(`✓ sotmaslik: ${sotmaslikRows.length}`);

  const locationRows = [];
  for (const agent of agentlar) {
    for (let h = 0; h < 8; h++) {
      const t = new Date();
      t.setHours(9 + h, rnd(0, 59));
      locationRows.push({
        agent_id: agent.id,
        lat: (40.3 + Math.random() * 0.2).toFixed(7),
        lng: (71.7 + Math.random() * 0.2).toFixed(7),
        battery: rnd(20, 100), sana: t,
      });
    }
  }
  await AgentLocationModel.bulkCreate(locationRows);
  console.log(`✓ agent_location: ${locationRows.length}`);

  console.log('\n✅ Barcha test ma\'lumotlar muvaffaqiyatli qo\'shildi!');
  process.exit(0);
}

main().catch(e => {
  console.error('❌ Xatolik:', e);
  process.exit(1);
});
