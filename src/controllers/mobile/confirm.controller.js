const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel = require('../../models/agent.model');
const HttpException = require('../../utils/HttpException.utils');
const { ok, requireRole } = require('./shared');
const { shapeDoc } = require('./docShape');

/* ── Confirmations (hujjat 7.x) ───────────────────────────────────────────── */
class MobileConfirmController {
  // 7.1 getConfirms/ → DocumentDeliveryModel massivi (holat = yangi)
  getConfirms = async (req, res, next) => {
    const list = await ArizaModel.findAll({
      where: { holat: 'yangi' },
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
    const ariza = await ArizaModel.findByPk(docId);
    if (!ariza) throw new HttpException(404, req.mf('Not found'));
    await ariza.update({
      holat: success ? 'tasdiqlangan' : 'bekor',
      tasdiqlagan_id: req.currentAgent.id,
      tasdiqlagan_sana: new Date(),
    });
    ok(res, { docId: String(docId) });
  };

  // 3.11 getBronFiltr region controller'da — bu yerda kerak emas
}

module.exports = new MobileConfirmController();
