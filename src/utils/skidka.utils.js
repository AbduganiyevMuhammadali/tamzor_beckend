'use strict';
/* MIJOZGA TOVAR BO'YICHA SKIDKA (2026-11-27)
   Bitta mijoz + tovar uchun bitta qoida: 'foiz' — narxdan foiz, 'summa' — har dona narxidan so'm.
   Muddat (dan/gacha, mahalliy kun) ixtiyoriy — berilmasa cheksiz. Amaldagi qoida narx xaritasiga
   (narx.utils: narxXaritasi, agentNarxXaritasi) avtomatik qo'llanadi va mobil sinxronga beriladi
   (ilova oflayn ham shu narxda sotadi). Diller sotuvida qo'llanmaydi (narx erkin).
   Narx manfiy bo'lmaydi; yaxlitlash — butun so'mga. */
const { Op } = require('sequelize');
const MijozSkidkaModel = require('../models/mijozSkidka.model');
const HttpException = require('./HttpException.utils');

const kunKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Skidkadan keyingi narx (butun so'm, 0 dan kam emas) */
function skidkaQoll(narx, s) {
  const x = Number(narx) || 0;
  if (!s || x <= 0) return x;
  const q = Number(s.qiymat) || 0;
  const y = s.tur === 'foiz' ? x * (1 - q / 100) : x - q;
  return Math.max(0, Math.round(y));
}

/** Amaldagi skidkalar: Map<mijozId, Map<tovarId, {tur, qiymat, dan, gacha}>>. sana — mahalliy kun (standart bugun). */
async function amaldagiSkidkalar(mijozIds, tovarIds = null, sana = kunKey(new Date())) {
  const mIds = [...new Set((mijozIds || []).map(Number))].filter(Boolean);
  const out = new Map();
  if (!mIds.length) return out;
  const where = {
    mijoz_id: mIds,
    [Op.and]: [
      { [Op.or]: [{ dan: null }, { dan: { [Op.lte]: sana } }] },
      { [Op.or]: [{ gacha: null }, { gacha: { [Op.gte]: sana } }] },
    ],
  };
  if (tovarIds) {
    const t = [...new Set(tovarIds.map(Number))].filter(Boolean);
    if (!t.length) return out;
    where.tovar_id = t;
  }
  const rows = await MijozSkidkaModel.findAll({ where, attributes: ['mijoz_id', 'tovar_id', 'tur', 'qiymat', 'dan', 'gacha'], raw: true });
  for (const r of rows) {
    if (!out.has(r.mijoz_id)) out.set(r.mijoz_id, new Map());
    out.get(r.mijoz_id).set(r.tovar_id, { tur: r.tur, qiymat: parseFloat(r.qiymat) || 0, dan: r.dan || null, gacha: r.gacha || null });
  }
  return out;
}

/** Narx xaritasi qatorlariga skidka: narx → skidkali, asl_narx va skidka qo'shiladi */
async function xaritagaQoll(mijozId, narxlar) {
  if (!mijozId || !narxlar.length) return narxlar;
  const sk = (await amaldagiSkidkalar([mijozId], narxlar.map(x => x.tovar_id))).get(Number(mijozId));
  if (!sk) return narxlar;
  return narxlar.map(x => {
    const s = sk.get(Number(x.tovar_id));
    if (!s || !(x.narx > 0)) return x;
    return { ...x, asl_narx: x.narx, narx: skidkaQoll(x.narx, s), skidka: s };
  });
}

/** Mobil sinxron uchun: { klientId: { tovarId: {tur, qiymat, dan, gacha} } } — bugun va keyin amal qiladiganlar
    (ilova oflayn kunlarda sanani o'zi tekshiradi). */
async function sinxronSkidkalar(mijozIds) {
  const mIds = [...new Set((mijozIds || []).map(Number))].filter(Boolean);
  if (!mIds.length) return {};
  const bugun = kunKey(new Date());
  const rows = await MijozSkidkaModel.findAll({
    where: { mijoz_id: mIds, [Op.or]: [{ gacha: null }, { gacha: { [Op.gte]: bugun } }] },
    attributes: ['mijoz_id', 'tovar_id', 'tur', 'qiymat', 'dan', 'gacha'], raw: true,
  });
  const out = {};
  for (const r of rows) {
    (out[r.mijoz_id] ||= {})[r.tovar_id] = { tur: r.tur, qiymat: parseFloat(r.qiymat) || 0, dan: r.dan || null, gacha: r.gacha || null };
  }
  return out;
}

/** Web kiritish tekshiruvi → { tovar_id, tur, qiymat, dan, gacha, izoh } */
function qoidaOl(q) {
  if (!q || typeof q !== 'object') throw new HttpException(400, "Skidka qatori noto'g'ri");
  const tovarId = Number(q.tovar_id);
  if (!Number.isInteger(tovarId) || tovarId <= 0) throw new HttpException(400, "tovar_id noto'g'ri");
  if (!['foiz', 'summa'].includes(q.tur)) throw new HttpException(400, "tur faqat 'foiz' yoki 'summa'");
  const qiymat = Number(q.qiymat);
  if (!Number.isFinite(qiymat) || qiymat <= 0) throw new HttpException(400, "Skidka qiymati 0 dan katta bo'lsin");
  if (q.tur === 'foiz' && qiymat >= 100) throw new HttpException(400, "Foiz 100 dan kichik bo'lsin");
  const sana = (v, nom) => {
    if (v === undefined || v === null || v === '') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(new Date(`${v}T00:00:00`).getTime())) throw new HttpException(400, `${nom} YYYY-MM-DD bo'lsin`);
    return String(v);
  };
  const dan = sana(q.dan, 'dan'), gacha = sana(q.gacha, 'gacha');
  if (dan && gacha && dan > gacha) throw new HttpException(400, "Muddat noto'g'ri: dan > gacha");
  const izoh = q.izoh === undefined || q.izoh === null ? null : String(q.izoh).trim().slice(0, 255) || null;
  return { tovar_id: tovarId, tur: q.tur, qiymat: Math.round(qiymat * 100) / 100, dan, gacha, izoh };
}

module.exports = { skidkaQoll, amaldagiSkidkalar, xaritagaQoll, qoidaOl, kunKey, sinxronSkidkalar };
