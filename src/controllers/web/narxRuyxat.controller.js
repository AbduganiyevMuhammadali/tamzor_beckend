/**
 * Narx ro'yxatlari (web sozlamalar → Narx). Yozish faqat Admin/Programmer.
 */
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { NarxRuyxatModel, NarxRuyxatQatorModel } = require('../../models/narxRuyxat.model');
const { MijozModel, MijozKategoriyaModel } = require('../../models/mijoz.model');
const TovarModel = require('../../models/tovar.model');
const HttpException = require('../../utils/HttpException.utils');
const { narxMap } = require('../../utils/avtolavka.utils');
const { narxXaritasi } = require('../../utils/narx.utils');

const TURLAR = ['optom', 'chakana', 'maxsus'];

function yozishHuquqi(req) {
  const rol = req.currentUser && req.currentUser.role;
  if (rol !== 'Admin' && rol !== 'Programmer') throw new HttpException(403, 'Narx ro\'yxatini faqat administrator o\'zgartiradi');
}

async function topOrYoq(id) {
  const r = await NarxRuyxatModel.findByPk(id);
  if (!r) throw new HttpException(404, 'Narx ro\'yxati topilmadi');
  return r;
}

class NarxRuyxatController {
  // GET /narx-ruyxatlar — barcha ro'yxatlar, tovar va toifa soni bilan
  getAll = async (req, res) => {
    const rows = await NarxRuyxatModel.findAll({ order: [['standart', 'DESC'], ['tur', 'ASC'], ['id', 'ASC']] });
    const ids = rows.map(r => r.id);
    const count = (model) => ids.length
      ? model.findAll({ attributes: ['narx_ruyxat_id', [sequelize.fn('COUNT', sequelize.col('id')), 'soni']],
          where: { narx_ruyxat_id: ids }, group: ['narx_ruyxat_id'], raw: true })
      : [];
    const [tovarSoni, katSoni] = await Promise.all([
      count(NarxRuyxatQatorModel),
      count(MijozKategoriyaModel),
    ]);
    const t = Object.fromEntries(tovarSoni.map(x => [x.narx_ruyxat_id, Number(x.soni)]));
    const k = Object.fromEntries(katSoni.map(x => [x.narx_ruyxat_id, Number(x.soni)]));
    res.send(rows.map(r => ({ ...r.toJSON(), tovar_soni: t[r.id] || 0, kategoriya_soni: k[r.id] || 0 })));
  };

  // GET /narx-ruyxatlar/:id — ro'yxat + barcha faol tovarlar (ro'yxatdagi narx va eski narx bilan)
  getById = async (req, res) => {
    const r = await topOrYoq(req.params.id);
    const [tovarlar, qatorlar] = await Promise.all([
      TovarModel.findAll({ attributes: ['id', 'nomi', 'turkum'], where: { faol: true, turi: 'tovar' }, order: [['turkum', 'ASC'], ['nomi', 'ASC']], raw: true }),
      NarxRuyxatQatorModel.findAll({ where: { narx_ruyxat_id: r.id }, raw: true }),
    ]);
    const eski = await narxMap(tovarlar.map(t => t.id));
    const qMap = Object.fromEntries(qatorlar.map(q => [q.tovar_id, parseFloat(q.narx) || 0]));
    res.send({
      ...r.toJSON(),
      tovarlar: tovarlar.map(t => ({
        tovar_id: t.id, tovar_nomi: t.nomi, turkum: t.turkum || '',
        narx: qMap[t.id] || 0,
        eski_chakana: parseFloat(eski[t.id]?.chakana_narx) || 0,
        eski_optom: parseFloat(eski[t.id]?.optom_narx) || 0,
      })),
    });
  };

  // POST /narx-ruyxatlar
  create = async (req, res) => {
    yozishHuquqi(req);
    const { nomi, tur = 'chakana', standart = false, faol = true, izoh = null } = req.body;
    if (!nomi || !String(nomi).trim()) throw new HttpException(400, 'Nomi majburiy');
    if (!TURLAR.includes(tur)) throw new HttpException(400, 'Noto\'g\'ri tur');
    const r = await sequelize.transaction(async (t) => {
      if (standart) await NarxRuyxatModel.update({ standart: false }, { where: { tur, standart: true }, transaction: t });
      return NarxRuyxatModel.create({ nomi: String(nomi).trim(), tur, standart: !!standart, faol: !!faol, izoh: izoh || null }, { transaction: t });
    });
    res.status(201).send(r);
  };

