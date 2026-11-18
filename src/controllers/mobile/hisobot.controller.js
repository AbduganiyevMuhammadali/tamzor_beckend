const { Op, fn, col } = require('sequelize');
const { ArizaModel } = require('../../models/ariza.model');
const TerritoriyaModel = require('../../models/territoriya.model');
const { ok, requireRole } = require('./shared');

const parseDate = (s) => (s ? new Date(String(s).replace(/\./g, '-')) : null);

async function savdoSummary(agentId, from, to) {
  const where = { turi: 'sotish' };
  if (agentId) where.agent_id = agentId;
  if (from && to) where.createdAt = { [Op.gte]: from, [Op.lt]: to };
  const row = await ArizaModel.findOne({
    attributes: [
      [fn('COUNT', col('id')), 'soni'],
      [fn('COALESCE', fn('SUM', col('jami_summa')), 0), 'summa'],
    ],
    where, raw: true,
  });
  return { soni: parseInt(row.soni, 10) || 0, summa: parseFloat(row.summa) || 0 };
}

/* ── Reports (hujjat 12.x) ────────────────────────────────────────────────── */
class MobileHisobotController {
  // 12.1 getBranches → [{ id, name, active }]
  getBranches = async (req, res, next) => {
    const list = await TerritoriyaModel.findAll({ order: [['nomi', 'ASC']] });
    ok(res, list.map(t => ({ id: t.id, name: t.nomi, active: true })));
  };

  // 12.2 getCircleReports → [{ id, title, values:[{id,title,value}] }]
  getCircleReports = async (req, res, next) => {
    ok(res, []);
  };

  // 12.3 getSections → [{ link, title, value, subTitle }]
  getSections = async (req, res, next) => {
    ok(res, []);
  };

  // 12.4 getLinearReports → [{ title, values:[{title, points:[]}] }]
  getLinearReports = async (req, res, next) => {
    ok(res, []);
  };

  // 12.5 getSellsReport → data MASSIV (ilova birinchi elementni oladi)
  // Faqat agent — sotuv hisoboti, dostavchining shaxsiy sotuvi yo'q.
  getSellsReport = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const day = parseDate(req.query.date) || new Date();
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const s = await savdoSummary(req.currentAgent.id, from, to);
    ok(res, [{
      visited: '0', along_route: '0', remaining_places: '0', no_along_route: '0',
      Order_quantity: String(s.soni), total_Number_Order: String(s.soni),
      total_Count_Products: '0',
      data_Category: [], data_sells: [], data_Client: [],
    }]);
  };

  // 12.6 getSellsReportMonth → data OBYEKT (massiv emas)
  // Faqat agent — sotuv hisoboti, dostavchining shaxsiy sotuvi yo'q.
  getSellsReportMonth = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const from = parseDate(req.query.date1);
    const to = parseDate(req.query.date2);
    if (to) to.setDate(to.getDate() + 1);
    const s = await savdoSummary(req.currentAgent.id, from, to);
    ok(res, {
      summa: String(s.summa),
      count: String(s.soni),
      shop: '0',
      month: '',
      data_Category: [], data_sells: [],
    });
  };

  // 12.7 table → TableModel
  table = async (req, res, next) => {
    ok(res, {
      orientation: 'vertical',
      header: { columns: [] },
      items: [],
      filter: [],
      selectedFilters: Array.isArray(req.body) ? req.body : [],
    });
  };
}

module.exports = new MobileHisobotController();
