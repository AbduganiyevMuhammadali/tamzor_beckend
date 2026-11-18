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
 */
const { NarxRuyxatModel, NarxRuyxatQatorModel } = require('../models/narxRuyxat.model');
const { MijozModel, MijozKategoriyaModel } = require('../models/mijoz.model');
const { narxMap } = require('./avtolavka.utils');

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
async function narxXaritasi({ mijozId = null, tovarIds }) {
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
    narxlar,
  };
}

module.exports = { standartRuyxat, mijozRuyxati, narxXaritasi };
