/**
 * LOGIN RATE LIMIT — parol tanlash (brute force) hujumidan himoya.
 *
 * Xotirada (in-memory, yangi npm paketisiz) IP + login juftligi bo'yicha muvaffaqiyatsiz
 * urinishlar sanaladi. Oyna ichida `maks` marta xato bo'lsa — oyna tugaguncha 429.
 * Muvaffaqiyatli kirishda hisoblagich tozalanadi.
 *
 * Natija javobdan aniqlanadi (controller'ga tegilmaydi):
 *   • HTTP status 400/401 → xato urinish;
 *   • mobil konvert (HTTP 200, body.error === true, error_code 400/401/405) → xato urinish;
 *   • 2xx va error emas → muvaffaqiyat (hisoblagich tozalanadi).
 * Boshqa xatolar (403 rol o'chirilgan, 500) hisoblanmaydi.
 *
 * Eslatma: server bitta jarayonda ishlaydi deb faraz qilinadi (cluster/PM2 bir necha
 * nusxada har biri o'z hisobini yuritadi). Proksi ortida `app.set('trust proxy', …)`
 * sozlanmagan bo'lsa req.ip proksi manzili bo'ladi — u holda cheklov amalda login bo'yicha.
 */
const HttpException = require('../utils/HttpException.utils');

const XATO_STATUS = new Set([400, 401, 405]);
const MAKS_KALIT = 50000;   // xotira o'sib ketmasligi uchun

function loginRateLimit({
  maks = 10,
  oynaMs = 15 * 60 * 1000,
  loginMaydoni = (req) => (req.body && (req.body.login ?? req.body.username)) || '',
} = {}) {
  const urinishlar = new Map();   // kalit → { soni, boshi }

  // Eskirgan yozuvlarni vaqti-vaqti bilan tozalash (jarayon chiqishini ushlab turmaydi)
  const tozalash = setInterval(() => {
    const hozir = Date.now();
    for (const [k, v] of urinishlar) if (hozir - v.boshi >= oynaMs) urinishlar.delete(k);
  }, Math.min(oynaMs, 5 * 60 * 1000));
  if (tozalash.unref) tozalash.unref();

  return function (req, res, next) {
    const ip = req.ip || (req.socket && req.socket.remoteAddress) || '';
    const login = String(loginMaydoni(req) || '').trim().toLowerCase().slice(0, 100);
    const kalit = `${ip}|${login}`;
    const hozir = Date.now();

    let yozuv = urinishlar.get(kalit);
    if (yozuv && hozir - yozuv.boshi >= oynaMs) { urinishlar.delete(kalit); yozuv = null; }
    if (yozuv && yozuv.soni >= maks) {
      const qoldi = Math.max(1, Math.ceil((yozuv.boshi + oynaMs - hozir) / 60000));
      res.set('Retry-After', String(qoldi * 60));
      return next(new HttpException(429,
        `Juda ko'p muvaffaqiyatsiz urinish. ${qoldi} daqiqadan keyin qayta urinib ko'ring`));
    }

    // Javob natijasini bir marta aniqlaymiz (res.send → res.json → res.send zanjiri)
    let aniqlandi = false;
    const asl = res.send;
    res.send = function (body) {
      if (!aniqlandi) {
        aniqlandi = true;
        try {
          let b = body;
          if (typeof b === 'string' || Buffer.isBuffer(b)) {
            try { b = JSON.parse(b.toString()); } catch (e) { b = null; }
          }
          const status = res.statusCode;
          const mobilXato = b && typeof b === 'object' && b.error === true;
          const xatoKod = mobilXato ? Number(b.error_code) : status;
          if ((status >= 400 || mobilXato) && XATO_STATUS.has(xatoKod)) {
            const y = urinishlar.get(kalit);
            if (y && Date.now() - y.boshi < oynaMs) y.soni += 1;
            else if (urinishlar.size < MAKS_KALIT) urinishlar.set(kalit, { soni: 1, boshi: Date.now() });
          } else if (status < 300 && !mobilXato) {
            urinishlar.delete(kalit);
          }
        } catch (e) { /* hisoblagich xatosi javobni buzmasin */ }
      }
      return asl.apply(this, arguments);
    };
    next();
  };
}

module.exports = { loginRateLimit };
