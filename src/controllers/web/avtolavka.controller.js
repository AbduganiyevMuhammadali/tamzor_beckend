/**
 * AVTOLAVKA (ko'chma savdo)
 *
 * Agent ertalab tovarni mashinaga yuklaydi, mijozlarga bevosita sotadi,
 * kechqurun naqdni kassaga va qolgan tovarni skladga topshiradi.
 *
 *   yuklash  — asosiy ombor → agent ombori ("Agent: <ism>"), hujjat tasdiqlanganda
 *   sotuv    — mobil ilovadan, chiqim agent omboridan (mobile/savdo.controller.js)
 *   qabul    — agent ombori → asosiy ombor; farq agent omborida qoladi, brak alohida
 *   solishtirma — bir agent, bir kun: tovar balansi + pul balansi
 *
 * Ombor harakati tovar_register orqali: o'tkazma ikki yozuv (chiqim + kirim),
 * ikkalasi tannarxda — jami ombor qiymati o'zgarmaydi, tovar faqat joy almashtiradi.
 */
const { Op } = require('sequelize');
const { kunParam, kunOraligi, kunBoshi, kunOxiri } = require('../../utils/sana.utils');
const sequelize = require('../../db/db-sequelize');
const { AvtolavkaHujjatModel, AvtolavkaQatorModel, AvtolavkaKunModel } = require('../../models/avtolavka.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const AgentModel = require('../../models/agent.model');
const TovarModel = require('../../models/tovar.model');
const TovarRegisterModel = require('../../models/tovar_register.model');
const HttpException = require('../../utils/HttpException.utils');
const { ASOSIY_OMBOR, AGENT_PREFIKS, agentOmbori } = require('../../utils/ombor.utils');
const { mavjudQoldiq } = require('../../utils/zaxira.utils');
const { SOTUV_RADIUS_M } = require('../../utils/geo.utils');
const { davr } = require('../../utils/tahlil.utils');
const { MijozModel } = require('../../models/mijoz.model');
const { narxXaritasi, agentNarxXaritasi } = require('../../utils/narx.utils');
const { kreditTekshir } = require('../../utils/kreditLimit.utils');
const { createAriza } = require('../mobile/savdo.controller');
const { agentPlastikKassalar } = require('../../utils/agentPul.utils');
const { yetkazilganSotuvniBekorQil, adminTekshir } = require('../../utils/sotuvBekor.utils');
const { qulflabOl, tovarlarniQulfla } = require('../../utils/qulf.utils');
const { tzOffset } = require('../../utils/tahlil.utils');
const {
  BRAK_OMBOR, INCLUDE, EPS, bugun, sanaMi, n, lokalKun,
  raqamYarat, avtolavkaAgent, narxMap, omborQoldiq, yuklashQoldigi, regYozuv, qatorlarniTayyorla,
  yuklashniTasdiqla, kunHisobla, kunniQaytaOch, kunVoqealari, tavsiyaHisobla,
} = require('../../utils/avtolavka.utils');

/* ══════════════════════════════════════════════════════════ */
class AvtolavkaController {

  // GET /avtolavka/agentlar — avtolavka rejimidagi agentlar + mashinadagi qoldiq
  agentlar = async (req, res) => {
    const agentlar = await AgentModel.findAll({
      where: { faol: true, avtolavka: true },
      attributes: ['id', 'fullname', 'telefon', 'mashina_raqam', 'transport'],
      order: [['fullname', 'ASC']],
    });
    const sana = bugun();
    const natija = await Promise.all(agentlar.map(async a => {
      const ombor = agentOmbori(a.fullname);
      const [[q], [h]] = await Promise.all([
        sequelize.query(`SELECT COUNT(*) tovar_soni, COALESCE(SUM(q),0) dona, COALESCE(SUM(s),0) summa FROM (
            SELECT tovar_id, SUM(donada) q, SUM(donada * COALESCE(NULLIF(sotuv_narx,0), kirim_narx)) s
            FROM tovar_register WHERE ombor = :ombor GROUP BY tovar_id HAVING q > 0.001) x`,
          { replacements: { ombor }, type: sequelize.QueryTypes.SELECT }),
        sequelize.query(`SELECT
            MAX(CASE WHEN tur = 'yuklash' AND holat = 'tasdiqlangan' THEN raqam END) yuklash,
            MAX(CASE WHEN tur = 'qabul' THEN raqam END) qabul
          FROM avtolavka_hujjat WHERE agent_id = :id AND sana = :sana`,
          { replacements: { id: a.id, sana }, type: sequelize.QueryTypes.SELECT }),
      ]);
      return {
        ...a.toJSON(), ombor,
        qoldiq: { tovar_soni: +q.tovar_soni, dona: n(q.dona), summa: n(q.summa) },
        bugun: { yuklash: h.yuklash || null, qabul: h.qabul || null },
      };
    }));
    res.send(natija);
  };

  // GET /avtolavka/tovarlar?search= — asosiy ombordagi qoldiq va narxlar (yuklash formasi)
  tovarlar = async (req, res) => {
    const { search, all } = req.query;
    const where = { faol: true, turi: 'tovar' };   // xom ashyo mashinaga yuklanmaydi
    if (search) where.nomi = { [Op.like]: `%${search}%` };
    const tovarlar = await TovarModel.findAll({
      where, attributes: ['id', 'nomi', 'turkum', 'blokdagi_soni', 'olchov_birligi'],
      order: [['nomi', 'ASC']], raw: true,
    });
    // qoldiq — yuklash mumkin bo'lgan MAVJUD miqdor (distributsiya zakazlariga band qilingani ayirilgan;
    // tasdiqlash ham shu bilan tekshiradi — avtolavka.utils yuklashniTasdiqla)
    const [mavjud, narx] = await Promise.all([mavjudQoldiq({ tovarIds: tovarlar.map(t => t.id) }), narxMap(tovarlar.map(t => t.id))]);
    res.send(tovarlar
      .map(t => ({
        ...t, qoldiq: mavjud.get(t.id)?.mavjud || 0, band: mavjud.get(t.id)?.band || 0,
        ...(narx[t.id] || { kirim_narx: 0, optom_narx: 0, chakana_narx: 0 }),
      }))
      .filter(t => all === 'true' || t.qoldiq > EPS));
  };

  // GET /avtolavka/hujjatlar?tur=&agent_id=&date_from=&date_to=&holat=
  ruyxat = async (req, res) => {
    const { tur, agent_id, date_from, date_to, holat, limit = 100 } = req.query;
    const where = {};
    if (tur)      where.tur = tur;
    if (agent_id) where.agent_id = agent_id;
    if (holat)    where.holat = holat;
    const oraliq = kunOraligi({ date_from, date_to });
    if (oraliq.from || oraliq.to) {
      where.sana = {};
      if (oraliq.from) where.sana[Op.gte] = oraliq.from;
      if (oraliq.to)   where.sana[Op.lte] = oraliq.to;
    }
    const rows = await AvtolavkaHujjatModel.findAll({
      where, include: INCLUDE, order: [['sana', 'DESC'], ['id', 'DESC']],
      limit: Math.min(500, parseInt(limit) || 100),
    });
    res.send(rows);
  };

  // GET /avtolavka/hujjatlar/:id
  getById = async (req, res) => {
    const h = await AvtolavkaHujjatModel.findByPk(req.params.id, { include: INCLUDE });
    if (!h) throw new HttpException(404, 'Hujjat topilmadi');
    res.send(h);
  };

  // POST /avtolavka/yuklash  { agent_id, sana, izoh, qatorlar:[{tovar_id, dona, blok, narx}], tasdiqla }
  yuklashCreate = async (req, res) => {
    const { agent_id, sana, izoh, qatorlar, tasdiqla } = req.body;
    const agent = await avtolavkaAgent(agent_id);
    const tayyor = await qatorlarniTayyorla(qatorlar);
    const t = await sequelize.transaction();
    let hujjat;
    try {
      hujjat = await AvtolavkaHujjatModel.create({
        raqam: await raqamYarat('yuklash', t), tur: 'yuklash',
        agent_id: agent.id, agent_nomi: agent.fullname, ombor: agentOmbori(agent.fullname),
        sana: sanaMi(sana) ? sana : bugun(), holat: 'qoralama', izoh: izoh || null,
        yaratgan_id: req.currentUser?.id || null,
        jami_dona: tayyor.reduce((s, q) => s + q.dona, 0),
        jami_summa: tayyor.reduce((s, q) => s + q.summa, 0),
      }, { transaction: t });
      await AvtolavkaQatorModel.bulkCreate(tayyor.map(q => ({ ...q, hujjat_id: hujjat.id })), { transaction: t });
      if (tasdiqla) await yuklashniTasdiqla(hujjat, req.currentUser?.id, t);
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
    res.status(201).send(await AvtolavkaHujjatModel.findByPk(hujjat.id, { include: INCLUDE }));
  };

  // PATCH /avtolavka/yuklash/:id — faqat qoralama
  yuklashUpdate = async (req, res) => {
    const { sana, izoh, qatorlar } = req.body;
    const t = await sequelize.transaction();
    let hujjat;
    try {
      // Qulflab qayta o'qiladi — parallel tasdiqlash qatorlarni o'qib bo'lgach ular almashtirilmasin
      hujjat = await qulflabOl(AvtolavkaHujjatModel, req.params.id, t);
      if (!hujjat || hujjat.tur !== 'yuklash') throw new HttpException(404, 'Yuklash hujjati topilmadi');
      if (hujjat.holat !== 'qoralama') throw new HttpException(400, 'Tasdiqlangan hujjatni o\'zgartirib bo\'lmaydi');
      const yangi = {};
      if (sanaMi(sana)) yangi.sana = sana;
      if (izoh !== undefined) yangi.izoh = izoh || null;
      if (qatorlar) {
        const tayyor = await qatorlarniTayyorla(qatorlar);
        await AvtolavkaQatorModel.destroy({ where: { hujjat_id: hujjat.id }, transaction: t });
        await AvtolavkaQatorModel.bulkCreate(tayyor.map(q => ({ ...q, hujjat_id: hujjat.id })), { transaction: t });
        yangi.jami_dona  = tayyor.reduce((s, q) => s + q.dona, 0);
        yangi.jami_summa = tayyor.reduce((s, q) => s + q.summa, 0);
      }
      await hujjat.update(yangi, { transaction: t });
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
    res.send(await AvtolavkaHujjatModel.findByPk(hujjat.id, { include: INCLUDE }));
  };

  // PATCH /avtolavka/yuklash/:id/tasdiqla — tovar agent omboriga o'tadi
  yuklashTasdiqla = async (req, res) => {
    const id = req.params.id;
    const t = await sequelize.transaction();
    let hujjat;
    try {
      // Hujjat yuklashniTasdiqla ichida qulflab qayta o'qiladi va holati shu yerda tekshiriladi
      hujjat = await yuklashniTasdiqla(id, req.currentUser?.id, t);
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
    res.send(await AvtolavkaHujjatModel.findByPk(hujjat.id, { include: INCLUDE }));
  };

  // PATCH /avtolavka/yuklash/:id/rad  { sabab } — agentning mobil so'rovini rad etish
  yuklashRad = async (req, res) => {
    const sabab = String(req.body?.sabab || '').trim().slice(0, 255);
    // Qulf + qayta tekshiruv: parallel tasdiqlangan hujjat (tovar ko'chgan) "bekor" bo'lib qolmasin
    const hujjat = await sequelize.transaction(async (t) => {
      const h = await qulflabOl(AvtolavkaHujjatModel, req.params.id, t);
      if (!h || h.tur !== 'yuklash') throw new HttpException(404, 'Yuklash hujjati topilmadi');
      if (h.holat !== 'qoralama') throw new HttpException(400, `Hujjat "${h.holat}" holatida — rad etib bo'lmaydi`);
      await h.update({ holat: 'bekor', rad_sababi: sabab || 'Omborchi rad etdi' }, { transaction: t });
      return h;
    });
    res.send(await AvtolavkaHujjatModel.findByPk(hujjat.id, { include: INCLUDE }));
  };

  // DELETE /avtolavka/yuklash/:id — faqat qoralama
  yuklashDelete = async (req, res) => {
    // Bitta tranzaksiyada, qulf bilan: tasdiqlangan (tovari ko'chgan) hujjat o'chib ketmasin,
    // qatorlar o'chib hujjat qolib ketmasin
    await sequelize.transaction(async (t) => {
      const hujjat = await qulflabOl(AvtolavkaHujjatModel, req.params.id, t);
      if (!hujjat || hujjat.tur !== 'yuklash') throw new HttpException(404, 'Yuklash hujjati topilmadi');
      if (hujjat.holat !== 'qoralama') throw new HttpException(400, 'Tasdiqlangan hujjatni o\'chirib bo\'lmaydi');
      await AvtolavkaQatorModel.destroy({ where: { hujjat_id: hujjat.id }, transaction: t });
      await hujjat.destroy({ transaction: t });
    });
    res.send({ ok: true });
  };

  // GET /avtolavka/qoldiq?agent_id= — agent omborida hozir turgan tovar (qabul uchun kutilayotgan ro'yxat)
  qoldiq = async (req, res) => {
    const agent = await avtolavkaAgent(req.query.agent_id);
    const ombor = agentOmbori(agent.fullname);
    const map = await omborQoldiq(ombor);
    const ids = Object.keys(map).filter(id => map[id].qoldiq > EPS).map(Number);
    const narx = await narxMap(ids);
    const tovarlar = ids.map(id => ({
      tovar_id: id, tovar_nomi: map[id].tovar_nomi, turkum: map[id].turkum,
      qoldiq: +map[id].qoldiq.toFixed(3),
      narx: narx[id]?.chakana_narx || 0,
      summa: +(map[id].qoldiq * (narx[id]?.chakana_narx || 0)).toFixed(2),
    })).sort((a, b) => a.tovar_nomi.localeCompare(b.tovar_nomi));
    res.send({
      agent: { id: agent.id, fullname: agent.fullname }, ombor, tovarlar,
      jami: {
        tovar_soni: tovarlar.length,
        dona:  +tovarlar.reduce((s, x) => s + x.qoldiq, 0).toFixed(3),
        summa: +tovarlar.reduce((s, x) => s + x.summa, 0).toFixed(2),
      },
    });
  };

  // POST /avtolavka/kun/qayta-och { agent_id } — bugungi yopilgan kunni qayta ochish (bir kunda yangi reys).
  // Ilovadagi "Yangi reys" bilan bir xil (kunniQaytaOch): keyin yuklash → savdo → yana topshirish.
  kunQaytaOch = async (req, res) => {
    const agent = await avtolavkaAgent(req.body.agent_id);
    const sana = bugun();
    const r = await kunniQaytaOch(agent, sana);
    if (!r.ozgardi) throw new HttpException(400, `${agent.fullname}ning bugungi kuni ochiq — qayta ochish shart emas`);
    res.send({ ok: true, sana, yangi_reys: r.yangiReys, kun: await kunHisobla(agent, sana) });
  };

  // POST /avtolavka/qabul  { agent_id, sana, izoh, qatorlar:[{tovar_id, qabul_dona, brak_dona}] }
  // Skladchi sanab qabul qiladi: qabul → asosiy ombor, brak → brak ombori,
  // farq agent omborida qoladi (tushuntirilmagan qoldiq).
  qabulCreate = async (req, res) => {
    const { agent_id, sana, izoh, qatorlar = [] } = req.body;
    const agent = await avtolavkaAgent(agent_id);
    const ombor = agentOmbori(agent.fullname);
    const kiritilgan = {};
    (Array.isArray(qatorlar) ? qatorlar : []).forEach(q => { kiritilgan[q.tovar_id] = q; });

    const t = await sequelize.transaction();
    let hujjat, boshMashina = false;   // javobda ham kerak — try'dan tashqarida e'lon qilinadi
    try {
      // Agent qatori qulflanadi — shu agentning qabullari (ikki marta bosish, ikki omborchi)
      // navbatma-navbat: ikkinchisi birinchisi commit bo'lgach yangilangan (bo'sh) mashinani ko'radi.
      await qulflabOl(AgentModel, agent.id, t);
      // Kutilgan qoldiq qulfdan KEYIN hisoblanadi: tovar qatorlari qulflanadi (parallel sotuv
      // shu tovarlar bo'yicha kutadi), so'ng qoldiq qulflovchi o'qish bilan qayta olinadi.
      const nomzod = await omborQoldiq(ombor, t);
      await tovarlarniQulfla(Object.keys(nomzod), t);
      const kutilgan = await omborQoldiq(ombor, t, { qulfla: true });
      const ids = Object.keys(kutilgan).filter(id => kutilgan[id].qoldiq > EPS).map(Number);
      // Mashina bo'sh (hammasi sotilgan) bo'lsa ham qabul hujjati yoziladi — qatorsiz, 0 kg:
      // kun yopilishi uchun "tovar topshirildi" belgisi aynan shu hujjatdan olinadi (kunHisobla).
      // Ilgari bu yerda xato berilib, hammasini sotgan agentning kunini yopib bo'lmasdi.
      boshMashina = !ids.length;
      const narx = boshMashina ? {} : await narxMap(ids);
      const vaqt = new Date();
      const hujjatSana = sanaMi(sana) ? sana : bugun();
      // Bo'sh mashina qabuli shu kunga allaqachon yozilgan bo'lsa (tugma qayta bosildi) — ikkinchisi yaratilmaydi.
      // Kun qayta ochilgan bo'lsa (yangi reys) — faqat ochilishdan keyingi qabul hisobga olinadi.
      if (boshMashina) {
        const kunYozuv = await AvtolavkaKunModel.findOne({ where: { agent_id: agent.id, sana: hujjatSana }, transaction: t });
        const mavjud = await AvtolavkaHujjatModel.findOne({
          where: {
            agent_id: agent.id, sana: hujjatSana, tur: 'qabul', holat: 'tasdiqlangan',
            ...(kunYozuv && kunYozuv.ochish_vaqt ? { tasdiqlagan_sana: { [Op.gte]: kunYozuv.ochish_vaqt } } : {}),
          }, order: [['id', 'DESC']], transaction: t,
        });
        if (mavjud) {
          await t.commit();
          const full = await AvtolavkaHujjatModel.findByPk(mavjud.id, { include: INCLUDE });
          return res.send({ ...full.toJSON(), _farq: { dona: full.farq_dona, brak: full.brak_dona, farq_bor: full.farq_dona > EPS }, _bosh: true, _mavjud: true });
        }
      }

      hujjat = await AvtolavkaHujjatModel.create({
        raqam: await raqamYarat('qabul', t), tur: 'qabul',
        agent_id: agent.id, agent_nomi: agent.fullname, ombor,
        sana: hujjatSana, holat: 'tasdiqlangan',
        izoh: izoh || (boshMashina ? "Mashina bo'sh — tovar to'liq sotilgan, qaytadigan qoldiq yo'q" : null),
        yaratgan_id: req.currentUser?.id || null,
        tasdiqlagan_id: req.currentUser?.id || null, tasdiqlagan_sana: vaqt,
      }, { transaction: t });

      const qatorYoz = [], regYoz = [];
      let jamiDona = 0, jamiSumma = 0, jamiFarq = 0, jamiBrak = 0;
      for (const id of ids) {
        const k = kutilgan[id];
        const kir = kiritilgan[id] || {};
        // Kiritilmagan tovar to'liq qabul qilingan hisoblanadi
        let qabul = kir.qabul_dona === undefined || kir.qabul_dona === null ? k.qoldiq : n(kir.qabul_dona);
        let brak  = n(kir.brak_dona);
        if (qabul < 0) qabul = 0;
        if (brak < 0) brak = 0;
        if (qabul + brak > k.qoldiq + EPS) {
          throw new HttpException(400, `"${k.tovar_nomi}": qabul (${qabul}) + brak (${brak}) kutilgandan (${k.qoldiq}) ko'p`);
        }
        const farq = +(k.qoldiq - qabul - brak).toFixed(3);
        const nx = narx[id] || { kirim_narx: 0, optom_narx: 0, chakana_narx: 0 };
        const q = { tovar_id: id, tovar_nomi: k.tovar_nomi, turkum: k.turkum, blok: 0, narx: nx.chakana_narx };
        qatorYoz.push({
          hujjat_id: hujjat.id, tovar_id: id, tovar_nomi: k.tovar_nomi, turkum: k.turkum,
          narx: nx.chakana_narx, kirim_narx: nx.kirim_narx, blok: 0,
          dona: qabul, kutilgan_dona: k.qoldiq, qabul_dona: qabul, brak_dona: brak, farq_dona: farq,
          summa: +(qabul * nx.chakana_narx).toFixed(2),
        });
        if (qabul > EPS) {
          regYoz.push(regYozuv({ q, ombor, tur: 'chiqim', manba_tur: 'qabul', manba_id: hujjat.id, dona: qabul, narx: nx, sana: vaqt }));
          regYoz.push(regYozuv({ q, ombor: ASOSIY_OMBOR, tur: 'kirim', manba_tur: 'qabul', manba_id: hujjat.id, dona: qabul, narx: nx, sana: vaqt }));
        }
        if (brak > EPS) {
          regYoz.push(regYozuv({ q, ombor, tur: 'chiqim', manba_tur: 'qabul', manba_id: hujjat.id, dona: brak, narx: nx, sana: vaqt }));
          regYoz.push(regYozuv({ q, ombor: BRAK_OMBOR, tur: 'kirim', manba_tur: 'qabul', manba_id: hujjat.id, dona: brak, narx: nx, sana: vaqt }));
        }
        jamiDona += qabul; jamiSumma += qabul * nx.chakana_narx; jamiFarq += farq; jamiBrak += brak;
      }
      if (qatorYoz.length) await AvtolavkaQatorModel.bulkCreate(qatorYoz, { transaction: t });
      if (regYoz.length) await TovarRegisterModel.bulkCreate(regYoz, { transaction: t });

      // Agent kun davomida mijozdan qaytarib olgan tovar mashinada (shu omborda)
      // turadi va hozirgina sanalib omborga o'tdi. Ularning arizalari ham yopiladi —
      // aks holda "Qaytarish qabuli"da ikkinchi marta ko'chirilib, agent ombori
      // minusga tushardi.
      await sequelize.query(`
        UPDATE ariza_qator q JOIN ariza a ON a.id = q.ariza_id
        SET q.qabul_dona = q.jami_dona
        WHERE a.turi = 'qaytarish' AND a.holat = 'qabul_kutilmoqda' AND a.deletedAt IS NULL
          AND a.agent_id = :agent_id AND a.ombor = :ombor`,
        { replacements: { agent_id: agent.id, ombor }, transaction: t });
      await ArizaModel.update({
        holat: 'qabul_qilindi', ombor: ASOSIY_OMBOR,
        qabul_qilgan_id: req.currentUser?.id || null, qabul_sana: vaqt,
      }, {
        where: { turi: 'qaytarish', holat: 'qabul_kutilmoqda', agent_id: agent.id, ombor },
        transaction: t,
      });
      await hujjat.update({
        jami_dona: +jamiDona.toFixed(3), jami_summa: +jamiSumma.toFixed(2),
        farq_dona: +jamiFarq.toFixed(3), brak_dona: +jamiBrak.toFixed(3),
      }, { transaction: t });
      await t.commit();
    } catch (e) {
      await t.rollback();
      throw e;
    }
    const full = await AvtolavkaHujjatModel.findByPk(hujjat.id, { include: INCLUDE });
    res.status(201).send({ ...full.toJSON(), _farq: { dona: full.farq_dona, brak: full.brak_dona, farq_bor: full.farq_dona > EPS }, _bosh: boshMashina });
  };

  // GET /avtolavka/solishtirma?agent_id=&sana= — bir agent, bir kun
  solishtirma = async (req, res) => {
    const agent = await avtolavkaAgent(req.query.agent_id);
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugun();
    const r = await kunHisobla(agent, sana, { tafsilot: true });
    res.send({ ...r, agent: { id: agent.id, fullname: agent.fullname, mashina_raqam: agent.mashina_raqam }, ombor: agentOmbori(agent.fullname) });
  };

  // GET /avtolavka/doska?sana= — boshqaruv markazi: har mashina, bitta kun
  doska = async (req, res) => {
    const sana = sanaMi(req.query.sana) ? req.query.sana : bugun();
    const agentlar = await AgentModel.findAll({
      where: { faol: true, avtolavka: true },
      attributes: ['id', 'fullname', 'telefon', 'mashina_raqam'], order: [['fullname', 'ASC']],
    });
    const mashinalar = await Promise.all(agentlar.map(async a => {
      const [kun, voqealar, [gps]] = await Promise.all([
        kunHisobla(a, sana),
        kunVoqealari(a, sana),
        sequelize.query(`SELECT sana, battery FROM agent_location WHERE agent_id = :id AND rol = 'agent'
                         AND ${lokalKun('sana')} = :sana ORDER BY sana DESC LIMIT 1`,
          { replacements: { id: a.id, sana, tz: tzOffset() }, type: sequelize.QueryTypes.SELECT }),
      ]);
      const sigim = kun.tovar.kun_boshi.dona + kun.tovar.berildi.dona + kun.tovar.qaytarildi.dona;
      return {
        ...kun, voqealar, gps: gps || null,
        agent: { id: a.id, fullname: a.fullname, telefon: a.telefon, mashina_raqam: a.mashina_raqam },
        mashina: { dona: kun.tovar.kun_oxiri.dona, summa: kun.tovar.kun_oxiri.summa,
                   tolish: sigim > 0 ? Math.max(0, Math.min(1, kun.tovar.kun_oxiri.dona / sigim)) : 0 },
      };
    }));
    const yigindi = (f) => mashinalar.reduce((s, m) => s + f(m), 0);
    res.send({
      sana, bugunmi: sana === bugun(), mashinalar,
      jami: {
        mashina: mashinalar.length,
        yolda: mashinalar.filter(m => m.bosqich === 1).length,
        yuklanmagan: mashinalar.filter(m => m.bosqich === 0).length,
        yopiq: mashinalar.filter(m => m.bosqich === 3).length,
        tovar_mashinada: yigindi(m => m.bosqich < 3 ? m.mashina.summa : 0),
        naqd_qolda: yigindi(m => m.pul.inkassatsiya ? 0 : m.pul.naqd_olindi),
        sotuv: yigindi(m => m.pul.sotuv_jami),
        kamomad_tovar: yigindi(m => m.topshirish.tovar ? Math.max(0, m.tovar.farq.dona) : 0),
        kamomad_pul: yigindi(m => m.pul.inkassatsiya ? Math.max(0, m.pul.farq) : 0),
        // Omborchini kutayotgan ish: agent so'rovlari va kunni yopib kelganlar
        sorov: mashinalar.filter(m => m.sorovlar.length).length,
        topshirishga_keldi: mashinalar.filter(m => m.kun_yopish && m.bosqich < 3).length,
      },
    });
  };

  // GET /avtolavka/kalendar?kun=14 — agent × kun holat matritsasi
  kalendar = async (req, res) => {
    const kunSoni = Math.min(42, Math.max(7, parseInt(req.query.kun) || 14));
    const to = bugun();
    const from = new Date(Date.parse(to) - (kunSoni - 1) * 864e5).toISOString().slice(0, 10);
    const agentlar = await AgentModel.findAll({
      where: { faol: true, avtolavka: true }, attributes: ['id', 'fullname'], order: [['fullname', 'ASC']], raw: true,
    });
    const ids = agentlar.map(a => a.id);
    const kunlar = [];
    for (let d = Date.parse(to); d >= Date.parse(from); d -= 864e5) kunlar.push(new Date(d).toISOString().slice(0, 10));
    if (!ids.length) return res.send({ kunlar, agentlar: [] });

    const q = (sql) => sequelize.query(sql, { replacements: { ids, from, to, tz: tzOffset() }, type: sequelize.QueryTypes.SELECT });
    const [hujjat, sotuv, naqd, inkas] = await Promise.all([
      q(`SELECT agent_id, DATE_FORMAT(sana, '%Y-%m-%d') sana, tur, SUM(jami_summa) summa, SUM(farq_dona) farq
         FROM avtolavka_hujjat WHERE agent_id IN (:ids) AND holat = 'tasdiqlangan' AND sana BETWEEN :from AND :to
         GROUP BY agent_id, DATE_FORMAT(sana, '%Y-%m-%d'), tur`),
      // DATETIME ustunlar UTC — kunga mahalliy vaqtda ajratiladi (kunHisobla bilan bir xil)
      q(`SELECT agent_id, DATE_FORMAT(${lokalKun('yetkazilgan_sana')}, '%Y-%m-%d') sana, SUM(jami_summa) summa
         FROM ariza WHERE agent_id IN (:ids) AND deletedAt IS NULL AND turi = 'sotish' AND holat = 'yetkazildi'
           AND kanal = 'avtolavka' AND ${lokalKun('yetkazilgan_sana')} BETWEEN :from AND :to
         GROUP BY agent_id, DATE_FORMAT(${lokalKun('yetkazilgan_sana')}, '%Y-%m-%d')`),
      q(`SELECT user_id agent_id, DATE_FORMAT(${lokalKun('sana')}, '%Y-%m-%d') sana, SUM(summa) summa FROM kassa
         WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND manba_tur IN ('mijoz','avtolavka') AND user_id IN (:ids)
           AND ${lokalKun('sana')} BETWEEN :from AND :to GROUP BY user_id, DATE_FORMAT(${lokalKun('sana')}, '%Y-%m-%d')`),
      q(`SELECT agent_id, DATE_FORMAT(sana, '%Y-%m-%d') sana, topshirilgan_summa FROM inkassatsiya
         WHERE agent_id IN (:ids) AND sana BETWEEN :from AND :to`),
    ]);
    const kalit = (a, d) => `${a}|${d}`;
    const M = {};
    const ol = (a, d) => (M[kalit(a, d)] ||= { yuklash: false, qabul: false, farq: 0, sotuv: 0, naqd: 0, inkas: null });
    hujjat.forEach(r => { const x = ol(r.agent_id, r.sana); if (r.tur === 'yuklash') x.yuklash = true; else { x.qabul = true; x.farq += n(r.farq); } });
    sotuv.forEach(r => { ol(r.agent_id, r.sana).sotuv = n(r.summa); });
    naqd.forEach(r => { ol(r.agent_id, r.sana).naqd = n(r.summa); });
    inkas.forEach(r => { ol(r.agent_id, r.sana).inkas = n(r.topshirilgan_summa); });

    res.send({
      kunlar,
      agentlar: agentlar.map(a => ({
        id: a.id, fullname: a.fullname,
        kunlar: kunlar.map(d => {
          const x = M[kalit(a.id, d)];
          if (!x || (!x.yuklash && !x.sotuv && !x.qabul)) return { sana: d, holat: 'bosh' };
          const pulTayyor = x.inkas !== null || (x.naqd <= 0 && x.qabul);
          let holat = 'ochiq';
          if (x.qabul && pulTayyor) holat = (x.farq > EPS || (x.inkas !== null && x.naqd - x.inkas > 0.5)) ? 'kamomad' : 'yopiq';
          else if (x.qabul || x.inkas !== null) holat = 'topshirilmoqda';
          return { sana: d, holat, sotuv: x.sotuv, naqd: x.naqd };
        }),
      })),
    });
  };

  // GET /avtolavka/tavsiya?agent_id= — ertalabki yuklash taklifi:
  // oxirgi 14 kundagi o'rtacha kunlik sotuv + 20% zaxira − mashinadagi qoldiq,
  // blokka yaxlitlanadi, asosiy ombordagi qoldiq bilan cheklanadi.
  tavsiya = async (req, res) => {
    const agent = await avtolavkaAgent(req.query.agent_id);
    res.send(await tavsiyaHisobla(agent));
  };

  // GET /avtolavka/kunlar?agent_id=&date_from=&date_to= — kunlar bo'yicha qisqa solishtirma
  kunlar = async (req, res) => {
    const agent = await avtolavkaAgent(req.query.agent_id);
    const to = sanaMi(req.query.date_to) ? req.query.date_to : bugun();
    const from = sanaMi(req.query.date_from) ? req.query.date_from
      : new Date(new Date(to).getTime() - 13 * 864e5).toISOString().slice(0, 10);
    const kunlar = [];
    for (let d = new Date(to); d >= new Date(from) && kunlar.length < 62; d.setUTCDate(d.getUTCDate() - 1)) {
      kunlar.push(d.toISOString().slice(0, 10));
    }
    const natija = await Promise.all(kunlar.map(k => kunHisobla(agent, k)));
    res.send({
      agent: { id: agent.id, fullname: agent.fullname }, date_from: from, date_to: to,
      kunlar: natija.filter(r => r.holat !== 'bosh'),
    });
  };

  // GET /avtolavka/sotuvlar?dan&gacha&agent_id&kanal=sklad&search&tolov=naqd|qarz&takror=1&holat=bekor&page
  // Won Sell sotuvlari jurnali: mashinadan (kanal=avtolavka) va skladdan xodimsiz (kanal=sklad) cheklar.
  // Distributsiya buyurtmalari bu yerga kirmaydi: ular Sotuvlar → Arizalar'da.
  // Sana — sotuv vaqti (yetkazilgan_sana); naqd qoidasi kunHisobla bilan bir xil.
  // takror — "takror chek ehtimoli": shu mijozga, shu mashinadan, aynan shu summaga 2 soat ichida yana
  //   yetkazilgan sotuv bor (xodim ikki marta bosgan). Admin tekshirib, ortiqchasini bekor qiladi.
  // holat=bekor — bekor qilingan cheklar (sabab bilan); odatda faqat yetkazilganlar.
  sotuvlar = async (req, res) => {
    const D = davr(req.query, 1);
    const LIMIT = 100;
    const sahifa = Math.max(1, parseInt(req.query.page, 10) || 1);
    const NAQD = `(CASE WHEN a.tolangan_summa > 0 THEN a.tolangan_summa WHEN a.tolov_turi IN ('naqt','naqd') THEN a.jami_summa ELSE 0 END)`;
    const QARZ = `GREATEST(0, a.jami_summa - ${NAQD})`;
    const TAKROR = `EXISTS (SELECT 1 FROM ariza b WHERE b.id <> a.id AND b.deletedAt IS NULL AND b.turi = 'sotish' AND b.holat = 'yetkazildi'
         AND b.mijoz_id = a.mijoz_id AND COALESCE(b.agent_id, 0) = COALESCE(a.agent_id, 0) AND b.jami_summa = a.jami_summa
         AND ABS(TIMESTAMPDIFF(MINUTE, a.yetkazilgan_sana, b.yetkazilgan_sana)) <= 120)`;
    const bekorKorinish = req.query.holat === 'bekor';

    const r = { prefiks: `${AGENT_PREFIKS}%`, from: D.from, to: D.to, radius: SOTUV_RADIUS_M, lim: LIMIT, off: (sahifa - 1) * LIMIT };
    const shart = [`a.deletedAt IS NULL`, `a.turi = 'sotish'`, `a.holat = '${bekorKorinish ? 'bekor' : 'yetkazildi'}'`, `a.kanal IN ('avtolavka','sklad')`, `a.yetkazilgan_sana BETWEEN :from AND :to`];
    const search = String(req.query.search || '').trim();
    if (search) { shart.push(`(a.raqam LIKE :s OR a.mijoz_nomi LIKE :s)`); r.s = `%${search}%`; }
    if (req.query.tolov === 'qarz') shart.push(`${QARZ} > 0.5`);
    if (req.query.tolov === 'naqd') shart.push(`${QARZ} <= 0.5`);
    if (!bekorKorinish && (req.query.takror === '1' || req.query.takror === 'true')) shart.push(TAKROR);
    const umumiy = shart.join(' AND ');             // mashinalar kesimi — agent filtrisiz
    if (req.query.kanal === 'sklad') shart.push(`a.kanal = 'sklad'`);
    else if (req.query.agent_id) { shart.push(`a.agent_id = :agent_id`); r.agent_id = parseInt(req.query.agent_id, 10) || 0; }
    const W = shart.join(' AND ');
    const q = (sql) => sequelize.query(sql, { replacements: r, type: sequelize.QueryTypes.SELECT });

    const [rows, [jami], agentlar] = await Promise.all([
      q(`SELECT a.id, a.raqam, a.yetkazilgan_sana vaqt, a.agent_id, a.agent_nomi, a.mijoz_id, a.mijoz_nomi,
                m.telefon mijoz_telefon, a.jami_summa summa, ${NAQD} naqd, ${QARZ} qarz, a.tolov_turi, a.tolov_sana,
                a.masofa_m, a.oflayn, a.izoh, a.manba, a.kanal, a.holat, a.bekor_sababi, ${bekorKorinish ? '0' : TAKROR} takror,
                (SELECT COUNT(*) FROM ariza_qator x WHERE x.ariza_id = a.id) tovar_soni,
                (SELECT COALESCE(SUM(x.jami_dona),0) FROM ariza_qator x WHERE x.ariza_id = a.id) dona,
                (SELECT SUBSTRING_INDEX(GROUP_CONCAT(x.tovar_nomi ORDER BY x.summa DESC SEPARATOR '||'), '||', 3)
                   FROM ariza_qator x WHERE x.ariza_id = a.id) tovarlar
         FROM ariza a LEFT JOIN mijoz m ON m.id = a.mijoz_id
         WHERE ${W} ORDER BY a.yetkazilgan_sana DESC, a.id DESC LIMIT :lim OFFSET :off`),
      q(`SELECT COUNT(*) soni, COALESCE(SUM(a.jami_summa),0) summa, COALESCE(SUM(${NAQD}),0) naqd, COALESCE(SUM(${QARZ}),0) qarz,
                COALESCE(SUM(a.masofa_m > :radius),0) uzoq, COUNT(DISTINCT a.mijoz_id) mijozlar, COUNT(DISTINCT a.agent_id) mashinalar,
                COALESCE(SUM(${bekorKorinish ? '0' : TAKROR}),0) takror,
                COALESCE((SELECT SUM(x.jami_dona) FROM ariza_qator x JOIN ariza a ON a.id = x.ariza_id WHERE ${W}),0) dona
         FROM ariza a WHERE ${W}`),
      q(`SELECT a.agent_id id, MAX(a.agent_nomi) fullname, MAX(a.kanal) kanal, COUNT(*) soni, COALESCE(SUM(a.jami_summa),0) summa
         FROM ariza a WHERE ${umumiy} GROUP BY a.agent_id ORDER BY summa DESC`),
    ]);

    res.send({
      dan: D.dan, gacha: D.gacha, radius: SOTUV_RADIUS_M, sahifa, limit: LIMIT, holat: bekorKorinish ? 'bekor' : 'yetkazildi',
      jami: {
        soni: n(jami.soni), summa: n(jami.summa), naqd: n(jami.naqd), qarz: n(jami.qarz), dona: n(jami.dona),
        uzoq: n(jami.uzoq), mijozlar: n(jami.mijozlar), mashinalar: n(jami.mashinalar), takror: n(jami.takror),
      },
      // Skladdan (xodimsiz) sotuvlar agent_id'siz — jurnal filtrida alohida "Sklad" tugmasi
      agentlar: agentlar.map(a => a.id ? { id: a.id, fullname: a.fullname, soni: n(a.soni), summa: n(a.summa) }
        : { id: 'sklad', fullname: 'Sklad · xodimsiz', soni: n(a.soni), summa: n(a.summa) }),
      rows: rows.map(a => ({
        ...a, summa: n(a.summa), naqd: n(a.naqd), qarz: n(a.qarz), dona: n(a.dona), tovar_soni: n(a.tovar_soni),
        masofa_m: a.masofa_m === null ? null : n(a.masofa_m), uzoq: a.masofa_m !== null && n(a.masofa_m) > SOTUV_RADIUS_M,
        oflayn: !!a.oflayn, takror: !!n(a.takror), tovarlar: a.tovarlar ? String(a.tovarlar).split('||') : [],
      })),
    });
  };

  // POST /avtolavka/sotuv/:id/bekor { sabab } — faqat Admin/Programmer.
  // Takror yoki xato yozilgan Won Sell chekini to'liq teskari yozadi (utils/sotuvBekor.utils.js):
  // tovar mashina/sklad omboriga, naqd kassadan, qarz mijoz balansidan, bonus agent registridan.
  sotuvBekor = async (req, res) => {
    adminTekshir(req.currentUser);
    // Chek tranzaksiya ichida qulflab o'qiladi va shu tranzaksiya bekor qilishga uzatiladi —
    // ikki parallel bekor qilish tovar/naqd/qarzni ikki marta qaytarmaydi (holat qulf ostida tekshiriladi)
    const { ariza, r } = await sequelize.transaction(async (t) => {
      const a = await qulflabOl(ArizaModel, req.params.id, t);
      if (!a) throw new HttpException(404, 'Chek topilmadi');
      if (!['avtolavka', 'sklad'].includes(a.kanal)) {
        throw new HttpException(400, 'Bu Won Sell cheki emas — distributsiya buyurtmasi Buyurtmalar sahifasida bekor qilinadi');
      }
      const natija = await yetkazilganSotuvniBekorQil(a, { sabab: req.body.sabab, user: req.currentUser, transaction: t });
      return { ariza: (natija && natija.ariza) || a, r: natija };
    });
    res.send({
      ok: true, id: ariza.id, raqam: ariza.raqam, holat: 'bekor', bekor_sababi: ariza.bekor_sababi,
      tovar: r.tovar, naqd: r.naqd, qarz: r.qarz, bonus: r.bonus, mijoz_balans: r.mijoz_balans, ogohlantirishlar: r.ogohlantirishlar,
    });
  };

  /* ── SOTUV QILISH (web, xodim nomidan) ─────────────────────────────
     Xodim ilovadan sota olmagan holat (telefon buzilgan, internet yo'q, ilova
     ishlamadi): omborchi/admin web'da xodimni tanlab, uning mashinasidan sotadi.
     Sotuv mobil saveSell bilan AYNAN bir yo'ldan o'tadi (createAriza): chiqim
     xodim omboridan, naqd xodim kassasiga (manba_tur='avtolavka', user_id=xodim),
     qarz mijoz balansiga, bonus agent_register'ga, kun hisobiga. Farqi — ariza.manba='web'
     va izohda kim kiritgani. */

  // GET /avtolavka/sotuv/tayyor?agent_id&mijoz_id&sana — forma uchun: mashina, narxlar, mijoz, kun holati
  sotuvTayyor = async (req, res) => {
    // agent_id='sklad' — xodimsiz: admin asosiy skladdan sotadi
    const sklad = skladMi(req.query.agent_id);
    const agent = sklad ? null : await avtolavkaAgent(req.query.agent_id);
    const sana = sotuvSanasi(req.query.sana);
    const ombor = sklad ? ASOSIY_OMBOR : agentOmbori(agent.fullname);
    const mijozId = parseInt(req.query.mijoz_id, 10) || null;

    const [map, kun, mijoz, plastikKassalar] = await Promise.all([
      sklad ? skladQoldigi() : omborQoldiq(ombor),   // sklad: band qilinganidan tashqari MAVJUD qoldiq
      sklad ? null : kunHisobla(agent, sana),
      mijozId ? MijozModel.findByPk(mijozId) : null,
      sklad ? [] : agentPlastikKassalar(agent),        // 2026-11-24: plastik to'lov uchun kassa tanlovi
    ]);
    if (mijozId && !mijoz) throw new HttpException(404, 'Mijoz topilmadi');
    const ids = Object.keys(map).filter(id => map[id].qoldiq > EPS).map(Number);
    const [narx, tovarlar] = await Promise.all([
      // Agent nomidan: agent viloyati bo'lsa toifa ro'yxati → viloyat narxi → sotilmaydi (narx 0, manba 'yoq');
      // viloyati yo'q agent va sklad — eski qoida (narx.utils)
      sklad ? narxXaritasi({ mijozId: mijoz ? mijoz.id : null, tovarIds: ids })
        : agentNarxXaritasi({ agent, mijozId: mijoz ? mijoz.id : null, tovarIds: ids }),
      ids.length ? TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'olchov_birligi', 'blokdagi_soni', 'shtrix_kod'], raw: true }) : [],
    ]);
    const narxBy = new Map(narx.narxlar.map(x => [x.tovar_id, x]));
    const tovarBy = new Map(tovarlar.map(t => [t.id, t]));

    let mijozJson = null;
    if (mijoz) {
      const balans = n(mijoz.balans);
      const [kredit, egasi] = await Promise.all([
        kreditTekshir(mijoz, 0),
        mijoz.agent_id ? AgentModel.findByPk(mijoz.agent_id, { attributes: ['fullname'], paranoid: false }) : null,
      ]);
      mijozJson = {
        id: mijoz.id, nomi: mijoz.nomi, telefon: mijoz.telefon, manzil: mijoz.manzil, faol: !!mijoz.faol,
        balans, qarz: balans < 0 ? -balans : 0, haqdor: balans > 0 ? balans : 0,
        kredit_limit: n(mijoz.kredit_limit), tolov_muddati_kun: mijoz.tolov_muddati_kun ?? 30,
        narx_turi: mijoz.narx_turi, agent_id: mijoz.agent_id, agent_nomi: egasi ? egasi.fullname : null,
        // Muddati o'tgan qarz bo'lsa qarzga sotib bo'lmaydi — faqat to'liq naqd
        qarz_bloklangan: kredit.bloklangan ? kredit.xabar : null,
      };
    }

    res.send({
      sklad,
      agent: agent ? { id: agent.id, fullname: agent.fullname, telefon: agent.telefon, mashina_raqam: agent.mashina_raqam } : null,
      ombor, sana, bugun: kunKey(new Date()),
      kun: kun ? { holat: kun.holat, kun_yopish: kun.kun_yopish, sotildi: kun.tovar.sotildi, naqd: kun.pul.naqd_olindi, topshirish: kun.topshirish } : null,
      narx_ruyxat: narx.ruyxat,
      // 2026-11-25: viloyat narxi qoidasi — true bo'lsa narx serverda aniqlanadi (forma narxni tahrirlamaydi),
      // narx_manba 'yoq' tovar sotilmaydi
      viloyat: narx.viloyat || null,
      viloyat_qoida: !!narx.viloyat,
      // Agent viloyatidagi faol plastik kassalar [{ id, nomi }] — tolov_usuli 'plastik' uchun (sklad: [])
      plastik_kassalar: plastikKassalar.map(k => ({ id: k.id, nomi: k.nomi })),
      mijoz: mijozJson,
      tovarlar: ids.map(id => {
        const t = tovarBy.get(id) || {}, x = narxBy.get(id) || { narx: 0, manba: 'yoq' };
        return {
          tovar_id: id, tovar_nomi: map[id].tovar_nomi, turkum: map[id].turkum,
          qoldiq: +map[id].qoldiq.toFixed(3), narx: x.narx, narx_manba: x.manba, sotiladi: x.narx > 0,
          olchov: t.olchov_birligi || 'kg', blokdagi_soni: n(t.blokdagi_soni) || null, shtrix_kod: t.shtrix_kod || null,
        };
      }).sort((a, b) => a.tovar_nomi.localeCompare(b.tovar_nomi)),
    });
  };

  // POST /avtolavka/sotuv { agent_id, mijoz_id, sana, qatorlar:[{tovar_id, dona, narx}], tolov: naqd|qisman|qarz, naqd, tolov_sana, izoh }
  // Ixtiyoriy `sorov_id` (8–64 belgi) — ikki marta bosishdan himoya: ariza.mobil_id (UNIQUE) ga
  // yoziladi; shu kalit bilan qayta yuborilsa yangi sotuv yaratilmaydi, mavjudi 200 bilan qaytadi.
  sotuvCreate = async (req, res) => {
    const b = req.body || {};
    // multipart (chek fayli bilan) — qatorlar JSON matn bo'lib keladi
    if (typeof b.qatorlar === 'string') {
      try { b.qatorlar = JSON.parse(b.qatorlar); } catch (e) { throw new HttpException(400, "qatorlar noto'g'ri (JSON massiv)"); }
    }
    /* TO'LOV USULI (2026-11-24): 'naqd' (standart) | 'plastik' — mobil saveSell bilan bir xil qoida:
       to'langan qism (tolov 'naqd' → hammasi, 'qisman' → naqd maydoni) plastik_tolov 'kutilmoqda' bo'ladi,
       kassa_id — agent viloyatidagi faol plastik kassa, chek majburiy: multipart `chek` fayli yoki
       chek_rasm (POST /kassalar/chek-yuklash qaytargan yo'l). Tasdiqgacha sotuv to'liq qarz. */
    const usulRaw = b.tolov_usuli ?? b.tolovUsuli;
    const usul = usulRaw === undefined || usulRaw === null || usulRaw === '' ? 'naqd' : String(usulRaw);
    if (!['naqd', 'plastik'].includes(usul)) throw new HttpException(400, "tolov_usuli faqat 'naqd' yoki 'plastik'");
    let sorovId = null;
    if (b.sorov_id !== undefined && b.sorov_id !== null && String(b.sorov_id).trim() !== '') {
      sorovId = String(b.sorov_id).trim();
      if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(sorovId)) throw new HttpException(400, "sorov_id noto'g'ri (8–64 belgi: harf, raqam, - _ . :)");
    }
    const sklad = skladMi(b.agent_id);   // xodimsiz — asosiy skladdan (createAriza agent=null)
    if (usul === 'plastik' && sklad) throw new HttpException(400, "Plastik to'lov faqat agent nomidan sotuvda qabul qilinadi");
    if (usul === 'plastik' && b.tolov === 'qarz') throw new HttpException(400, "Plastik to'lovda to'langan summa bo'lishi kerak (tolov: 'naqd' yoki 'qisman')");
    // Takroriy so'rov: mavjud sotuvni qaytaramiz (boshqa sotuvga tegishli kalit — 409)
    const takrorJavob = async () => {
      const bor = await ArizaModel.findOne({ where: { mobil_id: sorovId }, include: [{ model: ArizaQatorModel, as: 'qatorlar' }] });
      if (!bor) return false;
      if (bor.manba !== 'web' || bor.turi !== 'sotish' || Number(bor.mijoz_id) !== (parseInt(b.mijoz_id, 10) || 0)) {
        throw new HttpException(409, 'Bu sorov_id boshqa hujjatga tegishli');
      }
      const m = await MijozModel.findByPk(bor.mijoz_id, { paranoid: false });
      const a = bor.agent_id ? await AgentModel.findByPk(bor.agent_id, { attributes: ['id', 'fullname'], paranoid: false }) : null;
      const summa = n(bor.jami_summa);
      const qatorlar = bor.qatorlar || [];
      const pl = await plastikJavob(bor);
      const naqd = pl ? 0 : n(bor.tolangan_summa), tolandi = pl ? pl.summa : naqd;
      res.status(200).send({
        id: bor.id, raqam: bor.raqam, sana: kunKey(new Date(bor.yetkazilgan_sana || bor.createdAt)),
        summa, naqd, qarz: +(summa - tolandi).toFixed(2), tolov_sana: bor.tolov_sana || null,
        tolov_usuli: pl ? 'plastik' : 'naqd', plastik: pl,
        sklad: !bor.agent_id, agent: a ? { id: a.id, fullname: a.fullname } : null,
        mijoz: m ? { id: m.id, nomi: m.nomi, balans: n(m.balans) } : null,
        tovar_soni: qatorlar.length, dona: +qatorlar.reduce((s, q) => s + n(q.jami_dona), 0).toFixed(3),
        takror: true,
      });
      return true;
    };
    if (sorovId && await takrorJavob()) return;
    const agent = sklad ? null : await avtolavkaAgent(b.agent_id);
    if (agent && !agent.faol) throw new HttpException(400, `${agent.fullname} faol emas`);
    const mijoz = await MijozModel.findByPk(parseInt(b.mijoz_id, 10) || 0);
    if (!mijoz) throw new HttpException(400, 'Mijozni tanlang');
    if (!mijoz.faol) throw new HttpException(400, `"${mijoz.nomi}" faol emas`);

    const bugunKun = kunKey(new Date());
    const sana = b.sana ? String(b.sana) : bugunKun;
    if (!sanaMi(sana) || sana > bugunKun) throw new HttpException(400, "Sotuv sanasi noto'g'ri (kelajak sana bo'lmaydi)");
    const eng = new Date(); eng.setDate(eng.getDate() - SOTUV_ORQAGA_KUN);
    if (sana < kunKey(eng)) throw new HttpException(400, `Sotuvni ko'pi bilan ${SOTUV_ORQAGA_KUN} kun orqaga kiritish mumkin`);
    // Bugungi sotuv — hozirgi vaqt; o'tgan kun — o'sha kunning tushi (kun hisobi o'sha kunga tushadi)
    const vaqt = sana === bugunKun ? new Date() : new Date(`${sana}T12:00:00`);

    /* VILOYAT NARXI (2026-11-25): agentning viloyati bo'lsa narx SERVERDA aniqlanadi —
       mijoz toifasi ro'yxati → agent viloyati narxi (mijoz narx_turi) → narx yo'q bo'lsa 400.
       So'rovdagi `narx` bu holda e'tiborsiz. Viloyati yo'q agent va sklad — eski qoida (narx so'rovdan). */
    const viloyatQoida = !!(agent && agent.territoriya_id);

    // Qatorlar: bir tovar ikki marta kelsa qo'shiladi
    const birlash = new Map();
    for (const q of Array.isArray(b.qatorlar) ? b.qatorlar : []) {
      const id = parseInt(q.tovar_id, 10), dona = +n(q.dona).toFixed(3), narx = viloyatQoida ? 0 : +n(q.narx).toFixed(2);
      if (!id || dona <= 0) continue;
      if (!viloyatQoida && narx <= 0) throw new HttpException(400, 'Har bir tovarga narx kiriting');
      const old = birlash.get(id);
      if (old && old.narx !== narx) throw new HttpException(400, 'Bir tovar ikki xil narxda — bitta qatorga jamlang');
      birlash.set(id, { tovar_id: id, dona: +((old ? old.dona : 0) + dona).toFixed(3), narx });
    }
    if (!birlash.size) throw new HttpException(400, "Kamida bitta tovar qo'shing");
    const tovarlar = await TovarModel.findAll({ where: { id: [...birlash.keys()] }, attributes: ['id', 'nomi', 'turi'], raw: true });
    const nomBy = new Map(tovarlar.map(t => [t.id, t]));
    const serverNarx = viloyatQoida
      ? await agentNarxXaritasi({ agent, mijozId: mijoz.id, tovarIds: [...birlash.keys()] })
      : null;
    const serverBy = serverNarx ? new Map(serverNarx.narxlar.map(x => [x.tovar_id, x])) : null;
    const qatorlar = [...birlash.values()].map(q => {
      const t = nomBy.get(q.tovar_id);
      if (!t) throw new HttpException(400, `Tovar #${q.tovar_id} topilmadi`);
      if (t.turi === 'xom_ashyo') throw new HttpException(400, `"${t.nomi}" — xom ashyo, sotilmaydi`);
      if (serverBy) {
        const x = serverBy.get(q.tovar_id);
        if (!x || !(x.narx > 0)) {
          throw new HttpException(400, `"${t.nomi}" uchun ${serverNarx.viloyat ? serverNarx.viloyat.nomi : ''} viloyatida narx belgilanmagan`);
        }
        q.narx = +n(x.narx).toFixed(2);
      }
      return { ...q, nomi: t.nomi, summa: Math.round(q.dona * q.narx) };
    });
    const itog = qatorlar.reduce((s, q) => s + q.summa, 0);

    // To'lov: naqd — hammasi qo'lda, qarz — hammasi mijoz zimmasida, qisman — bir qismi naqd
    const tolov = ['naqd', 'qisman', 'qarz'].includes(b.tolov) ? b.tolov : 'naqd';
    let naqd = tolov === 'naqd' ? itog : tolov === 'qarz' ? 0 : Math.round(n(b.naqd));
    if (tolov === 'qisman' && (naqd <= 0 || naqd >= itog)) {
      throw new HttpException(400, `Qisman to'lovda naqd summa 0 dan katta va ${itog.toLocaleString('ru-RU')} dan kichik bo'lishi kerak`);
    }
    const qarz = itog - naqd;
    let tolovSana = null;
    if (qarz > 0.5) {
      tolovSana = String(b.tolov_sana || '');
      if (!sanaMi(tolovSana)) throw new HttpException(400, "Qarz qismi uchun to'lov sanasini belgilang");
      if (tolovSana < sana) throw new HttpException(400, "To'lov sanasi sotuv kunidan oldin bo'lmaydi");
    }

    // Mobil saveSell bilan bir xil shakl — keyingi barcha qoidalar (mashina qoldig'i,
    // kredit limiti, kassa, qarz, bonus) createAriza ichida
    const body = {
      klientId: mijoz.id,
      products: qatorlar.map(q => ({
        tovarId: q.tovar_id, productName: q.nomi, eskiNarx: q.narx, yangiNarx: q.narx,
        kolbo: q.dona, pachka: 0, eskisumma: q.summa, yangisumma: q.summa,
      })),
      itogSummaSumYangi: itog, skidkaSum: 0,
      currency: qarz > 0.5 ? 'qarz' : 'naqt',
      tolanganSumma: naqd, tolovSana,
      komment: String(b.izoh || '').trim().slice(0, 500) || null,
      vaqt: vaqt.toISOString(),
    };
    if (usul === 'plastik') {
      body.tolovUsuli = 'plastik';
      body.kassaId = b.kassa_id ?? b.kassaId;
      body.chekRasm = req.file ? `/uploads/kassa/${req.file.filename}` : (b.chek_rasm ?? b.chekRasm);
      body.chekIzoh = b.chek_izoh ?? b.chekIzoh;
    }
    const kim = req.currentUser ? (req.currentUser.fullname || req.currentUser.username) : null;
    if (sorovId) body.mobilId = sorovId;
    let ariza;
    try {
      ariza = await createAriza({ body, agent, turi: 'sotish', manba: 'web', webUser: kim || 'web', webUserId: req.currentUser ? req.currentUser.id : null });
    } catch (e) {
      // Parallel takror (bir xil sorov_id) — UNIQUE indeks ushladi
      if (sorovId && e && (e.name === 'SequelizeUniqueConstraintError' || (e.parent && e.parent.code === 'ER_DUP_ENTRY'))
          && await takrorJavob()) return;
      throw e;
    }
    await mijoz.reload();
    const pl = await plastikJavob(ariza);

    res.status(201).send({
      id: ariza.id, raqam: ariza.raqam, sana, summa: itog, naqd: pl ? 0 : naqd, qarz, tolov_sana: tolovSana,
      tolov_usuli: pl ? 'plastik' : 'naqd', plastik: pl,
      sklad, agent: agent ? { id: agent.id, fullname: agent.fullname } : null,
      mijoz: { id: mijoz.id, nomi: mijoz.nomi, balans: n(mijoz.balans) },
      tovar_soni: qatorlar.length, dona: +qatorlar.reduce((s, q) => s + q.dona, 0).toFixed(3),
    });
  };
}

