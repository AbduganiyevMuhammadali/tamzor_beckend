/**
 * Narx ro'yxatlari — mijoz uchun tovar narxini aniqlash.
 *
 * Har tovar uchun ustunlik (birinchi topilgani olinadi):
 *   1. mijozning toifasiga biriktirilgan narx ro'yxati (mijoz_kategoriya.narx_ruyxat_id)
 *   2. mijozning narx turiga mos standart ro'yxat (narx_ruyxat.tur = mijoz.narx_turi, standart = 1)
 *   3. eski narx: tovar_register dagi oxirgi optom/chakana narx
 *
 * Toifa ro'yxatida tovar yo'q bo'lsa 2-band ishlaydi. Ro'yxat umuman bo'lmasa ham 3-band
 * ishlaydi, shuning uchun mavjud sotuvlar o'zgarmaydi.
 *
 * VILOYAT NARXI (2026-11-25, agentNarxXaritasi): AGENT sotuvida agentning viloyati
 * (agent.territoriya_id) bo'lsa ustunlik boshqacha:
 *   1. mijoz toifasining narx ro'yxati (narxi > 0 bo'lsa)
 *   2. tovar_viloyat_narx: agent viloyatidagi narx, mijoz narx_turi bo'yicha (chakana | optom)
 *   3. aks holda tovar shu agent tomonidan SOTILMAYDI (standart ro'yxat / eski narxga tushmaydi)
 * Viloyati yo'q agent va sklad (agentsiz) sotuvi — yuqoridagi eski qoida (narxXaritasi).
 *
 * SKIDKA (2026-11-27): topilgan narxga mijozning shu tovar skidkasi qo'llanadi (skidka.utils).
 */
const { NarxRuyxatModel, NarxRuyxatQatorModel } = require('../models/narxRuyxat.model');
const { MijozModel, MijozKategoriyaModel } = require('../models/mijoz.model');
const { narxMap } = require('./avtolavka.utils');
const TovarViloyatNarxModel = require('../models/tovarViloyatNarx.model');
const TerritoriyaModel = require('../models/territoriya.model');
const { xaritagaQoll } = require('./skidka.utils');

async function standartRuyxat(tur) {
  return NarxRuyxatModel.findOne({ where: { tur, standart: true, faol: true } });
}

/** Mijoz uchun amaldagi narx ro'yxati (toifa → standart). */
async function mijozRuyxati(mijoz) {
  if (mijoz.kategoriya_id) {
    const kat = await MijozKategoriyaModel.findByPk(mijoz.kategoriya_id, { attributes: ['id', 'narx_ruyxat_id'] });
    if (kat && kat.narx_ruyxat_id) {
      const r = await NarxRuyxatModel.findOne({ where: { id: kat.narx_ruyxat_id, faol: true } });
      if (r) return r;
    }
  }
  return standartRuyxat(mijoz.narx_turi || 'chakana');
}

/**
 * Tovarlar uchun narx xaritasi.
 * @returns {{ ruyxat: {id,nomi,tur}|null, narxlar: [{ tovar_id, narx, manba }] }}
 *   manba: 'ruyxat' (toifa/asosiy ro'yxat) | 'standart' (turdagi standart ro'yxat)
 *          | 'eski' (tovar_register) | 'yoq' (narx yo'q)
 */
async function narxXaritasi({ mijozId = null, tovarIds, skidkasiz = false }) {
  const ids = [...new Set((tovarIds || []).map(Number))].filter(Boolean);

  let mijoz = null, asosiy;
  if (mijozId) {
    mijoz = await MijozModel.findByPk(mijozId, { attributes: ['id', 'narx_turi', 'kategoriya_id'] });
    asosiy = mijoz ? await mijozRuyxati(mijoz) : null;
  } else {
    asosiy = await standartRuyxat('chakana');
  }
  const tur = mijoz ? (mijoz.narx_turi || 'chakana') : 'chakana';
  const standart = await standartRuyxat(tur);

  // Ketma-ket tekshiriladigan ro'yxatlar (takrorlanmasin)
  const royxatlar = [];
  for (const r of [asosiy, standart]) {
    if (r && !royxatlar.some(x => x.ruyxat.id === r.id)) royxatlar.push({ ruyxat: r, manba: r === asosiy ? 'ruyxat' : 'standart' });
  }

  const qatorMap = {};   // ruyxat_id → { tovar_id: narx }
  for (const { ruyxat } of royxatlar) {
    if (!ids.length) break;
    const qatorlar = await NarxRuyxatQatorModel.findAll({
      where: { narx_ruyxat_id: ruyxat.id, tovar_id: ids }, attributes: ['tovar_id', 'narx'], raw: true,
    });
    qatorMap[ruyxat.id] = {};
    qatorlar.forEach(q => { if (parseFloat(q.narx) > 0) qatorMap[ruyxat.id][q.tovar_id] = parseFloat(q.narx); });
  }

  const eski = await narxMap(ids);
  const narxlar = ids.map(id => {
    for (const { ruyxat, manba } of royxatlar) {
      const n = qatorMap[ruyxat.id]?.[id];
      if (n) return { tovar_id: id, narx: n, manba };
    }
    const e = eski[id] || {};
    const n = parseFloat(tur === 'optom' ? e.optom_narx : e.chakana_narx) || 0;
    return n ? { tovar_id: id, narx: n, manba: 'eski' } : { tovar_id: id, narx: 0, manba: 'yoq' };
  });

  return {
    ruyxat: asosiy ? { id: asosiy.id, nomi: asosiy.nomi, tur: asosiy.tur } : null,
    // 2026-11-27: mijozning tovar skidkasi (skidka.utils) — narx skidkali, asl_narx/skidka qo'shiladi
    narxlar: mijoz && !skidkasiz ? await xaritagaQoll(mijoz.id, narxlar) : narxlar,
  };
}

