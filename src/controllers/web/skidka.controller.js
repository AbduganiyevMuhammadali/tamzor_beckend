/* MIJOZ SKIDKALARI (2026-11-27) — web: mijoz kartasida tovar bo'yicha skidka (foiz yoki so'm, ixtiyoriy muddat).
   GET    /mijozlar/:id/skidkalar            — ro'yxat (asl va skidkali narx bilan)
   PUT    /mijozlar/:id/skidkalar            { qatorlar: [{ tovar_id, tur, qiymat, dan?, gacha?, izoh? }] } — qo'shish/yangilash
   DELETE /mijozlar/:id/skidkalar/:tovar_id  — olib tashlash
   Diller mijoziga skidka berilmaydi (diller narxi erkin). */
const sequelize = require('../../db/db-sequelize');
const HttpException = require('../../utils/HttpException.utils');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel = require('../../models/agent.model');
const TovarModel = require('../../models/tovar.model');
const MijozSkidkaModel = require('../../models/mijozSkidka.model');
const { qoidaOl, skidkaQoll, kunKey } = require('../../utils/skidka.utils');
const { narxXaritasi, agentNarxXaritasi } = require('../../utils/narx.utils');

async function mijozOl(id) {
  const m = await MijozModel.findByPk(id);
  if (!m) throw new HttpException(404, 'Mijoz topilmadi');
  const agent = m.agent_id ? await AgentModel.findByPk(m.agent_id, { paranoid: false }) : null;
  return { m, agent };
}

class SkidkaController {
  royxat = async (req, res) => {
    const { m, agent } = await mijozOl(req.params.id);
    const rows = await MijozSkidkaModel.findAll({ where: { mijoz_id: m.id }, order: [['id', 'ASC']], raw: true });
    const tIds = rows.map(r => r.tovar_id);
    const tovarlar = tIds.length ? await TovarModel.findAll({ where: { id: tIds }, attributes: ['id', 'nomi', 'olchov_birligi'], raw: true, paranoid: false }) : [];
    const tBy = new Map(tovarlar.map(t => [t.id, t]));
    // Asl narx — skidkasiz (agent viloyati qoidasi bilan), skidkali — shu qoida bilan
    const asl = tIds.length
      ? (agent && agent.territoriya_id && !agent.diller
        ? await agentNarxXaritasi({ agent, mijozId: m.id, tovarIds: tIds, skidkasiz: true })
        : await narxXaritasi({ mijozId: m.id, tovarIds: tIds, skidkasiz: true }))
      : { narxlar: [] };
    const aBy = new Map(asl.narxlar.map(x => [x.tovar_id, x.narx]));
    const bugun = kunKey(new Date());
    res.send({
      mijoz: { id: m.id, nomi: m.nomi, agent_id: m.agent_id, diller: !!(agent && agent.diller) },
      rows: rows.map(r => {
        const aslNarx = aBy.get(r.tovar_id) || 0;
        const amalda = (!r.dan || r.dan <= bugun) && (!r.gacha || r.gacha >= bugun);
        return {
          id: r.id, tovar_id: r.tovar_id, tovar_nomi: tBy.get(r.tovar_id)?.nomi || `#${r.tovar_id}`, olchov: tBy.get(r.tovar_id)?.olchov_birligi || null,
          tur: r.tur, qiymat: parseFloat(r.qiymat), dan: r.dan, gacha: r.gacha, izoh: r.izoh,
          amalda, holat: amalda ? 'amalda' : (r.dan && r.dan > bugun ? 'kutilmoqda' : 'tugagan'),
          asl_narx: aslNarx, skidkali_narx: aslNarx > 0 ? skidkaQoll(aslNarx, { tur: r.tur, qiymat: r.qiymat }) : 0,
          user_nomi: r.user_nomi, updatedAt: r.updatedAt,
        };
      }),
    });
  };

  saqla = async (req, res) => {
    const { m, agent } = await mijozOl(req.params.id);
    if (agent && agent.diller) throw new HttpException(400, "Diller mijoziga skidka berilmaydi — diller narxni o'zi qo'yadi");
    const list = Array.isArray(req.body && req.body.qatorlar) ? req.body.qatorlar : null;
    if (!list || !list.length) throw new HttpException(400, "qatorlar bo'sh");
    if (list.length > 500) throw new HttpException(400, "Bir so'rovda 500 tadan ko'p qator bo'lmaydi");
    const qoidalar = list.map(qoidaOl);
    const ids = [...new Set(qoidalar.map(q => q.tovar_id))];
    if (ids.length !== qoidalar.length) throw new HttpException(400, 'Bir tovar ikki marta kelgan');
    const tovarlar = await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'nomi', 'turi'], raw: true });
    for (const id of ids) {
      const t = tovarlar.find(x => x.id === id);
      if (!t) throw new HttpException(400, `Tovar #${id} topilmadi`);
      if (t.turi !== 'tovar') throw new HttpException(400, `"${t.nomi}" — savdo tovari emas`);
    }
    const user = req.currentUser || {};
    await sequelize.transaction(async (t) => {
      for (const q of qoidalar) {
        const bor = await MijozSkidkaModel.findOne({ where: { mijoz_id: m.id, tovar_id: q.tovar_id }, transaction: t, lock: t.LOCK.UPDATE });
        const qiymatlar = { ...q, user_id: user.id || null, user_nomi: user.fullname || user.username || null };
        if (bor) await bor.update(qiymatlar, { transaction: t });
        else await MijozSkidkaModel.create({ ...qiymatlar, mijoz_id: m.id }, { transaction: t });
      }
    });
    return this.royxat(req, res);
  };

  ochir = async (req, res) => {
    const { m } = await mijozOl(req.params.id);
    const soni = await MijozSkidkaModel.destroy({ where: { mijoz_id: m.id, tovar_id: Number(req.params.tovar_id) || 0 } });
    if (!soni) throw new HttpException(404, 'Bu tovarga skidka yo\'q');
    res.send({ ok: true });
  };
}

module.exports = new SkidkaController();
