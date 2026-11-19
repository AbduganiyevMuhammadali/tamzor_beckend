const { Op } = require('sequelize');
const { MijozModel } = require('../../models/mijoz.model');
const TerritoriyaModel = require('../../models/territoriya.model');
const { SotmaslikModel, AgentLocationModel } = require('../../models/hisobot.model');
const HttpException = require('../../utils/HttpException.utils');
const { ok, fail, requireRole, WEEK_KEYS, PAGE_SIZE, mobilKalit, mobilVaqt, sababNomi, mijozRuxsat, takrorXato } = require('./shared');
const sequelize = require('../../db/db-sequelize');
const MijozReytingModel = require('../../models/mijozReyting.model');
const { reytingYoz, reytingKorinish } = require('../../utils/reyting.utils');

/* Mobil xodim (agent yoki dostavchik) — reyting tarixida kim yozgani */
const xodimOl = (req) => req.currentAgent
  ? { rol: req.currentRole === 'dostavchi' ? 'dostavchi' : 'agent', id: req.currentAgent.id, nomi: req.currentAgent.fullname || req.currentAgent.ism || null }
  : null;

// Mobil GPS sana formati: "dd/MM/yyyy//HH:mm:ss" (hujjat 4.9). `new Date()`
// bunga to'g'ridan-to'g'ri tushunmaydi (kun/oy tartibini AQSh formati deb
// noto'g'ri talqin qiladi yoki butunlay rad etadi) — qo'lda parse qilamiz.
function parseMobileGpsDate(raw) {
  if (!raw) return new Date();
  const m = String(raw).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\/\/(\d{1,2}):(\d{2}):(\d{2})$/);
  if (!m) {
    const fallback = new Date(raw);
    return isNaN(fallback.getTime()) ? new Date() : fallback;
  }
  const [, day, month, year, hh, mm, ss] = m;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hh), Number(mm), Number(ss));
}

// Mijozni hujjat 4.1 (ClientModel) formatiga aylantirish
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

const mapKlientBody = (q) => {
  const data = {};
  if (q.name != null) data.nomi = q.name;
  if (q.yuridikNomi != null) data.yuridik_nomi = q.yuridikNomi;
  if (q.tel != null) data.telefon = q.tel;
  if (q.address != null) data.manzil = q.address;
  if (q.xudud != null) data.territoriya_id = q.xudud;
  if (q.lat != null) data.lat = q.lat;
  if (q.lon != null) data.lng = q.lon;
  return data;
};

// Javob hujjat 4.1 kontrakti bo'yicha: { code, clients }
//   code = keyingi sahifa kursori (shu sahifadagi oxirgi mijozning klientcode/id)
//   so'rovda kelgan `code` dan KATTA id'li mijozlar qaytariladi (kursor paginatsiya)
//   tugaganda clients: [] qaytadi
async function fetchClients({ agentId, searchKey, weekKey, cursor = 0 }) {
  const where = { faol: true };
  if (agentId) where.agent_id = agentId;
  if (cursor > 0) where.id = { [Op.gt]: cursor };  // koddan keyingi mijozlar
  if (searchKey) {
    where[Op.or] = [
      { nomi: { [Op.like]: `%${searchKey}%` } },
      { telefon: { [Op.like]: `%${searchKey}%` } },
      { yuridik_nomi: { [Op.like]: `%${searchKey}%` } },
    ];
  }
  if (weekKey >= 1 && weekKey <= 7) {
    // FAQAT shu kunga tashrif belgilangan mijozlar (kuni yo'q mijoz bugun chiqmaydi)
    where.tashrif_kunlari = { [Op.like]: `%${WEEK_KEYS[weekKey]}%` };
  }
  const list = await MijozModel.findAll({
    where, order: [['id', 'ASC']], limit: PAGE_SIZE,
  });
  const clients = list.map(shapeClient);
  // keyingi sahifa kursori = oxirgi mijozning klientcode (bo'sh bo'lsa kelgan cursor)
  const code = clients.length ? clients[clients.length - 1].klientcode : cursor;
  return { code, clients };
}

