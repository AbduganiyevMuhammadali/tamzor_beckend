const TovarModel = require('../../models/tovar.model');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { turgaKochir } = require('../../utils/omborKochirish.utils');
const { turkumAniqla, tovarTurkuminiTarqat } = require('../../utils/turkum.utils');

class TovarController extends BaseController {

  getAll = async (req, res) => {
    const { search, turkum, faol, turi, page = 1, limit = 50 } = req.query;

    const where = {};
    if (search)  where.nomi        = { [Op.like]: `%${search}%` };
    if (turkum)  where.turkum      = turkum;
    if (req.query.turkum_id) where.turkum_id = req.query.turkum_id;
    if (faol !== undefined) where.faol = faol === 'true';
    if (['tovar', 'xom_ashyo'].includes(turi)) where.turi = turi;

    const offset = (Number(page) - 1) * Number(limit);

    const { count, rows } = await TovarModel.findAndCountAll({
      where,
      order: [['nomi', 'ASC']],
      limit:  Number(limit),
      offset,
    });

    res.send({
      data:  rows,
      total: count,
      page:  Number(page),
      pages: Math.ceil(count / Number(limit)),
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

    // Turkum: id yoki nom (nom bo'lsa — Turkumlar jadvalida topiladi / ochiladi)
    const tk = await turkumAniqla(body);
    const tovar = await TovarModel.create({
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
    if (body.turkum !== undefined || body.turkum_id !== undefined) {
      const tk = await turkumAniqla(body);
      turkumOzgardi = (tk.turkum || null) !== (tovar.turkum || null);
      tovar.turkum = tk.turkum; tovar.turkum_id = tk.turkum_id;
    }
    tovar.podkategoriya      = body.podkategoriya      ?? tovar.podkategoriya;
    tovar.savdo_yonalishi    = body.savdo_yonalishi    ?? tovar.savdo_yonalishi;
    tovar.shtrix_kod         = body.shtrix_kod         ?? tovar.shtrix_kod;
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
    try {
      await tovar.destroy({ force: true });
    } catch {
      await tovar.destroy();
    }
    res.send({ message: "O'chirildi" });
  };

  bulkDelete = async (req, res) => {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      throw new HttpException(400, 'ids majburiy');
    await TovarModel.destroy({ where: { id: { [Op.in]: ids } }, force: true });
    res.send({ message: `${ids.length} ta tovar o'chirildi` });
  };
}

module.exports = new TovarController();
