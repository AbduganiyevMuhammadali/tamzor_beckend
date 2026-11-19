/**
 * MIJOZLAR IMPORTI — Excel/CSV ro'yxatni tizimga o'tkazish (boshqa tizimdan ko'chish yoki ommaviy qo'shish).
 *
 * Oqim:
 *   1. POST /mijozlar/import/oqish  — fayl o'qiladi; ustunlar bizning maydonlarga avtomatik moslanadi,
 *                                     "mas'ul shaxs" nomlari mavjud agentlarga taklif qilinadi. Hech narsa yozilmaydi.
 *   2. POST /mijozlar/import  rejim=tekshir — har qator: yangi / yangilanadi / o'zgarishsiz / xato (+ ogohlantirishlar).
 *   3. POST /mijozlar/import  rejim=saqla   — xuddi shu hisob, bitta tranzaksiyada saqlanadi.
 *
 * Qoidalar:
 *   - Mavjud mijoz telefon (oxirgi 9 raqam, telefon yoki telefon2) bo'yicha, bo'lmasa aynan shu nom bo'yicha topiladi.
 *     Topilsa YANGILANADI: fayldagi to'ldirilgan kataklar yoziladi, bo'sh katak bordagini o'chirmaydi.
 *   - Balans faqat YANGI mijozga yoziladi — mavjud mijozning balansi savdo va to'lovlardan yuradi.
 *     Standart: manfiy son = mijoz qarzi (bizning `mijoz.balans` bilan bir xil ishora); sozlamada teskarisi ham bor.
 *   - Hudud (territoriya) va toifa nomi bo'yicha topiladi, bo'lmasa yaratiladi.
 *   - Mas'ul shaxs → agent: ilova bergan xarita bo'yicha (mavjud agent id | 'yangi' — agent yaratiladi | null — biriktirilmaydi).
 *   - Eski tizim tarixi (birinchi/oxirgi savdo, xaridlar soni, ko'chirilgan qarz) yangi mijoz izohiga yoziladi.
 */
const ExcelJS = require('exceljs');
const { MijozModel, TerritoriyaModel, MijozKategoriyaModel, AgentModel } = require('../../models/index');
const HttpException = require('../../utils/HttpException.utils');
const sequelize = require('../../db/db-sequelize');

const MAX_QATOR = 5000;
const KUNLAR = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];

