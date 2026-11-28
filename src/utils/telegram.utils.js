'use strict';
/* TELEGRAM MIJOZ BOTI (2026-11-28)

   Mijoz bilan bo'ladigan har bir amal (sotuv, to'lov, vozvrat, almashtirish, buyum, va'da ...) haqida mijozga
   Telegram'da xabar boradi. Web panelda (Sozlamalar → Telegram bot) har bir amal turi alohida yoqiladi/o'chiriladi.

   QAT'IY QOIDA (yoqilgan tur uchun):
     • mijoz botni o'z telefon raqami bilan /start qilgan bo'lishi shart — aks holda amal SAQLANMAYDI (400);
     • xabar amal tranzaksiyasi ichida yuboriladi: mijoz botni bloklagan / akkaunti o'chgan / Telegram javob
       bermasa — amal SAQLANMAYDI (tranzaksiya qaytariladi), xato qaytadi; bog'lanish 'bloklangan' bo'ladi.
   YUMSHOQ (keyinroq bo'ladigan admin amallari — sotuv bekor qilish, karta to'lovi tasdig'i): ulangan bo'lsa
   xabar boradi, yetmasa amal to'xtamaydi.
   Bot sozlanmagan (.env TELEGRAM_BOT_TOKEN yo'q, masalan demo) — xabar yo'q, hech narsa bloklanmaydi.

   Bog'lanish: mijoz botda /start → "Telefon raqamni yuborish" (Telegram kontakti, faqat o'ziniki) →
   raqamning oxirgi 9 raqami mijoz.telefon / telefon2 ga mos kelgan barcha mijozlarga bog'lanadi.
   Yangilanishlar long polling (getUpdates) bilan olinadi — bitta jarayon (pm2 fork), webhook/HTTPS shart emas. */
const { AsyncLocalStorage } = require('async_hooks');
const sequelize = require('../db/db-sequelize');
const HttpException = require('./HttpException.utils');
const SozlamaModel = require('../models/sozlama.model');
const { MijozTelegramModel, TelegramXabarModel } = require('../models/telegram.model');

const TURLAR = {
  sotuv:          { nomi: 'Sotuv', qatiy: true },
  tolov:          { nomi: "To'lov (qarz to'lovi)", qatiy: true },
  vozvrat:        { nomi: 'Vozvrat (qaytarish)', qatiy: true },
  almashtirish:   { nomi: 'Tovar almashtirish', qatiy: true },
  buyum:          { nomi: 'Buyum berish / qaytarib olish', qatiy: true },
  vada:           { nomi: "To'lov sanasi surilishi (va'da)", qatiy: true },
  bekor:          { nomi: 'Sotuv bekor qilinishi', qatiy: false },
  plastik_tasdiq: { nomi: "Karta to'lovi tasdig'i / rad etilishi", qatiy: false },
};
const KALITLAR = Object.keys(TURLAR);

const n = (v) => Number(v) || 0;
const sum = (v) => `${Math.round(n(v)).toLocaleString('ru-RU').replace(/ /g, ' ')} so'm`;
const son = (v) => { const x = Math.round(n(v) * 1000) / 1000; return String(x).replace('.', ','); };
const sanaMatn = (d) => {
  const x = d ? new Date(d) : new Date();
  const p = (k) => String(k).padStart(2, '0');
  return `${p(x.getDate())}.${p(x.getMonth() + 1)}.${x.getFullYear()} ${p(x.getHours())}:${p(x.getMinutes())}`;
};

const token = () => String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const apiUrl = () => String(process.env.TELEGRAM_API_URL || 'https://api.telegram.org').replace(/\/+$/, '');
const botBor = () => !!token();
let botNomi = null;

/** Telegram Bot API chaqiruvi → result; xato: Error { tgKod, tgTavsif } */
async function api(metod, body, { timeoutMs = 15000 } = {}) {
  const r = await fetch(`${apiUrl()}/bot${token()}/${metod}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) {
    const e = new Error(j.description || `Telegram ${metod}: ${r.status}`);
    e.tgKod = j.error_code || r.status; e.tgTavsif = j.description || '';
    throw e;
  }
  return j.result;
}

/* ── Sozlamalar ─────────────────────────────────────────── */
async function turlar(t) {
  const rows = await SozlamaModel.findAll({ where: { kalit: KALITLAR.map(k => `tg_${k}`) }, raw: true, ...(t ? { transaction: t } : {}) });
  const by = Object.fromEntries(rows.map(r => [r.kalit.slice(3), String(r.qiymat) === '1']));
  return Object.fromEntries(KALITLAR.map(k => [k, !!by[k]]));
}

async function sozlamalar() {
  const [tr, [stat]] = await Promise.all([
    turlar(),
    sequelize.query(`SELECT COUNT(DISTINCT CASE WHEN holat = 'faol' THEN mijoz_id END) faol, COUNT(DISTINCT CASE WHEN holat = 'bloklangan' THEN mijoz_id END) bloklangan FROM mijoz_telegram`, { type: sequelize.QueryTypes.SELECT }),
  ]);
  if (botBor() && !botNomi) { try { botNomi = (await api('getMe', {}, { timeoutMs: 5000 })).username || null; } catch (e) { /* tarmoq */ } }
  return {
    bot: { sozlangan: botBor(), username: botBor() ? botNomi : null, havola: botBor() && botNomi ? `https://t.me/${botNomi}` : null },
    turlar: tr,
    tur_nomlari: Object.fromEntries(KALITLAR.map(k => [k, TURLAR[k].nomi])),
    qatiy: Object.fromEntries(KALITLAR.map(k => [k, TURLAR[k].qatiy])),
    ulangan_mijozlar: n(stat.faol), bloklagan_mijozlar: n(stat.bloklangan),
  };
}

