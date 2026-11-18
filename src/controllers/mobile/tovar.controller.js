const { Op, fn, col } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const TovarModel = require('../../models/tovar.model');
const HttpException = require('../../utils/HttpException.utils');
const { ok, PAGE_SIZE, PRICE_TYPES } = require('./shared');
const { agentOmbori } = require('../../utils/ombor.utils');
const { mavjudQoldiq } = require('../../utils/zaxira.utils');

// Avtolavka agenti faqat mashinasidagi tovarni sotadi — qoldiq uning omboridan
const agentOmborNomi = (req) =>
  (req.currentRole === 'agent' && req.currentAgent?.avtolavka) ? agentOmbori(req.currentAgent.fullname) : null;

// Berilgan tovar id'lari uchun ombor qoldig'i + optom/chakana narx.
// Web savdo bilan bir xil manba: tovar_register (kirim−chiqim qoldiq,
// eng so'nggi optom_narx/chakana_narx > 0).
// ombor berilsa qoldiq faqat shu ombordan (avtolavka), narxlar umumiy.
async function qoldiqMapFor(ids, ombor = null) {
  const map = {};
  if (!ids.length) return map;
  // Qoldiq = donada yig'indisi (kirim musbat, chiqim manfiy yozilgan)
  const [rows] = await sequelize.query(`
    SELECT tovar_id,
      COALESCE(SUM(CASE WHEN ${ombor ? 'ombor = ?' : '1=1'} THEN donada ELSE 0 END), 0) AS qoldiq,
      (SELECT r2.optom_narx FROM tovar_register r2
         WHERE r2.tovar_id = tr.tovar_id AND r2.optom_narx > 0
         ORDER BY r2.sana DESC, r2.id DESC LIMIT 1) AS optomNarx,
      (SELECT r3.chakana_narx FROM tovar_register r3
         WHERE r3.tovar_id = tr.tovar_id AND r3.chakana_narx > 0
         ORDER BY r3.sana DESC, r3.id DESC LIMIT 1) AS chakanaNarx
    FROM tovar_register tr
    WHERE tovar_id IN (${ids.map(() => '?').join(',')})
    GROUP BY tovar_id
  `, { replacements: ombor ? [ombor, ...ids] : ids });
  rows.forEach(r => {
    const chakanaNarx = parseFloat(r.chakanaNarx) || 0;
    map[r.tovar_id] = {
      qoldiq: parseFloat(r.qoldiq) || 0,
      // "narx" — moslik uchun (chakana narx standart sifatida)
      narx: chakanaNarx,
      optomNarx: parseFloat(r.optomNarx) || 0,
      chakanaNarx,
    };
  });
  return map;
}

// Joriy dollar kursi (pricing.controller bilan bir xil manba)
function getKurs() {
  return parseFloat(process.env.MOBILE_KURS) || 12650.0;
}

// Tovarni hujjat 5.1 (ProductModel) formatiga aylantirish — narx kalitlari KIRILLCHA.
// PRICE_TYPES tartibi: 1=Optom, 2=Roznichniy (chakana) — har biriga o'z narxi beriladi.
function shapeProduct(t, q, kurs = getKurs()) {
  const o = q || { qoldiq: 0, narx: 0, optomNarx: 0, chakanaNarx: 0 };
  const narxFor = (priceType) => (priceType === 'Optom' ? o.optomNarx : o.chakanaNarx) || o.narx || 0;

  const sumBloklar = PRICE_TYPES.map(pt => {
    const narx = narxFor(pt.priceType);
    return {
      priceType: pt.priceType, priceTypeId: String(pt.priceTypeId),
      minNarx: narx, maxNarx: narx, narx, currencyTovar: 'Сум',
    };
  });
  const dollarBloklar = PRICE_TYPES.map(pt => {
    const narx = narxFor(pt.priceType);
    const narxUsd = kurs > 0 ? Math.round((narx / kurs) * 100) / 100 : 0;
    return {
      priceType: pt.priceType, priceTypeId: String(pt.priceTypeId),
      minNarx: narxUsd, maxNarx: narxUsd, narx: narxUsd, currencyTovar: 'Доллар',
    };
  });

  return {
    tovar: t.nomi,
    tovarId: String(t.id),
    image: '',
    countType: t.olchov_birligi || 'kg',
    sht: parseFloat(t.blokdagi_soni) || 1,
    qoldiq: o.qoldiq,
    tovarCode: parseFloat(t.shtrix_kod) || t.id,
    'Сум': sumBloklar,
    'Доллар': dollarBloklar,
    cartCount: 0.0,
    cartPackCount: 0.0,
    link: '',
    info: t.tavsif || '',
    brutto: parseFloat(t.ogirlik) || 0,
    netto: parseFloat(t.ogirlik) || 0,
    categoryId: String(t.turkum || ''),
    categoryName: t.turkum || '',
  };
}

