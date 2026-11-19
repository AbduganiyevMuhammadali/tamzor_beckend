const { Op } = require('sequelize');
const { kunOraligi } = require('../../utils/sana.utils');
const { MijozModel, TerritoriyaModel, MijozKategoriyaModel, AgentModel } = require('../../models/index');
const { TashrifModel } = require('../../models/marshrut.model');
const HttpException = require('../../utils/HttpException.utils');
const sequelize = require('../../db/db-sequelize');
const MijozReytingModel = require('../../models/mijozReyting.model');
const { reytingYoz, qoidalar: reytingQoidalari, daraja: reytingDaraja, darajaChegara, DARAJALAR, MAX: REYTING_MAX } = require('../../utils/reyting.utils');
const { adminMi } = require('../../utils/sotuvBekor.utils');
const { ArizaModel } = require('../../models/ariza.model');

/* Kassa kategoriyasining o'qiladigan nomi */
const KATEGORIYA_NOMI = {
  mijoz_tolov:     "Mijoz to'lovi",
  sotuvdan_tushum: 'Sotuvdan tushum',
  qarz_qaytarish:  'Qarz qaytarish',
};

/* Web formadan tahrirlanadigan maydonlar (mijozValidator bilan bir xil).
 * balans, reyting*, rad_ketma_ket, tolov_vada_sana, mobil_id — tizim maydonlari:
 * ular faqat savdo/kassa/reyting oqimlari orqali o'zgaradi. */
const TAHRIR_MAYDONLAR = [
  'nomi', 'yuridik_nomi', 'telefon', 'telefon2', 'manzil', 'mo_ljal',
  'territoriya_id', 'kategoriya_id', 'agent_id', 'sinf', 'narx_turi',
  'inn', 'shartnoma_raqam', 'shartnoma_sana', 'hisob_raqam', 'bank', 'mfo',
  'tashrif_kunlari', 'tashrif_chastota', 'lat', 'lng', 'kredit_limit', 'tolov_muddati_kun',
  'izoh', 'faol', 'boshlangich_balans', 'boshlangich_sana', 'boshlangich_izoh',
];

/* Buyurtmaning yakuniy holatlari — qolganlari "ochiq" (mijozni o'chirishga to'sqinlik qiladi) */
const ARIZA_YAKUNIY = ['yetkazildi', 'bekor', 'qabul_qilindi'];

/* Territoriya / kategoriya nomi: bo'sh bo'lmagan satr, ≤100 belgi (trim).
 * majburiy=false bo'lsa va maydon yuborilmagan bo'lsa — undefined (o'zgarmaydi). */
function nomiTekshir(body, majburiy) {
  if (!majburiy && !(body && Object.prototype.hasOwnProperty.call(body, 'nomi'))) return undefined;
  const v = body ? body.nomi : undefined;
  if (typeof v !== 'string' || !v.trim()) throw new HttpException(400, 'Nomi majburiy');
  const nomi = v.trim();
  if (nomi.length > 100) throw new HttpException(400, 'Nomi 100 belgidan oshmasligi kerak');
  return nomi;
}

/* Ro'yxat so'rovining yuqori chegarasi (all=true ham shu bilan cheklanadi) */
const MAKS_QATOR = 5000;
const MAKS_LIMIT = 1000;

/* YYYY-MM-DD formatini tekshiradi (bo'sh — undefined) */
const SANA_RE = /^\d{4}-\d{2}-\d{2}$/;
function sanaTekshir(v, nomi) {
  if (v === undefined || v === null || v === '') return undefined;
  const s = String(v);
  if (!SANA_RE.test(s) || Number.isNaN(new Date(s + 'T00:00:00Z').getTime())) {
    throw new HttpException(400, `${nomi} sanasi noto'g'ri (YYYY-MM-DD)`);
  }
  return s;
}

const INCLUDE = [
  { model: TerritoriyaModel,     as: 'territoriya', attributes: ['id','nomi'] },
  { model: MijozKategoriyaModel, as: 'kategoriya',  attributes: ['id','nomi'] },
  { model: AgentModel,           as: 'agent',       attributes: ['id','fullname','avtolavka'] },
];

