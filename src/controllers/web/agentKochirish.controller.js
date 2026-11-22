/**
 * AGENTDAN AGENTGA KO'CHIRISH — web (operator). Mantiq: utils/agentKochirish.utils.js
 *   POST   /avtolavka/kochirish            — yaratish (darhol amal qiladi)
 *   GET    /avtolavka/kochirish            — ro'yxat
 *   GET    /avtolavka/kochirish/:id        — tafsilot (qatorlar + audit)
 *   PATCH  /avtolavka/kochirish/:id        — tahrirlash (delta)
 *   POST   /avtolavka/kochirish/:id/bekor  — bekor qilish (teskari harakat)
 *   GET    /avtolavka/agent-qoldiq         — forma uchun agent omboridagi sotiladigan qoldiq
 */
const K = require('../../utils/agentKochirish.utils');
const HttpException = require('../../utils/HttpException.utils');

class AgentKochirishController {
  yarat = async (req, res) => {
    const r = await K.yarat(req.body || {}, req.currentUser);
    res.status(r.status).send(r.body);
  };

  royxat = async (req, res) => { res.send(await K.royxat(req.query)); };

  bitta = async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw new HttpException(404, "Ko'chirish hujjati topilmadi");
    res.send(await K.bitta(id));
  };

  tahrirla = async (req, res) => { res.send(await K.tahrirla(req.params.id, req.body || {}, req.currentUser)); };

  bekor = async (req, res) => { res.send(await K.bekorQil(req.params.id, req.body || {}, req.currentUser)); };

  agentQoldiq = async (req, res) => { res.send(await K.agentQoldiq(req.query.agent_id)); };
}

module.exports = new AgentKochirishController();