/* Bizning maydonlar va ular fayl sarlavhasida qanday atalishi mumkinligi (ustuvorlik tartibida) */
const MAYDONLAR = [
  { k: 'nomi',            nom: 'Mijoz nomi',          majburiy: true,
    kalitlar: ["to'liq ismi", 'mijoz nomi', 'nomi', 'mijoz', "do'kon", "do'kon nomi", 'name', 'название', 'наименование', 'клиент', 'fio', 'f.i.o'] },
  { k: 'telefon',         nom: 'Telefon',
    kalitlar: ['telefon raqami', 'telefon', 'tel', 'phone', 'телефон', 'telefon 1'] },
  { k: 'telefon2',        nom: "Qo'shimcha telefon",
    kalitlar: ['telefon 2', "qo'shimcha telefon", 'kompaniya telefon raqami', 'tel 2', 'phone 2'] },
  { k: 'masul',           nom: "Mas'ul shaxs (agent)",
    kalitlar: ["ma'sul shaxs fio", "mas'ul shaxs", "ma'sul shaxs", 'agent', 'agent nomi', 'agent fio', 'ответственный'] },
  { k: 'hudud',           nom: 'Hudud (tuman)',
    kalitlar: ['hudud', 'tuman', 'territoriya', 'hudud (tuman)', 'kategoriya', 'район', 'регион', 'region'] },
  { k: 'toifa',           nom: 'Toifa (narx ro\'yxati)',
    kalitlar: ['toifa', 'mijoz toifasi', 'категория клиента'] },
  { k: 'holat',           nom: 'Holati',
    kalitlar: ['holati', 'holat', 'status', 'статус'] },
  { k: 'turi',            nom: 'Mijoz turi',
    kalitlar: ['mijoz turi', 'turi', 'тип клиента'] },
  { k: 'manzil',          nom: 'Manzil',
    kalitlar: ['manzil', 'joylashuv', 'address', 'адрес', 'manzili'] },
  { k: 'mo_ljal',         nom: "Mo'ljal",
    kalitlar: ["mo'ljal", 'moljal', 'ориентир'] },
  { k: 'yuridik_nomi',    nom: 'Yuridik nomi',
    kalitlar: ['yuridik nomi', 'yuridik nom', 'tashkilot', 'korxona', 'юридическое название'] },
  { k: 'inn',             nom: 'STIR (INN)',
    kalitlar: ['stir', 'inn', 'инн', 'stir (inn)'] },
  { k: 'bank',            nom: 'Bank',           kalitlar: ['bank', 'банк'] },
  { k: 'hisob_raqam',     nom: 'Hisob raqami',   kalitlar: ['hisob raqami', 'hisob raqam', 'h/r', 'р/с', 'расчетный счет'] },
  { k: 'mfo',             nom: 'MFO',            kalitlar: ['mfo', 'мфо'] },
  { k: 'narx_turi',       nom: 'Narx turi',      kalitlar: ['narx turi', 'narx', 'тип цены'] },
  { k: 'kredit_limit',    nom: 'Kredit limiti',  kalitlar: ['kredit limiti', 'kredit limit', 'limit', 'кредитный лимит'] },
  { k: 'tolov_muddati_kun', nom: "To'lov muddati (kun)", kalitlar: ["to'lov muddati", "to'lov muddati (kun)", 'muddat', 'срок оплаты'] },
  { k: 'tashrif_kunlari', nom: 'Tashrif kunlari', kalitlar: ['tashrif kunlari', 'kunlar', 'hafta kunlari', 'дни посещения'] },
  { k: 'sinf',            nom: 'Sinf (A–D)',     kalitlar: ['sinf', 'class', 'класс'] },
  { k: 'lat',             nom: 'Kenglik (lat)',  kalitlar: ['lat', 'latitude', 'kenglik', 'широта'] },
  { k: 'lng',             nom: 'Uzunlik (lng)',  kalitlar: ['lng', 'lon', 'long', 'longitude', 'uzunlik', 'долгота'] },
  { k: 'balans',          nom: 'Balans / qarz',  kalitlar: ['balans', 'qarz', 'qoldiq', 'saldo', 'баланс', 'долг', 'сальдо', 'balance'] },
  { k: 'izoh',            nom: 'Izoh',           kalitlar: ['izoh', 'eslatma', 'комментарий', 'примечание', 'comment', 'note'] },
  { k: 'birinchi_savdo',  nom: 'Birinchi savdo (tarix)', kalitlar: ['birinchi savdo', 'birinchi xarid', 'первая продажа'] },
  { k: 'oxirgi_savdo',    nom: 'Oxirgi savdo (tarix)',   kalitlar: ['oxirgi savdo', 'oxirgi xarid', 'последняя продажа'] },
  { k: 'xaridlar_soni',   nom: 'Xaridlar soni (tarix)',  kalitlar: ['xaridlar soni', 'karidor soni', 'xaridlar', 'количество покупок'] },
];

/* ── Yordamchilar ── */
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const norm = s => String(s ?? '').toLowerCase().replace(/[ʻʼ‘’`´']/g, "'").replace(/\s+/g, ' ').trim();
const toza = s => String(s ?? '').replace(/[ʻʼ‘’`´]/g, "'").replace(/\s+/g, ' ').trim();
const tel9 = s => { const d = String(s ?? '').replace(/\D/g, ''); return d.length >= 9 ? d.slice(-9) : ''; };
const bosh = v => v === null || v === undefined || String(v).trim() === '';