/* Oddiy agent zakazi: qoldiq = skladdagi MAVJUD miqdor (jismoniy − boshqa ochiq
   buyurtmalarga band), faqat bor tovar ko'rsatiladi (utils/zaxira.utils.js).
   Qaytarish (vozvrat) ro'yxatlariga tegilmaydi. */
const zakazMi = (req) => !agentOmborNomi(req);

async function fetchProducts({ categoryId, searchKey, page = 0, all = false, ombor = null, zakaz = false }) {
  const where = { faol: true, turi: 'tovar' };   // xom ashyo sotilmaydi
  if (categoryId) where.turkum = categoryId;
  if (searchKey) {
    where[Op.or] = [
      { nomi: { [Op.like]: `%${searchKey}%` } },
      { shtrix_kod: { [Op.like]: `%${searchKey}%` } },
    ];
  }
  const tovarlar = await TovarModel.findAll({ where, order: [['nomi', 'ASC']] });
  const map = await qoldiqMapFor(tovarlar.map(t => t.id), ombor);
  if (zakaz) {
    const mavjud = await mavjudQoldiq({ tovarIds: tovarlar.map(t => t.id) });
    Object.keys(map).forEach(id => { map[id].qoldiq = mavjud.get(Number(id))?.mavjud || 0; });
  }
  const kurs = getKurs();
  // FAQAT narxi bor (sotiladigan) mahsulotlar — narxsizni APK "belgilanmagan" deydi.
  // Avtolavkada esa faqat mashinada bor tovar.
  let data = tovarlar
    .map(t => shapeProduct(t, map[t.id], kurs))
    .filter(p => p['Сум'] && p['Сум'][0].narx > 0)
    .filter(p => !(ombor || zakaz) || p.qoldiq > 0);
  if (!all) data = data.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  return data;
}

/* ── Tovarlar (hujjat 5.x) ────────────────────────────────────────────────── */
class MobileTovarController {
  // 5.1 getProductSell/
  getProductSell = async (req, res, next) => {
    ok(res, await fetchProducts({
      categoryId: (req.query.categoryId || '').trim(),
      searchKey: (req.query.searchKey || '').trim(),
      page: parseInt(req.query.code, 10) || 0,
      ombor: agentOmborNomi(req),
      zakaz: zakazMi(req),
    }));
  };

  // 5.3 getProductsVozvrat/ (sotuv bilan bir xil manba)
  getProductsVozvrat = async (req, res, next) => {
    ok(res, await fetchProducts({
      categoryId: (req.query.categoryId || '').trim(),
      searchKey: (req.query.searchKey || '').trim(),
      page: parseInt(req.query.code, 10) || 0,
      ombor: agentOmborNomi(req),
    }));
  };

  // 5.2 getProductSellOffline
  getProductSellOffline = async (req, res, next) => {
    ok(res, await fetchProducts({ all: true, ombor: agentOmborNomi(req), zakaz: zakazMi(req) }));
  };

  // 5.4 getProductsVozvratOffline/
  getProductsVozvratOffline = async (req, res, next) => {
    ok(res, await fetchProducts({ all: true, ombor: agentOmborNomi(req) }));
  };

  // 5.5 checkProduct/ → { qoldiq }
  checkProduct = async (req, res, next) => {
    const tovarId = req.query.tovarId;
    const tovar = await TovarModel.findByPk(tovarId);
    if (!tovar) throw new HttpException(404, req.mf('Not found'));
    if (zakazMi(req)) {
      const m = await mavjudQoldiq({ tovarIds: [tovar.id] });
      return ok(res, { qoldiq: m.get(tovar.id)?.mavjud || 0 });
    }
    const map = await qoldiqMapFor([tovar.id], agentOmborNomi(req));
    ok(res, { qoldiq: map[tovar.id] ? map[tovar.id].qoldiq : 0 });
  };

  // 3.5 getCategories → [{ categoryId, categoryName, supCategoryId, supCategoryName, image }]
  getCategories = async (req, res, next) => {
    const rows = await TovarModel.findAll({
      attributes: [[fn('DISTINCT', col('turkum')), 'turkum']],
      where: { faol: true, turi: 'tovar', turkum: { [Op.ne]: null } },
      order: [['turkum', 'ASC']],
      raw: true,
    });
    const data = rows
      .map(r => r.turkum)
      .filter(Boolean)
      .map((nomi) => ({
        categoryId: String(nomi),
        categoryName: nomi,
        supCategoryId: '',
        supCategoryName: '',
        image: '',
      }));
    ok(res, data);
  };
}

module.exports = new MobileTovarController();
