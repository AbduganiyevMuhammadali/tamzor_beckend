const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { secret_jwt } = require('../../startup/config');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { ok } = require('./shared');
const { ochiqRollar, asosiyRol, asosiyRolYoqilgan, rolOchiqEmasXabari } = require('../../utils/mobilRollar.utils');

const AgentModel = require('../../models/agent.model');
const DostavchiModel = require('../../models/dostavchi.model');
const TerritoriyaModel = require('../../models/territoriya.model');

// Login obyektini yasash — asl server formatiga mos.
// rol: 'agent' | 'dostavchi' — flaglar shunga qarab.
async function buildUserData(user, token, rol = 'agent') {
  const filial = await TerritoriyaModel.findByPk(user.territoriya_id)
    || await TerritoriyaModel.findOne({ order: [['id', 'ASC']] });
  const isAgent = rol === 'agent';
  // dual_role — faqat agent jadvalida bor (sinov/aralash rol uchun): shu
  // agent bitta hisob bilan ham sotuv, ham yetkazib berish oynalarini ko'radi.
  const isDualRoleAgent = isAgent && !!user.dual_role;
  // .env MOBIL_ROLLAR bilan kesishma — o'chirilgan rol oynasi ochilmaydi
  const rollar = ochiqRollar(user, rol);
  return {
    token: token || '',
    password: '',
    login: user.login ?? '',
    name: (isAgent ? user.fullname : user.ism) ?? '',
    filial: filial ? filial.nomi : '',
    filialId: String(user.territoriya_id || (filial ? filial.id : '')),
    tel: user.telefon ?? '',
    adress: (isAgent ? user.boshlanish_manzil : '') ?? '',
    aralashSavdo: false,
    isAgent,
    // Ko'chma savdo agenti: ilova "Mening mashinam", yuklash so'rovi va
    // kun yakuni ekranlarini ko'rsatadi (mobile/avtolavka.controller.js)
    // 2026-11-21: har bir agent o'z omboridan sotadi (avvalgi Won Sell oqimi) — eski ilova uchun bayroq
    isAvtolavka: isAgent,
    isDeliver: (!isAgent || isDualRoleAgent) && rollar.includes('dostavchik'),
    // Dostavchik ilovasi uchun: mashina raqami va transport
    mashina: isAgent ? (user.mashina_raqam || '') : (user.mashina_raqam || ''),
    transport: user.transport || '',
    isAudit: false,
    isConfirmation: isAgent && rollar.includes('tasdiq'),
    // 2026-11-27: mijozni tahrirlash (telefon, manzil, lokatsiya) — web'dagi agent.mijoz_tahrir; diller — doim
    editLocation: isAgent && (!!user.mijoz_tahrir || !!user.diller),
    editClient: isAgent && (!!user.mijoz_tahrir || !!user.diller),
    add_client: isAgent,
    location: !(isAgent && user.diller),
    // Ish vaqti — shu oraliqda ilova marshrutni (GPS) yozadi. .env: GPS_BOSH=08:00, GPS_OXIR=20:00
    // (demo / tekshiruv instansiyasida 00:00–23:59 — tekshiruvchi istalgan vaqtda ko'ra olsin)
    locationStart: `0001-01-01T${soatEnv('GPS_BOSH', '08:00')}:00`,
    locationEnd: `0001-01-01T${soatEnv('GPS_OXIR', '20:00')}:00`,
    addClientSubKlient: false,
    serverVersion: 0,
    editCountType: false,
    rols: isAgent ? 'agentOrDostavshik' : 'dostavshik',
    tipPechat: '2',
    oneSell: false,
    returnView: !isAgent,
    // 2026-11-25: web panelda agent kartasidagi "Narxni o'zgartirish" bayrog'i (standart — yo'q)
    // 2026-11-29: diller narxni erkin qo'yadi (editPrice doim true)
    editPrice: isAgent && (!!user.narx_ozgartirish || !!user.diller),
    // 2026-11-29: DILLER — hamkor (o'z ombori, erkin narx, kassa/topshiruv yo'q). GPS kuzatuvi dillerda yo'q.
    diller: isAgent && !!user.diller,
    gps: !(isAgent && user.diller),
    // Yangi Flutter ilova uchun: asosiy rol va ochiq rollar ro'yxati
    // 2026-11-21: faqat 2 rol — 'agent' va 'super_agent' (rollar = ['agent'] + 'super_agent')
    asosiyRol: asosiyRol(user, rol),
    rollar,
    superAgent: isAgent && !!user.super_agent && rollar.includes('super_agent'),
    viloyat: isAgent && filial && Number(filial.id) === Number(user.territoriya_id) ? { id: filial.id, nomi: filial.nomi } : null,
  };
}

