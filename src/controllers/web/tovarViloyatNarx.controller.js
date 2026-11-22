/**
 * VILOYAT NARXLARI (2026-11-25) — tovarning har viloyatdagi (territoriya) chakana va optom narxi.
 *
 *   GET /tovar/:id/viloyat-narxlari           — bitta tovar kartasi: har mavjud viloyat uchun qator
 *   PUT /tovar/:id/viloyat-narxlari           — { narxlar: [{ territoriya_id, chakana_narx, optom_narx }] }
 *   GET /tovar/viloyat-narxlari?territoriya_id — bitta viloyat bo'yicha ommaviy tahrir jadvali
 *   PUT /tovar/viloyat-narxlari/:territoriyaId — { narxlar: [{ tovar_id, chakana_narx, optom_narx }] }
 *
 * Qoidalar (ikkala PUT uchun bir xil):
 *   - faqat ro'yxatda kelgan qatorlar o'zgaradi; narx maydoni yuborilmasa — o'zgarmaydi;
 *   - null / 0 / '' — shu narx tozalanadi; ikkala narx ham bo'sh bo'lsa qator o'chiriladi;
 *   - narx: 0..1e12 son (raqamli satr ham qabul qilinadi), 2 xonagacha yaxlitlanadi;
 *   - noma'lum maydon, takroriy id, mavjud bo'lmagan viloyat/tovar → 400.
 * Narx saqlangan zahoti amal qiladi (sotuvda ishlatiladi: utils/narx.utils agentNarxXaritasi).
 * Har qatorda updatedAt va kim o'zgartirgani (user_id, user_nomi) saqlanadi.
 */
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const HttpException = require('../../utils/HttpException.utils');
const TovarModel = require('../../models/tovar.model');
const TerritoriyaModel = require('../../models/territoriya.model');
const TovarViloyatNarxModel = require('../../models/tovarViloyatNarx.model');

const MAX_NARX = 1e12;
const MAX_QATOR = 2000;
const NARX_KALIT = ['chakana_narx', 'optom_narx'];

const butun = (v) => {
  const x = typeof v === 'string' && /^\d+$/.test(v.trim()) ? Number(v.trim()) : v;
  return Number.isInteger(x) && x > 0 ? x : null;
};

/* Narx: undefined — o'zgarmaydi; null — tozalash; aks holda 0..1e12 son (0 → null) */
function narxOl(v, nomi, kim) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  let x = v;
  if (typeof x === 'string' && /^\s*\d+(\.\d+)?\s*$/.test(x)) x = Number(x);
  if (typeof x !== 'number' || !Number.isFinite(x)) throw new HttpException(400, `${kim}: ${nomi} son bo'lishi kerak`);
  if (x < 0) throw new HttpException(400, `${kim}: ${nomi} manfiy bo'lmaydi`);
  if (x > MAX_NARX) throw new HttpException(400, `${kim}: ${nomi} juda katta (≤ 1 000 000 000 000)`);
  const r = Math.round(x * 100) / 100;
  return r > 0 ? r : null;
}

/* So'rov tanasini tekshiradi → [{ id, chakana_narx?, optom_narx? }] (id — idKalit qiymati) */
function tananiTekshir(body, idKalit) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpException(400, "So'rov tanasi { narxlar: [...] } bo'lishi kerak");
  const ortiqcha = Object.keys(body).filter(k => k !== 'narxlar');
  if (ortiqcha.length) throw new HttpException(400, `Noma'lum maydon: ${ortiqcha.join(', ')}`);
  if (!Array.isArray(body.narxlar)) throw new HttpException(400, "narxlar — massiv bo'lishi kerak");
  if (body.narxlar.length > MAX_QATOR) throw new HttpException(400, `Bir so'rovda ko'pi bilan ${MAX_QATOR} ta qator`);
  const korilgan = new Set();
  return body.narxlar.map((q, i) => {
    const kim = `narxlar[${i}]`;
    if (!q || typeof q !== 'object' || Array.isArray(q)) throw new HttpException(400, `${kim} — obyekt bo'lishi kerak`);
    const nom = Object.keys(q).filter(k => k !== idKalit && !NARX_KALIT.includes(k));
    if (nom.length) throw new HttpException(400, `${kim}: noma'lum maydon: ${nom.join(', ')}`);
    const id = butun(q[idKalit]);
    if (!id) throw new HttpException(400, `${kim}: ${idKalit} noto'g'ri`);
    if (korilgan.has(id)) throw new HttpException(400, `${kim}: ${idKalit} = ${id} takrorlangan`);
    korilgan.add(id);
    if (q.chakana_narx === undefined && q.optom_narx === undefined) throw new HttpException(400, `${kim}: chakana_narx yoki optom_narx kerak`);
    return { id, chakana_narx: narxOl(q.chakana_narx, 'chakana_narx', kim), optom_narx: narxOl(q.optom_narx, 'optom_narx', kim) };
  });
}

