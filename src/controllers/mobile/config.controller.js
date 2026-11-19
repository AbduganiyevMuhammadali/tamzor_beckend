const { ok, raw } = require('./shared');
const SozlamaModel = require('../../models/sozlama.model');
const { mobilRollar, ROL_NOMI } = require('../../utils/mobilRollar.utils');
const { biznesRejim } = require('../../utils/rejim.utils');
const { SOTUV_RADIUS_M } = require('../../utils/geo.utils');

// mobilSozlama javobi o'zgarsa oshiriladi — ilova keshni qayta o'qish kerakligini biladi
const SOZLAMA_VERSIYA = 1;

/* ── BOOTSTRAP: server manzilini topish ──────────────────────────────────── */
class MobileConfigController {
  // 1.1 GET url1c — 1C server ip/port. KONVERTSIZ (to'g'ridan-to'g'ri obyekt).
  url1c = async (req, res, next) => {
    raw(res, {
      ip: process.env.MOBILE_API_IP || process.env.HOST || 'localhost',
      port: String(process.env.MOBILE_API_PORT || process.env.PORT || '3001'),
    });
  };

  // 1.2 GET LoadConfig — mijoz konfiguratsiyasi (data = konfiguratsiya obyekti).
  // Ilova bundan baseUrl = http://{ipaddress}:{ipport}/{href_address}/ ni quradi.
  loadConfig = async (req, res, next) => {
    const ip = process.env.MOBILE_API_IP || process.env.HOST || 'localhost';
    const port = String(process.env.MOBILE_API_PORT || process.env.PORT || '3001');
    const secret = req.query.secret_name || 'RashMilkNew';
    ok(res, {
      id: 1,
      secret_name: secret,
      ipaddress: ip,
      ipport: port,
      // Asl server kabi: base URL = http://{ip}:{port}/RashMilkNew/hs/AgentDostavshik/
      href_address: `${secret}/hs/AgentDostavshik`,
      mobile_username: process.env.MOBILE_USERNAME || 'mobiles',
      mobile_password: process.env.MOBILE_PASSWORD || '123',
    });
  };

  // GET mobilSozlama/ — yangi Flutter ilova server ulanganda BIR MARTA o'qiydi va keshlaydi.
  // Token kerak emas; maxfiy ma'lumot qaytarmaydi (parol, kalit yo'q).
  mobilSozlama = async (req, res, next) => {
    const rows = await SozlamaModel.findAll({
      where: { kalit: ['chek_nomi', 'chek_telefon', 'chek_manzil', 'chek_izoh'] }, raw: true,
    });
    const chek = Object.fromEntries(rows.map(r => [r.kalit.replace('chek_', ''), r.qiymat || '']));
    const rollar = mobilRollar();
    ok(res, {
      sozlamaVersiya: SOZLAMA_VERSIYA,
      serverVaqt: new Date().toISOString(),
      biznesRejim: biznesRejim(),
      rollar,
      rollarNomi: Object.fromEntries(rollar.map(r => [r, ROL_NOMI[r]])),
      minIlovaVersiya: String(process.env.MOBIL_MIN_VERSIYA || '1.0.0'),
      sotuvRadiusM: SOTUV_RADIUS_M,
      chek: { nomi: chek.nomi || '', telefon: chek.telefon || '', manzil: chek.manzil || '', izoh: chek.izoh || '' },
    });
  };
}

module.exports = new MobileConfigController();
