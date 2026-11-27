'use strict';
/* SUPER AGENT KUZATUV RUXSATLARI (2026-11-27)
   Admin har bir super agentga alohida belgilaydi (agent.super_kuzatuv JSON): biriktirilgan agentlarning
   qaysi bo'limlarini ko'radi. Faqat ko'rish (yozish kuzatuvda hech qachon yo'q). Belgilanmagan kalit — ruxsat bor
   (avvalgi xatti-harakat o'zgarmaydi). Server kuzatuv javoblarini shu bo'yicha qisqartiradi, ilova esa
   login javobidagi superKuzatuv bo'yicha bo'limlarni yashiradi. */
const HttpException = require('./HttpException.utils');

const BOLIMLAR = {
  bugun:    "Bugun — kunlik savdo ko'rsatkichlari",
  mijozlar: "Mijozlar ro'yxati, marshrut va tashriflar",
  qarz:     'Mijozlar qarzi va balansi',
  sklad:    "Sklad — agent qoldig'i, brak, ko'chirishlar, buyumlar",
  kassa:    'Kassa — agent puli, sotuvlar va to\'lovlar tarixi',
  cheklar:  'Mijoz chek tarixi',
  kpi:      'Oylik KPI va statistika',
};
const KALITLAR = Object.keys(BOLIMLAR);

/** agent.super_kuzatuv (JSON matn | obyekt | null) → { bugun: true, ... } — belgilanmagani true */
function ruxsatlar(agent) {
  let x = agent ? agent.super_kuzatuv : null;
  if (typeof x === 'string') { try { x = JSON.parse(x); } catch (e) { x = null; } }
  const out = {};
  for (const k of KALITLAR) out[k] = !(x && typeof x === 'object' && x[k] === false);
  return out;
}

/** Web kiritish: { kalit: bool } — noma'lum kalit 400 → saqlanadigan JSON matn */
function kiritish(v) {
  if (v === null) return null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpException(400, "super_kuzatuv obyekt bo'lsin: { bolim: true|false }");
  const out = {};
  for (const [k, b] of Object.entries(v)) {
    if (!KALITLAR.includes(k)) throw new HttpException(400, `super_kuzatuv: noma'lum bo'lim "${k}" (${KALITLAR.join(', ')})`);
    if (typeof b !== 'boolean') throw new HttpException(400, `super_kuzatuv.${k} true yoki false bo'lsin`);
    out[k] = b;
  }
  return JSON.stringify(out);
}

/** Kuzatuvdagi so'rov uchun bo'lim ruxsati: yo'q bo'lsa 403 */
function tekshir(req, kalit) {
  if (!req.kuzatuv) return;
  if (!ruxsatlar(req.superAgent)[kalit]) throw new HttpException(403, `Bu bo'lim (${BOLIMLAR[kalit]}) sizga yopilgan — administrator ruxsat bermagan`);
}

/** avtolavkaSinxron javobini kuzatuv ruxsatlari bo'yicha qisqartiradi */
function sinxronFiltr(d, sup) {
  const r = ruxsatlar(sup);
  const out = { ...d, superKuzatuv: r };
  if (!r.bugun && out.holat) out.holat = { ...out.holat, bugun: {} };
  if (!r.mijozlar) { out.mijozlar = []; out.reja = []; out.tashriflar = []; }
  if (!r.qarz && Array.isArray(out.mijozlar)) out.mijozlar = out.mijozlar.map(m => ({ ...m, qarz: 0, balans: 0, kreditLimit: 0 }));
  if (!r.sklad) {
    out.mashina = { qatorlar: [], jami: { dona: 0, summa: 0 } }; out.brak = { qatorlar: [] };
    out.kochirishlar = []; out.buyumlar = null; out.ombor = []; out.tavsiya = null; out.yuklashlar = []; out.dalolatnomalar = [];
  }
  if (!r.kassa) { out.pul = null; out.savdolar = []; out.kassalar = []; }
  return out;
}

/** Agentlarim ro'yxatidagi qisqa kartani qisqartirish */
function qisqaFiltr(a, sup) {
  const r = ruxsatlar(sup);
  return {
    ...a,
    bugun: r.bugun ? a.bugun : null,
    mijozQarzi: r.qarz ? a.mijozQarzi : null,
    omborDona: r.sklad ? a.omborDona : null, omborSumma: r.sklad ? a.omborSumma : null,
    pul: r.kassa ? a.pul : null,
  };
}

module.exports = { BOLIMLAR, KALITLAR, ruxsatlar, kiritish, tekshir, sinxronFiltr, qisqaFiltr };