async function sozlamaYoz(body) {
  const b = body && typeof body === 'object' ? (body.turlar && typeof body.turlar === 'object' ? body.turlar : body) : {};
  for (const [k, v] of Object.entries(b)) {
    if (!KALITLAR.includes(k)) throw new HttpException(400, `Noma'lum tur "${k}" (${KALITLAR.join(', ')})`);
    if (typeof v !== 'boolean') throw new HttpException(400, `${k} true yoki false bo'lsin`);
  }
  for (const [k, v] of Object.entries(b)) {
    await SozlamaModel.upsert({ kalit: `tg_${k}`, qiymat: v ? '1' : '0', izoh: `Telegram: ${TURLAR[k].nomi}` });
  }
  return sozlamalar();
}

/* ── Qat'iy tekshiruv va yuborish ───────────────────────── */
const ULANMAGAN = (nomi) => `${nomi ? `"${nomi}" ` : 'Mijoz '}Telegram botga ulanmagan — mijoz botni o'z telefon raqami bilan /start qilishi kerak. Amal saqlanmadi`;
const BLOKLAGAN = (nomi) => `${nomi ? `"${nomi}" ` : 'Mijoz '}botni bloklagan yoki Telegram akkaunti o'chirilgan — xabar yetkazilmadi, amal saqlanmadi`;

/** Yoqilgan tur uchun mijozning faol bog'lanishlari (yo'q bo'lsa — qat'iy turda 400). null — xabar kerak emas */
async function tayyorla(mijozId, tur, { t = null, mijozNomi = null } = {}) {
  if (!botBor() || !mijozId || !TURLAR[tur]) return null;
  if (!(await turlar(t))[tur]) return null;
  const links = await MijozTelegramModel.findAll({ where: { mijoz_id: mijozId }, raw: true, ...(t ? { transaction: t } : {}) });
  const faol = links.filter(l => l.holat === 'faol');
  if (!faol.length) {
    if (!TURLAR[tur].qatiy) return null;
    throw new HttpException(400, links.length ? BLOKLAGAN(mijozNomi) : ULANMAGAN(mijozNomi));
  }
  return faol;
}

/** Xabarni yuboradi. Kamida bitta chatga yetsa — OK; bloklagan chatlar 'bloklangan' bo'ladi.
    qatiy: hech biriga yetmasa — throw (amal tranzaksiyasi qaytadi). */
async function yubor(links, matn, { tur, mijozId, kim = null, qatiy = true, mijozNomi = null }) {
  let yetdi = 0, oxirgiXato = null, tarmoq = false;
  for (const l of links) {
    try {
      await api('sendMessage', { chat_id: l.chat_id, text: matn, disable_web_page_preview: true });
      yetdi++;
      await MijozTelegramModel.update({ oxirgi_xabar: new Date(), xato: null }, { where: { id: l.id } });
      await TelegramXabarModel.create({ mijoz_id: mijozId, chat_id: l.chat_id, tur, matn, holat: 'yuborildi', kim });
    } catch (e) {
      oxirgiXato = e;
      const bloklangan = e.tgKod === 403 || (e.tgKod === 400 && /chat not found|user is deactivated/i.test(e.tgTavsif || ''));
      if (bloklangan) await MijozTelegramModel.update({ holat: 'bloklangan', xato: String(e.tgTavsif || e.message).slice(0, 255) }, { where: { id: l.id } });
      else tarmoq = true;
      await TelegramXabarModel.create({ mijoz_id: mijozId, chat_id: l.chat_id, tur, matn, holat: 'xato', xato: String(e.tgTavsif || e.message).slice(0, 255), kim }).catch(() => {});
    }
  }
  if (!yetdi && qatiy) {
    if (tarmoq) throw new HttpException(502, `Telegram'ga xabar yuborilmadi (${oxirgiXato ? oxirgiXato.message : 'aloqa yo\'q'}) — amal saqlanmadi, keyinroq qayta urinib ko'ring`);
    throw new HttpException(400, BLOKLAGAN(mijozNomi));
  }
  return yetdi;
}

