const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel = require('../../models/agent.model');
const HttpException = require('../../utils/HttpException.utils');
const sequelize = require('../../db/db-sequelize');
const { ok, requireRole } = require('./shared');
const { shapeDoc } = require('./docShape');
const { qulflabOl } = require('../../utils/qulf.utils');
const { reytingQaytar } = require('../../utils/reyting.utils');

/* ── Confirmations (hujjat 7.x) ───────────────────────────────────────────── */
class MobileConfirmController {
  // 7.1 getConfirms/ → DocumentDeliveryModel massivi (holat = yangi)
  // Faqat joriy agentning O'Z zakazlari (isConfirmation faqat agentga true).
  getConfirms = async (req, res, next) => {
    if (req.currentRole !== 'agent') return ok(res, []);
    const list = await ArizaModel.findAll({
      where: { holat: 'yangi', agent_id: req.currentAgent.id },
      include: [
        { model: ArizaQatorModel, as: 'qatorlar' },
        { model: MijozModel, as: 'mijoz', attributes: ['id', 'nomi', 'telefon', 'manzil', 'lat', 'lng'] },
        { model: AgentModel, as: 'agent', attributes: ['id', 'fullname', 'telefon'] },
      ],
      order: [['createdAt', 'DESC']],
    });
    ok(res, list.map(shapeDoc));
  };

  // 7.2 postConfirm/ → data: { docId }  (offline kontrakt)
  // Faqat agent (login javobida isConfirmation faqat agentga true bo'ladi).
  postConfirm = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const { docId, success } = req.body;
    const tasdiq = success === true || success === 'true' || success === 1 || success === '1';
    const yangiHolat = tasdiq ? 'tasdiqlangan' : 'bekor';
    const agentId = Number(req.currentAgent.id);

    // Holat tranzaksiya ichida qulf bilan qayta o'qiladi — parallel/oflayn takror
    // so'rovlar ikkinchi marta o'tkazmaydi. Faqat zakaz egasi (ariza.agent_id) va
    // faqat 'yangi' holatidan.
    await sequelize.transaction(async (t) => {
      const ariza = await qulflabOl(ArizaModel, docId, t);
      if (!ariza) throw new HttpException(404, req.mf('Not found'));
      if (Number(ariza.agent_id) !== agentId) throw new HttpException(403, 'Bu hujjat sizga tegishli emas');
      if (ariza.holat === yangiHolat) return;   // oflayn takror — natija allaqachon shu
      if (ariza.holat !== 'yangi') {
        throw new HttpException(400, `"${ariza.holat}" holatidagi hujjatni ${tasdiq ? 'tasdiqlab' : 'bekor qilib'} bo'lmaydi`);
      }
      await ariza.update({
        holat: yangiHolat,
        tasdiqlagan_id: agentId,
        tasdiqlagan_sana: new Date(),
      }, { transaction: t });
      // Web changeHolat bilan bir xil: bekor qilingan zakaz uchun berilgan reyting balli qaytadi
      if (yangiHolat === 'bekor') await reytingQaytar({ manba_tur: 'ariza', manba_id: ariza.id }, t);
    });
    ok(res, { docId: String(docId) });
  };

  // 3.11 getBronFiltr region controller'da — bu yerda kerak emas
}

module.exports = new MobileConfirmController();