/** .env dagi HH:MM (noto'g'ri bo'lsa standart) */
function soatEnv(kalit, standart) {
  const v = String(process.env[kalit] || '').trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : standart;
}

/* ── Auth & User ─────────────────────────────────────────────────────────── */
class MobileAuthController extends BaseController {
  // 2.1 POST Login/
  login = async (req, res, next) => {
    const { login, password } = req.body;
    if (!login || !password) {
      throw new HttpException(400, req.mf('Incorrect login or password!'));
    }

    // Tekshiruv (App Store / Play Market) akkaunti alohida demo serverda yashaydi —
    // ishchi bazaga tegmaydi. Ilova javobdagi demoServer ga ulanib, o'sha yerda qayta kiradi.
    const demoLogin = String(process.env.DEMO_LOGIN || '').trim();
    const demoServer = String(process.env.DEMO_SERVER || '').trim();
    if (demoLogin && demoServer && String(login).trim().toLowerCase() === demoLogin.toLowerCase()) {
      return ok(res, { demoServer });
    }

    // Avval agent, topilmasa dostavchik
    let user = await AgentModel.findOne({ where: { login } });
    let rol = 'agent';
    if (!user || !user.parol) {
      user = await DostavchiModel.findOne({ where: { login } });
      rol = 'dostavchi';
    }
    if (!user || !user.parol) {
      throw new HttpException(400, req.mf('Incorrect login or password!'));
    }

    const isMatch = await bcrypt.compare(password, user.parol);
    if (!isMatch) {
      throw new HttpException(400, req.mf('Incorrect login or password!'));
    }
    if (!user.faol) {
      throw new HttpException(400, req.mf('Unauthorized'));
    }
    // 2026-11-21: mobil ilovada faqat agent va super agent. Dostavchik roli olib tashlandi
    // (parol to'g'ri bo'lgandan keyin aytiladi — login borligini begonaga oshkor qilmaslik uchun)
    if (rol === 'dostavchi') {
      throw new HttpException(403, "Dostavchik roli mobil ilovadan olib tashlangan. Mobil ilovaga faqat agent va super agent kira oladi — administratorga murojaat qiling.");
    }
    // Asosiy roli serverda (.env MOBIL_ROLLAR) o'chirilgan bo'lsa — kirish yo'q
    if (!asosiyRolYoqilgan(user, rol)) {
      throw new HttpException(403, rolOchiqEmasXabari(asosiyRol(user, rol)));
    }

    // Token ichiga rol yoziladi: agent_id yoki dostavchi_id
    const payload = rol === 'agent'
      ? { agent_id: user.id.toString() }
      : { dostavchi_id: user.id.toString() };
    const token = jwt.sign(payload, secret_jwt, { expiresIn: '30d' });
    ok(res, await buildUserData(user, token, rol));
  };

  // 2.3 GET getUser/ — login bilan bir xil data obyekt
  getUser = async (req, res, next) => {
    ok(res, await buildUserData(req.currentAgent, req.headers.token || '', req.currentRole || 'agent'));
  };

  // 2.2 GET getFilial/ — data = [{ filialId, filial }]
  getFilial = async (req, res, next) => {
    const list = await TerritoriyaModel.findAll({ order: [['nomi', 'ASC']] });
    ok(res, list.map(t => ({ filialId: t.id, filial: t.nomi })));
  };
}

module.exports = new MobileAuthController();
