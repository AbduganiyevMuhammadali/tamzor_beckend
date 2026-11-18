const multer = require('multer');
const path = require('path');
const fs = require('fs');

// To'lov chek rasmlari: beckend/uploads/kassa/ ga saqlanadi
const KASSA_DIR = path.join(__dirname, '../../uploads/kassa');
fs.mkdirSync(KASSA_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, KASSA_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.jpg';
    cb(null, `chek_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
  },
});

const uploadKassa = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },   // 10MB, 1 rasm
  fileFilter: (req, file, cb) => {
    cb(null, /^image\//.test(file.mimetype));
  },
});

module.exports = uploadKassa;