  // PATCH /narx-ruyxatlar/:id
  update = async (req, res) => {
    yozishHuquqi(req);
    const r = await topOrYoq(req.params.id);
    const b = req.body;
    if (b.tur !== undefined && !TURLAR.includes(b.tur)) throw new HttpException(400, 'Noto\'g\'ri tur');
    await sequelize.transaction(async (t) => {
      const tur = b.tur ?? r.tur;
      if (b.standart === true) {
        await NarxRuyxatModel.update({ standart: false },
          { where: { tur, standart: true, id: { [Op.ne]: r.id } }, transaction: t });
      }
      await r.update({
        nomi:     b.nomi !== undefined ? String(b.nomi).trim() : r.nomi,
        tur,
        standart: b.standart !== undefined ? !!b.standart : r.standart,
        faol:     b.faol !== undefined ? !!b.faol : r.faol,
        izoh:     b.izoh !== undefined ? (b.izoh || null) : r.izoh,
      }, { transaction: t });
    });
    res.send(r);
  };

  // DELETE /narx-ruyxatlar/:id — standart ro'yxat o'chirilmaydi; toifalardan bog'lanish uziladi
  remove = async (req, res) => {
    yozishHuquqi(req);
    const r = await topOrYoq(req.params.id);
    if (r.standart) throw new HttpException(400, 'Standart ro\'yxatni o\'chirib bo\'lmaydi — avval boshqasini standart qiling');
    const toifalar = await MijozKategoriyaModel.count({ where: { narx_ruyxat_id: r.id } });
    await r.destroy();
    res.send({ message: 'O\'chirildi', toifalardan_uzildi: toifalar });
  };

  // PUT /narx-ruyxatlar/:id/narxlar — tovar narxlarini to'liq almashtirish (narx 0 bo'lsa qator o'chadi)
  saveNarxlar = async (req, res) => {
    yozishHuquqi(req);
    const r = await topOrYoq(req.params.id);
    // Validator ham cheklaydi; bu yerda — validatorsiz chaqiruvlar uchun ham himoya
    if (Array.isArray(req.body.qatorlar) && req.body.qatorlar.length > 5000) throw new HttpException(400, 'Bir so\'rovda 5000 tadan ortiq qator yuborib bo\'lmaydi');
    const kelgan = (req.body.qatorlar || []).map(q => ({ tovar_id: Number(q.tovar_id), narx: Number(q.narx) || 0 }));
    const musbat = kelgan.filter(q => q.narx > 0);

    if (musbat.length) {
      const topilgan = await TovarModel.findAll({ attributes: ['id'], where: { id: musbat.map(q => q.tovar_id) }, raw: true });
      const set = new Set(topilgan.map(t => t.id));
      const yoq = musbat.find(q => !set.has(q.tovar_id));
      if (yoq) throw new HttpException(400, `Tovar topilmadi: ${yoq.tovar_id}`);
    }

    await sequelize.transaction(async (t) => {
      await NarxRuyxatQatorModel.destroy({
        where: { narx_ruyxat_id: r.id, tovar_id: { [Op.notIn]: musbat.map(q => q.tovar_id).concat([0]) } },
        transaction: t,
      });
      if (musbat.length) {
        await NarxRuyxatQatorModel.bulkCreate(
          musbat.map(q => ({ narx_ruyxat_id: r.id, tovar_id: q.tovar_id, narx: q.narx })),
          { updateOnDuplicate: ['narx', 'updatedAt'], transaction: t });
      }
    });
    res.send({ saqlandi: musbat.length });
  };

  // GET /narx-ruyxatlar/mijoz/:mijozId — mijoz uchun amaldagi narxlar (sotuv formasi uchun)
  mijozNarxlari = async (req, res) => {
    const mijozId = Number(req.params.mijozId);
    const mijoz = await MijozModel.findByPk(mijozId, { attributes: ['id'] });
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    const tovarlar = await TovarModel.findAll({ attributes: ['id'], where: { faol: true, turi: 'tovar' }, raw: true });
    const r = await narxXaritasi({ mijozId, tovarIds: tovarlar.map(t => t.id) });
    res.send(r);
  };
}

module.exports = new NarxRuyxatController();