function telefonNormal(v) {
  const s = toza(v);
  if (!s) return '';
  const d = s.replace(/\D/g, '');
  if (d.length === 9) return '+998' + d;
  if (d.length === 12 && d.startsWith('998')) return '+' + d;
  return s.slice(0, 20);
}
function sonParse(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const matn = String(v).trim();
  const manfiy = /^[-−–]/.test(matn) || /^\(.*\)$/.test(matn);
  // Bo'sh joy (oddiy/NBSP/ingichka), valyuta va boshqa belgilar olib tashlanadi — faqat raqam , .
  let s = matn.replace(/[^\d,.]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const nuqta = (s.match(/\./g) || []).length, vergul = (s.match(/,/g) || []).length;
  if (nuqta && vergul) {
    // Ikkalasi bor: oxirgisi — kasr, qolgani minglik ("1.250.000,50" / "1,250,000.50")
    const kasr = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const ming = kasr === ',' ? '.' : ',';
    s = s.split(ming).join('').replace(kasr, '.');
  } else if (nuqta > 1 || vergul > 1) {
    // Bir xil belgi bir necha marta — minglik ajratgich ("1.250.000", "1,250,000")
    s = s.replace(/[.,]/g, '');
  } else if (vergul === 1) {
    // Bitta vergul: aniq 3 xona — minglik ("1,250"), aks holda kasr ("1,5", "41,311081")
    s = /^\d{1,3},\d{3}$/.test(s) ? s.replace(',', '') : s.replace(',', '.');
  }
  // Bitta nuqta — kasr ("12.5", "41.311")
  const x = parseFloat(s);
  if (!Number.isFinite(x)) return null;
  return manfiy ? -x : x;
}
function sanaMatn(v) {
  if (v instanceof Date && !isNaN(v)) return `${String(v.getDate()).padStart(2, '0')}.${String(v.getMonth() + 1).padStart(2, '0')}.${v.getFullYear()}`;
  return toza(v);
}
/* exceljs katagi: richText / hyperlink / formula / Date → oddiy qiymat */
function katak(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return sanaMatn(v);
  if (typeof v === 'object') {
    if (Array.isArray(v.richText)) return v.richText.map(r => r.text).join('');
    if ('result' in v) return katak(v.result);
    if ('text' in v) return katak(v.text);
    if ('hyperlink' in v) return katak(v.text || v.hyperlink);
    return String(v);
  }
  return v;
}
function levenshtein(a, b) {
  const m = a.length, k = b.length; if (!m) return k; if (!k) return m;
  let prev = Array.from({ length: k + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= k; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[k];
}
/* "Jahongir" ↔ "Johongir Saydullayev" kabi — ism bo'yicha taklif */
function agentTaklif(nom, agentlar) {
  const s = norm(nom); if (!s) return null;
  const aniq = agentlar.find(a => norm(a.fullname) === s); if (aniq) return aniq.id;
  const bosh1 = s.split(' ')[0];
  let eng = null, engMasofa = 3;
  for (const a of agentlar) {
    const an = norm(a.fullname);
    if (an.includes(s) || s.includes(an)) return a.id;
    for (const tok of an.split(' ')) {
      const d = levenshtein(bosh1, tok);
      if (bosh1.length >= 5 && d < engMasofa) { engMasofa = d; eng = a.id; }
    }
  }
  return engMasofa <= 2 ? eng : null;
}

/* ── CSV ── */
function csvOqi(matn) {
  const t = matn.replace(/^﻿/, '');
  const birinchi = t.split(/\r?\n/)[0] || '';
  const ajr = (birinchi.match(/;/g) || []).length > (birinchi.match(/,/g) || []).length ? ';' : ',';
  const qatorlar = []; let qator = [], katak = '', tirnoq = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (tirnoq) {
      if (c === '"') { if (t[i + 1] === '"') { katak += '"'; i++; } else tirnoq = false; }
      else katak += c;
    } else if (c === '"') tirnoq = true;
    else if (c === ajr) { qator.push(katak); katak = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; qator.push(katak); qatorlar.push(qator); qator = []; katak = ''; }
    else katak += c;
  }
  if (katak !== '' || qator.length) { qator.push(katak); qatorlar.push(qator); }
  return qatorlar;
}

async function faylniOqi(file) {
  const nom = (file.originalname || '').toLowerCase();
  let jadval;
  if (nom.endsWith('.csv') || nom.endsWith('.txt')) {
    jadval = csvOqi(file.buffer.toString('utf8'));
  } else {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(file.buffer); }
    catch { throw new HttpException(400, "Fayl o'qilmadi — .xlsx (Excel 2007+) yoki .csv yuboring"); }
    const ws = wb.worksheets.find(w => w.rowCount > 0) || wb.worksheets[0];
    if (!ws) throw new HttpException(400, "Faylda varaq topilmadi");
    jadval = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const v = row.values.slice(1).map(katak);
      jadval.push(v);
    });
  }
  // Sarlavha — birinchi bo'sh bo'lmagan qator
  while (jadval.length && jadval[0].every(bosh)) jadval.shift();
  if (!jadval.length) throw new HttpException(400, "Fayl bo'sh");
  const ustunlar = jadval[0].map(h => toza(h));
  const qatorlar = jadval.slice(1).filter(r => r.some(c => !bosh(c))).slice(0, MAX_QATOR)
    .map(r => ustunlar.map((_, i) => (r[i] === undefined ? '' : r[i])));
  return { ustunlar, qatorlar };
}

