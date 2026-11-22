const HttpException = require('../utils/HttpException.utils');

/* WEB SAHIFA RUXSATI (2026-11-24) — auth() dan KEYIN qo'yiladi.
   Frontend bilan bir xil qoida (tamzor_front/src/stores/auth.ts → hasPerm):
     - Admin va Programmer — hamma narsa ochiq;
     - qolganlar — user.perms JSON'ida { modul: ['amal', ...] } bo'lsa.
   Ruxsat yo'q → 403 "Ruxsat yo'q".
   Bir nechta amal berilsa (ruxsat('moliya', 'approve', 'create')) — bittasi yetarli. */
const TOLIQ = ['Admin', 'Programmer'];

function ruxsatBormi(user, modul, amallar) {
  if (!user) return false;
  if (TOLIQ.includes(user.role)) return true;
  let perms = user.perms;
  if (typeof perms === 'string') { try { perms = JSON.parse(perms); } catch (e) { perms = null; } }
  if (!perms || typeof perms !== 'object') return false;
  const bor = perms[modul];
  return Array.isArray(bor) && amallar.some(a => bor.includes(a));
}

const ruxsat = (modul, ...amallar) => {
  const list = amallar.length ? amallar : ['view'];
  return function (req, res, next) {
    if (!req.currentUser) return next(new HttpException(401, 'Authentication failed!'));
    if (!ruxsatBormi(req.currentUser, modul, list)) return next(new HttpException(403, "Ruxsat yo'q"));
    next();
  };
};

/* Bir nechta moduldan istalgan biri yetarli (2026-11-26):
     ruxsat.biri([['avtolavka', 'create'], ['ombor', 'edit']])
   Har element — [modul, amal] yoki [modul, [amal1, amal2]]. Admin/Programmer — doim ochiq. */
ruxsat.biri = (variantlar) => {
  const list = (variantlar || []).map(([modul, amal]) => [modul, Array.isArray(amal) ? amal : [amal || 'view']]);
  return function (req, res, next) {
    if (!req.currentUser) return next(new HttpException(401, 'Authentication failed!'));
    if (!list.some(([modul, amallar]) => ruxsatBormi(req.currentUser, modul, amallar))) return next(new HttpException(403, "Ruxsat yo'q"));
    next();
  };
};

ruxsat.ruxsatBormi = ruxsatBormi;
module.exports = ruxsat;
