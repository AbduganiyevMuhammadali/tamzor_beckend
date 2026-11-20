const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { rasmKengaytma, chekKengaytma, tasodifiyNom } = require('./rasmYuklash.utils');

// To'lov cheklari: beckend/uploads/kassa/ ga saqlanadi
const KASSA_DIR = path.join(__dirname, '../../uploads/kassa');
fs.mkdirSync(KASSA_DIR, { recursive: true });

/* uploadKassa — to'lov cheki (mobil chekYuklash/savePayment, web /kassalar/chek-yuklash):
   rasm yoki hujjat (pdf, doc, docx, xls, xlsx) — oq ro'yxat, rasmYuklash.utils.chekKengaytma.
   10MB, 1 fayl. */
const uploadKassa = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, KASSA_DIR),
    filename: (req, file, cb) => cb(null, tasodifiyNom('chek', file.mimetype, chekKengaytma(file))),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!chekKengaytma(file)),
});

/* uploadKassa.rasm — faqat rasm (xarajat cheki — avvalgidek o'zgarmadi) */
uploadKassa.rasm = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, KASSA_DIR),
    filename: (req, file, cb) => cb(null, tasodifiyNom('chek', file.mimetype)),
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => cb(null, !!rasmKengaytma(file.mimetype)),
});

uploadKassa.KASSA_DIR = KASSA_DIR;
module.exports = uploadKassa;