/* Avto moslash: har maydon uchun mos sarlavhalar ichidan eng to'liq to'ldirilgani */
function avtoXarita(ustunlar, qatorlar) {
  const nu = ustunlar.map(norm);
  const toldirilgan = ustunlar.map((_, i) => qatorlar.reduce((s, r) => s + (bosh(r[i]) ? 0 : 1), 0));
  const band = new Set();
  const xarita = {};
  for (const m of MAYDONLAR) {
    let tanlov = null, engYaxshi = -1;
    m.kalitlar.forEach((kal, ustuvorlik) => {
      nu.forEach((h, i) => {
        if (h !== kal || band.has(i)) return;
        const ball = toldirilgan[i] * 1000 - ustuvorlik;
        if (ball > engYaxshi) { engYaxshi = ball; tanlov = i; }
      });
    });
    if (tanlov !== null && toldirilgan[tanlov] > 0) { xarita[m.k] = tanlov; band.add(tanlov); }
    else xarita[m.k] = null;
  }
  return { xarita, toldirilgan };
}

/* ── Bitta qatorni bizning shaklga keltirish ── */
function qatorniTayyorla(r, xarita, sozlama) {
  const ol = k => (xarita[k] === null || xarita[k] === undefined) ? '' : r[xarita[k]];
  const ogoh = [];
  const m = {};
  m.nomi = toza(ol('nomi'));
  if (m.nomi.length > 150) { m.nomi = m.nomi.slice(0, 150); ogoh.push('nom qisqartirildi'); }
  m.telefon = telefonNormal(ol('telefon'));
  m.telefon2 = telefonNormal(ol('telefon2'));
  if (m.telefon && tel9(m.telefon).length < 9) ogoh.push("telefon raqami to'liq emas");
  m.masul = toza(ol('masul'));
  m.hudud = toza(ol('hudud'));
  m.toifa = toza(ol('toifa'));
  const holat = norm(ol('holat'));
  m.faol = holat ? !/nofaol|blok|arxiv|inactive|o'chir|yo'q|false|^0$|неактив|архив/.test(holat) : true;
  const turi = norm(ol('turi'));
  m.yuridik = !!turi && /yurid|mchj|ooo|llc|юрид|xk|ooo/.test(turi);
  m.manzil = toza(ol('manzil')).slice(0, 255);
  m.mo_ljal = toza(ol('mo_ljal')).slice(0, 255);
  m.yuridik_nomi = toza(ol('yuridik_nomi')).slice(0, 200);
  m.inn = toza(ol('inn')).slice(0, 20);
  m.bank = toza(ol('bank')).slice(0, 100);
  m.hisob_raqam = toza(ol('hisob_raqam')).slice(0, 30);
  m.mfo = toza(ol('mfo')).slice(0, 10);
  const nt = norm(ol('narx_turi'));
  m.narx_turi = nt ? (/opt|опт/.test(nt) ? 'optom' : 'chakana') : null;
  m.kredit_limit = sonParse(ol('kredit_limit'));
  const muddat = sonParse(ol('tolov_muddati_kun'));
  m.tolov_muddati_kun = muddat && muddat > 0 ? Math.round(muddat) : null;
  const kunlar = toza(ol('tashrif_kunlari'));
  if (kunlar) {
    // "Du," kabi oxirgi ajratgich bo'sh bo'lak beradi — bo'sh bo'laklar tashlanadi
    const t = kunlar.split(/[,;/ ]+/).filter(Boolean).map(x => x.slice(0, 2)).map(x => x[0].toUpperCase() + x.slice(1).toLowerCase()).filter(x => KUNLAR.includes(x));
    m.tashrif_kunlari = t.length ? [...new Set(t)].join(', ') : null;
    if (!t.length) ogoh.push("tashrif kunlari tushunarsiz (Du, Se, Ch… kutiladi)");
  } else m.tashrif_kunlari = null;
  const sinf = toza(ol('sinf')).toUpperCase();
  m.sinf = ['A', 'B', 'C', 'D'].includes(sinf) ? sinf : null;
  const lat = sonParse(ol('lat')), lng = sonParse(ol('lng'));
  m.lat = lat !== null && Math.abs(lat) <= 90 ? lat : null;
  m.lng = lng !== null && Math.abs(lng) <= 180 ? lng : null;
  if ((lat !== null || lng !== null) && (m.lat === null || m.lng === null)) ogoh.push("koordinata noto'g'ri");
  const b = sonParse(ol('balans'));
  // Standart: manfiy = qarz (bizning balans bilan bir xil). 'musbat' — faylda qarz musbat yozilgan.
  m.balans = b === null ? null : (sozlama.balansIshora === 'musbat' ? -b : b);
  m.izoh = toza(ol('izoh'));
  m.birinchi_savdo = sanaMatn(ol('birinchi_savdo'));
  m.oxirgi_savdo = sanaMatn(ol('oxirgi_savdo'));
  const xs = sonParse(ol('xaridlar_soni'));
  m.xaridlar_soni = xs === null ? null : Math.round(xs);
  if (!m.telefon) ogoh.push('telefon yo\'q');
  if (xarita.hudud !== null && xarita.hudud !== undefined && !m.hudud) ogoh.push('tuman ko\'rsatilmagan');
  return { m, ogoh };
}