/* ── QAYTARISHLAR TARIXI (2026-11-24) — mobil savdoQaytarish yozuvlari ──
   GET /avtolavka/qaytarishlar?dan=&gacha=&agent_id=&mijoz_id=&viloyat_id=&page=&limit=
   viloyat — agentning territoriyasi (kassalar bilan bir xil qoida). */
const qaytarishJson = (q) => ({
  id: q.id, sana: q.sana,
  agent: { id: q.agent_id, nomi: q.agent_nomi },
  mijoz: q.mijoz_id ? { id: q.mijoz_id, nomi: q.mijoz_nomi } : null,
  viloyat: q.viloyat_id ? { id: q.viloyat_id, nomi: q.viloyat_nomi } : null,
  sotuv: { id: q.ariza_id, raqam: q.ariza_raqam || String(q.ariza_id) },
  summa: n(q.summa), yaroqli_summa: n(q.yaroqli_summa), yaroqsiz_summa: n(q.yaroqsiz_summa),
  // tolov: 'qarz' — mijoz balansiga (qarzdan ayirildi), 'naqd' — agent mijozga naqd qaytardi
  tolov: q.tolov, tolov_nomi: q.tolov === 'naqd' ? 'Naqd qaytarildi' : 'Balansga (qarzdan ayirildi)',
  eski_jami: n(q.eski_jami), yangi_jami: n(q.yangi_jami), izoh: q.izoh || null, kassa_yozuv_id: q.kassa_id || null,
  qator_soni: Number(q.qator_soni) || 0,
});
const QAYT_SELECT = `SELECT q.*, a.territoriya_id viloyat_id, t.nomi viloyat_nomi,
    (SELECT COUNT(*) FROM savdo_qaytarish_qator x WHERE x.qaytarish_id = q.id) qator_soni
  FROM savdo_qaytarish q LEFT JOIN agent a ON a.id = q.agent_id LEFT JOIN territoriya t ON t.id = a.territoriya_id`;
