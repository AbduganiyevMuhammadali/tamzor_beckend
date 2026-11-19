const TovarModel = require('../../models/tovar.model');
const { AuditModel } = require('../../models/hisobot.model');
const { MijozModel } = require('../../models/mijoz.model');
const { Op, fn, col } = require('sequelize');
const HttpException = require('../../utils/HttpException.utils');
const { ok, SABABLAR, koordinataJuft } = require('./shared');
const { ochiqRollar, rolOchiqEmasXabari } = require('../../utils/mobilRollar.utils');

/* Mobil audit sanasi: "2026.11.19", "2026-11-19", "19.11.2026" (vaqt bilan ham) yoki ISO.
   Berilmasa — hozir. Berilgan, lekin tushunarsiz bo'lsa — 400 (avval Invalid Date bazaga
   yetib, 500 qaytarardi). */
function auditSana(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return new Date();
  const s = String(raw).trim();
  let d = null;
  let m = s.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m) d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  if (!d && (m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:[ T]|\/\/)?(?:(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/))) {
    d = new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  }
  if (!d) d = new Date(s);
  if (isNaN(d.getTime()) || d.getFullYear() < 2000 || d.getFullYear() > 2100) {
    throw new HttpException(400, "Sana noto'g'ri");
  }
  return d;
}

/* ── Audit (hujjat 3.6, 3.7, 8.1, 8.2) ────────────────────────────────────── */
class MobileAuditController {
  // 3.7 getReason/ → [{ id, name, tip }]  (asl server formati: tip = "Причина"/"Визить")
  getReason = async (req, res, next) => {
    ok(res, SABABLAR);
  };

  // 3.6 getBrends/ → [{ id, name, count, tip }]  (tovar.brend dan distinct)
  getBrends = async (req, res, next) => {
    const rows = await TovarModel.findAll({
      attributes: [[fn('DISTINCT', col('brend')), 'brend']],
      where: { faol: true, turi: 'tovar', brend: { [Op.ne]: null } },
      order: [['brend', 'ASC']],
      raw: true,
    });
    const data = rows
      .map(r => r.brend)
      .filter(Boolean)
      .map((name, i) => ({ id: String(i + 1), name, count: 0, tip: '' }));
    ok(res, data);
  };

  // 8.2 SendMedia/ → rasmlarni saqlab, audit yozuviga bog'laydi
  // Multipart (img[]) route'da multer orqali qabul qilinadi.
  // Rasm faqat JORIY xodimning shu mijoz (yoki aniq audit_id) bo'yicha audit yozuviga
  // qo'shiladi — klient_id'siz butun tizimdagi oxirgi auditga yozib yuborilmaydi.
  sendMedia = async (req, res, next) => {
    const { klient_id, date, comment, reason_id } = req.query;
    const auditId = req.query.audit_id || req.query.auditId || null;
    const agent = req.currentAgent || {};
    if (!agent.id) throw new HttpException(401, 'Avtorizatsiya kerak');
    if (!klient_id && !auditId) throw new HttpException(400, 'klient_id majburiy');
    const yollar = (req.files || []).map(f => `/uploads/audit/${f.filename}`);

    if (yollar.length) {
      const sana = auditSana(date);
      // Shu xodim + klient (yoki aniq audit_id) uchun oxirgi audit yozuvi (chekUp dan kelgan)
      const where = { agent_id: agent.id };
      if (auditId) where.id = auditId;
      if (klient_id) where.mijoz_id = klient_id;
      const mavjud = await AuditModel.findOne({
        where, order: [['id', 'DESC']],
      });
      if (auditId && !mavjud) throw new HttpException(404, 'Audit topilmadi');

      // Bir kunlik yozuv bo'lsa (yoki audit_id aniq berilgan bo'lsa) rasmlarni unga qo'shamiz, aks holda yangi yozuv
      const birKunlikmi = mavjud && (auditId || (mavjud.sana
        && new Date(mavjud.sana).toDateString() === sana.toDateString()));
      if (birKunlikmi) {
        await mavjud.update({ rasmlar: [...(mavjud.rasmlar || []), ...yollar] });
      } else {
        const mijoz = await MijozModel.findByPk(klient_id);
        if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
        await AuditModel.create({
          agent_id: agent.id,
          agent_nomi: agent.fullname || agent.ism || null,
          mijoz_id: mijoz.id,
          mijoz_nomi: mijoz.nomi,
          sabab: reason_id || null,
          shikoyat: comment || null,
          rasmlar: yollar,
          tovarlar: [],
          sana,
        });
      }
    }

    ok(res, { date: date || '' });
  };

  // 8.1 chekUp/ → audit natijasini DB'ga saqlaydi
  chekUp = async (req, res, next) => {
    const b = req.body || {};
    const agent = req.currentAgent || {};
    // Audit faqat audit roli ochiq foydalanuvchiga (login `rollar`). Avval istalgan token
    // istalgan mijoz nomidan audit yozardi.
    if (!ochiqRollar(agent, req.currentRole).includes('audit')) {
      throw new HttpException(403, rolOchiqEmasXabari('audit'));
    }
    const mijoz = b.client_id ? await MijozModel.findByPk(b.client_id) : null;
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    const sana = auditSana(b.date);
    const nuqta = koordinataJuft(b.lat, b.long ?? b.lng);   // noto'g'ri koordinata e'tiborsiz

    await AuditModel.create({
      agent_id:     agent.id || null,
      agent_nomi:   agent.fullname || null,
      mijoz_id:     b.client_id || null,
      mijoz_nomi:   mijoz ? mijoz.nomi : null,
      maydon:       b.area ?? null,
      stend:        b.stend ?? null,
      biz_bilan:    b.shopWithUs ?? null,
      bizsiz:       b.showWithoutUs ?? null,
      sabab:        b.reason ?? null,
      shikoyat:     b.complaint ?? null,
      taklif:       b.offer ?? null,
      kirish_vaqt:  b.enterTime ?? null,
      chiqish_vaqt: b.exitTime ?? null,
      lat:          nuqta ? nuqta.lat : null,
      lng:          nuqta ? nuqta.lng : null,
      tovarlar:     Array.isArray(b.goods) ? b.goods : [],
      rasmlar:      [],
      sana,
    });

    ok(res, { date: b.date || '' });
  };
}

module.exports = new MobileAuditController();
