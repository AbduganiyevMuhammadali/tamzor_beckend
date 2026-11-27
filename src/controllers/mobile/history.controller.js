const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel = require('../../models/agent.model');
const { ok, requireRole, mijozRuxsat } = require('./shared');
const { shapeDoc, STATUS_ID } = require('./docShape');
const sequelize = require('../../db/db-sequelize');
const HttpException = require('../../utils/HttpException.utils');
const { qarzQismlari } = require('../../utils/qarz.utils');

const NAQD = ['naqt', 'naqd'];
const SOTUV = ['sotish', 'diller_sotuv'];   // 2026-11-29: dillerning o'z sotuvi ham chek
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
  // Faqat xodim ishlaydigan mijoz (shared.mijozRuxsat — getKlient bilan bir xil qoida)
  getClientDocHistory = async (req, res, next) => {
    const mijoz = await MijozModel.findByPk(req.query.clientId, { attributes: ['id', 'agent_id'] });
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    if (!await mijozRuxsat(req, mijoz)) throw new HttpException(403, 'Bu mijoz sizga biriktirilmagan');
    const where = { mijoz_id: mijoz.id };
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
  require('../../utils/superKuzatuv.utils').tekshir(req, 'cheklar');   // 2026-11-27: super agent ruxsati
  const klientId = parseInt(req.query.klientId || req.query.clientId, 10);
  if (!klientId) throw new HttpException(400, 'klientId majburiy');
  const mijoz = await MijozModel.findByPk(klientId, { attributes: ['id', 'agent_id', 'nomi', 'balans', 'kredit_limit', 'tolov_muddati_kun'] });
  if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
  if (!await mijozRuxsat(req, mijoz)) throw new HttpException(403, 'Bu mijoz sizga biriktirilmagan');
  const page = Math.max(0, parseInt(req.query.page, 10) || 0);
  const HAJM = 20;

  const { SavdoQaytarishModel, SavdoQaytarishQatorModel } = require('../../models/savdoQaytarish.model');
  const [arizalar, tolovlar, qismlar, qaytarishlar, plastiklar, dillerTolov] = await Promise.all([
    ArizaModel.findAll({
      where: { mijoz_id: klientId, holat: Object.keys(HOLAT_NOM) },
      include: [{ model: ArizaQatorModel, as: 'qatorlar' }],
      order: [['createdAt', 'DESC']],
      limit: 300,
    }),
    // Tasdiqlangan plastik kirimi (manba_tur='plastik_tolov') bu yerda emas — pastda 'plastik' yozuvi sifatida
    sequelize.query(`SELECT id, sana, summa, tolov_usul, izoh, kategoriya FROM kassa
       WHERE tur = 'kirim' AND mijoz_id = :id AND kategoriya IN ('mijoz_tolov', 'qarz_qaytarish')
         AND (manba_tur IS NULL OR manba_tur <> 'plastik_tolov')
       ORDER BY sana DESC LIMIT 300`, { replacements: { id: klientId }, type: sequelize.QueryTypes.SELECT }),
    qarzQismlari([mijoz]),
    // Sotuvga bog'langan qaytarishlar (savdoQaytarish) — chek tarixida alohida yozuv
    SavdoQaytarishModel.findAll({
      where: { mijoz_id: klientId }, include: [{ model: SavdoQaytarishQatorModel, as: 'qatorlar' }],
      order: [['sana', 'DESC']], limit: 300,
    }),
    // 2026-11-24: plastik to'lovlar (kutilmoqda / tasdiqlangan / rad_etildi) — qarz to'lovi va sotuv
    sequelize.query(`SELECT p.id, p.tur, p.holat, p.summa, p.sana, p.kassa_id, k.nomi kassa_nomi, p.chek_rasm, p.rad_sababi,
         p.ariza_id, p.ariza_raqam, p.agent_nomi, p.izoh, p.tasdiq_vaqt
       FROM plastik_tolov p LEFT JOIN kassalar k ON k.id = p.kassa_id
       WHERE p.mijoz_id = :id ORDER BY p.sana DESC, p.id DESC LIMIT 300`, { replacements: { id: klientId }, type: sequelize.QueryTypes.SELECT }),
    // 2026-11-29: diller mijozining qarz to'lovlari (dillerning o'z daftari, kompaniya kassasi emas)
    sequelize.query(`SELECT id, sana, summa, usul, izoh FROM diller_pul WHERE mijoz_id = :id AND kategoriya = 'mijoz_tolov'
       ORDER BY sana DESC LIMIT 300`, { replacements: { id: klientId }, type: sequelize.QueryTypes.SELECT }),
  ]);
  const plastikSotuv = new Map(plastiklar.filter(p => p.ariza_id).map(p => [Number(p.ariza_id), p]));
  const ochiq = new Map((qismlar.get(mijoz.id) || []).filter(q => q.ariza_id).map(q => [q.ariza_id, q]));

  const yozuvlar = [
    ...arizalar.map(a => {
      const jami = n(a.jami_summa), tol = n(a.tolangan_summa);
      const naqdTur = NAQD.includes(String(a.tolov_turi || '').toLowerCase());
      // Joyida to'langani: avtolavka/dostavchik yozgan tolangan_summa, aks holda to'lov turidan
      const tolangan = SOTUV.includes(a.turi) ? (tol > 0 ? Math.min(jami, tol) : (naqdTur ? jami : 0)) : 0;
      const q = ochiq.get(a.id);
      const sana = a.yetkazilgan_sana || a.createdAt;
      return {
        tur: a.turi === 'qaytarish' ? 'qaytarish' : 'chek',
        id: String(a.id), raqam: a.raqam || String(a.id), sana,
        holat: a.holat, holatNomi: HOLAT_NOM[a.holat] || a.holat,
        agent: a.agent_nomi || '',
        tolovTuri: !SOTUV.includes(a.turi) ? null : tolangan >= jami - 0.5 ? 'naqd' : tolangan > 0 ? 'qisman' : 'qarz',
        jami, tolangan, qarzga: SOTUV.includes(a.turi) ? Math.max(0, jami - tolangan) : 0,
        // Hozir shu chekdan to'lanmay qolgan qarz (FIFO) va uning to'lov sanasi
        qolganQarz: q ? q.summa : 0,
        tolovSana: q ? q.tolov_sana : (a.tolov_sana || null),
        sanaBelgilangan: q ? q.belgilangan : !!a.tolov_sana,
        kechikkanKun: q ? q.kechikkan_kun : 0,
        izoh: a.izoh || '',
        // Plastik sotuv: to'lov holati (kutilmoqda | tasdiqlangan | rad_etildi), rad sababi
        ...(plastikSotuv.has(a.id) ? (() => {
          const p = plastikSotuv.get(a.id);
          return { tolovHolat: p.holat, plastikId: String(p.id), ...(p.rad_sababi ? { sabab: p.rad_sababi } : {}) };
        })() : {}),
        qatorlar: (a.qatorlar || []).map(x => ({
          tovarId: String(x.tovar_id || ''), tovar: x.tovar_nomi || '',
          dona: n(x.jami_dona), narx: n(x.narx), summa: n(x.summa),
        })),
      };
    }),
    ...qaytarishlar.map(q => ({
      tur: 'savdo_qaytarish', id: 'q' + q.id, raqam: `QT-${q.id}`, sana: q.sana, jami: n(q.summa),
      savdoId: String(q.ariza_id), savdoRaqam: q.ariza_raqam || String(q.ariza_id),
      tolov: q.tolov, agent: q.agent_nomi || '', izoh: q.izoh || '', yangiJami: n(q.yangi_jami),
      qatorlar: (q.qatorlar || []).map(x => ({
        tovarId: String(x.tovar_id), tovar: x.tovar_nomi || '', dona: n(x.dona), narx: n(x.narx), summa: n(x.summa),
        yaroqli: !!x.yaroqli, sabab: x.sabab || '',
      })),
    })),
    ...plastiklar.map(p => ({
      tur: 'plastik', id: 'p' + p.id, raqam: `PL-${p.id}`, sana: p.sana, jami: n(p.summa), summa: n(p.summa),
      holat: p.holat, tolovHolat: p.holat,   // 'kutilmoqda' | 'tasdiqlangan' | 'rad_etildi'
      plastikTur: p.tur,                     // 'qarz_tolov' | 'sotuv'
      kassaId: p.kassa_id ? String(p.kassa_id) : null, kassaNomi: p.kassa_nomi || '',
      chekRasm: p.chek_rasm || null, radSababi: p.rad_sababi || null, ...(p.rad_sababi ? { sabab: p.rad_sababi } : {}),
      tasdiqVaqt: p.tasdiq_vaqt || null,
      savdoId: p.ariza_id ? String(p.ariza_id) : null, savdoRaqam: p.ariza_id ? (p.ariza_raqam || String(p.ariza_id)) : null,
      agent: p.agent_nomi || '', izoh: p.izoh || '', qatorlar: [],
    })),
    ...tolovlar.map(t => ({
      tur: 'tolov', id: 'k' + t.id, raqam: `TL-${t.id}`, sana: t.sana, jami: n(t.summa),
      usul: t.tolov_usul || 'naqt', izoh: t.izoh || '',
    })),
    ...dillerTolov.map(t => ({
      tur: 'tolov', id: 'd' + t.id, raqam: `DT-${t.id}`, sana: t.sana, jami: n(t.summa),
      usul: t.usul === 'plastik' ? 'karta' : 'naqt', izoh: t.izoh || '',
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
      // Tasdiqlangan plastik qarz to'lovi ham to'lov (avval kassa yozuvi sifatida sanalardi — o'zgarmadi)
      tolovSumma: Math.round(yozuvlar.filter(x => x.tur === 'tolov' || (x.tur === 'plastik' && x.plastikTur === 'qarz_tolov' && x.holat === 'tasdiqlangan'))
        .reduce((a, x) => a + x.jami, 0)),
      kutilmoqdaPlastik: Math.round(yozuvlar.filter(x => x.tur === 'plastik' && x.holat === 'kutilmoqda').reduce((a, x) => a + x.jami, 0)),
      ochiqQarz: Math.round([...ochiq.values()].reduce((a, q) => a + q.summa, 0)),
    },
    page, pages: Math.max(1, Math.ceil(yozuvlar.length / HAJM)),
    data: yozuvlar.slice(page * HAJM, page * HAJM + HAJM),
  });
}

const controller = new MobileHistoryController();
controller.mijozCheklar = mijozCheklar;
module.exports = controller;
