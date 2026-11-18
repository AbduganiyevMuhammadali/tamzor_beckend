const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel = require('../../models/agent.model');
const { ok, requireRole } = require('./shared');
const { shapeDoc, STATUS_ID } = require('./docShape');
const sequelize = require('../../db/db-sequelize');
const HttpException = require('../../utils/HttpException.utils');
const { qarzQismlari } = require('../../utils/qarz.utils');

const NAQD = ['naqt', 'naqd'];
const n = v => parseFloat(v) || 0;
const HOLAT_NOM = { yangi: 'Yangi', tasdiqlangan: 'Tasdiqlangan', yigilmoqda: "Yig'ilmoqda", yolda: "Yo'lda",
  yetkazildi: 'Yetkazilgan', qabul_kutilmoqda: 'Qabul kutilmoqda', qabul_qilindi: 'Qabul qilingan' };

const INCLUDE = [
  { model: ArizaQatorModel, as: 'qatorlar' },
  { model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'telefon', 'manzil', 'lat', 'lng'] },
  { model: AgentModel, as: 'agent', attributes: ['id', 'fullname', 'telefon'] },
];

// statusId (mobil) -> ariza.holat ro'yxati
const STATUS_TO_HOLAT = {
  '1': ['yangi', 'tasdiqlangan', 'yigilmoqda'],
  '2': ['yolda'],
  '3': ['yetkazildi'],
};

/* ── History (hujjat 11.x) — DocumentDeliveryModel massivi ─────────────────── */
class MobileHistoryController {
  // 11.1 getAgentDocHistory/ — faqat agent (dostavchining agent jadvalidagi
  // mos ID'si bo'lmasligi mumkin, shuning uchun bu ro'yxat unga tegishli emas)
  getAgentDocHistory = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const where = { agent_id: req.currentAgent.id };
    const holatlar = STATUS_TO_HOLAT[String(req.query.statusId)];
    if (holatlar) where.holat = holatlar;
    const list = await ArizaModel.findAll({ where, include: INCLUDE, order: [['createdAt', 'DESC']] });
    ok(res, list.map(shapeDoc));
  };

  // 11.2 getClientDocHistory/
  getClientDocHistory = async (req, res, next) => {
    const where = { mijoz_id: req.query.clientId };
    const holatlar = STATUS_TO_HOLAT[String(req.query.statusId)];
    if (holatlar) where.holat = holatlar;
    const list = await ArizaModel.findAll({ where, include: INCLUDE, order: [['createdAt', 'DESC']] });
    ok(res, list.map(shapeDoc));
  };
}

/**
 * 20.1 mijozCheklar/?klientId=&page= — mijozning CHEK TARIXI (yangidan eskiga):
 * har sotuv cheki tovar qatorlari bilan, to'lovlar va qaytarishlar bitta vaqt
 * o'qida. Har chekda: qanchasi joyida to'langan, qarzga ketgani, hozir qancha
 * to'lanmay qolgani va to'lov sanasi (agent belgilagan yoki sotuv + muddat).
 * Bekor qilingan buyurtmalar kirmaydi. Sahifa — 20 ta yozuv.
 */
