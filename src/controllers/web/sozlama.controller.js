const SozlamaModel = require('../../models/sozlama.model');
const HttpException = require('../../utils/HttpException.utils');
const { DEFAULT_KURS } = require('../../utils/kurs.utils');
const { ochirishParoli, ochirishParoliniYoz } = require('../../utils/xavfsizlik.utils');
const { qoidalar: reytingQoidalari, qoidalarniYoz: reytingQoidalariniYoz } = require('../../utils/reyting.utils');

class SozlamaController {
  // GET /sozlama/kurs → { kurs, izoh, updatedAt }
  getKurs = async (req, res) => {
    const row = await SozlamaModel.findByPk('dollar_kurs');
    res.send({
      kurs: row ? parseFloat(row.qiymat) : DEFAULT_KURS,
      izoh: row?.izoh || null,
      updatedAt: row?.updatedAt || null,
    });
  };

  // PATCH /sozlama/kurs — body: { kurs }
  updateKurs = async (req, res) => {
    const kurs = parseFloat(req.body.kurs);
    if (!kurs || kurs <= 0) throw new HttpException(400, "Kurs musbat son bo'lishi kerak");

    const [row] = await SozlamaModel.findOrCreate({
      where: { kalit: 'dollar_kurs' },
      defaults: { qiymat: String(kurs), izoh: "1 USD necha so'm (prixodda $ narx kiritilganda ishlatiladi)" },
    });
    await row.update({ qiymat: String(kurs) });

    res.send({ kurs, izoh: row.izoh, updatedAt: row.updatedAt });
  };

  // ── Chek (80 mm termo printer, XP-80C) rekvizitlari ──────────────
  // sozlama jadvalida chek_nomi / chek_telefon / chek_manzil / chek_izoh kalitlari
  // GET /sozlama/chek → { nomi, telefon, manzil, izoh }
  getChek = async (req, res) => {
    const rows = await SozlamaModel.findAll({ where: { kalit: CHEK_KALITLAR.map(k => 'chek_' + k) }, raw: true });
    const m = Object.fromEntries(rows.map(r => [r.kalit.replace('chek_', ''), r.qiymat]));
    res.send({ nomi: m.nomi || '', telefon: m.telefon || '', manzil: m.manzil || '', izoh: m.izoh || '' });
  };

  // PATCH /sozlama/chek — body: { nomi, telefon, manzil, izoh } (Admin)
  updateChek = async (req, res) => {
    const b = req.body || {};
    for (const k of CHEK_KALITLAR) {
      if (b[k] === undefined) continue;
      const qiymat = String(b[k] ?? '').trim().slice(0, 255);
      const [row] = await SozlamaModel.findOrCreate({ where: { kalit: 'chek_' + k }, defaults: { qiymat, izoh: CHEK_IZOH[k] } });
      await row.update({ qiymat });
    }
    return this.getChek(req, res);
  };

  // ── Xavfsizlik: o'chirish paroli (utils/xavfsizlik.utils.js) — faqat Admin ──
  // GET /sozlama/xavfsizlik → { ochirish_parol }
  getXavfsizlik = async (req, res) => {
    const row = await SozlamaModel.findByPk('ochirish_parol');
    res.send({ ochirish_parol: await ochirishParoli(), updatedAt: row?.updatedAt || null });
  };

  // ── Mijoz reytingi ballari (utils/reyting.utils.js) ──
  // GET /sozlama/reyting → { buyurtma, rad_etildi, tolov_surildi, tolov_qabul, kritik_soni, darajalar, … }
  getReyting = async (req, res) => res.send(await reytingQoidalari());
  // PATCH /sozlama/reyting — body: shu kalitlardan istalgani (Admin)
  updateReyting = async (req, res) => res.send(await reytingQoidalariniYoz(req.body || {}));

  // PATCH /sozlama/xavfsizlik — body: { ochirish_parol }
  updateXavfsizlik = async (req, res) => {
    await ochirishParoliniYoz(req.body?.ochirish_parol);
    return this.getXavfsizlik(req, res);
  };
}

const CHEK_KALITLAR = ['nomi', 'telefon', 'manzil', 'izoh'];
const CHEK_IZOH = {
  nomi: 'Chek sarlavhasidagi firma nomi', telefon: 'Chekdagi telefon', manzil: 'Chekdagi manzil',
  izoh: 'Chek oxiridagi matn (masalan: Xaridingiz uchun rahmat!)',
};

module.exports = new SozlamaController();
