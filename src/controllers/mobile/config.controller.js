const { ok, raw } = require('./shared');

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
}

module.exports = new MobileConfigController();