const idQ = (v, nom) => {
  const x = Number(v);
  if (!Number.isInteger(x) || x <= 0) throw new HttpException(400, `${nom} noto'g'ri`);
  return x;
};

AvtolavkaController.prototype.qaytarishlar = async function (req, res) {
  const q = req.query;
  const { from, to } = kunOraligi(q, 'dan', 'gacha');
  const w = ['1=1'], R = {};
  if (from) { w.push('q.sana >= :dan'); R.dan = kunBoshi(from); }
  if (to) { w.push('q.sana <= :gacha'); R.gacha = kunOxiri(to); }
  if (q.agent_id) { w.push('q.agent_id = :agent'); R.agent = idQ(q.agent_id, 'agent_id'); }
  if (q.mijoz_id) { w.push('q.mijoz_id = :mijoz'); R.mijoz = idQ(q.mijoz_id, 'mijoz_id'); }
  if (q.viloyat_id) { w.push('a.territoriya_id = :vil'); R.vil = idQ(q.viloyat_id, 'viloyat_id'); }
  const limit = Math.min(500, Math.max(1, parseInt(q.limit, 10) || 50));
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const W = w.join(' AND ');
  const [[jami], rows] = await Promise.all([
    sequelize.query(`SELECT COUNT(*) soni, COALESCE(SUM(q.summa),0) summa,
        COALESCE(SUM(CASE WHEN q.tolov='naqd' THEN q.summa ELSE 0 END),0) naqd,
        COALESCE(SUM(CASE WHEN q.tolov='qarz' THEN q.summa ELSE 0 END),0) balansga
      FROM savdo_qaytarish q LEFT JOIN agent a ON a.id = q.agent_id WHERE ${W}`, { replacements: R, type: sequelize.QueryTypes.SELECT }),
    sequelize.query(`${QAYT_SELECT} WHERE ${W} ORDER BY q.sana DESC, q.id DESC LIMIT :limit OFFSET :offset`,
      { replacements: { ...R, limit, offset: (page - 1) * limit }, type: sequelize.QueryTypes.SELECT }),
  ]);
  res.send({
    data: rows.map(qaytarishJson),
    jami: { soni: Number(jami.soni) || 0, summa: n(jami.summa), naqd: n(jami.naqd), balansga: n(jami.balansga) },
    page, limit,
  });
};