/** Amal ichida (tranzaksiya oxirida): tur yoqilgan bo'lsa xabar yuboradi; qat'iy turda yetmasa throw.
    matn — satr yoki async () => satr (faqat kerak bo'lganda hisoblanadi). */
/** Qatorlarda tovar nomi bo'sh bo'lsa (ilova productName yubormagan) — tovar jadvalidan */
async function nomlarniToldir(qatorlar, t = null) {
  const kerak = [...new Set((qatorlar || []).filter(q => !q.tovar_nomi && q.tovar_id).map(q => Number(q.tovar_id)))];
  if (!kerak.length) return qatorlar;
  const rows = await sequelize.query('SELECT id, nomi FROM tovar WHERE id IN (:ids)', { replacements: { ids: kerak }, type: sequelize.QueryTypes.SELECT, ...(t ? { transaction: t } : {}) });
  const by = new Map(rows.map(r => [Number(r.id), r.nomi]));
  return qatorlar.map(q => (q.tovar_nomi || !q.tovar_id ? q : { ...q, tovar_nomi: by.get(Number(q.tovar_id)) || q.tovar_nomi }));
}

const kontekst = new AsyncLocalStorage();   // shablondagi {mijoz} uchun

async function xabar(mijozId, tur, matn, { t = null, kim = null, mijozNomi = null } = {}) {
  const links = await tayyorla(mijozId, tur, { t, mijozNomi });
  if (!links) return 0;
  let nomi = mijozNomi;
  if (!nomi) {
    const [r] = await sequelize.query('SELECT nomi FROM mijoz WHERE id = :id', { replacements: { id: mijozId }, type: sequelize.QueryTypes.SELECT, ...(t ? { transaction: t } : {}) });
    nomi = r ? r.nomi : '';
  }
  const m = typeof matn === 'function' ? await kontekst.run({ mijoz: nomi }, () => matn()) : matn;
  return yubor(links, m, { tur, mijozId, kim, qatiy: TURLAR[tur].qatiy, mijozNomi });
}

/** Yumshoq: xato hech qachon tashlanmaydi (admin amallari, tranzaksiyadan keyin) */
async function xabarYumshoq(mijozId, tur, matn, opts = {}) {
  try { return await xabar(mijozId, tur, matn, opts); } catch (e) { return 0; }
}

/** Mobil sinxron va web uchun: mijozlar bo'yicha holat Map<mijozId, 'faol'|'bloklangan'> */
async function holatlar(mijozIds) {
  const ids = [...new Set((mijozIds || []).map(Number))].filter(Boolean);
  if (!ids.length) return new Map();
  const rows = await MijozTelegramModel.findAll({ where: { mijoz_id: ids }, attributes: ['mijoz_id', 'holat'], raw: true });
  const out = new Map();
  for (const r of rows) if (out.get(r.mijoz_id) !== 'faol') out.set(r.mijoz_id, r.holat);
  return out;
}

/** Mobil ilova uchun: bot holati va qat'iy yoqilgan turlar */
async function mobilBlok(agent = null) {
  if (!botBor()) return { sozlangan: false, turlar: {}, bot: null, havola: null };
  if (!botNomi) { try { botNomi = (await api('getMe', {}, { timeoutMs: 5000 })).username || null; } catch (e) { /* tarmoq */ } }
  const tr = await turlar();
  return {
    sozlangan: true, turlar: Object.fromEntries(KALITLAR.filter(k => tr[k] && TURLAR[k].qatiy).map(k => [k, true])), bot: botNomi,
    // 2026-11-28: agentning shaxsiy havolasi (QR) — mijoz skanerlasa faqat shu agentning mijozi sifatida ulanadi
    havola: botNomi && agent ? `https://t.me/${botNomi}?start=a${agent.id}` : null,
  };
}

/* ── Xabar matnlari: shablonlar (admin tahrirlaydi) ──────
   Shablon — oddiy matn, {ozgaruvchi} o'rniga qiymat qo'yiladi. Qatorda o'zgaruvchi(lar) bo'lsa-yu, hammasi bo'sh
   chiqsa (masalan chegirma yo'q, xodim yo'q) — o'sha qator butunlay tushib qoladi. Ketma-ket bo'sh qatorlar bittaga.
   Saqlanadi: sozlama 'tgs_<kalit>' (bo'sh / null — standart matn). */
