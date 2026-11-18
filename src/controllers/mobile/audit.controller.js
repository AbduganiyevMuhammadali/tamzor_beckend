const TovarModel = require('../../models/tovar.model');
const { AuditModel } = require('../../models/hisobot.model');
const { MijozModel } = require('../../models/mijoz.model');
const { Op, fn, col } = require('sequelize');
const { ok, SABABLAR } = require('./shared');

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
  sendMedia = async (req, res, next) => {
    const { klient_id, date, comment, reason_id } = req.query;
    const agent = req.currentAgent || {};
    const yollar = (req.files || []).map(f => `/uploads/audit/${f.filename}`);

    if (yollar.length) {
      const sana = date ? new Date(String(date).replace(/\./g, '-')) : new Date();
      // Shu klient+sana uchun oxirgi audit yozuvini topamiz (chekUp dan kelgan)
      const where = {};
      if (klient_id) where.mijoz_id = klient_id;
      const mavjud = await AuditModel.findOne({
        where, order: [['id', 'DESC']],
      });

      // Bir kunlik yozuv bo'lsa rasmlarni unga qo'shamiz, aks holda yangi yozuv
      const birKunlikmi = mavjud && mavjud.sana
        && new Date(mavjud.sana).toDateString() === sana.toDateString();
      if (birKunlikmi) {
        await mavjud.update({ rasmlar: [...(mavjud.rasmlar || []), ...yollar] });
      } else {
        const mijoz = klient_id ? await MijozModel.findByPk(klient_id) : null;
        await AuditModel.create({
          agent_id: agent.id || null,
          agent_nomi: agent.fullname || agent.ism || null,
          mijoz_id: klient_id || null,
          mijoz_nomi: mijoz ? mijoz.nomi : null,
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
    const mijoz = b.client_id ? await MijozModel.findByPk(b.client_id) : null;

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
      lat:          b.lat ?? null,
      lng:          b.long ?? null,
      tovarlar:     Array.isArray(b.goods) ? b.goods : [],
      rasmlar:      [],
      sana:         b.date ? new Date(String(b.date).replace(/\./g, '-')) : new Date(),
    });

    ok(res, { date: b.date || '' });
  };
}

module.exports = new MobileAuditController();