/* Qatorlarni saqlash (tranzaksiya ichida). juftlar: [{ tovar_id, territoriya_id, chakana_narx?, optom_narx? }] */
async function saqla(juftlar, user, transaction) {
  if (!juftlar.length) return 0;
  const userId = user ? user.id : null;
  const userNomi = user ? (user.fullname || user.username || null) : null;
  const borlar = await TovarViloyatNarxModel.findAll({
    where: { [Op.or]: juftlar.map(j => ({ tovar_id: j.tovar_id, territoriya_id: j.territoriya_id })) },
    transaction, lock: transaction.LOCK.UPDATE,
  });
  const bor = new Map(borlar.map(r => [`${r.tovar_id}:${r.territoriya_id}`, r]));
  for (const j of juftlar) {
    const r = bor.get(`${j.tovar_id}:${j.territoriya_id}`);
    const chakana = j.chakana_narx !== undefined ? j.chakana_narx : (r ? r.chakana_narx : null);
    const optom = j.optom_narx !== undefined ? j.optom_narx : (r ? r.optom_narx : null);
    if (chakana == null && optom == null) {
      if (r) await r.destroy({ transaction });
      continue;
    }
    if (r) {
      r.chakana_narx = chakana; r.optom_narx = optom; r.user_id = userId; r.user_nomi = userNomi;
      r.changed('updatedAt', true);
      await r.save({ transaction });
    } else {
      await TovarViloyatNarxModel.create({
        tovar_id: j.tovar_id, territoriya_id: j.territoriya_id, chakana_narx: chakana, optom_narx: optom,
        user_id: userId, user_nomi: userNomi,
      }, { transaction });
    }
  }
  return juftlar.length;
}

async function tovarOl(idRaw, transaction) {
  const id = butun(idRaw);
  if (!id) throw new HttpException(400, "Tovar id noto'g'ri");
  const t = await TovarModel.findByPk(id, { attributes: ['id', 'nomi', 'turi'], transaction });
  if (!t) throw new HttpException(404, 'Tovar topilmadi');
  return t;
}

async function viloyatOl(idRaw, kalit = 'territoriya_id') {
  const id = butun(idRaw);
  if (!id) throw new HttpException(400, `${kalit} noto'g'ri`);
  const t = await TerritoriyaModel.findByPk(id, { attributes: ['id', 'nomi'] });
  if (!t) throw new HttpException(404, 'Viloyat topilmadi');
  return t;
}

/* Bitta tovar kartasi uchun javob — har mavjud viloyat */
async function tovarJavob(tovar) {
  const [viloyatlar, rows] = await Promise.all([
    TerritoriyaModel.findAll({ attributes: ['id', 'nomi'], order: [['nomi', 'ASC'], ['id', 'ASC']], raw: true }),
    TovarViloyatNarxModel.findAll({ where: { tovar_id: tovar.id } }),
  ]);
  const by = new Map(rows.map(r => [r.territoriya_id, r]));
  return {
    tovar: { id: tovar.id, nomi: tovar.nomi },
    narxlar: viloyatlar.map(v => {
      const r = by.get(v.id);
      return {
        territoriya_id: v.id, territoriya_nomi: v.nomi,
        chakana_narx: r ? r.chakana_narx : null, optom_narx: r ? r.optom_narx : null,
        updatedAt: r ? r.updatedAt : null, user_nomi: r ? r.user_nomi : null,
      };
    }),
  };
}

class TovarViloyatNarxController {
  /* GET /tovar/:id/viloyat-narxlari */
  tovarNarxlari = async (req, res) => {
    const tovar = await tovarOl(req.params.id);
    res.send(await tovarJavob(tovar));
  };

