const TovarModel = require('../../models/tovar.model');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { turgaKochir } = require('../../utils/omborKochirish.utils');
const { turkumAniqla, tovarTurkuminiTarqat } = require('../../utils/turkum.utils');
const { tovarlarniQulfla } = require('../../utils/qulf.utils');

/* Bir so'rovda o'chiriladigan tovarlar soni chegarasi */
const MAX_BULK = 500;
/* Buyurtmaning yakuniy holatlari — qolganlari ochiq (tovar band) */
const ARIZA_YAKUNIY = ['yetkazildi', 'bekor', 'qabul_qilindi'];

/* Tovar tarixi bor jadvallar (FK yo'q — shuning uchun qo'lda tekshiriladi).
 * Tarixi bor tovar butunlay o'chirilmaydi: hisobot/qoldiq/hujjatlar unga tayanadi. */
const TARIX_JADVALLAR = [
  'tovar_register', 'ariza_qator', 'prixod_qator',
  'ishlab_chiqarish_qator', 'avtolavka_qator', 'yetkazish_qaytarish',
];

/** Tarixi bor tovar id lari (Set) */
async function tarixiBorlar(ids, transaction) {
  if (!ids.length) return new Set();
  const sql = TARIX_JADVALLAR
    .map(j => `SELECT DISTINCT tovar_id FROM \`${j}\` WHERE tovar_id IN (:ids)`)
    .join(' UNION ');
  const rows = await sequelize.query(sql, { replacements: { ids }, transaction, type: sequelize.QueryTypes.SELECT });
  return new Set(rows.map(r => Number(r.tovar_id)));
}

/** Qoldig'i (istalgan omborda, shu jumladan agent/avtolavka/brak) yoki ochiq buyurtmasi bor
 *  tovar o'chirilmaydi — aks holda sklad qiymati va band qilingan buyurtmalar egasiz qoladi.
 *  Chaqirishdan oldin tovar qatorlari qulflangan bo'lishi kerak (tovarlarniQulfla). */