async function mijozCheklar(req, res) {
  const klientId = parseInt(req.query.klientId || req.query.clientId, 10);
  if (!klientId) throw new HttpException(400, 'klientId majburiy');
  const mijoz = await MijozModel.findByPk(klientId, { attributes: ['id', 'nomi', 'balans', 'kredit_limit', 'tolov_muddati_kun'] });
  if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const HAJM = 20;

  const [arizalar, tolovlar, qismlar] = await Promise.all([
    ArizaModel.findAll({
      where: { mijoz_id: klientId, holat: Object.keys(HOLAT_NOM) },
      include: [{ model: ArizaQatorModel, as: 'qatorlar' }],
      order: [['createdAt', 'DESC']],
      limit: 300,
    }),
    sequelize.query(`SELECT id, sana, summa, tolov_usul, izoh, kategoriya FROM kassa
       WHERE tur = 'kirim' AND mijoz_id = :id AND kategoriya IN ('mijoz_tolov', 'qarz_qaytarish')
       ORDER BY sana DESC LIMIT 300`, { replacements: { id: klientId }, type: sequelize.QueryTypes.SELECT }),
    qarzQismlari([mijoz]),
  ]);
  const ochiq = new Map((qismlar.get(mijoz.id) || []).filter(q => q.ariza_id).map(q => [q.ariza_id, q]));

  const yozuvlar = [
    ...arizalar.map(a => {
      const jami = n(a.jami_summa), tol = n(a.tolangan_summa);
      const naqdTur = NAQD.includes(String(a.tolov_turi || '').toLowerCase());
      // Joyida to'langani: avtolavka/dostavchik yozgan tolangan_summa, aks holda to'lov turidan
      const tolangan = a.turi === 'sotish' ? (tol > 0 ? Math.min(jami, tol) : (naqdTur ? jami : 0)) : 0;
      const q = ochiq.get(a.id);
      const sana = a.yetkazilgan_sana || a.createdAt;
      return {
        tur: a.turi === 'qaytarish' ? 'qaytarish' : 'chek',
        id: String(a.id), raqam: a.raqam || String(a.id), sana,
        holat: a.holat, holatNomi: HOLAT_NOM[a.holat] || a.holat,
        agent: a.agent_nomi || '',
        tolovTuri: a.turi !== 'sotish' ? null : tolangan >= jami - 0.5 ? 'naqd' : tolangan > 0 ? 'qisman' : 'qarz',
        jami, tolangan, qarzga: a.turi === 'sotish' ? Math.max(0, jami - tolangan) : 0,
        // Hozir shu chekdan to'lanmay qolgan qarz (FIFO) va uning to'lov sanasi
        qolganQarz: q ? q.summa : 0,
        tolovSana: q ? q.tolov_sana : (a.tolov_sana || null),
        sanaBelgilangan: q ? q.belgilangan : !!a.tolov_sana,
        kechikkanKun: q ? q.kechikkan_kun : 0,
        izoh: a.izoh || '',
        qatorlar: (a.qatorlar || []).map(x => ({
          tovarId: String(x.tovar_id || ''), tovar: x.tovar_nomi || '',
          dona: n(x.jami_dona), narx: n(x.narx), summa: n(x.summa),
        })),
      };
    }),
    ...tolovlar.map(t => ({
      tur: 'tolov', id: 'k' + t.id, raqam: `TL-${t.id}`, sana: t.sana, jami: n(t.summa),
      usul: t.tolov_usul || 'naqt', izoh: t.izoh || '',
    })),
  ].sort((a, b) => new Date(b.sana) - new Date(a.sana));

  const sotuvlar = yozuvlar.filter(x => x.tur === 'chek' && x.holat === 'yetkazildi');
  ok(res, {
    mijoz: {
      klientId: String(mijoz.id), nomi: mijoz.nomi, qarz: Math.max(0, -n(mijoz.balans)),
      kreditLimit: n(mijoz.kredit_limit), tolovMuddatiKun: parseInt(mijoz.tolov_muddati_kun, 10) || 30,
    },
    jami: {
      cheklar: sotuvlar.length,
      xaridSumma: Math.round(sotuvlar.reduce((a, x) => a + x.jami, 0)),
      tolovSumma: Math.round(yozuvlar.filter(x => x.tur === 'tolov').reduce((a, x) => a + x.jami, 0)),
      ochiqQarz: Math.round([...ochiq.values()].reduce((a, q) => a + q.summa, 0)),
    },
    page, pages: Math.max(1, Math.ceil(yozuvlar.length / HAJM)),
    data: yozuvlar.slice(page * HAJM, page * HAJM + HAJM),
  });
}

const controller = new MobileHistoryController();
controller.mijozCheklar = mijozCheklar;
module.exports = controller;