// GET /avtolavka/qaytarishlar/:id — qatorlar bilan
AvtolavkaController.prototype.qaytarishBitta = async function (req, res) {
  const id = idQ(req.params.id, 'id');
  const [q] = await sequelize.query(`${QAYT_SELECT} WHERE q.id = :id`, { replacements: { id }, type: sequelize.QueryTypes.SELECT });
  if (!q) throw new HttpException(404, 'Qaytarish topilmadi');
  const qatorlar = await sequelize.query(`SELECT * FROM savdo_qaytarish_qator WHERE qaytarish_id = :id ORDER BY id`,
    { replacements: { id }, type: sequelize.QueryTypes.SELECT });
  res.send({
    ...qaytarishJson(q),
    qatorlar: qatorlar.map(x => ({
      id: x.id, tovar_id: x.tovar_id, tovar_nomi: x.tovar_nomi, miqdor: n(x.dona), narx: n(x.narx), summa: n(x.summa),
      holat: x.yaroqli ? 'yaroqli' : 'yaroqsiz', ombor: x.ombor, sabab: x.sabab || null,
    })),
  });
};

/* Sotuvning plastik to'lovi (bo'lsa) — javob uchun */
async function plastikJavob(ariza) {
  if (!ariza || ariza.tolov_turi !== 'plastik') return null;
  const [p] = await sequelize.query(`SELECT p.id, p.holat, p.summa, p.kassa_id, k.nomi kassa_nomi, p.chek_rasm FROM plastik_tolov p
      LEFT JOIN kassalar k ON k.id = p.kassa_id WHERE p.ariza_id = :id`, { replacements: { id: ariza.id }, type: sequelize.QueryTypes.SELECT });
  return p ? { id: p.id, holat: p.holat, summa: n(p.summa), kassa_id: p.kassa_id, kassa_nomi: p.kassa_nomi, chek_rasm: p.chek_rasm } : null;
}