  /* PUT /tovar/:id/viloyat-narxlari  { narxlar: [{ territoriya_id, chakana_narx, optom_narx }] } */
  tovarNarxSaqla = async (req, res) => {
    const qatorlar = tananiTekshir(req.body, 'territoriya_id');
    const tovar = await sequelize.transaction(async (t) => {
      const tv = await tovarOl(req.params.id, t);
      if (tv.turi === 'xom_ashyo') throw new HttpException(400, `"${tv.nomi}" — xom ashyo, sotilmaydi (narx qo'yilmaydi)`);
      const ids = qatorlar.map(q => q.id);
      if (ids.length) {
        const bor = new Set((await TerritoriyaModel.findAll({ where: { id: ids }, attributes: ['id'], raw: true, transaction: t })).map(x => x.id));
        const yoq = ids.filter(id => !bor.has(id));
        if (yoq.length) throw new HttpException(400, `Viloyat topilmadi: ${yoq.join(', ')}`);
      }
      await saqla(qatorlar.map(q => ({ tovar_id: tv.id, territoriya_id: q.id, chakana_narx: q.chakana_narx, optom_narx: q.optom_narx })), req.currentUser, t);
      return tv;
    });
    res.send(await tovarJavob(tovar));
  };

  /* GET /tovar/viloyat-narxlari?territoriya_id=&qidiruv=&page=&limit= — faol tovarlar (turi 'tovar') */
  viloyatJadval = async (req, res) => {
    const vil = await viloyatOl(req.query.territoriya_id);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const where = { faol: true, turi: 'tovar' };
    const q = String(req.query.qidiruv || '').trim();
    if (q) where.nomi = { [Op.like]: `%${q.replace(/[\\%_]/g, '\\$&')}%` };
    const { count, rows } = await TovarModel.findAndCountAll({
      where, attributes: ['id', 'nomi', 'turkum'], order: [['nomi', 'ASC'], ['id', 'ASC']],
      limit, offset: (page - 1) * limit, raw: true,
    });
    const narxlar = rows.length
      ? await TovarViloyatNarxModel.findAll({ where: { territoriya_id: vil.id, tovar_id: rows.map(r => r.id) } })
      : [];
    const by = new Map(narxlar.map(r => [r.tovar_id, r]));
    res.send({
      territoriya: { id: vil.id, nomi: vil.nomi },
      data: rows.map(t => {
        const r = by.get(t.id);
        return {
          tovar_id: t.id, nomi: t.nomi, turkum: t.turkum || null,
          chakana_narx: r ? r.chakana_narx : null, optom_narx: r ? r.optom_narx : null,
          updatedAt: r ? r.updatedAt : null,
        };
      }),
      page, limit, jami: count,
    });
  };

  /* PUT /tovar/viloyat-narxlari/:territoriyaId  { narxlar: [{ tovar_id, chakana_narx, optom_narx }] } → { saqlandi } */
  viloyatSaqla = async (req, res) => {
    const vil = await viloyatOl(req.params.territoriyaId, 'territoriyaId');
    const qatorlar = tananiTekshir(req.body, 'tovar_id');
    const saqlandi = await sequelize.transaction(async (t) => {
      const ids = qatorlar.map(q => q.id);
      if (ids.length) {
        const tovarlar = await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'nomi', 'turi'], raw: true, transaction: t });
        const by = new Map(tovarlar.map(x => [x.id, x]));
        const yoq = ids.filter(id => !by.has(id));
        if (yoq.length) throw new HttpException(400, `Tovar topilmadi: ${yoq.join(', ')}`);
        const xom = tovarlar.filter(x => x.turi === 'xom_ashyo');
        if (xom.length) throw new HttpException(400, `Xom ashyoga narx qo'yilmaydi: ${xom.map(x => `"${x.nomi}"`).join(', ')}`);
      }
      return saqla(qatorlar.map(q => ({ tovar_id: q.id, territoriya_id: vil.id, chakana_narx: q.chakana_narx, optom_narx: q.optom_narx })), req.currentUser, t);
    });
    res.send({ saqlandi });
  };
}

module.exports = new TovarViloyatNarxController();