/* Yangi mijoz izohi: fayl izohi + mijoz turi + eski tizim tarixi + ko'chirilgan qarz */
function izohTuz(m, sana) {
  const q = [];
  if (m.izoh) q.push(m.izoh);
  if (m.yuridik) q.push('Yuridik shaxs');
  if (m.xaridlar_soni || m.birinchi_savdo || m.oxirgi_savdo) {
    const t = [];
    if (m.xaridlar_soni) t.push(`${m.xaridlar_soni} xarid`);
    if (m.birinchi_savdo || m.oxirgi_savdo) t.push([m.birinchi_savdo, m.oxirgi_savdo].filter(Boolean).join(' – '));
    q.push('Eski tizim: ' + t.join(', '));
  }
  if (m.balans !== null && Math.abs(m.balans) > 0.5) {
    q.push(m.balans < 0
      ? `Eski tizimdan qarz: ${Math.round(-m.balans).toLocaleString('ru-RU')} so'm (import ${sana})`
      : `Eski tizimdan oldindan to'lov: ${Math.round(m.balans).toLocaleString('ru-RU')} so'm (import ${sana})`);
  }
  return q.join(' · ') || null;
}

const MATN_MAYDONLAR = ['telefon', 'telefon2', 'manzil', 'mo_ljal', 'yuridik_nomi', 'inn', 'bank', 'hisob_raqam', 'mfo', 'tashrif_kunlari', 'sinf', 'narx_turi'];
const SON_MAYDONLAR = ['kredit_limit', 'tolov_muddati_kun', 'lat', 'lng'];

class MijozImportController {

  /* POST /mijozlar/import/oqish  (multipart: file) */
  oqish = async (req, res) => {
    if (!req.file) throw new HttpException(400, 'Fayl yuborilmadi');
    const { ustunlar, qatorlar } = await faylniOqi(req.file);
    const { xarita, toldirilgan } = avtoXarita(ustunlar, qatorlar);
    const agentlar = await AgentModel.findAll({ attributes: ['id', 'fullname', 'avtolavka'], where: { faol: true }, order: [['fullname', 'ASC']], raw: true });
    // Mas'ul shaxslar — nechta mijozi bor, qaysi agentga o'xshaydi
    const masullar = [];
    if (xarita.masul !== null) {
      const c = new Map();
      for (const r of qatorlar) { const v = toza(r[xarita.masul]); if (v) c.set(v, (c.get(v) || 0) + 1); }
      for (const [nom, soni] of [...c.entries()].sort((a, b) => b[1] - a[1])) masullar.push({ nom, soni, taklif: agentTaklif(nom, agentlar) });
    }
    res.send({
      faylNomi: req.file.originalname,
      ustunlar: ustunlar.map((nom, i) => ({ i, nom, toldirilgan: toldirilgan[i], namuna: qatorlar.filter(r => !bosh(r[i])).slice(0, 3).map(r => String(r[i]).slice(0, 40)) })),
      qatorlar,
      maydonlar: MAYDONLAR.map(m => ({ k: m.k, nom: m.nom, majburiy: !!m.majburiy })),
      xarita, masullar, agentlar,
      jami: qatorlar.length, chegara: MAX_QATOR,
    });
  };