const SHABLONLAR = {
  sotuv: {
    nomi: 'Sotuv (xarid)',
    standart: "🧾 Xarid: {raqam}\n{sana}\nSotuvchi: {xodim}\n\n{tovarlar}\nChegirma: −{chegirma}\nJami: {jami}\n{tolov}\n\n{qarz_holati}",
    ozg: { raqam: 'Chek raqami', sana: 'Sana va vaqt', xodim: 'Agent / diller', tovarlar: "Tovarlar ro'yxati (har biri alohida qatorda)", chegirma: "Chegirma summasi (bo'lmasa qator chiqmaydi)",
      jami: 'Jami summa', tolov: "To'lov qatorlari: naqd / karta / qarzga", naqd: "Naqd to'langan", karta: 'Karta bilan', qarzga: "Qarzga qolgan", tolov_sana: "Qarzni to'lash sanasi" },
  },
  tolov: {
    nomi: "To'lov (qarz to'lovi)",
    standart: "💵 To'lov qabul qilindi\n{sana}\nQabul qildi: {xodim}\n\nNaqd: {naqd}\nKarta: {karta} (tasdiq kutilmoqda — tasdiqlangach qarzdan ayiriladi)\n\n{qarz_holati}",
    ozg: { sana: 'Sana va vaqt', xodim: 'Qabul qilgan xodim', naqd: 'Naqd summa', karta: 'Karta summasi (tasdiq kutadi)', summa: "Jami to'lov" },
  },
  vozvrat: {
    nomi: 'Vozvrat (qaytarish)',
    standart: "↩️ Vozvrat: {raqam} chekidan\n{sana}\nQabul qildi: {xodim}\n\n{tovarlar}\nSumma: {summa} — {usul}\n\n{qarz_holati}",
    ozg: { raqam: 'Asl chek raqami', sana: 'Sana va vaqt', xodim: 'Xodim', tovarlar: 'Qaytgan tovarlar', summa: 'Qaytarish summasi', usul: '"sizga naqd qaytarildi" yoki "qarzingizdan ayirildi"' },
  },
  buyum_berish: {
    nomi: 'Buyum berildi',
    standart: "📦 Sizga buyum berildi (vaqtinchalik foydalanishga)\n{sana}\nXodim: {xodim}\n\n{buyumlar}",
    ozg: { sana: 'Sana va vaqt', xodim: 'Xodim', buyumlar: "Buyumlar ro'yxati" },
  },
  buyum_qaytarish: {
    nomi: 'Buyum qaytarib olindi',
    standart: "📦 Sizdan buyum qaytarib olindi\n{sana}\nXodim: {xodim}\n\n{buyumlar}",
    ozg: { sana: 'Sana va vaqt', xodim: 'Xodim', buyumlar: "Buyumlar ro'yxati" },
  },
  vada: {
    nomi: "To'lov sanasi surildi (va'da)",
    standart: "📅 Qarz to'lovi sanasi {yangi_sana} ga surildi\nXodim: {xodim}\nIzoh: {izoh}\n\n{qarz_holati}",
    ozg: { yangi_sana: "Yangi to'lov sanasi", xodim: 'Xodim', izoh: 'Izoh' },
  },
  bekor: {
    nomi: 'Sotuv bekor qilindi',
    standart: "❌ Xarid bekor qilindi: {raqam}\nSabab: {sabab}\n\n{qarz_holati}",
    ozg: { raqam: 'Chek raqami', sabab: 'Bekor qilish sababi' },
  },
  plastik_tasdiq: {
    nomi: "Karta to'lovi tasdiqlandi",
    standart: "✅ Karta to'lovingiz tasdiqlandi: {summa}\n\n{qarz_holati}",
    ozg: { summa: "To'lov summasi" },
  },
  plastik_rad: {
    nomi: "Karta to'lovi tasdiqlanmadi",
    standart: "⚠️ Karta to'lovingiz tasdiqlanmadi: {summa}\nSabab: {sabab}\n\n{qarz_holati}",
    ozg: { summa: "To'lov summasi", sabab: 'Rad etish sababi' },
  },
};
// Hamma shablonda bor
const UMUMIY_OZG = { mijoz: 'Mijoz (do\'kon) nomi', qarz: "Umumiy qarz summasi (qarz bo'lmasa — bo'sh)", qarz_holati: '"Umumiy qarzingiz: …" / "Qarzingiz yo\'q ✅" / "Sizning haqingiz: …"' };
const SHABLON_KALITLAR = Object.keys(SHABLONLAR);

