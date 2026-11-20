const HttpException = require('../utils/HttpException.utils');
const auth = require('./auth.middleware');
const mobileAuth = require('./mobileAuth.middleware');

/* YUKLANGAN FAYLLAR (/uploads/*) — faqat tizimga kirganlarga (2026-11-24).
   Qabul qilinadi:
     - web:   `Authorization: Bearer <jwt>` — auth() bilan bir xil tekshiruv (foydalanuvchi bazada bor);
     - mobil: `token: <jwt>` sarlavhasi — mobileAuth() bilan bir xil tekshiruv (agent/dostavchik faol,
              MOBIL_ROLLAR, x-kuzat-agent qoidasi).
   Query (?token=) qabul QILINMAYDI — havola tarqalsa ham fayl ochilmasin. Brauzer <img src> sarlavha
   yubora olmaydi: web faylni fetch(..., { headers: { Authorization } }) bilan blob qilib oladi
   (FRONTEND-UCHUN §19.1). Hech biri bo'lmasa → 401. */
const webAuth = auth();
const mobAuth = mobileAuth();

module.exports = function faylAuth() {
  return function (req, res, next) {
    const h = req.headers.authorization;
    if (h && h.startsWith('Bearer ')) return webAuth(req, res, next);
    if (req.headers.token) return mobAuth(req, res, next);
    next(new HttpException(401, 'Access denied. No credentials sent!'));
  };
};
