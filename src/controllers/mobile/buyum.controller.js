/**
 * BUYUMLAR — mobil (2026-11-28, FRONTEND-UCHUN §23). Mantiq: utils/buyum.utils.js
 *   POST buyumHarakat { mobilId, tur: 'mijozga'|'mijozdan', mijozId, qatorlar:[{buyumId, dona}], izoh?, rasm?, vaqt }
 *     → { harakatId, raqam, takror? }
 *   Agent do'konga buyum beradi (mijozga) yoki do'kondan olib ketadi (mijozdan). Mijoz ruxsati — saveSell bilan
 *   bir xil (shared.sotuvMijozRuxsat). Super agent kuzatuvi (x-kuzat-agent) — mobileAuth 403 qaytaradi (faqat GET).
 *   Sinxron bloki (`buyumlar`) — avtolavkaSinxron / agentSinxron.
 */
const B = require('../../utils/buyum.utils');
const { ok, fail, mobilKalit, mobilVaqt, sotuvMijozRuxsat } = require('./shared');

class MobileBuyumController {
  buyumHarakat = async (req, res) => {
    if (req.currentRole !== 'agent') return fail(res, 'Bu amal faqat agent uchun', 403);
    const r = await B.mobilHarakat(req.currentAgent, req.body || {}, {
      ruxsatFn: (mijoz) => sotuvMijozRuxsat(req, mijoz), mobilKalit, mobilVaqt,
    });
    ok(res, r, r.takror ? 'Harakat allaqachon saqlangan' : '');
  };
}

module.exports = new MobileBuyumController();
