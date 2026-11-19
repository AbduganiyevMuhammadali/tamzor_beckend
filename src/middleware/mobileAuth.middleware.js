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

      // Server sozlamasi (.env MOBIL_ROLLAR): foydalanuvchining asosiy roli yoqilmagan bo'lsa
      // 403 — 401 emas, aks holda ilova uni token xatosi deb logout qilib yuboradi.
      if (!asosiyRolYoqilgan(user, rol)) {
        throw new HttpException(403, rolOchiqEmasXabari(asosiyRol(user, rol)));
      }

      req.currentAgent = user;
      req.currentRole = rol;
      next();
    } catch (e) {
      // Faqat token xatolari 401 (ilova logout qiladi); baza xatosi 500 bo'lib qoladi
      next(e);
    }
  };
};

module.exports = mobileAuth;
