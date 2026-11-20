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
/* Ilova bergan takrorlanmas kalit (UUID va shu kabi) — faqat xavfsiz belgilar.
   Berilmasa — null (takror tekshiruvi yo'q). Berilgan, lekin formati buzuq bo'lsa — 400:
   avval jim null qaytarilardi va oflayn navbat takrori ikki marta yozilib ketardi. */
function mobilKalit(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(s)) {
    const HttpException = require('../../utils/HttpException.utils');
    throw new HttpException(400, "mobilId noto'g'ri (8–64 ta harf, raqam yoki _ . : - belgisi)");
  }
  return s;
}

/* Pul summasi: chekli son, 0 dan kichik emas va aqlli yuqori chegaradan oshmaydi.
   parseFloat("Infinity") / "1e400" kabi qiymatlar bazaga yetib bormasin.
   Bo'sh qiymat — `bosh` (standart null). Noto'g'ri bo'lsa 400. */
const MAX_SUMMA = 1e12;
function summaOl(v, { bosh = null, xabar = "Summa noto'g'ri" } = {}) {
  if (v === undefined || v === null || v === '') return bosh;
  const x = typeof v === 'number' ? v : Number(String(v).trim().replace(/\s+/g, '').replace(',', '.'));
  if (!Number.isFinite(x) || x < 0 || x > MAX_SUMMA) {
    const HttpException = require('../../utils/HttpException.utils');
    throw new HttpException(400, xabar);
  }
  return x;
}

/* Koordinata juftligi to'g'rimi: chekli son, |lat| ≤ 90, |lng| ≤ 180, (0,0) emas.
   To'g'ri bo'lsa { lat, lng }, aks holda null (chaqiruvchi koordinatani e'tiborsiz qoldiradi —
   eski APK ba'zan bo'sh/0 yuboradi, shuning uchun rad etilmaydi). */
function koordinataJuft(lat, lng) {
  if (lat === undefined || lat === null || lat === '' || lng === undefined || lng === null || lng === '') return null;
  const a = Number(lat), o = Number(lng);
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90 || Math.abs(o) > 180) return null;
  if (a === 0 && o === 0) return null;
  return { lat: a, lng: o };
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

/* Joriy foydalanuvchining "dostavchi" sifatidagi ID'si: haqiqiy dostavchik bo'lsa
   o'z ID'si, dual_role agent bo'lsa unga bog'langan dostavchi qatori, aks holda null. */
function dostavchiIdOl(req) {
  if (req.currentRole === 'dostavchi') return req.currentAgent ? Number(req.currentAgent.id) : null;
  if (req.currentRole === 'agent' && req.currentAgent && req.currentAgent.linked_dostavchi_id) {
    return Number(req.currentAgent.linked_dostavchi_id);
  }
  return null;
}

/* Unique kalit (mobil_id) bo'yicha parallel takror yozuv xatosi */
const takrorXato = (e) => !!e && (e.name === 'SequelizeUniqueConstraintError' || (e.parent && e.parent.code === 'ER_DUP_ENTRY'));

/* MIJOZGA RUXSAT — mobil xodim faqat o'zi ishlaydigan mijozni ko'radi/o'zgartiradi:
     agent      — mijoz.agent_id = agent (getKlient ro'yxati bilan bir xil qoida), marshrut rejasidagi
                  mijoz yoki shu agent yozgan buyurtmasi bor mijoz (mijoz boshqa agentga o'tkazilgan
                  bo'lsa ham o'z cheklari tarixini ko'ra oladi); dual_role agent —
                  qo'shimcha ravishda bog'langan dostavchiga tayinlangan buyurtma mijozi;
     dostavchik — o'ziga tayinlangan (dostavchi_id) buyurtmasi bor mijoz. */
async function mijozRuxsat(req, mijoz) {
  if (!mijoz || !req.currentAgent) return false;
  const { ArizaModel } = require('../../models/ariza.model');
  const yoki = [];
  if (req.currentRole === 'agent') {
    if (mijoz.agent_id != null && Number(mijoz.agent_id) === Number(req.currentAgent.id)) return true;
    // 2026-11-21: agent faqat o'ziga biriktirilgan mijozlarni ko'radi (avvalgi "avtolavka agentiga
    // hamma mijoz" istisnosi olib tashlandi). Kuzatuvda req.currentAgent — kuzatilayotgan agent.
    // Marshrut rejasida shu agentga tayinlangan mijoz
    const { MarshrutRejaModel } = require('../../models/marshrut.model');
    if (await MarshrutRejaModel.findOne({ where: { agent_id: req.currentAgent.id, mijoz_id: mijoz.id }, attributes: ['id'] })) return true;
    yoki.push({ agent_id: req.currentAgent.id });
  }
  const dId = dostavchiIdOl(req);
  if (dId) yoki.push({ dostavchi_id: dId });
  if (!yoki.length) return false;
  const { Op } = require('sequelize');
  const bor = await ArizaModel.findOne({ where: { mijoz_id: mijoz.id, [Op.or]: yoki }, attributes: ['id'] });
  return !!bor;
}

module.exports = {
  ok, raw, fail, requireRole, WEEK_KEYS, PAGE_SIZE, PRICE_TYPES, VALYUTALAR, mobilVaqt, mobilKalit, SABABLAR, sababNomi,
  dostavchiIdOl, takrorXato, mijozRuxsat, summaOl, MAX_SUMMA, koordinataJuft,
};
