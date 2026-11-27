const { Op, fn, col } = require('sequelize');
const { AgentModel, MijozModel, TerritoriyaModel } = require('../../models/index');
const AgentRegisterModel = require('../../models/agent_register.model');
const HttpException = require('../../utils/HttpException.utils');
const { ArizaModel } = require('../../models/ariza.model');
const TovarRegisterModel = require('../../models/tovar_register.model');
const { agentOmbori, agentBrakOmbori, AGENT_PREFIKS } = require('../../utils/ombor.utils');
const bcrypt = require('bcryptjs');
const sequelize = require('../../db/db-sequelize');
const { majburiyat, majburiyatlar, agentPulTarix } = require('../../utils/agentPul.utils');
const { sanaTogrimi } = require('../../utils/tahlil.utils');
const Diller = require('../../utils/diller.utils');

/* ── Bo'sh string va noto'g'ri qiymatlarni tozalash ───── */
const DATE_FIELDS   = ['tugilgan_sana', 'ish_boshlagan'];
const NUMBER_FIELDS = ['plan_summa', 'bonus_foiz', 'kredit_limit', 'max_chegirma', 'radius_km', 'territoriya_id', 'super_agent_id'];

/* Web formadan o'zgartiriladigan maydonlar (agentValidator bilan bir xil).
   token, dual_role, linked_dostavchi_id, deletedAt, id — so'rovdan yozilmaydi:
   dual_role/dostavchi bog'lanishi web formada yo'q (update sxemasi ularni rad etadi). */
const TAHRIR_MAYDONLAR = [
  'fullname', 'telefon', 'passport', 'tugilgan_sana', 'territoriya_id', 'plan_summa', 'bonus_foiz',
  'kredit_limit', 'max_chegirma', 'ish_boshlagan', 'tashrif_kunlari', 'boshlanish_manzil', 'transport',
  'mashina_raqam', 'radius_km', 'izoh', 'faol', 'login', 'parol', 'super_agent', 'super_agent_id',
  'narx_ozgartirish', 'diller', 'mijoz_tahrir', 'super_kuzatuv',
];
// 'avtolavka' endi so'rovdan yozilmaydi: 2026-11-21 dan HAMMA agent o'z omboridan sotadi (model standarti true)