async function ochirishTekshir(ids, transaction) {
  const [qoldiq, band] = await Promise.all([
    sequelize.query(`
      SELECT r.tovar_id, MAX(r.tovar_nomi) AS nomi, r.ombor, SUM(r.donada) AS q
      FROM tovar_register r WHERE r.tovar_id IN (:ids)
      GROUP BY r.tovar_id, r.ombor HAVING ABS(SUM(r.donada)) > 0.0005`,
    { replacements: { ids }, transaction, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`
      SELECT q.tovar_id, MAX(q.tovar_nomi) AS nomi, COUNT(DISTINCT a.id) AS soni
      FROM ariza_qator q JOIN ariza a ON a.id = q.ariza_id
      WHERE q.tovar_id IN (:ids) AND a.deletedAt IS NULL AND a.holat NOT IN (:yakuniy)
      GROUP BY q.tovar_id`,
    { replacements: { ids, yakuniy: ARIZA_YAKUNIY }, transaction, type: sequelize.QueryTypes.SELECT }),
  ]);
  if (!qoldiq.length && !band.length) return;
  const xatolar = [];
  const qm = new Map();
  for (const r of qoldiq) {
    const x = qm.get(r.tovar_id) || { nomi: r.nomi || `#${r.tovar_id}`, joy: [] };
    x.joy.push(`${r.ombor}: ${+(parseFloat(r.q) || 0).toFixed(3)}`);
    qm.set(r.tovar_id, x);
  }
  for (const x of qm.values()) xatolar.push(`"${x.nomi}" — omborda qoldiq bor (${x.joy.join(', ')})`);
  for (const r of band) xatolar.push(`"${r.nomi || `#${r.tovar_id}`}" — ${Number(r.soni)} ta ochiq buyurtmada`);
  const korsat = xatolar.slice(0, 10).join('; ') + (xatolar.length > 10 ? `; yana ${xatolar.length - 10} ta` : '');
  throw new HttpException(400, `Tovarni o'chirib bo'lmaydi: ${korsat}. Avval qoldiqni nolga tushiring (inventarizatsiya) va buyurtmalarni yakunlang yoki tovarni nofaol qiling`);
}

/** Tarixi bor — soft delete (paranoid), tarixsiz — butunlay o'chiriladi.
 *  Qoldiq / ochiq buyurtma bo'lsa — 400. Haqiqatda o'chirilgan tovarlar sonini qaytaradi. */
async function tovarlarniOchir(ids, transaction) {
  // Qulf birinchi: parallel kirim/buyurtma qoldiqni tekshiruvdan keyin o'zgartirmasin
  await tovarlarniQulfla(ids, transaction);
  await ochirishTekshir(ids, transaction);
  const tarixli = await tarixiBorlar(ids, transaction);
  const yumshoq = ids.filter(id => tarixli.has(id));
  const qattiq  = ids.filter(id => !tarixli.has(id));
  let soni = 0;
  if (yumshoq.length) soni += await TovarModel.destroy({ where: { id: { [Op.in]: yumshoq } }, transaction });
  if (qattiq.length)  soni += await TovarModel.destroy({ where: { id: { [Op.in]: qattiq } }, force: true, transaction });
  return soni;
}

class TovarController extends BaseController {

  getAll = async (req, res) => {
    const { search, turkum, faol, turi, page = 1, limit = 50 } = req.query;

    const where = {};
    if (search)  where.nomi        = { [Op.like]: `%${search}%` };
    if (turkum)  where.turkum      = turkum;
    if (req.query.turkum_id) where.turkum_id = req.query.turkum_id;
    if (faol !== undefined) where.faol = faol === 'true';
    if (['tovar', 'xom_ashyo'].includes(turi)) where.turi = turi;

    // NaN / manfiy / haddan katta qiymatlar cheklanadi
    const lim = Math.min(1000, Math.max(1, parseInt(limit) || 50));
    const pg  = Math.max(1, parseInt(page) || 1);
    const offset = (pg - 1) * lim;

    const { count, rows } = await TovarModel.findAndCountAll({
      where,
      order: [['nomi', 'ASC']],
      limit:  lim,
      offset,
    });

    res.send({
      data:  rows,
      total: count,
      page:  pg,
      pages: Math.ceil(count / lim),
    });
  };

  getById = async (req, res) => {
    const tovar = await TovarModel.findOne({ where: { id: req.params.id } });
    if (!tovar) throw new HttpException(404, req.mf('data not found'));
    res.send(tovar);
  };

  create = async (req, res) => {
    this.checkValidation(req);
    const body = req.body;

    // Shtrix kod takrorlanmasligini tekshirish
    if (body.shtrix_kod) {
      const exists = await TovarModel.findOne({ where: { shtrix_kod: body.shtrix_kod } });
      if (exists) throw new HttpException(400, 'Bu shtrix kod allaqachon mavjud');
    }

    // Turkum: id yoki nom (nom bo'lsa — Turkumlar jadvalida topiladi / ochiladi).
    // Bitta tranzaksiyada: tovar yaratilmasa — yangi turkum ham ochilib qolmaydi
    const tovar = await sequelize.transaction(async (t) => {
      const tk = await turkumAniqla(body, t);
      return TovarModel.create({
        nomi:               body.nomi,
        turkum:             tk.turkum,
        turkum_id:          tk.turkum_id,
        podkategoriya:      body.podkategoriya      || null,
        savdo_yonalishi:    body.savdo_yonalishi    || null,
        shtrix_kod:         body.shtrix_kod         || null,
        hajm:               body.hajm               ?? null,
        ogirlik:            body.ogirlik            ?? null,
        blokdagi_soni:      body.blokdagi_soni      ?? 1,
        qutidagi_bloklar:   body.qutidagi_bloklar   ?? 1,
        olchov_birligi:     body.olchov_birligi     || 'kg',
        brend:              body.brend              || null,
        ishlab_chiqaruvchi: body.ishlab_chiqaruvchi || null,
        segment:            body.segment            || null,
        guruh:              body.guruh              || null,
        tavsif:             body.tavsif             || null,
        faol:               body.faol !== undefined ? body.faol : true,
        turi:               body.turi === 'xom_ashyo' ? 'xom_ashyo' : 'tovar',
      }, { transaction: t });
    });

    res.status(201).send(tovar);
  };

  update = async (req, res) => {
    this.checkValidation(req);
    const body = req.body;

    const tovar = await TovarModel.findOne({ where: { id: req.params.id } });
    if (!tovar) throw new HttpException(404, req.mf('data not found'));

    // Shtrix kod boshqa tovarnikiga tegmasin
    if (body.shtrix_kod && body.shtrix_kod !== tovar.shtrix_kod) {
      const exists = await TovarModel.findOne({
        where: { shtrix_kod: body.shtrix_kod, id: { [Op.ne]: tovar.id } },
      });
      if (exists) throw new HttpException(400, 'Bu shtrix kod allaqachon mavjud');
    }

    tovar.nomi               = body.nomi;
    let turkumOzgardi = false;
    tovar.podkategoriya      = body.podkategoriya      ?? tovar.podkategoriya;
    tovar.savdo_yonalishi    = body.savdo_yonalishi    ?? tovar.savdo_yonalishi;
    // Bo'sh shtrix kod — null (create bilan bir xil; '' unique indeksda to'qnashardi)
    tovar.shtrix_kod         = body.shtrix_kod === '' ? null : (body.shtrix_kod ?? tovar.shtrix_kod);
    tovar.hajm               = body.hajm               ?? tovar.hajm;
    tovar.ogirlik            = body.ogirlik            ?? tovar.ogirlik;
    tovar.blokdagi_soni      = body.blokdagi_soni      ?? tovar.blokdagi_soni;
    tovar.qutidagi_bloklar   = body.qutidagi_bloklar   ?? tovar.qutidagi_bloklar;
    tovar.olchov_birligi     = body.olchov_birligi     ?? tovar.olchov_birligi;
    tovar.brend              = body.brend              ?? tovar.brend;
    tovar.ishlab_chiqaruvchi = body.ishlab_chiqaruvchi ?? tovar.ishlab_chiqaruvchi;
    tovar.segment            = body.segment            ?? tovar.segment;
    tovar.guruh              = body.guruh              ?? tovar.guruh;
    tovar.tavsif             = body.tavsif             ?? tovar.tavsif;
    if (body.faol !== undefined) tovar.faol = body.faol;

    // Turi o'zgarsa (savdo tovari ↔ xom ashyo) — qoldig'i yangi turi omboriga ko'chadi
    const eskiTuri = tovar.turi;
    if (['tovar', 'xom_ashyo'].includes(body.turi)) tovar.turi = body.turi;
    const kochirildi = await sequelize.transaction(async (t) => {
      // Turkum (yangi nom bo'lsa ochiladi) — tovar saqlanishi bilan bitta tranzaksiyada
      if (body.turkum !== undefined || body.turkum_id !== undefined) {
        const tk = await turkumAniqla(body, t);
        turkumOzgardi = (tk.turkum || null) !== (tovar.turkum || null);
        tovar.turkum = tk.turkum; tovar.turkum_id = tk.turkum_id;
      }
      await tovar.save({ transaction: t });
      // Turkum tovarning xususiyati — hujjat qatorlari (register, ariza, prixod…) ham yangi nomga o'tadi
      if (turkumOzgardi) await tovarTurkuminiTarqat(tovar.id, tovar.turkum, t);
      return tovar.turi !== eskiTuri ? turgaKochir(tovar, eskiTuri, t) : null;
    });
    res.send({ ...tovar.toJSON(), kochirildi });
  };

  toggleFaol = async (req, res) => {
    const tovar = await TovarModel.findOne({ where: { id: req.params.id } });
    if (!tovar) throw new HttpException(404, req.mf('data not found'));
    tovar.faol = !tovar.faol;
    await tovar.save();
    res.send(tovar);
  };

  delete = async (req, res) => {
    const tovar = await TovarModel.findOne({ where: { id: req.params.id } });
    if (!tovar) throw new HttpException(404, req.mf('data not found'));
    await sequelize.transaction(t => tovarlarniOchir([tovar.id], t));
    res.send({ message: "O'chirildi", deleted: 1 });
  };

  bulkDelete = async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      throw new HttpException(400, 'ids majburiy');
    if (ids.length > MAX_BULK) throw new HttpException(400, `Bir so'rovda ${MAX_BULK} tadan ortiq tovar o'chirib bo'lmaydi`);
    const toza = [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))];
    if (!toza.length) throw new HttpException(400, 'ids noto\'g\'ri');
    const soni = await sequelize.transaction(t => tovarlarniOchir(toza, t));
    res.send({ message: `${soni} ta tovar o'chirildi`, deleted: soni });
  };
}

module.exports = new TovarController();
