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

/**
 * TO'LOV CHEKI (2026-11-24): rasm YOKI hujjat — oq ro'yxat. PDF va Office (doc/docx/xls/xlsx).
 * HTML, SVG, skript, bajariladigan fayllar qabul qilinmaydi. Kengaytma MIME turidan olinadi;
 * telefon ba'zan hujjatni `application/octet-stream` deb yuboradi — shunda fayl nomining kengaytmasi
 * oq ro'yxatda bo'lsagina qabul qilinadi (saqlangan nomda baribir oq ro'yxatdagi kengaytma).
 * Fayl /uploads orqali nosniff + CSP sandbox bilan beriladi.
 */
const HUJJAT_TURLARI = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};
const CHEK_KENGAYTMALAR = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.pdf', '.doc', '.docx', '.xls', '.xlsx'];
function chekKengaytma(file) {
  const mime = String((file && file.mimetype) || '').toLowerCase();
  const k = RASM_TURLARI[mime] || HUJJAT_TURLARI[mime];
  if (k) return k;
  if (mime === 'application/octet-stream') {
    const m = /\.([A-Za-z0-9]{1,5})$/.exec(String((file && file.originalname) || ''));
    const e = m ? `.${m[1].toLowerCase()}` : null;
    if (e && CHEK_KENGAYTMALAR.includes(e)) return e === '.jpeg' ? '.jpg' : e;
  }
  return null;
}

/** Taxmin qilib bo'lmaydigan fayl nomi (kengaytma — mimetype'dan yoki tayyor '.pdf' kabi qiymat) */
const tasodifiyNom = (prefiks, mimetype, kengaytma = null) =>
  `${prefiks}_${Date.now()}_${crypto.randomBytes(12).toString('hex')}${kengaytma || rasmKengaytma(mimetype) || '.jpg'}`;

module.exports = { rasmKengaytma, chekKengaytma, CHEK_KENGAYTMALAR, tasodifiyNom };