class MijozController {

  /* GET /mijozlar */
  getAll = async (req, res) => {
    const {
      search, territoriya_id, kategoriya_id, agent_id,
      sinf, faol, kanal, page = 1, limit = 50, all, reyting, tartib, qarzdor,
    } = req.query;

    const where = {};
    // Kanal: avtolavka mijozi (agenti mashinadan sotadi) yoki distributsiya mijozi (zakaz → dostavchik)
    if (kanal === 'avtolavka')     where['$agent.avtolavka$'] = true;
    if (kanal === 'distributsiya') where[Op.or] = [{ agent_id: null }, { '$agent.avtolavka$': false }];
    if (search) where.nomi = { [Op.like]: `%${search}%` };
    if (territoriya_id) where.territoriya_id = territoriya_id;
    if (kategoriya_id)  where.kategoriya_id  = kategoriya_id;
    if (agent_id)       where.agent_id       = agent_id;
    if (sinf)           where.sinf           = sinf;
    if (faol !== undefined && faol !== '') where.faol = faol === 'true';
    // Reyting darajasi: alo | yaxshi | orta | past | kritik (utils/reyting.utils.js DARAJALAR)
    // 'diqqat' — Past va Kritik birga (ro'yxat tepasidagi "Diqqat talab" kartasi)
    if (reyting) {
      const c = reyting === 'diqqat' ? { dan: 0, gacha: darajaChegara('past').gacha } : darajaChegara(reyting);
      if (c) where.reyting = { [Op.between]: [c.dan, c.gacha] };
    }
    if (qarzdor === '1') where.balans = { [Op.lt]: 0 };
    const order = tartib === 'reyting' ? [['reyting', 'ASC'], ['nomi', 'ASC']]
      : tartib === 'reyting_desc' ? [['reyting', 'DESC'], ['nomi', 'ASC']] : [['nomi', 'ASC']];

    if (all === 'true') {
      const rows = await MijozModel.findAll({ where, include: INCLUDE, order, limit: MAKS_QATOR });
      return res.send(rows);
    }

    // page/limit: NaN yoki haddan katta qiymatlar cheklanadi
    const lim = Math.min(MAKS_LIMIT, Math.max(1, parseInt(limit) || 50));
    const pg  = Math.max(1, parseInt(page) || 1);
    const offset = (pg - 1) * lim;
    const { count, rows } = await MijozModel.findAndCountAll({
      where, include: INCLUDE,
      order,
      limit: lim,
      offset,
    });

    res.send({ count, rows, page: pg, pages: Math.ceil(count / lim) });
  };

