/**
 * BUYUMLAR (sotilmaydigan jihozlar) — web. Mantiq: utils/buyum.utils.js, FRONTEND-UCHUN.md §23.
 *   GET    /buyumlar                 — katalog (+ kompaniyada / agentlarda / mijozlarda / jami)
 *   POST   /buyumlar                 — yangi buyum            PATCH /buyumlar/:id — tahrir / faol
 *   DELETE /buyumlar/:id             — faqat harakatsiz buyum
 *   POST   /buyumlar/harakat         — kirim | agentga | agentdan | agentdan_agentga
 *   GET    /buyumlar/harakatlar      — harakatlar tarixi       GET /buyumlar/harakatlar/:id
 *   GET    /buyumlar/hisobot/agentlar | mijozlar | buyumlar
 *   GET    /buyumlar/agent/:id       — agent qo'lida va uning mijozlarida
 */
const B = require('../../utils/buyum.utils');

class BuyumController {
  katalog = async (req, res) => { res.send(await B.katalog(req.query)); };
  yarat = async (req, res) => { res.status(201).send(await B.katalogYarat(req.body || {})); };
  tahrir = async (req, res) => { res.send(await B.katalogTahrir(req.params.id, req.body || {})); };
  ochir = async (req, res) => { res.send(await B.katalogOchir(req.params.id)); };
  harakat = async (req, res) => {
    const r = await B.webHarakat(req.body || {}, req.currentUser);
    res.status(r.status).send(r.body);
  };
  harakatlar = async (req, res) => { res.send(await B.harakatlar(req.query)); };
  harakatBitta = async (req, res) => { res.send(await B.harakatBitta(req.params.id)); };
  hisobotAgentlar = async (req, res) => { res.send(await B.hisobotAgentlar(req.query)); };
  hisobotMijozlar = async (req, res) => { res.send(await B.hisobotMijozlar(req.query)); };
  hisobotBuyumlar = async (req, res) => { res.send(await B.hisobotBuyumlar()); };
  agent = async (req, res) => { res.send(await B.agentBuyumlari(req.params.id)); };
}

module.exports = new BuyumController();