/** Viloyat narxlari: { tovar_id: { chakana: number|null, optom: number|null } } (0 → null). */
async function viloyatNarxlari(territoriyaId, tovarIds = null) {
  if (!territoriyaId) return {};
  const where = { territoriya_id: territoriyaId };
  if (tovarIds) {
    const ids = [...new Set(tovarIds.map(Number))].filter(Boolean);
    if (!ids.length) return {};
    where.tovar_id = ids;
  }
  const rows = await TovarViloyatNarxModel.findAll({ where, attributes: ['tovar_id', 'chakana_narx', 'optom_narx'], raw: true });
  const musbat = (v) => { const x = parseFloat(v); return x > 0 ? x : null; };
  const out = {};
  for (const r of rows) out[r.tovar_id] = { chakana: musbat(r.chakana_narx), optom: musbat(r.optom_narx) };
  return out;
}

/** Mijoz toifasiga biriktirilgan (faol) narx ro'yxati — standartga tushmaydi. */
async function toifaRuyxati(mijoz) {
  if (!mijoz || !mijoz.kategoriya_id) return null;
  const kat = await MijozKategoriyaModel.findByPk(mijoz.kategoriya_id, { attributes: ['id', 'narx_ruyxat_id'] });
  if (!kat || !kat.narx_ruyxat_id) return null;
  return NarxRuyxatModel.findOne({ where: { id: kat.narx_ruyxat_id, faol: true } });
}

/**
 * Agent sotuvi uchun narx xaritasi. Agentda viloyat yo'q bo'lsa — narxXaritasi (eski qoida).
 * @returns {{ ruyxat, narxlar: [{ tovar_id, narx, manba }], viloyat: {id,nomi}|null }}
 *   manba (viloyat rejimida): 'ruyxat' (toifa ro'yxati) | 'viloyat' | 'yoq' (sotilmaydi)
 */
async function agentNarxXaritasi({ agent, mijozId = null, tovarIds, skidkasiz = false }) {
  if (!agent || !agent.territoriya_id) {
    const r = await narxXaritasi({ mijozId, tovarIds, skidkasiz: skidkasiz || !!(agent && agent.diller) });
    return { ...r, viloyat: null };
  }
  const ids = [...new Set((tovarIds || []).map(Number))].filter(Boolean);
  const viloyat = await TerritoriyaModel.findByPk(agent.territoriya_id, { attributes: ['id', 'nomi'], raw: true });
  const mijoz = mijozId ? await MijozModel.findByPk(mijozId, { attributes: ['id', 'narx_turi', 'kategoriya_id'] }) : null;
  const tur = mijoz && mijoz.narx_turi === 'optom' ? 'optom' : 'chakana';
  const toifa = await toifaRuyxati(mijoz);
  const toifaNarx = {};
  if (toifa && ids.length) {
    const q = await NarxRuyxatQatorModel.findAll({ where: { narx_ruyxat_id: toifa.id, tovar_id: ids }, attributes: ['tovar_id', 'narx'], raw: true });
    q.forEach(x => { if (parseFloat(x.narx) > 0) toifaNarx[x.tovar_id] = parseFloat(x.narx); });
  }
  const vil = viloyat ? await viloyatNarxlari(viloyat.id, ids) : {};
  const narxlar = ids.map(id => {
    if (toifaNarx[id]) return { tovar_id: id, narx: toifaNarx[id], manba: 'ruyxat' };
    const v = vil[id] && vil[id][tur];
    return v ? { tovar_id: id, narx: v, manba: 'viloyat' } : { tovar_id: id, narx: 0, manba: 'yoq' };
  });
  return {
    ruyxat: toifa ? { id: toifa.id, nomi: toifa.nomi, tur: toifa.tur } : null,
    // 2026-11-27: mijoz skidkasi (dillerda — yo'q, narx erkin)
    narxlar: mijoz && !agent.diller && !skidkasiz ? await xaritagaQoll(mijoz.id, narxlar) : narxlar,
    viloyat: viloyat ? { id: viloyat.id, nomi: viloyat.nomi } : null,
  };
}

module.exports = { standartRuyxat, mijozRuyxati, narxXaritasi, viloyatNarxlari, agentNarxXaritasi };
