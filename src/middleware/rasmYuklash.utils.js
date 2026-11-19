const crypto = require('crypto');

/**
 * Faqat ruxsat etilgan rasm turlari. Fayl kengaytmasi mijoz yuborgan nomdan
 * EMAS, tekshirilgan MIME turidan olinadi — `x.html` ni `image/png` deb
 * yuborib, serverga HTML/skript joylab bo'lmaydi. SVG ruxsat etilmaydi
 * (ichida skript bo'lishi mumkin).
 */
const RASM_TURLARI = {
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/pjpeg': '.jpg',
  'image/png':  '.png',
  'image/webp': '.webp',
  'image/gif':  '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

const rasmKengaytma = (mimetype) => RASM_TURLARI[String(mimetype || '').toLowerCase()] || null;

/** Taxmin qilib bo'lmaydigan fayl nomi */
const tasodifiyNom = (prefiks, mimetype) =>
  `${prefiks}_${Date.now()}_${crypto.randomBytes(12).toString('hex')}${rasmKengaytma(mimetype) || '.jpg'}`;

module.exports = { rasmKengaytma, tasodifiyNom };