  /* GET /mijozlar/reyting/xulosa — faol mijozlar darajalar bo'yicha (ro'yxat tepasidagi chiplar) */
  reytingXulosa = async (req, res) => {
    const [r] = await sequelize.query(`SELECT ${DARAJALAR.map((d, i) => `SUM(reyting BETWEEN ${d.min} AND ${i === 0 ? REYTING_MAX : DARAJALAR[i - 1].min - 1}) \`${d.kod}\``).join(', ')},
        COUNT(*) jami, ROUND(AVG(reyting)) ortacha,
        SUM(balans < 0) qarzdor, COALESCE(-SUM(CASE WHEN balans < 0 THEN balans END), 0) qarz,
        SUM(tolov_vada_sana IS NOT NULL AND tolov_vada_sana < CURDATE() AND balans < 0) vada_otgan
      FROM mijoz WHERE deletedAt IS NULL AND faol = 1`, { type: sequelize.QueryTypes.SELECT });
    res.send({
      darajalar: DARAJALAR.map(d => ({ kod: d.kod, nom: d.nom, min: d.min, soni: Number(r[d.kod]) || 0 })),
      jami: Number(r.jami) || 0, ortacha: Number(r.ortacha) || 0,
      qarzdor: Number(r.qarzdor) || 0, qarz: Number(r.qarz) || 0, vada_otgan: Number(r.vada_otgan) || 0,
    });
  };

  /* GET /mijozlar/:id/reyting — joriy ball, daraja, savdo/moliya qismlari, qoidalar va tarix */
  reyting = async (req, res) => {
    const m = await MijozModel.findByPk(req.params.id, { attributes: ['id', 'nomi', 'balans', 'reyting', 'reyting_savdo', 'reyting_moliya', 'rad_ketma_ket', 'tolov_vada_sana', 'reyting_vaqt'] });
    if (!m) throw new HttpException(404, 'Mijoz topilmadi');
    const [Q, tarix, stat] = await Promise.all([
      reytingQoidalari(),
      MijozReytingModel.findAll({ where: { mijoz_id: m.id }, order: [['sana', 'DESC'], ['id', 'DESC']], limit: Math.min(300, Number(req.query.limit) || 100) }),
      sequelize.query(`SELECT tur, COUNT(*) soni, SUM(ball) ball FROM mijoz_reyting WHERE mijoz_id = :id GROUP BY tur`,
        { replacements: { id: m.id }, type: sequelize.QueryTypes.SELECT }),
    ]);
    const d = reytingDaraja(m.reyting);
    res.send({
      mijoz_id: m.id, reyting: Number(m.reyting), daraja: d.kod, daraja_nomi: d.nom,
      savdo: Number(m.reyting_savdo), moliya: Number(m.reyting_moliya), rad_ketma_ket: Number(m.rad_ketma_ket) || 0,
      kritikgacha: Math.max(0, Q.kritik_soni - (Number(m.rad_ketma_ket) || 0)),
      tolov_vada_sana: m.tolov_vada_sana, yangilangan: m.reyting_vaqt, qoidalar: Q,
      statistika: Object.fromEntries(stat.map(s => [s.tur, { soni: Number(s.soni), ball: Number(s.ball) || 0 }])),
      tarix,
    });
  };

  /* POST /mijozlar/:id/reyting { ball, yonalish: savdo|moliya, izoh } — admin tuzatishi */
  reytingTuzat = async (req, res) => {
    if (!adminMi(req.currentUser)) throw new HttpException(403, "Reytingni faqat Admin tuzata oladi");
    const ball = Math.round(Number(req.body.ball));
    const izoh = String(req.body.izoh || '').trim();
    if (!ball || Math.abs(ball) > 100) throw new HttpException(400, 'Ball −100…+100 oralig\'ida, 0 dan farqli bo\'lsin');
    if (izoh.length < 3) throw new HttpException(400, 'Sababini yozing');
    const m = await MijozModel.findByPk(req.params.id, { attributes: ['id'] });
    if (!m) throw new HttpException(404, 'Mijoz topilmadi');
    const u = req.currentUser || {};
    const r = await reytingYoz(m.id, {
      tur: 'qolda', ball, yonalish: req.body.yonalish === 'moliya' ? 'moliya' : 'savdo', sabab: 'Admin tuzatishi', izoh,
      manba_tur: 'web', xodim: { rol: 'web', id: u.id || null, nomi: u.username || u.fullname || null },
    });
    res.status(201).send({ reyting: r.reyting, daraja: r.daraja.kod, ball: r.yozuv.ball });
  };

  /* GET /mijozlar/:id */
  getById = async (req, res) => {
    const m = await MijozModel.findByPk(req.params.id, { include: INCLUDE });
    if (!m) throw new HttpException(404, 'Mijoz topilmadi');
    res.send(m);
  };

  /* POST /mijozlar */
  create = async (req, res) => {
    const body = this.#normalize(req.body);
    await this.#boglanganlar(body);
    // Yangi mijoz: joriy balans = boshlang'ich qoldiq (manfiy — mijoz qarzdor, musbat — mijoz haqdor)
    if (body.boshlangich_balans !== undefined && body.boshlangich_balans !== null) body.balans = +Number(body.boshlangich_balans).toFixed(2);
    const m = await MijozModel.create(body);
    const full = await MijozModel.findByPk(m.id, { include: INCLUDE });
    res.status(201).send(full);
  };

  /* PATCH /mijozlar/:id */
  update = async (req, res) => {
    const body = this.#normalize(req.body);
    await this.#boglanganlar(body);
    const m = await sequelize.transaction(async (t) => {
      // Mijoz qatori tranzaksiya ichida qulflanib o'qiladi: farq shu yangi nusxadan hisoblanadi —
      // ikki marta bosilganda (parallel so'rov) balans ikki marta surilmaydi
      const m = await MijozModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!m) throw new HttpException(404, 'Mijoz topilmadi');
      // Boshlang'ich qoldiq o'zgarsa — joriy balans shu farqga suriladi (savdo/to'lovlar tarixi o'z joyida qoladi)
      const yangi = body.boshlangich_balans;
      const farq = (yangi === undefined || yangi === null) ? 0 : +(Number(yangi) - parseFloat(m.boshlangich_balans || 0)).toFixed(2);
      await m.update(body, { transaction: t });
      if (Math.abs(farq) > 0.005) await MijozModel.increment('balans', { by: farq, where: { id: m.id }, transaction: t });
      return m;
    });
    const full = await MijozModel.findByPk(m.id, { include: INCLUDE });
    res.send(full);
  };

  /** Hudud, kategoriya va agent id'lari bazada bormi (yo'q id FK xatosi — 500 bermasin) */
  async #boglanganlar(b) {
    const tekshir = async (kalit, Model, nom) => {
      const v = b[kalit];
      if (v === undefined || v === null || v === '') return;
      const id = Number(v);
      if (!Number.isInteger(id) || id <= 0) throw new HttpException(400, `${kalit} noto'g'ri`);
      if (!await Model.findByPk(id, { attributes: ['id'] })) throw new HttpException(400, `${nom} topilmadi (${kalit}=${id})`);
    };
    await tekshir('territoriya_id', TerritoriyaModel, 'Hudud');
    await tekshir('kategoriya_id', MijozKategoriyaModel, 'Kategoriya');
    await tekshir('agent_id', AgentModel, 'Agent');
  }

  #normalize(body) {
    // Faqat ruxsat etilgan maydonlar (balans, reyting va h.k. so'rovdan o'zgartirilmaydi)
    const b = {};
    for (const k of TAHRIR_MAYDONLAR) if (body && Object.prototype.hasOwnProperty.call(body, k)) b[k] = body[k];
    for (const k of ['shartnoma_sana', 'boshlangich_sana']) if (b[k] === '') b[k] = null;
    if (b.boshlangich_izoh === '') b.boshlangich_izoh = null;
    // boshlangich_balans NOT NULL — null/bo'sh yuborilsa e'tiborsiz qoldiriladi
    if (b.boshlangich_balans === null || b.boshlangich_balans === '') delete b.boshlangich_balans;
    return b;
  }

  /* DELETE /mijozlar/:id */
  /* O'chirish: balansi 0 bo'lmagan yoki ochiq buyurtmasi bor mijoz o'chirilmaydi
   * (qarz hisobotdan "yo'qolmasin", yo'ldagi buyurtma egasiz qolmasin). Tranzaksiya + qulf. */
  delete = async (req, res) => {
    await sequelize.transaction(async (t) => {
      const m = await MijozModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!m) throw new HttpException(404, 'Mijoz topilmadi');
      const balans = parseFloat(m.balans) || 0;
      if (Math.abs(balans) > 0.005) {
        throw new HttpException(400, `Mijozni o'chirib bo'lmaydi: balansi 0 emas (${+balans.toFixed(2)}). Avval hisob-kitobni yoping yoki mijozni nofaol qiling`);
      }
      const ochiq = await ArizaModel.count({
        where: { mijoz_id: m.id, holat: { [Op.notIn]: ARIZA_YAKUNIY } }, transaction: t,
      });
      if (ochiq > 0) {
        throw new HttpException(400, `Mijozni o'chirib bo'lmaydi: ${ochiq} ta ochiq buyurtmasi bor. Avval ularni yakunlang yoki bekor qiling`);
      }
      await m.destroy({ transaction: t });
    });
    res.send({ message: 'O\'chirildi' });
  };

  /* GET /mijozlar/xarita — "Xaritadagi mijozlar" ekrani uchun
   *
   * Bitta so'rovda: filtrlangan mijozlar (koordinatasi bilan) + agentlar
   * kesimidagi qamrov statistikasi. Qamrov = tanlangan davrda mijozga
   * tashrif bo'lganmi (savdo yoki sotmaslik — ikkalasi ham tashrif).
   *
   * Filtrlar: agent_id, territoriya_id, kategoriya_id, sinf, faol,
   *           kun (Du/Se/Ch/Pa/Ju/Sh — tashrif_kunlari bo'yicha),
   *           tashrif (bari|qamralgan|qamralmagan), search
   */
  xarita = async (req, res) => {
    const {
      agent_id, territoriya_id, kategoriya_id, sinf, faol,
      kun, tashrif = 'bari', search, dan, gacha,
    } = req.query;

    const where = {};
    if (search)         where.nomi           = { [Op.like]: `%${search}%` };
    if (territoriya_id) where.territoriya_id = territoriya_id;
    if (kategoriya_id)  where.kategoriya_id  = kategoriya_id;
    if (agent_id)       where.agent_id       = agent_id;
    if (sinf)           where.sinf           = sinf;
    if (faol !== undefined && faol !== '') where.faol = faol === 'true';
    // tashrif_kunlari "Du, Se, Ch" ko'rinishida saqlanadi
    if (kun) where.tashrif_kunlari = { [Op.like]: `%${kun}%` };

    const mijozlar = await MijozModel.findAll({
      where, include: INCLUDE, order: [['nomi', 'ASC']], limit: 3000,
    });

    // ── Davr ichida qaysi mijozga tashrif bo'lgan ──
    const oraliq = kunOraligi({ dan, gacha }, 'dan', 'gacha');
    const sanaSharti = {};
    if (oraliq.from) sanaSharti[Op.gte] = oraliq.from;
    if (oraliq.to)   sanaSharti[Op.lte] = oraliq.to;

    const tashrifWhere = {};
    if (dan || gacha) tashrifWhere.sana = sanaSharti;
    if (agent_id)     tashrifWhere.agent_id = agent_id;

    const tashriflar = await TashrifModel.findAll({
      where: tashrifWhere,
      attributes: ['mijoz_id', 'agent_id', 'natija'],
      limit: 10000,
    });

    const qamralganlar = new Set(tashriflar.map(t => t.mijoz_id));

    let rows = mijozlar.map(m => {
      const j = m.toJSON();
      return {
        ...j,
        lat: j.lat != null ? Number(j.lat) : null,
        lng: j.lng != null ? Number(j.lng) : null,
        qamralgan: qamralganlar.has(j.id),
      };
    });

    if (tashrif === 'qamralgan')    rows = rows.filter(r => r.qamralgan);
    if (tashrif === 'qamralmagan')  rows = rows.filter(r => !r.qamralgan);

    // ── Agentlar kesimi: "3 / 12" ko'rinishidagi qamrov ──
    const agentlar = await AgentModel.findAll({
      where: { faol: true },
      attributes: ['id', 'fullname', 'telefon', 'territoriya_id'],
      order: [['fullname', 'ASC']],
    });

    const agentStat = agentlar.map(a => {
      const oz = rows.filter(r => r.agent_id === a.id);
      return {
        id: a.id,
        fullname: a.fullname,
        telefon: a.telefon,
        mijoz_soni: oz.length,
        qamralgan:  oz.filter(r => r.qamralgan).length,
        koordinatali: oz.filter(r => r.lat != null).length,
      };
    }).filter(a => a.mijoz_soni > 0);

    res.send({
      mijozlar: rows,
      jami: rows.length,
      koordinatali: rows.filter(r => r.lat != null).length,
      qamralgan:    rows.filter(r => r.qamralgan).length,
      agentlar: agentStat,
    });
  };

  /* GET /mijozlar/:id/oldi-berdi?dan=&gacha=
   *
   * Mijozning oldi-berdi tarixi — bitta vaqt o'qida:
   *   OLDI  = yetkazilgan savdo (ariza)      → qarz oshadi
   *   BERDI = kassaga tushgan to'lov (kassa) → qarz kamayadi
   *
   * Har qatorda yuguruvchi qoldiq: shu harakatdan keyin qancha qarz
   * qolgani. Jadval o'zini o'zi tekshiradi — oxirgi qator umumiy qoldiqqa
   * teng bo'lishi shart.
   */
  oldiBerdi = async (req, res) => {
    const mijoz = await MijozModel.findByPk(req.params.id, { include: INCLUDE });
    if (!mijoz) throw new HttpException(404, 'Mijoz topilmadi');

    // Sanalar faqat YYYY-MM-DD; SQL ga replacements orqali beriladi (SQL injection yo'q)
    const dan   = sanaTekshir(req.query.dan, 'dan');
    const gacha = sanaTekshir(req.query.gacha, 'gacha');
    const sanaRepl = { ...(dan ? { dan } : {}), ...(gacha ? { gacha } : {}) };
    // ustun — faqat kod ichidagi o'zgarmas ifoda (foydalanuvchi qiymati emas)
    const sanaSharti = (ustun) => {
      if (!dan && !gacha) return '';
      if (dan && gacha) return ` AND DATE(${ustun}) BETWEEN :dan AND :gacha`;
      if (dan)          return ` AND DATE(${ustun}) >= :dan`;
      return ` AND DATE(${ustun}) <= :gacha`;
    };

    // ── OLDI: yetkazilgan savdolar ──
    const savdolar = await sequelize.query(`
      SELECT a.id, a.raqam, a.jami_summa, a.chegirma_summa, a.tolov_turi,
             COALESCE(a.yetkazilgan_sana, a.createdAt) AS sana,
             a.agent_nomi, a.holat
      FROM ariza a
      WHERE a.mijoz_id = :id AND a.deletedAt IS NULL
        AND a.turi = 'sotish' AND a.holat = 'yetkazildi'
        ${sanaSharti('COALESCE(a.yetkazilgan_sana, a.createdAt)')}
      ORDER BY sana ASC`,
      { replacements: { id: mijoz.id, ...sanaRepl }, type: sequelize.QueryTypes.SELECT });

    // ── BERDI: mijozdan tushgan pul ──
    const tolovlar = await sequelize.query(`
      SELECT k.id, k.summa, k.sana, k.tolov_usul, k.kategoriya, k.izoh
      FROM kassa k
      WHERE k.mijoz_id = :id AND k.tur = 'kirim'
        ${sanaSharti('k.sana')}
      ORDER BY k.sana ASC`,
      { replacements: { id: mijoz.id, ...sanaRepl }, type: sequelize.QueryTypes.SELECT });

    // ── Boshlang'ich qoldiq: kartadagi balans harakatlardan farq qilsa (eski tizimdan ko'chirilgan qarz) ──
    // Butun tarix bo'yicha: qarz = Σ savdo − Σ to'lov; kartada undan ortig'i — boshlang'ich qoldiq.
    const [[hamma]] = await sequelize.query(`
      SELECT (SELECT COALESCE(SUM(jami_summa), 0) FROM ariza WHERE mijoz_id = :id AND deletedAt IS NULL AND turi = 'sotish' AND holat = 'yetkazildi') AS oldi,
             (SELECT COALESCE(SUM(summa), 0)      FROM kassa WHERE mijoz_id = :id AND tur = 'kirim') AS berdi`,
      { replacements: { id: mijoz.id } });
    const boshlangich = +((-parseFloat(mijoz.balans || 0)) - (parseFloat(hamma.oldi || 0) - parseFloat(hamma.berdi || 0))).toFixed(2);
    const boshQator = (!dan && Math.abs(boshlangich) > 0.5) ? [{
      tur: 'boshlangich', sana: mijoz.boshlangich_sana ? new Date(mijoz.boshlangich_sana + 'T00:00:00') : mijoz.createdAt, hujjat: 'BOSHL.',
      izoh: `Boshlang'ich qoldiq — ${boshlangich > 0 ? 'mijoz qarzdor' : 'mijoz haqdor (biz qarzdormiz)'}${mijoz.boshlangich_izoh ? ' · ' + mijoz.boshlangich_izoh : ''}`,
      tolov_usul: null, oldi: boshlangich > 0 ? boshlangich : 0, berdi: boshlangich < 0 ? -boshlangich : 0, manba_id: 0,
    }] : [];

    // ── Bitta vaqt o'qiga birlashtiramiz ──
    const harakatlar = [
      ...boshQator,
      ...savdolar.map(a => ({
        tur: 'oldi',
        sana: a.sana,
        hujjat: a.raqam || `#${a.id}`,
        izoh: a.agent_nomi ? `Agent: ${a.agent_nomi}` : 'Savdo',
        tolov_usul: a.tolov_turi || null,
        oldi: parseFloat(a.jami_summa || 0),
        berdi: 0,
        manba_id: a.id,
      })),
      ...tolovlar.map(k => ({
        tur: 'berdi',
        sana: k.sana,
        hujjat: `TL-${k.id}`,
        izoh: k.izoh || KATEGORIYA_NOMI[k.kategoriya] || "To'lov",
        tolov_usul: k.tolov_usul || null,
        oldi: 0,
        berdi: parseFloat(k.summa || 0),
        manba_id: k.id,
      })),
    ].sort((x, y) => (x.tur === 'boshlangich' ? -1 : y.tur === 'boshlangich' ? 1 : new Date(x.sana) - new Date(y.sana)));

    // ── Yuguruvchi qoldiq ──
    let qoldiq = 0;
    const qatorlar = harakatlar.map(h => {
      qoldiq += h.oldi - h.berdi;
      return { ...h, qoldiq: +qoldiq.toFixed(2) };
    });

    const jamiOldi  = qatorlar.reduce((s, h) => s + h.oldi, 0);
    const jamiBerdi = qatorlar.reduce((s, h) => s + h.berdi, 0);

    // Oxirgi to'lovdan beri necha kun o'tgani — muddat nazorati uchun
    const oxirgiTolov = tolovlar.length ? tolovlar[tolovlar.length - 1].sana : null;
    const kunOtgan = oxirgiTolov
      ? Math.floor((Date.now() - new Date(oxirgiTolov).getTime()) / 86400000)
      : null;

    res.send({
      mijoz: {
        id: mijoz.id, nomi: mijoz.nomi, telefon: mijoz.telefon,
        manzil: mijoz.manzil, sinf: mijoz.sinf,
        agent: mijoz.agent?.fullname || null,
        territoriya: mijoz.territoriya?.nomi || null,
        kredit_limit: parseFloat(mijoz.kredit_limit || 0),
        tolov_muddati_kun: mijoz.tolov_muddati_kun,
        // Mijoz kartasidagi rasmiy balans — harakatlardan farq qilishi mumkin
        rasmiy_balans: parseFloat(mijoz.balans || 0),
        boshlangich_balans: parseFloat(mijoz.boshlangich_balans || 0),
        boshlangich_sana: mijoz.boshlangich_sana || null, boshlangich_izoh: mijoz.boshlangich_izoh || null,
      },
      jami: {
        oldi: +jamiOldi.toFixed(2),
        berdi: +jamiBerdi.toFixed(2),
        qoldiq: +(jamiOldi - jamiBerdi).toFixed(2),
        boshlangich: boshQator.length ? boshlangich : 0,
        savdo_soni: savdolar.length,
        tolov_soni: tolovlar.length,
        oxirgi_tolov: oxirgiTolov,
        oxirgi_tolovdan_kun: kunOtgan,
        // Kredit limitidan oshib ketganmi
        limit_oshdi: parseFloat(mijoz.kredit_limit || 0) > 0 &&
                     (jamiOldi - jamiBerdi) > parseFloat(mijoz.kredit_limit || 0),
      },
      qatorlar,
      davr: { dan: dan || null, gacha: gacha || null },
    });
  };

  /* GET /mijozlar/spravochnik  — kategoriya, territoriya, agentlar */
  spravochnik = async (req, res) => {
    const [territoriyalar, kategoriyalar, agentlar] = await Promise.all([
      TerritoriyaModel.findAll({ order: [['nomi','ASC']] }),
      MijozKategoriyaModel.findAll({ order: [['nomi','ASC']] }),
      // Agentlar alohida jadvaldan olinadi
      AgentModel.findAll({
        attributes: ['id', 'fullname', 'telefon', 'territoriya_id'],
        where: { faol: true },
        order: [['fullname', 'ASC']],
      }),
    ]);
    res.send({ territoriyalar, kategoriyalar, agentlar });
  };

  /* ── Territoriya CRUD ───────────────────────────── */
  territoriyaCreate = async (req, res) => {
    const nomi = nomiTekshir(req.body, true);
    const t = await TerritoriyaModel.create({ nomi, izoh: req.body.izoh || null });
    res.status(201).send(t);
  };

  territoriyaUpdate = async (req, res) => {
    const t = await TerritoriyaModel.findByPk(req.params.id);
    if (!t) throw new HttpException(404, 'Topilmadi');
    const nomi = nomiTekshir(req.body, false);
    const upd = { izoh: req.body.izoh };
    if (nomi !== undefined) upd.nomi = nomi;
    await t.update(upd);
    res.send(t);
  };

  territoriyaDelete = async (req, res) => {
    const t = await TerritoriyaModel.findByPk(req.params.id);
    if (!t) throw new HttpException(404, 'Topilmadi');
    await t.destroy();
    res.send({ message: 'O\'chirildi' });
  };

  /* ── Kategoriya CRUD ────────────────────────────── */
  // Narx ro'yxati id'sini tekshiradi (null — biriktirilmagan, standart ro'yxat ishlaydi)
  async narxRuyxatTekshir(id) {
    if (id === undefined || id === null || id === '') return null;
    const { NarxRuyxatModel } = require('../../models/narxRuyxat.model');
    const r = await NarxRuyxatModel.findByPk(id, { attributes: ['id'] });
    if (!r) throw new HttpException(400, 'Narx ro\'yxati topilmadi');
    return r.id;
  }

  kategoriyaCreate = async (req, res) => {
    const nomi = nomiTekshir(req.body, true);
    const narx_ruyxat_id = await this.narxRuyxatTekshir(req.body.narx_ruyxat_id);
    const k = await MijozKategoriyaModel.create({ nomi, izoh: req.body.izoh || null, narx_ruyxat_id });
    res.status(201).send(k);
  };

  kategoriyaUpdate = async (req, res) => {
    const k = await MijozKategoriyaModel.findByPk(req.params.id);
    if (!k) throw new HttpException(404, 'Topilmadi');
    const nomi = nomiTekshir(req.body, false);
    const upd = { izoh: req.body.izoh };
    if (nomi !== undefined) upd.nomi = nomi;
    if ('narx_ruyxat_id' in req.body) upd.narx_ruyxat_id = await this.narxRuyxatTekshir(req.body.narx_ruyxat_id);
    await k.update(upd);
    res.send(k);
  };

  kategoriyaDelete = async (req, res) => {
    const k = await MijozKategoriyaModel.findByPk(req.params.id);
    if (!k) throw new HttpException(404, 'Topilmadi');
    await k.destroy();
    res.send({ message: 'O\'chirildi' });
  };
}

module.exports = new MijozController();
