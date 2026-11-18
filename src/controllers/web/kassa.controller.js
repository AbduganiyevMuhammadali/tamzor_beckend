const { Op, fn, col } = require('sequelize');
const { reytingYoz, reytingQaytar } = require('../../utils/reyting.utils');
const sequelize = require('../../db/db-sequelize');
const KassaModel = require('../../models/kassa.model');
const { MijozModel } = require('../../models/mijoz.model');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { xarajatTurlari } = require('../../utils/xarajat.utils');

// Kategoriya yorliqlari (frontda ko'rsatish uchun)
const KATEGORIYA = {
  sotuv:             { label: 'Sotuv (naqd)',        tur: 'kirim' },
  mijoz_tolov:       { label: 'Mijoz to\'lovi',       tur: 'kirim' },
  dostavchik_inkassatsiya: { label: 'Dostavchik naqd topshirdi', tur: 'chiqim' },
  boshqa_daromad:    { label: 'Boshqa daromad',       tur: 'kirim' },
  boshlangich_kapital: { label: 'Boshlang\'ich qoldiq (kapital)', tur: 'kirim' },   // tizimga o'tishdagi pul / egadan kiritilgan — daromad emas
  yetkazuvchi_tolov: { label: 'Yetkazuvchiga to\'lov', tur: 'chiqim' },
  xarajat:           { label: 'Xarajat',              tur: 'chiqim' },
  ish_haqi:          { label: 'Ish haqi',             tur: 'chiqim' },
  ijara:             { label: 'Ijara',                tur: 'chiqim' },
  boshqa_chiqim:     { label: 'Boshqa chiqim',        tur: 'chiqim' },
  ishlab_chiqarish:  { label: 'Ishlab chiqarish xarajati', tur: 'chiqim' },
  // Moliya → Qarz oldi-berdi (uchinchi shaxslar): daromad ham, xarajat ham emas — qarz harakati
  qarz_berildi:      { label: 'Qarz berildi',            tur: 'chiqim' },
  qarz_qaytdi:       { label: 'Berilgan qarz qaytdi',    tur: 'kirim' },
  qarz_olindi:       { label: 'Qarz olindi',             tur: 'kirim' },
  qarz_qaytarildi:   { label: 'Olingan qarz qaytarildi', tur: 'chiqim' },
};

function periodRange(period, from_q, to_q) {
  const now = new Date();
  let from = new Date(now.getFullYear(), now.getMonth(), 1);
  let to   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (from_q || to_q) {
    from = from_q ? new Date(from_q + 'T00:00:00') : new Date(2000, 0, 1);
    to   = to_q   ? new Date(to_q   + 'T23:59:59') : now;
  } else if (period === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    to   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  } else if (period === 'week') {
    const d = now.getDay() || 7;
    from = new Date(now); from.setDate(now.getDate() - d + 1); from.setHours(0,0,0,0);
  } else if (period === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
    to   = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  }
  return { from, to };
}

class KassaController extends BaseController {

  // ── GET /kassa — hisobot (kirim/chiqim ro'yxati + jami) ──
  hisobot = async (req, res) => {
    const { period = 'month', from: fq, to: tq, tur, kategoriya, search } = req.query;
    const { from, to } = periodRange(period, fq, tq);

    const where = { sana: { [Op.between]: [from, to] } };
    if (tur)        where.tur = tur;
    if (kategoriya) where.kategoriya = kategoriya;
    if (search) {
      where[Op.or] = [
        { mijoz_nomi: { [Op.like]: `%${search}%` } },
        { izoh:       { [Op.like]: `%${search}%` } },
      ];
    }

    const rows = await KassaModel.findAll({ where, order: [['sana', 'DESC'], ['id', 'DESC']] });
    // Xarajat toifalari nomi — foydalanuvchi o'zgartirgan bo'lishi mumkin (Moliya → Kunlik xarajatlar → Toifalar)
    const turlar = await xarajatTurlari();
    const yorliq = k => turlar.get(k)?.nomi || KATEGORIYA[k]?.label || k;

    const kirim  = rows.filter(r => r.tur === 'kirim').reduce((s, r) => s + r.summa, 0);
    const chiqim = rows.filter(r => r.tur === 'chiqim').reduce((s, r) => s + r.summa, 0);

    // Kategoriya bo'yicha taqsimot
    const byKat = {};
    for (const r of rows) {
      const k = r.kategoriya;
      if (!byKat[k]) byKat[k] = { kategoriya: k, label: yorliq(k), tur: r.tur, summa: 0, soni: 0 };
      byKat[k].summa += r.summa;
      byKat[k].soni  += 1;
    }

    res.send({
      jami: {
        kirim,
        chiqim,
        qoldiq: kirim - chiqim,
        soni:   rows.length,
      },
      kategoriyalar: Object.values(byKat).sort((a, b) => b.summa - a.summa),
      harakatlar: rows.map(r => ({
        ...r.toJSON(),
        kategoriya_label: yorliq(r.kategoriya),
      })),
    });
  };

