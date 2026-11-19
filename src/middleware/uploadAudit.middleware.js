const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { rasmKengaytma, tasodifiyNom } = require('./rasmYuklash.utils');

// Audit rasmlari: beckend/uploads/audit/ ga saqlanadi
const AUDIT_DIR = path.join(__dirname, '../../uploads/audit');
fs.mkdirSync(AUDIT_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, AUDIT_DIR),
  filename: (req, file, cb) => cb(null, tasodifiyNom('audit', file.mimetype)),
});

const uploadAudit = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 10 },   // 10MB, max 10 rasm
  fileFilter: (req, file, cb) => {
    // faqat rasm fayllari
    cb(null, !!rasmKengaytma(file.mimetype));
  },
});

module.exports = uploadAudit;