// Web sotuvi necha kun orqaga kiritilishi mumkin (mobilVaqt 7 kundan eskisini "hozir"ga aylantiradi)
const SOTUV_ORQAGA_KUN = 6;
const kunKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function sotuvSanasi(s) {
  const b = kunKey(new Date());
  return sanaMi(s) && s <= b ? s : b;
}
// agent_id='sklad' — Won Sell → Sotuv qilish'da xodim o'rniga sklad tanlangan
const skladMi = (v) => v === 'sklad' || v === 0 || v === '0';
/* Skladdan sotuv uchun tovarlar: asosiy ombordagi MAVJUD qoldiq (ochiq distributsiya zakazlariga
   band qilingani ayirilgan — yuklashQoldigi bilan bir xil qoida), faqat faol savdo tovarlari */
async function skladQoldigi() {
  const m = await yuklashQoldigi();
  const ids = Object.keys(m).filter(id => m[id].qoldiq > EPS).map(Number);
  const tovarlar = ids.length ? await TovarModel.findAll({ where: { id: ids, faol: true, turi: 'tovar' }, attributes: ['id', 'nomi', 'turkum'], raw: true }) : [];
  const map = {};
  for (const t of tovarlar) map[t.id] = { qoldiq: m[t.id].qoldiq, tovar_nomi: t.nomi, turkum: t.turkum };
  return map;
}

module.exports = new AvtolavkaController();