  // ── GET /kassa/kpi — umumiy qoldiq (period berilmasdan jami) ──
  kpi = async (req, res) => {
    const row = await KassaModel.findAll({
      attributes: ['tur', [fn('SUM', col('summa')), 'jami']],
      group: ['tur'], raw: true,
    });
    let kirim = 0, chiqim = 0;
    for (const r of row) {
      if (r.tur === 'kirim')  kirim  = parseFloat(r.jami || 0);
      if (r.tur === 'chiqim') chiqim = parseFloat(r.jami || 0);
    }
    res.send({ kirim, chiqim, qoldiq: kirim - chiqim });
  };

  // ── POST /kassa — qo'lda kirim/chiqim yoki mijoz to'lovi ──
  create = async (req, res) => {
    const { tur, kategoriya, summa, tolov_usul, mijoz_id, izoh, sana } = req.body;
    if (!tur || !['kirim','chiqim'].includes(tur)) throw new HttpException(400, 'Tur noto\'g\'ri');
    if (!kategoriya) throw new HttpException(400, 'Kategoriya kerak');
    if (!summa || Number(summa) <= 0) throw new HttpException(400, 'Summa noto\'g\'ri');

    const t = await sequelize.transaction();
    try {
      let mijoz_nomi = null, eskiBalans = null;
      // Mijoz to'lovi bo'lsa — balansni oshiramiz (qarz kamayadi)
      if (kategoriya === 'mijoz_tolov' && mijoz_id) {
        const m = await MijozModel.findByPk(mijoz_id, { transaction: t });
        if (m) {
          mijoz_nomi = m.nomi;
          eskiBalans = parseFloat(m.balans) || 0;
          await m.increment('balans', { by: Number(summa), transaction: t });
        }
      }

      const rec = await KassaModel.create({
        tur,
        kategoriya,
        summa:      Number(summa),
        tolov_usul: tolov_usul || 'naqt',
        manba_tur:  kategoriya === 'mijoz_tolov' ? 'mijoz' : 'qol',
        manba_id:   kategoriya === 'mijoz_tolov' ? (mijoz_id || null) : null,
        mijoz_id:   mijoz_id || null,
        mijoz_nomi,
        izoh:       izoh || null,
        sana:       sana ? new Date(sana) : new Date(),
        user_id:    req.currentUser?.id || null,
      }, { transaction: t });

      // Mijoz reytingi: qarzdor mijoz to'ladi (+ball, kuniga bir marta; to'lov o'chirilsa qaytadi)
      if (eskiBalans !== null && eskiBalans < -0.5) {
        const u = req.currentUser || {};
        await reytingYoz(mijoz_id, {
          tur: 'tolov_qabul', sabab: "Qarz to'lovi (kassa)", summa: Number(summa), manba_tur: 'kassa', manba_id: rec.id,
          qarzYopildi: eskiBalans + Number(summa) >= -0.5,
          xodim: { rol: 'web', id: u.id || null, nomi: u.username || u.fullname || null }, sana: rec.sana,
        }, t);
      }

      await t.commit();
      res.status(201).send(rec);
    } catch (e) {
      await t.rollback();
      throw e;
    }
  };

  // ── DELETE /kassa/:id — faqat qo'lda kiritilganlarni o'chirish ──
  delete = async (req, res) => {
    const rec = await KassaModel.findByPk(req.params.id);
    if (!rec) throw new HttpException(404, 'Topilmadi');
    if (rec.manba_tur === 'uchinchi_shaxs') {
      throw new HttpException(400, "Bu qarz oldi-berdi yozuvi — Moliya → Qarz oldi-berdi bo'limidan o'chiring (shaxs hisobi ham to'g'rilanadi)");
    }
    if (!['qol', 'mijoz', 'xarajat'].includes(rec.manba_tur)) {
      throw new HttpException(400, 'Avtomatik yozuvni o\'chirib bo\'lmaydi (sotuv/prixod)');
    }
    const t = await sequelize.transaction();
    try {
      // Mijoz to'lovi bo'lsa — balansni qaytaramiz
      if (rec.kategoriya === 'mijoz_tolov' && rec.mijoz_id) {
        await MijozModel.decrement('balans', { by: rec.summa, where: { id: rec.mijoz_id }, transaction: t });
        await reytingQaytar({ manba_tur: 'kassa', manba_id: rec.id }, t);
      }
      await rec.destroy({ transaction: t });
      await t.commit();
      res.send({ message: 'O\'chirildi' });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  };
}

module.exports = new KassaController();