function sanitize(body) {
  // Faqat ruxsat etilgan maydonlar olinadi (mass assignment yo'q)
  const out = {};
  for (const k of TAHRIR_MAYDONLAR) if (body && Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
  // Bo'sh string → null (DATE, TEXT, STRING fieldlar uchun)
  Object.keys(out).forEach(k => {
    if (out[k] === '' || out[k] === undefined) out[k] = null;
  });
  // Sana fieldlari: noto'g'ri sana → null
  DATE_FIELDS.forEach(k => {
    if (out[k]) {
      const d = new Date(out[k]);
      out[k] = isNaN(d.getTime()) ? null : out[k];
    }
  });
  // Raqam fieldlari: string → number, '' yoki NaN → null
  NUMBER_FIELDS.forEach(k => {
    if (out[k] !== null && out[k] !== undefined) {
      const n = parseFloat(out[k]);
      out[k] = isNaN(n) ? null : n;
    }
  });
  // 2026-11-27: super_kuzatuv obyekt → JSON matn (null — hammasi ochiq)
  if (Object.prototype.hasOwnProperty.call(out, 'super_kuzatuv')) out.super_kuzatuv = require('../../utils/superKuzatuv.utils').kiritish(out.super_kuzatuv);
  // tashrif_kunlari: array → vergul bilan string
  if (Array.isArray(out.tashrif_kunlari)) {
    out.tashrif_kunlari = out.tashrif_kunlari.length ? out.tashrif_kunlari.join(',') : null;
  }
  return out;
}

/* ── include: territoriya ─────────────────────────────── */
const INCLUDE = [
  { model: TerritoriyaModel, as: 'territoriya', attributes: ['id', 'nomi'] },
  { model: AgentModel, as: 'superAgent', attributes: ['id', 'fullname'] },
];

/* Javobga super agent nomi (ro'yxat va kartada ko'rsatish uchun) */
const shakl = (a) => {
  const j = a.toJSON();
  j.super_agent = !!j.super_agent;
  j.super_agent_id = j.super_agent_id ?? null;
  j.super_agent_nomi = j.superAgent ? j.superAgent.fullname : null;
  j.narx_ozgartirish = !!j.narx_ozgartirish;
  j.mijoz_tahrir = !!j.mijoz_tahrir;
  j.super_kuzatuv = require('../../utils/superKuzatuv.utils').ruxsatlar(j);
  j.diller = !!j.diller;
  j.territoriya = j.territoriya || null;
  return j;
};

/* ─────────────────────────────────────────────────────────
   Yordamchi: agent uchun statistika hisoblash
   ───────────────────────────────────────────────────────── */
async function buildStats(agent, period) {
  const now  = new Date();
  let from   = new Date(now.getFullYear(), now.getMonth(), 1);   // oy boshi default
  if (period === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'week') {
    const day  = now.getDay() || 7;
    from = new Date(now);
    from.setDate(now.getDate() - day + 1);
    from.setHours(0, 0, 0, 0);
  }

  // Agentning barcha mijozlari
  const mijozlar = await MijozModel.findAll({
    where: { agent_id: agent.id },
    attributes: ['id', 'sinf', 'balans', 'faol', 'tashrif_kunlari'],
    include: [{ model: TerritoriyaModel, as: 'territoriya', attributes: ['id', 'nomi'] }],
  });

  // Sinf taqsimoti
  const sinfMap = {};
  mijozlar.forEach(m => {
    if (m.sinf) sinfMap[m.sinf] = (sinfMap[m.sinf] || 0) + 1;
  });
  const sinflar = Object.entries(sinfMap)
    .map(([sinf, count]) => ({ sinf, count }))
    .sort((a, b) => a.sinf.localeCompare(b.sinf));

  // ── Plan-fakt-bonus (agent_register dan, period bo'yicha) ──
  const reg = await AgentRegisterModel.findOne({
    attributes: [
      [fn('SUM', col('summa')),       'fakt_summa'],
      [fn('SUM', col('bonus_summa')), 'bonus_summa'],
      [fn('COUNT', col('id')),        'savdo_soni'],
    ],
    where: { agent_id: agent.id, tur: 'savdo', sana: { [Op.gte]: from } },
    raw: true,
  });
  const fakt_summa  = parseFloat(reg?.fakt_summa  || 0);
  const bonus_summa = parseFloat(reg?.bonus_summa || 0);
  const savdo_soni  = parseInt(reg?.savdo_soni    || 0, 10);
  const plan_summa  = parseFloat(agent.plan_summa || 0);
  const plan_pct    = plan_summa > 0 ? Math.round(fakt_summa / plan_summa * 100) : 0;
  const qolgan_plan = Math.max(0, plan_summa - fakt_summa);

  return {
    mijozlar_soni:    mijozlar.length,
    faol_mijozlar:    mijozlar.filter(m => m.faol).length,
    nofaol_mijozlar:  mijozlar.filter(m => !m.faol).length,
    sinflar,
    // Plan-fakt-bonus
    plan_summa,
    fakt_summa,
    plan_pct,
    qolgan_plan,
    bonus_summa,
    buyurtmalar_soni: savdo_soni,
    bugungi_tashrif:  0,
  };
}

class AgentController {

  /* ── GET /agents ────────────────────────────────────── */
  getAll = async (req, res) => {
    const { search, territoriya_id, faol, period = 'month', super_agent_id, super_agent } = req.query;

    const where = {};
    if (search)         where.fullname      = { [Op.like]: `%${search}%` };
    if (territoriya_id) where.territoriya_id = territoriya_id;
    if (faol !== undefined && faol !== '') where.faol = faol === 'true';
    if (super_agent_id !== undefined && super_agent_id !== '') {
      const sid = Number(super_agent_id);
      if (!Number.isInteger(sid) || sid <= 0) throw new HttpException(400, "super_agent_id noto'g'ri");
      where.super_agent_id = sid;
    }
    if (super_agent !== undefined && super_agent !== '') where.super_agent = super_agent === 'true';
    if (req.query.diller !== undefined && req.query.diller !== '') where.diller = req.query.diller === 'true';

    const agents = await AgentModel.findAll({
      where,
      include: INCLUDE,
      order: [['fullname', 'ASC']],
    });

    // Har bir agent uchun statistika qo'shamiz; pul — naqd majburiyat (agentPul.utils)
    const pullar = await majburiyatlar(agents.map(a => a.id));
    const dQarz = await Diller.dillerQarzlari(agents.filter(a => a.diller).map(a => a.id));   // 2026-11-29
    const result = await Promise.all(
      agents.map(async a => {
        const stats = await buildStats(a, period);
        return { ...shakl(a), ...stats, pul: pullar.get(a.id), diller_qarz: a.diller ? (dQarz.get(a.id) || 0) : null };
      })
    );

    res.send(result);
  };

  /* ── GET /agents/:id/pul?dan=&gacha=&limit= — agent pul daftari (naqd, plastik, topshiruv, qaytarish) ── */
  pul = async (req, res) => {
    const agent = await AgentModel.findByPk(req.params.id, { attributes: ['id', 'fullname', 'territoriya_id'], paranoid: false });
    if (!agent) throw new HttpException(404, 'Agent topilmadi');
    const { dan, gacha } = req.query;
    if (dan && !sanaTogrimi(String(dan))) throw new HttpException(400, "dan sanasi noto'g'ri (YYYY-MM-DD)");
    if (gacha && !sanaTogrimi(String(gacha))) throw new HttpException(400, "gacha sanasi noto'g'ri (YYYY-MM-DD)");
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 1000));
    const tarix = await agentPulTarix(agent.id, {
      dan: dan ? new Date(`${dan}T00:00:00`) : null,
      gacha: gacha ? new Date(new Date(`${gacha}T00:00:00`).getTime() + 864e5) : null,
      limit,
    });
    const davr = { naqd: 0, qaytarish: 0, plastik_tasdiqlangan: 0, plastik_kutilmoqda: 0, topshiruv_tasdiqlangan: 0, topshiruv_kutilmoqda: 0 };
    for (const x of tarix) {
      if (x.tur === 'naqd') davr.naqd += x.summa;
      else if (x.tur === 'qaytarish') davr.qaytarish += x.summa;
      else if (x.tur === 'plastik' && x.holat === 'tasdiqlangan') davr.plastik_tasdiqlangan += x.summa;
      else if (x.tur === 'plastik' && x.holat === 'kutilmoqda') davr.plastik_kutilmoqda += x.summa;
      else if (x.tur === 'topshiruv' && x.holat === 'tasdiqlangan') davr.topshiruv_tasdiqlangan += x.summa;
      else if (x.tur === 'topshiruv' && x.holat === 'kutilmoqda') davr.topshiruv_kutilmoqda += x.summa;
    }
    Object.keys(davr).forEach(k => { davr[k] = +davr[k].toFixed(2); });
    res.send({ agent: { id: agent.id, fullname: agent.fullname }, pul: await majburiyat(agent.id), davr, tarix });
  };

  /* ── GET /agents/:id ────────────────────────────────── */
  getById = async (req, res) => {
    const agent = await AgentModel.findByPk(req.params.id, { include: INCLUDE });
    if (!agent) throw new HttpException(404, 'Agent topilmadi');

    const stats = await buildStats(agent, req.query.period || 'month');

    // Agentning barcha mijozlarini qaytaramiz
    const mijozlar = await MijozModel.findAll({
      where: { agent_id: agent.id },
      include: [{ model: TerritoriyaModel, as: 'territoriya', attributes: ['id', 'nomi'] }],
      order: [['nomi', 'ASC']],
    });

    // Super agent bo'lsa — unga biriktirilgan agentlar
    const agentlari = agent.super_agent
      ? await AgentModel.findAll({ where: { super_agent_id: agent.id }, attributes: ['id', 'fullname', 'faol', 'territoriya_id'],
          include: [{ model: TerritoriyaModel, as: 'territoriya', attributes: ['id', 'nomi'] }], order: [['fullname', 'ASC']] })
      : [];

    res.send({ ...shakl(agent), ...stats, mijozlar, agentlari, pul: await majburiyat(agent.id),
      diller_qarz: agent.diller ? await Diller.dillerQarz(agent.id) : null });
  };

  /* Mobil login/parol: parol xeshlanadi, bo'sh parol mavjudini o'zgartirmaydi,
     login boshqa agentda band bo'lsa — aniq xabar (aks holda 500 chiqardi) */
  async mobilKirish(body, agentId = null) {
    if (body.parol) body.parol = await bcrypt.hash(String(body.parol), 10);
    else delete body.parol;
    if (body.login) {
      const band = await AgentModel.findOne({ where: { login: body.login, ...(agentId ? { id: { [Op.ne]: agentId } } : {}) } });
      if (band) throw new HttpException(400, `"${body.login}" logini boshqa agentda band`);
    }
    return body;
  }

  /* ── POST /agents ───────────────────────────────────── */
  create = async (req, res) => {
    const body  = await this.mobilKirish(sanitize(req.body));
    body.avtolavka = true;
    const agent = await sequelize.transaction(async (t) => {
      await Diller.bayroqTekshir(null, body, t);
      await this.superAgentTekshir(null, body, t);
      return AgentModel.create(body, { transaction: t });
    });
    const full  = await AgentModel.findByPk(agent.id, { include: INCLUDE });
    res.status(201).send(shakl(full));
  };

  /* SUPER AGENT qoidalari (agent — tahrirlanayotgan, yangi bo'lsa null):
     - super_agent_id: mavjud, faol, super_agent=true agent; o'zi emas; zanjirda o'zi uchramasin (sikl yo'q);
     - super agent bayrog'ini o'chirish — unga biriktirilgan agentlar bo'lsa 400. */
  superAgentTekshir = async (agent, body, transaction) => {
    const selfId = agent ? Number(agent.id) : null;
    const superYangi = body.super_agent === undefined || body.super_agent === null
      ? !!(agent && agent.super_agent) : !!body.super_agent;
    if (body.super_agent !== undefined) body.super_agent = superYangi;
    if (agent && agent.super_agent && !superYangi) {
      const soni = await AgentModel.count({ where: { super_agent_id: agent.id }, transaction });
      if (soni) throw new HttpException(400, `${agent.fullname}ga ${soni} ta agent biriktirilgan — super agentlikni olishdan oldin ularni boshqa super agentga o'tkazing yoki biriktirishni olib tashlang`);
    }
    if (body.super_agent_id === undefined || body.super_agent_id === null) return;
    const sid = Number(body.super_agent_id);
    if (!Number.isInteger(sid) || sid <= 0) throw new HttpException(400, "super_agent_id noto'g'ri");
    if (selfId && sid === selfId) throw new HttpException(400, "Agent o'zini o'ziga super agent qilib biriktira olmaydi");
    const sup = await AgentModel.findByPk(sid, { transaction, lock: transaction.LOCK.UPDATE });
    if (!sup) throw new HttpException(400, 'Super agent topilmadi');
    if (!sup.faol) throw new HttpException(400, `${sup.fullname} faol emas`);
    if (!sup.super_agent) throw new HttpException(400, `${sup.fullname} super agent emas (avval agent kartasida "Super agent" belgisini qo'ying)`);
    if (sup.diller) throw new HttpException(400, `${sup.fullname} — diller, super agent bo'la olmaydi`);
    // Sikl: tanlangan super agentdan yuqoriga zanjir bo'ylab — o'zi (yoki o'z bo'ysunuvchisi orqali) qaytib kelmasin
    if (selfId) {
      const korildi = new Set([sid]);
      let joriy = sup;
      while (joriy && joriy.super_agent_id) {
        const keyingi = Number(joriy.super_agent_id);
        if (keyingi === selfId) throw new HttpException(400, `${sup.fullname} sizga bo'ysunadi — sikl hosil bo'ladi`);
        if (korildi.has(keyingi)) break;
        korildi.add(keyingi);
        joriy = await AgentModel.findByPk(keyingi, { attributes: ['id', 'super_agent_id'], transaction });
      }
    }
  };

  /* ── PATCH /agents/:id ──────────────────────────────── */
  update = async (req, res) => {
    // Parol xeshi va login bandligi — tranzaksiyadan oldin (qulf uzoq ushlanmasin)
    const body = await this.mobilKirish(sanitize(req.body), Number(req.params.id) || null);
    // Tekshiruv va yozish bitta tranzaksiyada, agent qatori qulflangan holda: tekshiruvdan keyin
    // parallel so'rov (zakaz, ism o'zgarishi) holatni o'zgartirib ulgurmaydi
    const agent = await sequelize.transaction(async (t) => {
      const agent = await AgentModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!agent) throw new HttpException(404, 'Agent topilmadi');
      await this.kanalOzgarishTekshir(agent, body, t);
      await Diller.bayroqTekshir(agent, body, t);
      await this.superAgentTekshir(agent, body, t);
      await agent.update(body, { transaction: t });
      return agent;
    });
    const full = await AgentModel.findByPk(agent.id, { include: INCLUDE });
    res.send(shakl(full));
  };

  /* Kanal (avtolavka ↔ distributsiya) yoki ism almashganda ma'lumot chalkashmasin:
     - avtolavkaga o'tkazish — ochiq distributsiya zakazlari bo'lsa (ular ombor/dostavchik
       oqimida turibdi) taqiqlanadi;
     - avtolavkadan chiqarish yoki ismni o'zgartirish — "Agent: <ism>" omborida tovar bo'lsa
       taqiqlanadi: mashina ombori ism bilan nomlanadi, tovar eski nom ostida qolib ketadi. */
  kanalOzgarishTekshir = async (agent, body, transaction) => {
    const avtoYangi = body.avtolavka === undefined ? agent.avtolavka : !!body.avtolavka;
    const ismYangi  = body.fullname === undefined ? agent.fullname : body.fullname;
    if (avtoYangi && !agent.avtolavka) {
      const ochiq = await ArizaModel.count({ where: {
        agent_id: agent.id, turi: 'sotish', holat: { [Op.in]: ['yangi', 'tasdiqlangan', 'yigilmoqda', 'yolda'] },
        kanal: 'distributsiya',
      }, transaction });
      if (ochiq) throw new HttpException(400, `${agent.fullname}ning ${ochiq} ta ochiq zakazi bor — Won Sell'ga o'tkazishdan oldin ularni yetkazing yoki bekor qiling`);
    }
    if (agent.diller && ismYangi !== agent.fullname) {
      const q = await Diller.dillerOmborJami(agent, transaction);
      if (q > 0.001) throw new HttpException(400, `"Diller: ${agent.fullname}" omborida ${+q.toFixed(3)} birlik tovar bor — avval dillerdan qaytarish bilan bo'shating, keyin ismni o'zgartiring`);
    }
    if ((agent.avtolavka && !avtoYangi) || ismYangi !== agent.fullname) {
      const q = await this.omborQoldigi(agent, transaction);
      if (q > 0.001) {
        throw new HttpException(400, `"${agentOmbori(agent.fullname)}" omborida ${+q.toFixed(3)} birlik tovar bor — `
          + `avval Won Sell → Qabul (yoki Ombor → Qaytarish qabul) bilan asosiy omborga qaytaring, keyin `
          + (ismYangi !== agent.fullname ? "ismni o'zgartiring" : "Won Sell'dan chiqaring"));
      }
    }
  };

  // "Agent: <ism>" omboridagi jami qoldiq (avtolavka mashinasi yoki qabul kutayotgan qaytarishlar)
  omborQoldigi = async (agent, transaction) => {
    // Sotiladigan ombor + agentning brak ombori (ikkalasi ham ism bilan nomlanadi)
    const rows = await TovarRegisterModel.findAll({
      attributes: ['ombor', [fn('SUM', col('donada')), 'q']], raw: true, transaction,
      where: { ombor: [agentOmbori(agent.fullname), agentBrakOmbori(agent.fullname)] },
      group: ['ombor'],
    });
    return rows.reduce((s, r) => s + Math.max(0, parseFloat(r.q) || 0), 0);
  };

  /* ── DELETE /agents/:id ─────────────────────────────── */
  delete = async (req, res) => {
    // Tekshiruv, mijozlarni bo'shatish va o'chirish — bitta tranzaksiyada (yarim bajarilib qolmaydi)
    await sequelize.transaction(async (t) => {
      const agent = await AgentModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!agent) throw new HttpException(404, 'Agent topilmadi');
      const q = await this.omborQoldigi(agent, t);
      if (q > 0.001) throw new HttpException(400, `"${agentOmbori(agent.fullname)}" omborida ${+q.toFixed(3)} birlik tovar bor — avval asosiy omborga qaytaring, keyin o'chiring`);
      if (agent.diller) {
        const dq = await Diller.dillerOmborJami(agent, t);
        if (dq > 0.001) throw new HttpException(400, `"Diller: ${agent.fullname}" omborida ${+dq.toFixed(3)} birlik tovar bor — avval dillerdan qaytaring, keyin o'chiring`);
        const qarz = await Diller.dillerQarz(agent.id, t);
        if (Math.abs(qarz) > 0.005) throw new HttpException(400, `Diller qarzi ${qarz} — o'chirishdan oldin qarz 0 bo'lishi kerak`);
      }

      // Agentga biriktirilgan mijozlarni agent_idsiz qoldirish (soft)
      await MijozModel.update({ agent_id: null }, { where: { agent_id: agent.id }, transaction: t });
      // Super agent o'chirilsa — unga biriktirilgan agentlar biriktirishsiz qoladi
      await AgentModel.update({ super_agent_id: null }, { where: { super_agent_id: agent.id }, transaction: t });

      await agent.destroy({ transaction: t });
    });
    res.send({ message: "Agent o'chirildi" });
  };

  /* ── GET /agents/:id/mijozlar ───────────────────────── */
  getMijozlar = async (req, res) => {
    const agent = await AgentModel.findByPk(req.params.id);
    if (!agent) throw new HttpException(404, 'Agent topilmadi');

    const { sinf, faol, search } = req.query;
    const where = { agent_id: req.params.id };
    if (sinf)  where.sinf = sinf;
    if (faol !== undefined && faol !== '') where.faol = faol === 'true';
    if (search) where.nomi = { [Op.like]: `%${search}%` };

    const mijozlar = await MijozModel.findAll({
      where,
      include: [{ model: TerritoriyaModel, as: 'territoriya', attributes: ['id', 'nomi'] }],
      order: [['nomi', 'ASC']],
    });
    res.send(mijozlar);
  };

  /* ── GET /agents/spravochnik ────────────────────────── */
  spravochnik = async (req, res) => {
    const [agentlar, territoriyalar] = await Promise.all([
      AgentModel.findAll({
        where: { faol: true },
        include: INCLUDE,
        attributes: ['id', 'fullname', 'territoriya_id', 'super_agent', 'super_agent_id', 'diller'],
        order: [['fullname', 'ASC']],
      }),
      TerritoriyaModel.findAll({ order: [['nomi', 'ASC']] }),
    ]);
    res.send({ agentlar, territoriyalar });
  };

  /* ── GET /agents/statistika ─────────────────────────── */
  statistika = async (req, res) => {
    const { period = 'month' } = req.query;

    // 2026-11-29: dillerlar kompaniya KPI'siga kirmaydi
    const agentlar = await AgentModel.findAll({
      where: { faol: true, diller: false },
      include: INCLUDE,
      order: [['fullname', 'ASC']],
    });

    const result = await Promise.all(
      agentlar.map(async a => {
        const stats = await buildStats(a, period);
        return { ...a.toJSON(), ...stats };
      })
    );

    // Umumiy KPI
    const kpi = {
      jami_agentlar:    result.length,
      jami_mijozlar:    result.reduce((s, a) => s + a.mijozlar_soni, 0),
      jami_plan_summa:  result.reduce((s, a) => s + (a.plan_summa  || 0), 0),
      jami_fakt_summa:  result.reduce((s, a) => s + (a.fakt_summa  || 0), 0),
      jami_bonus_summa: result.reduce((s, a) => s + (a.bonus_summa || 0), 0),
      orta_plan_foiz:   result.length
        ? Math.round(result.reduce((s, a) => s + (a.plan_pct || 0), 0) / result.length)
        : 0,
    };

    res.send({ agentlar: result, kpi });
  };

  /* ── PATCH /agents/:id/faol ─────────────────────────── */
  toggleFaol = async (req, res) => {
    const agent = await AgentModel.findByPk(req.params.id);
    if (!agent) throw new HttpException(404, 'Agent topilmadi');
    await agent.update({ faol: !agent.faol });
    res.send({ id: agent.id, faol: agent.faol });
  };

  /* ── GET /agents/:id/kpi?oy=YYYY-MM — agentning oylik KPI'si (mobil agentKpi bilan bir xil, 2026-11-27) ── */
  kpi = async (req, res) => {
    const agent = await AgentModel.findByPk(req.params.id);
    if (!agent) throw new HttpException(404, 'Agent topilmadi');
    res.send(await require('../../utils/agentKpi.utils').agentKpi(agent, req.query.oy));
  };

  /* ── GET /agents/:id/register — savdo harakatlari tarixi ── */
  register = async (req, res) => {
    const agent = await AgentModel.findByPk(req.params.id, { include: INCLUDE });
    if (!agent) throw new HttpException(404, 'Agent topilmadi');

    const { period = 'month' } = req.query;
    const now = new Date();
    let from = new Date(now.getFullYear(), now.getMonth(), 1);
    if (period === 'today')      from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    else if (period === 'week')  { const d = now.getDay()||7; from = new Date(now); from.setDate(now.getDate()-d+1); from.setHours(0,0,0,0); }
    else if (period === 'year')  from = new Date(now.getFullYear(), 0, 1);
    else if (period === 'all')   from = new Date(2000, 0, 1);

    const harakatlar = await AgentRegisterModel.findAll({
      where: { agent_id: agent.id, sana: { [Op.gte]: from } },
      order: [['sana', 'DESC'], ['id', 'DESC']],
    });

    const fakt_summa  = harakatlar.reduce((s, h) => s + h.summa, 0);
    const bonus_summa = harakatlar.reduce((s, h) => s + h.bonus_summa, 0);
    const plan_summa  = parseFloat(agent.plan_summa || 0);

    res.send({
      agent: { id: agent.id, fullname: agent.fullname, plan_summa, bonus_foiz: parseFloat(agent.bonus_foiz||0) },
      jami: {
        fakt_summa, bonus_summa, plan_summa,
        plan_pct:    plan_summa > 0 ? Math.round(fakt_summa / plan_summa * 100) : 0,
        qolgan_plan: Math.max(0, plan_summa - fakt_summa),
        savdo_soni:  harakatlar.length,
      },
      harakatlar,
    });
  };
}

module.exports = new AgentController();