  /* POST /mijozlar/import  { qatorlar, xarita, agentXarita, sozlama, rejim } */
  import = async (req, res) => {
    const { qatorlar, xarita = {}, agentXarita = {}, sozlama = {}, rejim = 'tekshir' } = req.body || {};
    if (!Array.isArray(qatorlar) || !qatorlar.length) throw new HttpException(400, "Qatorlar yo'q");
    if (qatorlar.length > MAX_QATOR) throw new HttpException(400, `Bir safarda ko'pi bilan ${MAX_QATOR} qator`);
    if (xarita.nomi === null || xarita.nomi === undefined) throw new HttpException(400, "«Mijoz nomi» ustuni tanlanmagan");
    const yangilash = sozlama.yangilash !== false;
    const saqla = rejim === 'saqla';
    const bugun = new Date();
    const sanaMatni = `${String(bugun.getDate()).padStart(2, '0')}.${String(bugun.getMonth() + 1).padStart(2, '0')}.${bugun.getFullYear()}`;

    const [mavjud, hududlar, toifalar, agentlar] = await Promise.all([
      MijozModel.findAll({ attributes: ['id', 'nomi', 'telefon', 'telefon2', 'manzil', 'mo_ljal', 'territoriya_id', 'kategoriya_id', 'agent_id', 'sinf', 'narx_turi', 'balans', 'kredit_limit', 'tolov_muddati_kun', 'inn', 'hisob_raqam', 'bank', 'mfo', 'yuridik_nomi', 'tashrif_kunlari', 'lat', 'lng', 'faol'], raw: true }),
      TerritoriyaModel.findAll({ raw: true }),
      MijozKategoriyaModel.findAll({ raw: true }),
      AgentModel.findAll({ attributes: ['id', 'fullname'], raw: true }),
    ]);
    const telIndeks = new Map(), nomIndeks = new Map();
    for (const m of mavjud) {
      for (const t of [m.telefon, m.telefon2]) { const k = tel9(t); if (k && !telIndeks.has(k)) telIndeks.set(k, m); }
      const nk = norm(m.nomi); if (nk && !nomIndeks.has(nk)) nomIndeks.set(nk, m);
    }
    const hududMap = new Map(hududlar.map(h => [norm(h.nomi), h]));
    const toifaMap = new Map(toifalar.map(t => [norm(t.nomi), t]));
    const agentMap = new Map(agentlar.map(a => [a.id, a]));
    const yangiHududlar = new Map(), yangiToifalar = new Map(), yangiAgentlar = new Map();

    const agentTanla = (masul) => {
      if (!masul) return { id: null, nom: null };
      const v = agentXarita[masul];
      if (v === 'yangi') { if (!yangiAgentlar.has(masul)) yangiAgentlar.set(masul, { fullname: masul }); return { id: 'yangi:' + masul, nom: masul + ' (yangi)' }; }
      if (v === null || v === undefined || v === '' ) return { id: null, nom: null };
      const a = agentMap.get(Number(v));
      return a ? { id: a.id, nom: a.fullname } : { id: null, nom: null };
    };
    const hududTanla = (nom) => {
      if (!nom) return null;
      const k = norm(nom);
      if (hududMap.has(k)) return hududMap.get(k).id;
      if (!yangiHududlar.has(k)) yangiHududlar.set(k, { nomi: toza(nom) });
      return 'yangi:' + k;
    };
    const toifaTanla = (nom) => {
      if (!nom) return null;
      const k = norm(nom);
      if (toifaMap.has(k)) return toifaMap.get(k).id;
      if (!yangiToifalar.has(k)) yangiToifalar.set(k, { nomi: toza(nom) });
      return 'yangi:' + k;
    };

    const natija = [];
    const fayldaTel = new Map(), fayldaNom = new Map();
    const xulosa = { jami: qatorlar.length, yangi: 0, yangilanadi: 0, ozgarishsiz: 0, xato: 0, qarzdorlar: 0, qarzJami: 0, ogohlantirish: 0 };

    qatorlar.forEach((r, i) => {
      const n1 = i + 2;   // Excel'dagi qator raqami (1 — sarlavha)
      const { m, ogoh } = qatorniTayyorla(Array.isArray(r) ? r : [], xarita, sozlama);
      const agent = agentTanla(m.masul);
      const hududId = hududTanla(m.hudud);
      const toifaId = toifaTanla(m.toifa);
      const qator = { n: n1, nomi: m.nomi, telefon: m.telefon, hudud: m.hudud || null, agent: agent.nom, masul: m.masul || null,
        balans: m.balans, holat: 'yangi', sabab: null, ogoh, ozgarishlar: [] };
      if (!m.nomi) { qator.holat = 'xato'; qator.sabab = "Mijoz nomi bo'sh"; natija.push(qator); return; }
      // Faylning o'zida takror
      const tk = tel9(m.telefon), nk = norm(m.nomi);
      if (tk && fayldaTel.has(tk)) { qator.holat = 'xato'; qator.sabab = `Telefon ${fayldaTel.get(tk)}-qator bilan bir xil`; natija.push(qator); return; }
      if (fayldaNom.has(nk)) { qator.holat = 'xato'; qator.sabab = `Nom ${fayldaNom.get(nk)}-qator bilan bir xil`; natija.push(qator); return; }
      if (tk) fayldaTel.set(tk, n1);
      fayldaNom.set(nk, n1);

      // Nom bo'yicha moslash faqat qatorda telefon bo'lmasa yoki tizimdagi mijozda telefon bo'lmasa —
      // aks holda telefoni boshqa, nomi bir xil BOSHQA mijoz ustidan yozib yuborilardi
      const nomBor = nomIndeks.get(nk) || null;
      const bor = (tk && telIndeks.get(tk))
        || (nomBor && (!tk || (!tel9(nomBor.telefon) && !tel9(nomBor.telefon2))) ? nomBor : null)
        || null;
      if (bor) {
        qator.mavjudId = bor.id;
        if (!yangilash) { qator.holat = 'ozgarishsiz'; qator.sabab = 'Tizimda bor (yangilash o\'chirilgan)'; natija.push(qator); return; }
        const oz = [];
        const qoy = (k, yangi, eski) => { if (yangi !== null && yangi !== undefined && yangi !== '' && String(yangi) !== String(eski ?? '')) oz.push({ maydon: k, eski: eski ?? null, yangi }); };
        if (norm(m.nomi) !== norm(bor.nomi) && tk) qoy('nomi', m.nomi, bor.nomi);
        for (const k of MATN_MAYDONLAR) if (m[k]) qoy(k, m[k], bor[k]);
        for (const k of SON_MAYDONLAR) if (m[k] !== null && m[k] !== undefined) { if (Math.abs(n(m[k]) - n(bor[k])) > 1e-6) oz.push({ maydon: k, eski: bor[k], yangi: m[k] }); }
        if (hududId !== null && String(hududId) !== String(bor.territoriya_id ?? '')) oz.push({ maydon: 'territoriya_id', eski: bor.territoriya_id, yangi: hududId });
        if (toifaId !== null && String(toifaId) !== String(bor.kategoriya_id ?? '')) oz.push({ maydon: 'kategoriya_id', eski: bor.kategoriya_id, yangi: toifaId });
        if (agent.id !== null && String(agent.id) !== String(bor.agent_id ?? '')) oz.push({ maydon: 'agent_id', eski: bor.agent_id, yangi: agent.id });
        if (xarita.holat !== null && xarita.holat !== undefined && m.faol !== !!bor.faol) oz.push({ maydon: 'faol', eski: !!bor.faol, yangi: m.faol });
        if (m.balans !== null && Math.abs(m.balans - n(bor.balans)) > 0.5) qator.ogoh.push(`balans yangilanmaydi (tizimda ${Math.round(n(bor.balans)).toLocaleString('ru-RU')}, faylda ${Math.round(m.balans).toLocaleString('ru-RU')})`);
        qator.ozgarishlar = oz;
        qator.holat = oz.length ? 'yangilanadi' : 'ozgarishsiz';
        qator.sabab = oz.length ? `${oz.length} ta maydon o'zgaradi` : 'Tizimdagisi bilan bir xil';
      } else {
        qator.yozuv = {
          nomi: m.nomi, telefon: m.telefon || null, telefon2: m.telefon2 || null,
          manzil: m.manzil || null, mo_ljal: m.mo_ljal || null,
          territoriya_id: hududId, kategoriya_id: toifaId, agent_id: agent.id,
          sinf: m.sinf, narx_turi: m.narx_turi || 'chakana',
          balans: m.balans !== null ? +m.balans.toFixed(2) : 0,
          boshlangich_balans: m.balans !== null ? +m.balans.toFixed(2) : 0,
          boshlangich_sana: m.balans !== null && Math.abs(m.balans) > 0.5 ? bugun.toISOString().slice(0, 10) : null,
          boshlangich_izoh: m.balans !== null && Math.abs(m.balans) > 0.5 ? 'Eski tizimdan import' : null,
          kredit_limit: m.kredit_limit !== null ? m.kredit_limit : 0,
          tolov_muddati_kun: m.tolov_muddati_kun || 30,
          inn: m.inn || null, hisob_raqam: m.hisob_raqam || null, bank: m.bank || null, mfo: m.mfo || null,
          yuridik_nomi: m.yuridik_nomi || null,
          tashrif_kunlari: m.tashrif_kunlari, lat: m.lat, lng: m.lng,
          izoh: izohTuz(m, sanaMatni), faol: m.faol,
        };
        if (m.balans !== null && m.balans < -0.5) { xulosa.qarzdorlar++; xulosa.qarzJami += -m.balans; }
      }
      natija.push(qator);
    });
    for (const q of natija) { xulosa[q.holat]++; if (q.ogoh.length) xulosa.ogohlantirish++; }
    xulosa.qarzJami = +xulosa.qarzJami.toFixed(2);

    const javob = {
      rejim, xulosa,
      yangiHududlar: [...yangiHududlar.values()].map(h => h.nomi),
      yangiToifalar: [...yangiToifalar.values()].map(t => t.nomi),
      yangiAgentlar: [...yangiAgentlar.values()].map(a => a.fullname),
      qatorlar: natija.map(({ yozuv, ...q }) => q),
    };
    if (!saqla) return res.send(javob);

    /* ── Saqlash: bitta tranzaksiya ── */
    await sequelize.transaction(async (t) => {
      const hId = new Map(), tId = new Map(), aId = new Map();
      for (const [k, h] of yangiHududlar) { const r = await TerritoriyaModel.create({ nomi: h.nomi }, { transaction: t }); hId.set('yangi:' + k, r.id); }
      for (const [k, x] of yangiToifalar)  { const r = await MijozKategoriyaModel.create({ nomi: x.nomi }, { transaction: t }); tId.set('yangi:' + k, r.id); }
      for (const [k, a] of yangiAgentlar)  { const r = await AgentModel.create({ fullname: a.fullname, faol: true, plan_summa: 0 }, { transaction: t }); aId.set('yangi:' + k, r.id); }
      const haqiqiy = (v, map) => (typeof v === 'string' && v.startsWith('yangi:')) ? map.get(v) : v;
      for (const q of natija) {
        if (q.holat === 'yangi') {
          const y = { ...q.yozuv, territoriya_id: haqiqiy(q.yozuv.territoriya_id, hId), kategoriya_id: haqiqiy(q.yozuv.kategoriya_id, tId), agent_id: haqiqiy(q.yozuv.agent_id, aId) };
          const r = await MijozModel.create(y, { transaction: t });
          q.id = r.id;
        } else if (q.holat === 'yangilanadi') {
          const u = {};
          for (const o of q.ozgarishlar) {
            u[o.maydon] = o.maydon === 'territoriya_id' ? haqiqiy(o.yangi, hId) : o.maydon === 'kategoriya_id' ? haqiqiy(o.yangi, tId) : o.maydon === 'agent_id' ? haqiqiy(o.yangi, aId) : o.yangi;
          }
          await MijozModel.update(u, { where: { id: q.mavjudId }, transaction: t });
          q.id = q.mavjudId;
        }
      }
    });
    console.log(`[IMPORT] mijozlar: ${xulosa.yangi} yangi, ${xulosa.yangilanadi} yangilandi, ${xulosa.xato} xato — ${req.currentUser?.username || req.currentUser?.name || 'user'}`);
    javob.saqlandi = true;
    javob.qatorlar = natija.map(({ yozuv, ...q }) => q);
    res.send(javob);
  };

