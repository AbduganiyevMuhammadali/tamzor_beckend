const HttpException = require('../utils/HttpException.utils');
const AgentModel = require('../models/agent.model');
const DostavchiModel = require('../models/dostavchi.model');
const jwt = require('jsonwebtoken');
const { secret_jwt } = require('../startup/config');
const { asosiyRol, asosiyRolYoqilgan, rolOchiqEmasXabari } = require('../utils/mobilRollar.utils');

/**
 * Mobil ilova uchun auth middleware.
 * Namuna mobil API'dagidek token oddiy `token` header orqali yuboriladi
 * (Bearer sxemasiz). Ba'zi endpoint'lar tokenni query/body'da ham yuboradi
 * (masalan userToken, agent_id) — shularni ham qabul qilamiz.
 */
const mobileAuth = () => {
  return async function (req, res, next) {
    try {
      const token =
        req.headers.token ||
        req.query.token ||
        req.query.userToken ||
        (req.body && (req.body.userToken || req.body.token));

      if (!token) {
        throw new HttpException(401, req.mf('Access denied. No credentials sent!'));
      }

      let decoded;
      try {
        decoded = jwt.verify(token, secret_jwt, { algorithms: ['HS256'] });
      } catch (e) {
        throw new HttpException(401, req.mf('Authentication failed!'));
      }

      // Token'dagi rolga qarab: agent_id → agent, dostavchi_id → dostavchik.
      // Ikkalasida ham req.currentAgent to'ldiriladi (endpointlar umumiy ishlatadi),
      // req.currentRole esa rolni bildiradi.
      let user = null;
      let rol = null;
      if (decoded.agent_id) {
        user = await AgentModel.findOne({ where: { id: decoded.agent_id } });
        rol = 'agent';
      } else if (decoded.dostavchi_id) {
        user = await DostavchiModel.findOne({ where: { id: decoded.dostavchi_id } });
        rol = 'dostavchi';
      }

      if (!user || !user.faol) {
        throw new HttpException(401, req.mf('Authentication failed!'));
      }

      // Bitta login — ikki savdo rejimi: ilova Won Sell rejimida "x-rejim: avtolavka" yuboradi,
      // agentning Won Sell jufti bo'lsa so'rov o'sha juft nomidan bajariladi.
      // (2026-11-21 dan hamma agent avtolavka — bu shoxcha faqat eski ma'lumot uchun)
      if (rol === 'agent' && !user.avtolavka && user.juft_agent_id && String(req.headers['x-rejim'] || '') === 'avtolavka') {
        const juft = await AgentModel.findOne({ where: { id: user.juft_agent_id } });
        if (juft && juft.faol && juft.avtolavka) {
          req.asosiyAgent = user;
          user = juft;
        }
      }

      // Server sozlamasi (.env MOBIL_ROLLAR): foydalanuvchining asosiy roli yoqilmagan bo'lsa
      // 403 — 401 emas, aks holda ilova uni token xatosi deb logout qilib yuboradi.
      if (!asosiyRolYoqilgan(user, rol)) {
        throw new HttpException(403, rolOchiqEmasXabari(asosiyRol(user, rol)));
      }

      req.currentAgent = user;
      req.currentRole = rol;

      /* SUPER AGENT KUZATUVI (faqat o'qish): "x-kuzat-agent: <agentId>" sarlavhasi bilan super agent
         o'ziga biriktirilgan agent ko'radigan hamma narsani (GET) ko'radi — so'rov o'sha agent nomidan
         bajariladi. Faqat GET; yozuvchi so'rov sarlavha bilan kelsa 403 (agent nomidan sotuv/to'lov yo'q). */
      const kuzat = req.headers['x-kuzat-agent'];
      if (kuzat !== undefined && String(kuzat).trim() !== '') {
        const rad = () => { throw new HttpException(403, 'Bu agent sizga biriktirilmagan'); };
        if (req.method !== 'GET') throw new HttpException(403, "Kuzatuv rejimida faqat ko'rish mumkin — o'zgartirib bo'lmaydi");
        const targetId = Number(String(kuzat).trim());
        if (rol !== 'agent' || !user.super_agent || !Number.isInteger(targetId) || targetId <= 0) rad();
        const target = await AgentModel.findOne({ where: { id: targetId } });
        if (!target || !target.faol || Number(target.super_agent_id) !== Number(user.id) || Number(target.id) === Number(user.id)) rad();
        req.superAgent = user;
        req.currentAgent = target;
        req.kuzatuv = true;
      }
      next();
    } catch (e) {
      // Faqat token xatolari 401 (ilova logout qiladi); baza xatosi 500 bo'lib qoladi
      next(e);
    }
  };
};

module.exports = mobileAuth;
