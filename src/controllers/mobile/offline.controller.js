const { Op } = require('sequelize');
const { MijozModel } = require('../../models/mijoz.model');
const { ok, requireRole, WEEK_KEYS } = require('./shared');

// Mijozni hujjat 4.1 (ClientModel) formatiga aylantirish (klient controller bilan bir xil)
function shapeClient(m) {
  return {
    klientId: String(m.id),
    klientName: m.nomi || '',
    klientTel: m.telefon || '',
    klientAdress: m.manzil || '',
    klientLat: m.lat != null ? String(m.lat) : '',
    klientLong: m.lng != null ? String(m.lng) : '',
    klientOstatkasum: parseFloat(m.balans) || 0,
    klientOstatkaDollar: 0.0,
    isOpen: true,
    klientcode: m.id,
    subKlient: false,
    notSell: false,
    image: '',
    subClientName: '',
    subClientId: '',
    regionId: m.territoriya_id != null ? String(m.territoriya_id) : '',
    yuridikNomi: m.yuridik_nomi || '',
    chekcDiapazon: false,
    metrDiapazon: 100.0,
    klientQrCode: '',
    green: true,
    client_id_mobile: '',
  };
}

// weekDay null bo'lsa — butun hafta
async function klientlarByWeek(agentId, weekDay) {
  const where = { agent_id: agentId, faol: true };
  // FAQAT shu kunga tashrif belgilangan mijozlar (kuni yo'q mijoz chiqmaydi)
  if (weekDay) where.tashrif_kunlari = { [Op.like]: `%${WEEK_KEYS[weekDay]}%` };
  const list = await MijozModel.findAll({ where, order: [['id', 'ASC']] });
  const clients = list.map(shapeClient);
  const code = clients.length ? clients[clients.length - 1].klientcode : 0;
  return { code, clients };
}

/* ── Offline (Weekly Clients) — hujjat 10 ─────────────────────────────────── */
// Bularning barchasi agentning shaxsiy mijozlar ro'yxati (mijoz.agent_id
// bo'yicha filtrlanadi) — dostavchi chaqirsa, o'z ID'siga mos kelgan (yoki
// hech qanday) boshqa agentning mijozlari chiqib ketardi.
class MobileOfflineController {
  getKlientOfflineMonday    = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, 1)); };
  getKlientOfflineTuesday   = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, 2)); };
  getKlientOfflineWednesday = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, 3)); };
  getKlientOfflineThursday  = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, 4)); };
  getKlientOfflineFriday    = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, 5)); };
  getKlientOfflineSaturday  = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, 6)); };
  getKlientOfflineSunday    = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, 7)); };
  getKlientOfflineAllWeek   = async (req, res) => { if (!requireRole(req, res, 'agent')) return; ok(res, await klientlarByWeek(req.currentAgent.id, null)); };
}

module.exports = new MobileOfflineController();