/* ── Mijozlar (hujjat 4.x) ────────────────────────────────────────────────── */
class MobileKlientController {
  // 4.1 getKlient (agent, hafta bo'yicha) — faqat agent uchun: agent_id
  // req.currentAgent.id bo'lib qoladi, dostavchik chaqirsa boshqa agentning
  // (yoki hech kimning) mijozlari chiqib ketishi mumkin edi.
  getKlient = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    ok(res, await fetchClients({
      agentId: req.currentAgent.id,
      searchKey: (req.query.searchKey || '').trim(),
      weekKey: parseInt(req.query.keyWeek, 10) || 0,
      cursor: parseInt(req.query.code, 10) || 0,
    }));
  };

  // 4.2 getAllKlient/ (delivery — agent filtrsiz)
  getAllKlient = async (req, res, next) => {
    ok(res, await fetchClients({
      searchKey: (req.query.searchKey || '').trim(),
      cursor: parseInt(req.query.code, 10) || 0,
    }));
  };

  // 4.3 getAllKlientAudit/
  getAllKlientAudit = async (req, res, next) => {
    ok(res, await fetchClients({
      searchKey: (req.query.searchKey || '').trim(),
      cursor: parseInt(req.query.code, 10) || 0,
    }));
  };

  // 4.4 info/ → ClientInfoModel
  // Faqat xodim ishlaydigan mijoz (shared.mijozRuxsat — getKlient bilan bir xil qoida).
  info = async (req, res, next) => {
    const m = await MijozModel.findByPk(req.query.client_id, {
      include: [{ model: TerritoriyaModel, as: 'territoriya', attributes: ['nomi'] }],
    });
    if (!m) throw new HttpException(404, req.mf('Not found'));
    if (!await mijozRuxsat(req, m)) throw new HttpException(403, 'Bu mijoz sizga biriktirilmagan');
    ok(res, {
      name: m.nomi || '',
      phone: m.telefon || '',
      inn: m.inn || '',
      address: m.manzil || '',
      birth: '',
      region: m.territoriya ? m.territoriya.nomi : '',
      price_type: 'Optom',
      yuridikNomi: m.yuridik_nomi || '',
    });
  };

  // 4.5 saveKlient/ → data: { klientId }  (offline kontrakt)
  // Yangi mijoz shu vaqtda tizimga kirgan agentga bog'lanadi (dostavchik yaratsa
  // agent_id bog'lanmaydi — u mijozning doimiy agentini bilmaydi).
  // Parametrlar query yoki body'da kelishi mumkin. mobilId — oflayn ilova kaliti: takror kelsa borini qaytaradi.
  saveKlient = async (req, res, next) => {
    const q = { ...req.query, ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    const data = mapKlientBody(q);
    if (!data.nomi) throw new HttpException(400, req.mf('Validation faild'));
    if (req.currentRole === 'agent') data.agent_id = req.currentAgent.id;
    const mobilId = mobilKalit(q.mobilId);
    if (mobilId) {
      const bor = await MijozModel.findOne({ where: { mobil_id: mobilId }, attributes: ['id'] });
      if (bor) return ok(res, { klientId: String(bor.id), takror: true }, 'Mijoz allaqachon saqlangan');
      data.mobil_id = mobilId;
    }
    const klient = await MijozModel.create(data);
    ok(res, { klientId: String(klient.id) }, 'Mijoz saqlandi');
  };

  // 4.6 updateClient/ → data: { klientId }
  updateClient = async (req, res, next) => {
    const klient = await MijozModel.findByPk(req.query.klientId);
    if (!klient) throw new HttpException(404, req.mf('Not found'));
    if (!await mijozRuxsat(req, klient)) throw new HttpException(403, 'Bu mijoz sizga biriktirilmagan');
    await klient.update(mapKlientBody(req.query));
    ok(res, { klientId: String(klient.id) }, 'Yangilandi');
  };

  // 4.7 saveLocation/ → data: { klientId }  (offline kontrakt)
  saveLocation = async (req, res, next) => {
    const { klientId, lat, long } = req.body;
    if (klientId && lat != null && long != null) {
      const klient = await MijozModel.findByPk(klientId, { attributes: ['id', 'agent_id'] });
      if (!klient) throw new HttpException(404, req.mf('Not found'));
      if (!await mijozRuxsat(req, klient)) throw new HttpException(403, 'Bu mijoz sizga biriktirilmagan');
      await MijozModel.update({ lat, lng: long }, { where: { id: klient.id } });
    }
    ok(res, { klientId: String(klientId || '') });
  };

  // 4.8 clientNotSell → sotmaslik (rad etish) sababi + mijoz reytingi (utils/reyting.utils.js).
  // mobilId (yangi ilova) — oflayn navbat qayta yuborsa ikkinchi marta yozilmaydi.
  // Mijoz topilmasa yozuv yaratilmaydi. Takror kalit mijoz_reyting.mobil_id (UNIQUE) da saqlanadi
  // (sotmaslik jadvalida mobil_id ustuni yo'q) — parallel takror ham bitta yozuv qoldiradi.
  clientNotSell = async (req, res, next) => {
    const { clientId, reasonId, date } = req.query;
    const agent = req.currentAgent || {};
    const mobilId = mobilKalit(req.query.mobilId);
    const takrorJavob = () => ok(res, { date: date || '', takror: true }, 'Allaqachon saqlangan');
    const takrorMi = async () => !!(mobilId && await MijozReytingModel.findOne({ where: { mobil_id: mobilId }, attributes: ['id'] }));
    if (await takrorMi()) return takrorJavob();
    const mijoz = clientId ? await MijozModel.findByPk(clientId) : null;
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    let sana = req.query.vaqt ? mobilVaqt(req.query.vaqt) : (date ? new Date(String(date).replace(/\./g, '-')) : new Date());
    if (isNaN(sana.getTime())) sana = new Date();
    let natija;
    try {
      natija = await sequelize.transaction(async (t) => {
        const s = await SotmaslikModel.create({
          agent_id:   agent.id || null,
          agent_nomi: agent.fullname || null,
          mijoz_id:   mijoz.id,
          mijoz_nomi: mijoz.nomi,
          sabab_id:   reasonId || null,
          sabab_nomi: sababNomi(reasonId),
          sana,
        }, { transaction: t });
        const r = await reytingYoz(mijoz.id, {
          tur: 'rad_etildi', sabab_id: reasonId ? String(reasonId) : null, sabab: sababNomi(reasonId) || 'Sabab ko\'rsatilmagan',
          manba_tur: 'sotmaslik', manba_id: s.id, xodim: xodimOl(req), mobil_id: mobilId, sana,
        }, t);
        // reytingYoz shu mobilId bilan yozuvni topgan bo'lsa — bu takror: sotmaslik yozuvi ham bekor
        if (r && r.takror) { const e = new Error('takror'); e.name = 'SequelizeUniqueConstraintError'; throw e; }
        return r;
      });
    } catch (e) {
      if (takrorXato(e) && await takrorMi()) return takrorJavob();
      throw e;
    }
    ok(res, { date: date || '', reyting: natija ? natija.reyting : null, kritik: !!natija?.kritik }, 'Saqlandi');
  };

  // POST tolovSurildi/ { klientId, yangiSana (YYYY-MM-DD), izoh, mobilId, vaqt }
  // Mijoz qarzni to'lamay, boshqa kunga va'da berdi — reyting (moliya) tushadi, va'da sanasi saqlanadi.
  tolovSurildi = async (req, res) => {
    const { klientId, yangiSana, izoh } = req.body;
    const mobilId = mobilKalit(req.body.mobilId);
    if (mobilId) {
      const bor = await MijozReytingModel.findOne({ where: { mobil_id: mobilId } });
      if (bor) return ok(res, { klientId: String(bor.mijoz_id), reyting: bor.reyting_keyin, takror: true }, 'Allaqachon saqlangan');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(yangiSana || ''))) return fail(res, "Yangi to'lov sanasini tanlang");
    const mijoz = await MijozModel.findByPk(klientId);
    if (!mijoz) return fail(res, 'Mijoz topilmadi', 404);
    const r = await reytingYoz(mijoz.id, {
      tur: 'tolov_surildi', sabab: "To'lov vaqti surildi", izoh: izoh ? String(izoh).slice(0, 200) : null,
      summa: Math.max(0, -(parseFloat(mijoz.balans) || 0)), vada_sana: yangiSana,
      manba_tur: 'mobil', xodim: xodimOl(req), mobil_id: mobilId, sana: mobilVaqt(req.body.vaqt),
    });
    ok(res, { klientId: String(mijoz.id), ...reytingKorinish({ reyting: r.reyting, rad_ketma_ket: mijoz.rad_ketma_ket, tolov_vada_sana: yangiSana }) }, "Qayd etildi");
  };

  // 4.9 sendLocation/ (batch GPS) — agent HAM dostavchik marshrutini DB'ga
  // saqlaydi. `rol` ustuni yozib qo'yiladi, aks holda agent va dostavchi
  // bir xil ID'ga ega bo'lganda GPS izlari bir-biriga aralashib qolardi.
  sendLocation = async (req, res, next) => {
    const points = Array.isArray(req.body.location) ? req.body.location : [];
    const userId = (req.currentAgent && req.currentAgent.id) || null;
    const rol = req.currentRole === 'dostavchi' ? 'dostavchi' : 'agent';
    if (points.length) {
      await AgentLocationModel.bulkCreate(points.map(p => ({
        agent_id: userId,
        rol,
        lat: p.lat ?? null,
        lng: p.long ?? null,
        battery: p.battery ?? null,
        sana: parseMobileGpsDate(p.date),
      })));
    }
    ok(res, null);
  };
}

module.exports = new MobileKlientController();
