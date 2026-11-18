const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { secret_jwt } = require('../../startup/config');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { ok } = require('./shared');

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
    isAvtolavka: isAgent && !!user.avtolavka,
    isDeliver: !isAgent || isDualRoleAgent,
    // Dostavchik ilovasi uchun: mashina raqami va transport
    mashina: isAgent ? (user.mashina_raqam || '') : (user.mashina_raqam || ''),
    transport: user.transport || '',
    isAudit: false,
    isConfirmation: isAgent,
    editLocation: isAgent,
    add_client: isAgent,
    location: true,
    locationStart: '0001-01-01T08:00:00',
    locationEnd: '0001-01-01T20:00:00',
    addClientSubKlient: false,
    serverVersion: 0,
    editCountType: false,
    rols: isAgent ? 'agentOrDostavshik' : 'dostavshik',
    tipPechat: '2',
    oneSell: false,
    returnView: !isAgent,
    editPrice: isAgent,
  };
}

/* ── Auth & User ─────────────────────────────────────────────────────────── */
class MobileAuthController extends BaseController {
  // 2.1 POST Login/
  login = async (req, res, next) => {
    const { login, password } = req.body;
    if (!login || !password) {
      throw new HttpException(400, req.mf('Incorrect login or password!'));
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
