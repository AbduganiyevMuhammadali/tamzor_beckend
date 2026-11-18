const { ok, PRICE_TYPES, VALYUTALAR } = require('./shared');
const { joriyKurs } = require('../../utils/kurs.utils');

/* ── Ma'lumotnomalar: kurs, valyuta, narx/to'lov turlari ──────────────────── */
class MobilePricingController {
  // 3.1 getKurs → { kurs } — web bilan bir xil global "sozlama" jadvalidan
  getKurs = async (req, res, next) => {
    ok(res, { kurs: await joriyKurs() });
  };

  // 3.2 getValyuta → [{ valyuta }]  (kirillcha — umumiy manba)
  getValyuta = async (req, res, next) => {
    ok(res, VALYUTALAR);
  };

  // 3.3 getPriceType → IdNameModel [{ id, name, count, tip }]
  getPriceType = async (req, res, next) => {
    ok(res, PRICE_TYPES.map(pt => ({
      id: String(pt.priceTypeId),
      name: pt.priceType,
      count: 0,
      tip: '',
    })));
  };

  // 3.4 getPaymentType → [{ paymentTypeId, paymentTypeName, valyuta }]
  getPaymentType = async (req, res, next) => {
    ok(res, [
      { paymentTypeId: '1', paymentTypeName: 'Naqd', valyuta: 'Сум' },
      { paymentTypeId: '2', paymentTypeName: 'Plastik', valyuta: 'Сум' },
    ]);
  };
}

module.exports = new MobilePricingController();
