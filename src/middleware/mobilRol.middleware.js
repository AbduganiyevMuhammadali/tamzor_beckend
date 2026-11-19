const HttpException = require('../utils/HttpException.utils');
const { rolYoqilgan, rolOchiqEmasXabari } = require('../utils/mobilRollar.utils');

/* Route guruhi faqat .env (MOBIL_ROLLAR) da yoqilgan rol uchun ochiq.
 * mobileAuth() dan keyin qo'yiladi. Foydalanuvchining shu rolga huquqi borligini
 * controller o'zi tekshiradi — bu yerda faqat server sozlamasi. */
const mobilRol = (rol) => (req, res, next) => {
  if (!rolYoqilgan(rol)) return next(new HttpException(403, rolOchiqEmasXabari(rol)));
  next();
};

module.exports = mobilRol;