  /* GET /mijozlar/import/shablon — bo'sh Excel namuna (bizning sarlavhalar + 2 ta misol) */
  shablon = async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Mijozlar');
    const ust = [
      ['Mijoz nomi', 28], ['Telefon', 16], ["Qo'shimcha telefon", 16], ["Mas'ul shaxs", 22], ['Hudud (tuman)', 20], ['Toifa', 16],
      ['Holati', 10], ['Mijoz turi', 12], ['Manzil', 34], ["Mo'ljal", 20], ['Yuridik nomi', 22], ['STIR', 12], ['Bank', 18], ['Hisob raqami', 22], ['MFO', 8],
      ['Narx turi', 10], ['Kredit limiti', 14], ["To'lov muddati (kun)", 12], ['Tashrif kunlari', 16], ['Sinf', 6], ['Kenglik (lat)', 12], ['Uzunlik (lng)', 12],
      ['Balans', 14], ['Izoh', 30],
    ];
    ws.columns = ust.map(([header, width]) => ({ header, width }));
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
    ws.addRow(["Anvar do'koni", '+998901234567', '', 'Johongir Saydullayev', 'Dangara tumani', '', 'Faol', 'Jismoniy', "Farg'ona sh., 41-uy", 'Maktab oldi', '', '', '', '', '', 'chakana', 5000000, 30, 'Du, Ch, Ju', 'B', 40.3842, 71.7843, -1250000, 'Balans manfiy = mijoz qarzi']);
    ws.addRow(['Baraka baza MChJ', '+998912345678', '+998712345678', 'Johongir Saydullayev', "Qo'qon shahar", '', 'Faol', 'Yuridik', "Qo'qon sh., Turkiston ko'chasi 5", '', 'BARAKA BAZA MChJ', '305123456', 'Kapitalbank', '20208000123456789001', '01088', 'optom', 20000000, 14, 'Se, Pa', 'A', '', '', 0, '']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="mijozlar-shablon.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  };
}

module.exports = new MijozImportController();