function shablonQoll(tpl, vars) {
  const bosh = (k) => vars[k] === undefined || vars[k] === null || String(vars[k]) === '';
  const out = [];
  for (const line of String(tpl).split('\n')) {
    const keys = [...line.matchAll(/\{([a-z_]+)\}/g)].map(m => m[1]);
    if (keys.length && keys.every(bosh)) continue;
    out.push(line.replace(/\{([a-z_]+)\}/g, (_, k) => (bosh(k) ? '' : String(vars[k]))));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function shablonMatni(kalit) {
  const s = await SozlamaModel.findByPk(`tgs_${kalit}`).catch(() => null);
  const v = s && s.qiymat ? String(s.qiymat) : '';
  return v.trim() ? v : SHABLONLAR[kalit].standart;
}

async function render(kalit, vars) {
  const balans = n(vars.balans);
  const k = kontekst.getStore();
  return shablonQoll(await shablonMatni(kalit), {
    ...vars, mijoz: vars.mijoz || (k && k.mijoz) || '', qarz: balans < -0.5 ? sum(-balans) : '', qarz_holati: qarzQatori(balans),
  });
}

/** Shablon tekshiruvi: noma'lum {ozgaruvchi} — 400 */
function shablonTekshir(kalit, matn) {
  if (!SHABLONLAR[kalit]) throw new HttpException(400, `Noma'lum shablon "${kalit}" (${SHABLON_KALITLAR.join(', ')})`);
  if (matn === null || matn === undefined || String(matn).trim() === '') return null;
  if (typeof matn !== 'string') throw new HttpException(400, `${kalit}: matn satr bo'lsin`);
  if (matn.length > 3500) throw new HttpException(400, `${kalit}: matn 3500 belgidan oshmasin`);
  const ruxsat = { ...SHABLONLAR[kalit].ozg, ...UMUMIY_OZG };
  const nomalum = [...new Set([...matn.matchAll(/\{([^{}]*)\}/g)].map(m => m[1]).filter(k => !ruxsat[k]))];
  if (nomalum.length) throw new HttpException(400, `${SHABLONLAR[kalit].nomi}: noma'lum o'zgaruvchi: ${nomalum.join(', ')}. Mumkin: ${Object.keys(ruxsat).join(', ')} (jingalak qavsda yoziladi)`);
  return matn;
}

/* Namuna qiymatlar (admin panelda ko'rinish uchun) */
const NAMUNA = {
  sotuv: { raqam: 'AR-2026-0123', sana: '28.11.2026 14:35', xodim: 'Ali Valiyev', tovarlar: "• Sut 1L — 10 × 12 000 so'm = 120 000 so'm\n• Qatiq — 5 × 9 000 so'm = 45 000 so'm",
    chegirma: '', jami: "165 000 so'm", tolov: "Naqd to'landi: 100 000 so'm\nQarzga: 65 000 so'm (to'lov sanasi 2026-12-05)", naqd: "100 000 so'm", karta: '', qarzga: "65 000 so'm", tolov_sana: '2026-12-05', balans: -265000 },
  tolov: { sana: '28.11.2026 15:10', xodim: 'Ali Valiyev', naqd: "50 000 so'm", karta: '', summa: "50 000 so'm", balans: -215000 },
  vozvrat: { raqam: 'AR-2026-0123', sana: '28.11.2026 15:20', xodim: 'Ali Valiyev', tovarlar: '• Sut 1L — 2\n• Qatiq — 1 (yaroqsiz)', summa: "33 000 so'm", usul: 'qarzingizdan ayirildi', balans: -182000 },
  buyum_berish: { sana: '28.11.2026 15:30', xodim: 'Ali Valiyev', buyumlar: '• Muzlatkich — 1 dona' },
  buyum_qaytarish: { sana: '28.11.2026 15:30', xodim: 'Ali Valiyev', buyumlar: '• Muzlatkich — 1 dona' },
  vada: { yangi_sana: '2026-12-05', xodim: 'Ali Valiyev', izoh: "Juma kuni to'laydi", balans: -182000 },
  bekor: { raqam: 'AR-2026-0123', sabab: 'Takror yozilgan chek', balans: -17000 },
  plastik_tasdiq: { summa: "40 000 so'm", balans: -142000 },
  plastik_rad: { summa: "40 000 so'm", sabab: "Chek o'qilmaydi", balans: -182000 },
};

async function shablonlar() {
  const rows = await SozlamaModel.findAll({ where: { kalit: SHABLON_KALITLAR.map(k => `tgs_${k}`) }, raw: true });
  const by = Object.fromEntries(rows.map(r => [r.kalit.slice(4), r.qiymat]));
  return SHABLON_KALITLAR.map(k => {
    const ozgartirilgan = !!(by[k] && String(by[k]).trim());
    const matn = ozgartirilgan ? by[k] : SHABLONLAR[k].standart;
    const b = n(NAMUNA[k].balans);
    return {
      kalit: k, nomi: SHABLONLAR[k].nomi, matn, standart: SHABLONLAR[k].standart, ozgartirilgan,
      ozgaruvchilar: Object.entries({ ...SHABLONLAR[k].ozg, ...UMUMIY_OZG }).map(([kalit, izoh]) => ({ kalit, izoh })),
      namuna: shablonQoll(matn, { ...NAMUNA[k], mijoz: 'Baraka market', qarz: b < -0.5 ? sum(-b) : '', qarz_holati: qarzQatori(b) }),
    };
  });
}

/** { kalit: matn | null } — null / bo'sh — standartga qaytarish */
async function shablonYoz(body) {
  const b = body && typeof body === 'object' ? (body.shablonlar && typeof body.shablonlar === 'object' ? body.shablonlar : body) : {};
  const tayyor = Object.entries(b).map(([k, v]) => [k, shablonTekshir(k, v)]);
  for (const [k, v] of tayyor) {
    await SozlamaModel.upsert({ kalit: `tgs_${k}`, qiymat: v, izoh: `Telegram xabar shabloni: ${SHABLONLAR[k].nomi}` });
  }
  return shablonlar();
}

/** Ko'rinish: saqlamasdan, berilgan matn namunada qanday chiqadi */
function shablonNamuna(kalit, matn) {
  const m = shablonTekshir(kalit, matn) || SHABLONLAR[kalit].standart;
  const b = n(NAMUNA[kalit].balans);
  return { kalit, namuna: shablonQoll(m, { ...NAMUNA[kalit], mijoz: 'Baraka market', qarz: b < -0.5 ? sum(-b) : '', qarz_holati: qarzQatori(b) }) };
}

const qarzQatori = (balans) => {
  const b = n(balans);
  return b < -0.5 ? `Umumiy qarzingiz: ${sum(-b)}` : b > 0.5 ? `Sizning haqingiz: ${sum(b)}` : 'Qarzingiz yo\'q ✅';
};

async function sotuvMatni({ ariza, qatorlar, balans, xodim, plastik = 0, naqd = 0, mijoz = null }) {
  const qq = (qatorlar || []).filter(q => n(q.jami_dona ?? q.dona) > 0).slice(0, 40)
    .map(q => `• ${q.tovar_nomi || 'Tovar'} — ${son(q.jami_dona ?? q.dona)} × ${sum(q.narx)} = ${sum(q.summa)}`);
  const jami = n(ariza.jami_summa);
  const qarzga = Math.max(0, jami - n(naqd) - n(plastik));
  const tolSana = ariza.tolov_sana ? String(ariza.tolov_sana).slice(0, 10) : '';
  const tol = [];
  if (n(naqd) > 0.5) tol.push(`Naqd to'landi: ${sum(naqd)}`);
  if (n(plastik) > 0.5) tol.push(`Karta: ${sum(plastik)} (tasdiq kutilmoqda)`);
  if (qarzga > 0.5) tol.push(`Qarzga: ${sum(qarzga)}${tolSana ? ` (to'lov sanasi ${tolSana})` : ''}`);
  return render('sotuv', {
    raqam: ariza.raqam || '', sana: sanaMatn(ariza.yetkazilgan_sana || ariza.createdAt), xodim: xodim || '', tovarlar: qq.join('\n'),
    chegirma: n(ariza.chegirma_summa) > 0.5 ? sum(ariza.chegirma_summa) : '', jami: sum(jami), tolov: tol.join('\n'),
    naqd: n(naqd) > 0.5 ? sum(naqd) : '', karta: n(plastik) > 0.5 ? sum(plastik) : '', qarzga: qarzga > 0.5 ? sum(qarzga) : '',
    tolov_sana: tolSana, balans, mijoz: mijoz || ariza.mijoz_nomi || '',
  });
}

async function tolovMatni({ naqd = 0, plastik = 0, balans, xodim, sana, mijoz = null }) {
  return render('tolov', {
    sana: sanaMatn(sana), xodim: xodim || '', naqd: n(naqd) > 0.5 ? sum(naqd) : '', karta: n(plastik) > 0.5 ? sum(plastik) : '',
    summa: sum(n(naqd) + n(plastik)), balans, mijoz: mijoz || '',
  });
}

async function vozvratMatni({ raqam, qatorlar, summa, usul, balans, xodim, sana, mijoz = null }) {
  const qq = (qatorlar || []).slice(0, 40).map(q => `• ${q.tovar_nomi || q.tovar || 'Tovar'} — ${son(q.dona)}${q.yaroqli === false ? ' (yaroqsiz)' : ''}`);
  return render('vozvrat', {
    raqam: raqam || '', sana: sanaMatn(sana), xodim: xodim || '', tovarlar: qq.join('\n'), summa: sum(summa),
    usul: usul === 'naqd' ? 'sizga naqd qaytarildi' : 'qarzingizdan ayirildi', balans, mijoz: mijoz || '',
  });
}

async function buyumMatni({ tur, qatorlar, xodim, sana, mijoz = null }) {
  const qq = (qatorlar || []).slice(0, 40).map(q => `• ${q.nomi || 'Buyum'} — ${son(q.dona)} dona`);
  return render(tur === 'mijozga' ? 'buyum_berish' : 'buyum_qaytarish', { sana: sanaMatn(sana), xodim: xodim || '', buyumlar: qq.join('\n'), mijoz: mijoz || '' });
}

async function vadaMatni({ yangiSana, balans, xodim, izoh, mijoz = null }) {
  return render('vada', { yangi_sana: yangiSana, xodim: xodim || '', izoh: izoh || '', balans, mijoz: mijoz || '' });
}

async function bekorMatni({ raqam, sabab, balans, mijoz = null }) {
  return render('bekor', { raqam: raqam || '', sabab: sabab || '', balans, mijoz: mijoz || '' });
}

async function plastikMatni({ summa, tasdiq, sabab, balans, mijoz = null }) {
  return render(tasdiq ? 'plastik_tasdiq' : 'plastik_rad', { summa: sum(summa), sabab: sabab || '', balans, mijoz: mijoz || '' });
}

/* ── Bot: yangilanishlarni olish (long polling) ─────────── */
const oxirgi9 = (v) => String(v || '').replace(/\D/g, '').slice(-9);
const KONTAKT_TUGMA = { keyboard: [[{ text: '📱 Telefon raqamni yuborish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true };

async function javob(chatId, text, extra = {}) {
  try { await api('sendMessage', { chat_id: chatId, text, ...extra }); } catch (e) { /* bloklagan bo'lishi mumkin */ }
}

async function chatMijozlari(chatId) {
  return sequelize.query(`SELECT m.id, m.nomi, m.balans, t.holat FROM mijoz_telegram t JOIN mijoz m ON m.id = t.mijoz_id AND m.deletedAt IS NULL
    WHERE t.chat_id = :c ORDER BY m.nomi`, { replacements: { c: String(chatId) }, type: sequelize.QueryTypes.SELECT });
}

/* Agent QR kodi (2026-11-28): https://t.me/<bot>?start=a<agentId> — mijoz skanerlasa /start a<agentId> keladi.
   Shu chat kontakt yuborguncha agent eslab qolinadi: raqam faqat SHU agentga biriktirilgan mijozlar orasidan qidiriladi. */
const kutilganAgent = new Map();   // chatId → { agentId, vaqt }
const agentPayload = (text) => { const m = /^\/start\s+a(\d{1,10})\b/.exec(text); return m ? Number(m[1]) : null; };

async function yangilanish(u) {
  const mcm = u.my_chat_member;
  if (mcm && mcm.chat && mcm.new_chat_member) {
    const st = mcm.new_chat_member.status;
    if (st === 'kicked') await MijozTelegramModel.update({ holat: 'bloklangan', xato: 'Botni bloklagan' }, { where: { chat_id: String(mcm.chat.id) } });
    if (st === 'member') await MijozTelegramModel.update({ holat: 'faol', xato: null }, { where: { chat_id: String(mcm.chat.id) } });
    return;
  }
  const m = u.message;
  if (!m || !m.chat || m.chat.type !== 'private') return;
  const chatId = String(m.chat.id);
  if (m.contact) {
    if (String(m.contact.user_id || '') !== String(m.from && m.from.id)) {
      return javob(chatId, "Faqat o'zingizning raqamingizni yuboring — pastdagi tugmani bosing.", { reply_markup: KONTAKT_TUGMA });
    }
    const raqam = oxirgi9(m.contact.phone_number);
    if (raqam.length < 9) return javob(chatId, "Raqam noto'g'ri.", { reply_markup: KONTAKT_TUGMA });
    const ka = kutilganAgent.get(chatId);
    const agentId = ka && Date.now() - ka.vaqt < 24 * 3600 * 1000 ? ka.agentId : null;
    const barcha = await sequelize.query(`SELECT m.id, m.nomi, m.balans, m.agent_id, a.fullname agent_nomi FROM mijoz m LEFT JOIN agent a ON a.id = m.agent_id
      WHERE m.deletedAt IS NULL AND (RIGHT(REGEXP_REPLACE(COALESCE(m.telefon, ''), '[^0-9]', ''), 9) = :r OR RIGHT(REGEXP_REPLACE(COALESCE(m.telefon2, ''), '[^0-9]', ''), 9) = :r)`,
      { replacements: { r: raqam }, type: sequelize.QueryTypes.SELECT });
    // Agent QR orqali kelgan: faqat shu agentga biriktirilgan mijozlar
    const mijozlar = agentId ? barcha.filter(x => Number(x.agent_id) === agentId) : barcha;
    if (!mijozlar.length) {
      if (agentId) {
        const [ag] = await sequelize.query('SELECT fullname FROM agent WHERE id = :a', { replacements: { a: agentId }, type: sequelize.QueryTypes.SELECT });
        return javob(chatId, `+998${raqam} raqami ${ag ? ag.fullname : 'bu agent'}ning mijozlari ro'yxatida yo'q. Agentingizdan raqamingizni o'z mijozlariga kiritishini so'rang, keyin QR kodni qayta skanerlang.`, { reply_markup: { remove_keyboard: true } });
      }
      return javob(chatId, `+998${raqam} raqami mijozlar ro'yxatida topilmadi. Agentingizga raqamingizni to'g'ri yozib qo'yishini ayting va qayta /start bosing.`, { reply_markup: { remove_keyboard: true } });
    }
    kutilganAgent.delete(chatId);
    const ism = [m.from.first_name, m.from.last_name].filter(Boolean).join(' ').slice(0, 150) || null;
    for (const mj of mijozlar) {
      const bor = await MijozTelegramModel.findOne({ where: { mijoz_id: mj.id, chat_id: chatId } });
      const q = { tg_user_id: String(m.from.id), telefon: `+998${raqam}`, ism, holat: 'faol', xato: null };
      if (bor) await bor.update(q); else await MijozTelegramModel.create({ ...q, mijoz_id: mj.id, chat_id: chatId });
    }
    return javob(chatId, [
      `✅ Ulandingiz: ${mijozlar.map(x => x.nomi).join(', ')}`, '',
      "Endi har bir xarid, to'lov, vozvrat va boshqa amallar haqida shu yerga xabar keladi.",
      ...mijozlar.map(x => `${mijozlar.length > 1 ? x.nomi + ': ' : ''}${qarzQatori(x.balans)}`),
      '', 'Qarzingizni ko\'rish: /balans',
    ].join('\n'), { reply_markup: { remove_keyboard: true } });
  }
  const text = String(m.text || '').trim();
  if (/^\/start\b/.test(text)) {
    const ag = agentPayload(text);
    if (ag) kutilganAgent.set(chatId, { agentId: ag, vaqt: Date.now() });
    const bor = await chatMijozlari(chatId);
    if (bor.length) await MijozTelegramModel.update({ holat: 'faol', xato: null }, { where: { chat_id: chatId } });
    return javob(chatId, bor.length
      ? `Assalomu alaykum! Siz ulangansiz: ${bor.map(x => x.nomi).join(', ')}.\nQarzingiz: /balans\nRaqamni yangilash uchun pastdagi tugmani bosing.`
      : "Assalomu alaykum! Xaridlaringiz va to'lovlaringiz haqida xabar olish uchun pastdagi tugma orqali telefon raqamingizni yuboring.",
    { reply_markup: KONTAKT_TUGMA });
  }
  if (/^\/balans\b/.test(text)) {
    const bor = await chatMijozlari(chatId);
    if (!bor.length) return javob(chatId, 'Avval /start bosing va telefon raqamingizni yuboring.');
    return javob(chatId, bor.map(x => `${bor.length > 1 ? x.nomi + ': ' : ''}${qarzQatori(x.balans)}`).join('\n'));
  }
  return javob(chatId, "Xabarlar shu yerga avtomatik keladi. Qarzingiz: /balans", {});
}

let ishlayapti = false;
async function botniIshgaTushir() {
  if (!botBor() || ishlayapti || process.env.NODE_ENV === 'test') return;
  ishlayapti = true;
  try { botNomi = (await api('getMe', {}, { timeoutMs: 10000 })).username || null; } catch (e) { /* keyinroq */ }
  const s = await SozlamaModel.findByPk('tg_offset').catch(() => null);
  let offset = s ? Number(s.qiymat) || 0 : 0;
  const kut = (ms) => new Promise(r => setTimeout(r, ms));
  const pollSek = Math.max(0, Math.min(50, Number(process.env.TELEGRAM_POLL_SEK ?? 30)));
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const yangi = await api('getUpdates', { offset, timeout: pollSek, allowed_updates: ['message', 'my_chat_member'] }, { timeoutMs: (pollSek + 15) * 1000 });
      for (const u of yangi) {
        offset = u.update_id + 1;
        try { await yangilanish(u); } catch (e) { console.error('[telegram] yangilanish xatosi', e.message); }
      }
      if (yangi.length) await SozlamaModel.upsert({ kalit: 'tg_offset', qiymat: String(offset), izoh: 'Telegram getUpdates offset' });
    } catch (e) {
      console.error('[telegram] getUpdates', e.message);
      await kut(5000);
    }
  }
}

module.exports = {
  TURLAR, KALITLAR, botBor, sozlamalar, sozlamaYoz, tayyorla, yubor, xabar, xabarYumshoq, holatlar, mobilBlok,
  nomlarniToldir, shablonlar, shablonYoz, shablonNamuna, shablonQoll, SHABLONLAR, sotuvMatni, tolovMatni, vozvratMatni, buyumMatni, vadaMatni, bekorMatni, plastikMatni, botniIshgaTushir, yangilanish,
};
