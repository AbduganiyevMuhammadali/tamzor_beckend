// Mobil controller bo'limlari uchun umumiy yordamchilar

// APK javob konverti: { error, message, error_code, data }
// error HECH QACHON null bo'lmasin — aks holda ilova javobni rad etadi.
const ok = (res, data, message = '') =>
  res.send({ error: false, message, error_code: 200, data });

// Konvertsiz javob (faqat url1c kabi bootstrap endpointlar uchun)
const raw = (res, data) => res.send(data);

// Xatolik konverti (error_code: 405 = token yaroqsiz → ilova logout qiladi)
const fail = (res, message = '', error_code = 400, data = null) =>
  res.send({ error: true, message, error_code, data });

// Faqat berilgan rol (agent/dostavchi) so'rov yuborganda davom etadi.
// Boshqa rol chaqirsa, konvert ichida error:true bilan aniq javob qaytaradi —
// noto'g'ri odamning ID'si bilan boshqa jadvalga yozib/o'qib yuborish o'rniga.
const requireRole = (req, res, role) => {
  if (req.currentRole !== role) {
    fail(res, `Bu amal faqat ${role === 'agent' ? 'agent' : 'dostavchik'} uchun`, 403);
    return false;
  }
  return true;
};

// Hafta kuni raqamini (1=Du ... 7=Ya) agent/mijoz formatidagi qisqartmaga moslash
const WEEK_KEYS = { 1: 'Du', 2: 'Se', 3: 'Ch', 4: 'Pa', 5: 'Ju', 6: 'Sh', 7: 'Ya' };

const PAGE_SIZE = 50;

// Narx turlari — yagona manba. getPriceType ham, mahsulot narx bloklari ham
// shu ro'yxatdan foydalanadi, shunda priceTypeId DOIM mos keladi.
// priceTypeId int (APK select int kutadi).
const PRICE_TYPES = [
  { priceTypeId: 1, priceType: 'Optom' },
  { priceTypeId: 2, priceType: 'Roznichniy' },
];

// Valyutalar — yagona manba (kirillcha)
const VALYUTALAR = [{ valyuta: 'Сум' }, { valyuta: 'Доллар' }];

/* Oflayn qilingan amalning haqiqiy vaqti (ilova yuboradi). Kelajakdagi yoki 7 kundan
   eski vaqt qabul qilinmaydi — telefon soati noto'g'ri bo'lsa server vaqti olinadi. */
function mobilVaqt(v) {
  if (!v) return new Date();
  const d = new Date(v);
  const t = d.getTime(), now = Date.now();
  if (isNaN(t) || t > now + 5 * 60 * 1000 || t < now - 7 * 24 * 3600 * 1000) return new Date();
  return d;
}
/* Ilova bergan takrorlanmas kalit (UUID va shu kabi) — faqat xavfsiz belgilar */
function mobilKalit(v) {
  const s = String(v || '').trim();
  return /^[A-Za-z0-9_.:-]{8,64}$/.test(s) ? s : null;
}

/* Sotmaslik va tashrif sabablari — getReason, clientNotSell va hisobotlar bitta ro'yxatdan foydalanadi */
// Rad etish sabablari. '1' — neytral (do'kon yopiq: mijoz rad etmagan, reytingga ta'sir qilmaydi —
// utils/reyting.utils.js NEYTRAL_SABAB). Id'lar o'zgarmaydi: sotmaslik tarixida saqlanadi.
const SABABLAR = [
  { id: '6', name: 'Hozir kerak emas, keyinroq', tip: 'Причина' },
  { id: '2', name: "Hozir pulim yo'q",           tip: 'Причина' },
  { id: '3', name: 'Tovar kerak emas',           tip: 'Причина' },
  { id: '7', name: 'Narx qimmat',                tip: 'Причина' },
  { id: '8', name: 'Boshqa firmadan oladi',      tip: 'Причина' },
  { id: '1', name: "Do'kon yopiq",               tip: 'Причина', neytral: true },
  { id: '4', name: "Do'konga kirdim",   tip: 'Визить' },
  { id: '5', name: "Do'kondan chiqdim", tip: 'Визить' },
];
const sababNomi = (id) => (SABABLAR.find(s => s.id === String(id)) || {}).name || null;

module.exports = { ok, raw, fail, requireRole, WEEK_KEYS, PAGE_SIZE, PRICE_TYPES, VALYUTALAR, mobilVaqt, mobilKalit, SABABLAR, sababNomi };
