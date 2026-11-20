/**
 * MOLIYA → KUNLIK XARAJATLAR: kassadan rasxod (benzin, ovqat, ijara, ish haqi …).
 * Har xarajat — `kassa` yozuvi (tur='chiqim', kategoriya = toifa kodi, manba_tur='xarajat'), shuning uchun
 * kassa qoldig'idan ayriladi va foyda-zarar hisobotida operatsion xarajat bo'lib ko'rinadi.
 * Kassa sahifasidan qo'lda kiritilgan xarajatlar (manba_tur='qol') ham shu ro'yxatda ko'rinadi.
 */
const fs = require('fs');
const path = require('path');
const sequelize = require('../../db/db-sequelize');
const KassaModel = require('../../models/kassa.model');
const XarajatTuriModel = require('../../models/xarajatTuri.model');
const HttpException = require('../../utils/HttpException.utils');
const U = require('../../utils/tahlil.utils');
const { xarajatTurlari } = require('../../utils/xarajat.utils');

const n = v => Number(v) || 0;
const yax = v => Math.round(n(v) * 100) / 100;
const USUL = ['naqt', 'karta', 'bank'];
const TAHRIR_MANBA = ['xarajat', 'qol'];
const Q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

/* Sana: bugun tanlansa — hozirgi vaqt, boshqa kun — o'sha kunning tushi (mahalliy) */
function sanaOl(v) {
  if (!v) return new Date();
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (s === U.kunKey(new Date())) return new Date();
    return new Date(`${s}T12:00:00`);
  }
  const d = new Date(s);
  if (isNaN(d)) throw new HttpException(400, "Sana noto'g'ri");
  return d;
}
function slug(nomi) {
  const s = String(nomi || '').toLowerCase().replace(/[ʻʼ‘’`´']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || 'toifa';
}
function rasmniOchir(fayl) {
  if (!fayl || !String(fayl).startsWith('/uploads/kassa/')) return;
  fs.unlink(path.join(__dirname, '../../..', fayl), () => {});
}

class XarajatController {

  /* GET /xarajatlar/turlar */
  turlar = async (req, res) => {
    const rows = await XarajatTuriModel.findAll({ order: [['tartib', 'ASC'], ['id', 'ASC']], raw: true });
    // Har toifa necha marta ishlatilgan (so'nggi 90 kun) — tez tanlash tugmalari tartibi uchun
    const d90 = new Date(Date.now() - 90 * 86400000);
    const son = await Q(`SELECT kategoriya, COUNT(*) AS soni FROM kassa WHERE tur = 'chiqim' AND sana >= :d90 GROUP BY kategoriya`, { d90 });
    const sMap = new Map(son.map(r => [r.kategoriya, n(r.soni)]));
    res.send(rows.map(r => ({ ...r, faol: !!r.faol, soni90: sMap.get(r.kod) || 0 })));
  };

  /* POST /xarajatlar/turlar { nomi, ikon } */
  turQosh = async (req, res) => {
    const nomi = String(req.body.nomi || '').trim().slice(0, 100);
    if (!nomi) throw new HttpException(400, 'Toifa nomi kiritilmagan');
    const bor = await XarajatTuriModel.findOne({ where: sequelize.where(sequelize.fn('LOWER', sequelize.col('nomi')), nomi.toLowerCase()) });
    if (bor) throw new HttpException(400, `"${bor.nomi}" toifasi allaqachon bor`);
    let kod = slug(nomi), i = 2;
    while (await XarajatTuriModel.count({ where: { kod } }) || ['boshqa_chiqim', 'qarz_berildi', 'qarz_qaytarildi', 'yetkazuvchi_tolov', 'ishlab_chiqarish', 'sotuv', 'sotuv_qaytarish', 'mijoz_tolov'].includes(kod)) kod = `${slug(nomi).slice(0, 36)}_${i++}`;
    const max = await XarajatTuriModel.max('tartib');
    const t = await XarajatTuriModel.create({ kod, nomi, ikon: req.body.ikon || 'boshqa', tartib: n(max) + 1, faol: true });
    res.status(201).send(t);
  };

  /* PATCH /xarajatlar/turlar/:id { nomi, ikon, faol, tartib } — kod o'zgarmaydi */
  turTahrir = async (req, res) => {
    const t = await XarajatTuriModel.findByPk(req.params.id);
    if (!t) throw new HttpException(404, 'Toifa topilmadi');
    const u = {};
    if (req.body.nomi !== undefined) { const nomi = String(req.body.nomi || '').trim().slice(0, 100); if (!nomi) throw new HttpException(400, 'Toifa nomi kiritilmagan'); u.nomi = nomi; }
    if (req.body.ikon !== undefined) u.ikon = String(req.body.ikon || 'boshqa').slice(0, 30);
    if (req.body.faol !== undefined) u.faol = !!req.body.faol;
    if (req.body.tartib !== undefined) u.tartib = parseInt(req.body.tartib, 10) || 0;
    await t.update(u);
    res.send(t);
  };

  /* GET /xarajatlar?dan&gacha&kategoriya&search — davr xarajatlari + tahlil */
  royxat = async (req, res) => {
    const D = U.davr(req.query, 1);
    const turlar = await xarajatTurlari();
    const kodlar = [...turlar.keys()];
    const shart = ['k.tur = \'chiqim\'', 'k.kategoriya IN (:kodlar)'];
    const rep = { kodlar, from: D.from, to: D.to, tz: D.tz };
    if (req.query.kategoriya && turlar.has(req.query.kategoriya)) { shart.push('k.kategoriya = :kat'); rep.kat = req.query.kategoriya; }
    if (req.query.search) { shart.push('k.izoh LIKE :q'); rep.q = `%${req.query.search}%`; }
    const asos = shart.join(' AND ');
    const d30 = new Date(Date.now() - 30 * 86400000);
    const [rows, kunlar, kassa, oy30] = await Promise.all([
      Q(`SELECT k.id, k.sana, k.kategoriya, k.summa, k.tolov_usul, k.izoh, k.chek_rasm, k.manba_tur, k.user_id,
                COALESCE(u.fullname, u.username) AS kim
         FROM kassa k LEFT JOIN user u ON u.id = k.user_id
         WHERE ${asos} AND k.sana BETWEEN :from AND :to ORDER BY k.sana DESC, k.id DESC`, rep),
      Q(`SELECT DATE_FORMAT(CONVERT_TZ(k.sana, '+00:00', :tz), '%Y-%m-%d') AS kun, SUM(k.summa) AS summa, COUNT(*) AS soni
         FROM kassa k WHERE ${asos} AND k.sana BETWEEN :from AND :to GROUP BY kun ORDER BY kun`, rep),
      Q(`SELECT tolov_usul, COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END), 0) AS qoldiq FROM kassa GROUP BY tolov_usul`),
      Q(`SELECT COALESCE(SUM(k.summa), 0) AS summa FROM kassa k WHERE k.tur = 'chiqim' AND k.kategoriya IN (:kodlar) AND k.sana >= :d30`, { kodlar, d30 }),
    ]);
    const tur = k => turlar.get(k) || { nomi: k, ikon: 'boshqa' };
    const jami = rows.reduce((a, r) => a + n(r.summa), 0);
    const tMap = new Map();
    for (const r of rows) {
      const key = r.kategoriya === 'boshqa_chiqim' ? 'xarajat' : r.kategoriya;
      const x = tMap.get(key) || { kod: key, nomi: tur(key).nomi, ikon: tur(key).ikon, summa: 0, soni: 0 };
      x.summa += n(r.summa); x.soni++; tMap.set(key, x);
    }
    const kMap = Object.fromEntries(kassa.map(r => [r.tolov_usul, yax(r.qoldiq)]));
    res.send({
      davr: { dan: D.dan, gacha: D.gacha, kunlar: D.kunlar },
      jami: { summa: yax(jami), soni: rows.length, kunlik: yax(jami / D.kunlar) },
      ortacha30: yax(n(oy30[0]?.summa) / 30),
      kassa: { naqt: kMap.naqt || 0, karta: kMap.karta || 0, bank: kMap.bank || 0, jami: yax((kMap.naqt || 0) + (kMap.karta || 0) + (kMap.bank || 0)) },
      toifalar: [...tMap.values()].map(x => ({ ...x, summa: yax(x.summa), ulush: jami > 0 ? Math.round(x.summa / jami * 1000) / 10 : 0 })).sort((a, b) => b.summa - a.summa),
      kunlar: kunlar.map(k => ({ kun: k.kun, summa: yax(k.summa), soni: n(k.soni) })),
      rows: rows.map(r => ({
        id: r.id, sana: r.sana, kategoriya: r.kategoriya, nomi: tur(r.kategoriya).nomi, ikon: tur(r.kategoriya).ikon,
        summa: yax(r.summa), tolov_usul: r.tolov_usul, izoh: r.izoh || '', chek_rasm: r.chek_rasm || null,
        manba: r.manba_tur, kim: r.kim || '', tahrir: TAHRIR_MANBA.includes(r.manba_tur),
      })),
    });
  };

  /* POST /xarajatlar (multipart: kategoriya, summa, tolov_usul, sana, izoh, rasm?) */
  create = async (req, res) => {
    try {
      const turlar = await xarajatTurlari();
      const t = turlar.get(req.body.kategoriya);
      if (!t || t.alias) throw new HttpException(400, 'Xarajat toifasini tanlang');
      if (!t.faol) throw new HttpException(400, `"${t.nomi}" toifasi yashirilgan`);
      const summa = yax(req.body.summa);
      if (!(summa > 0)) throw new HttpException(400, "Summa noto'g'ri");
      const rec = await KassaModel.create({
        tur: 'chiqim', kategoriya: t.kod, summa,
        tolov_usul: USUL.includes(req.body.tolov_usul) ? req.body.tolov_usul : 'naqt',
        manba_tur: 'xarajat', manba_id: null, mijoz_id: null, mijoz_nomi: null,
        izoh: req.body.izoh ? String(req.body.izoh).trim().slice(0, 255) : null,
        sana: sanaOl(req.body.sana), user_id: req.currentUser?.id || null,
        chek_rasm: req.file ? `/uploads/kassa/${req.file.filename}` : null,
      });
      res.status(201).send(rec);
    } catch (e) {
      if (req.file) rasmniOchir(`/uploads/kassa/${req.file.filename}`);
      throw e;
    }
  };

  /* PATCH /xarajatlar/:id (multipart: kategoriya, summa, tolov_usul, sana, izoh, rasm?, rasm_ochir?) */
  update = async (req, res) => {
    const rec = await KassaModel.findByPk(req.params.id);
    const turlar = await xarajatTurlari();
    try {
      if (!rec || rec.tur !== 'chiqim' || !turlar.has(rec.kategoriya)) throw new HttpException(404, 'Xarajat topilmadi');
      if (!TAHRIR_MANBA.includes(rec.manba_tur)) throw new HttpException(400, "Bu avtomatik yozuv — tahrirlab bo'lmaydi");
      const u = {};
      if (req.body.kategoriya !== undefined) {
        const t = turlar.get(req.body.kategoriya);
        if (!t || t.alias) throw new HttpException(400, 'Xarajat toifasini tanlang');
        u.kategoriya = t.kod;
      }
      if (req.body.summa !== undefined) { const s = yax(req.body.summa); if (!(s > 0)) throw new HttpException(400, "Summa noto'g'ri"); u.summa = s; }
      if (req.body.tolov_usul !== undefined && USUL.includes(req.body.tolov_usul)) u.tolov_usul = req.body.tolov_usul;
      if (req.body.sana) {
        const yangiKun = String(req.body.sana).slice(0, 10);
        // Kun o'zgarmagan bo'lsa, asl vaqt saqlanadi
        const eskiKun = U.kunKey(new Date(rec.sana));
        if (yangiKun !== eskiKun) u.sana = sanaOl(req.body.sana);
      }
      if (req.body.izoh !== undefined) u.izoh = req.body.izoh ? String(req.body.izoh).trim().slice(0, 255) : null;
      const eskiRasm = rec.chek_rasm;
      if (req.file) u.chek_rasm = `/uploads/kassa/${req.file.filename}`;
      else if (req.body.rasm_ochir === '1' || req.body.rasm_ochir === true) u.chek_rasm = null;
      await rec.update(u);
      if (eskiRasm && u.chek_rasm !== undefined && u.chek_rasm !== eskiRasm) rasmniOchir(eskiRasm);
      res.send(rec);
    } catch (e) {
      if (req.file) rasmniOchir(`/uploads/kassa/${req.file.filename}`);
      throw e;
    }
  };

  /* DELETE /xarajatlar/:id */
  delete = async (req, res) => {
    const rec = await KassaModel.findByPk(req.params.id);
    const turlar = await xarajatTurlari();
    if (!rec || rec.tur !== 'chiqim' || !turlar.has(rec.kategoriya)) throw new HttpException(404, 'Xarajat topilmadi');
    if (!TAHRIR_MANBA.includes(rec.manba_tur)) throw new HttpException(400, "Bu avtomatik yozuv — o'chirib bo'lmaydi");
    const rasm = rec.chek_rasm;
    await rec.destroy();
    rasmniOchir(rasm);
    res.send({ message: "O'chirildi" });
  };
}

module.exports = new XarajatController();
