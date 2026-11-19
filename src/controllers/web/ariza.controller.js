const { Op, fn, col } = require('sequelize');
const sequelize        = require('../../db/db-sequelize');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const { MijozModel }   = require('../../models/mijoz.model');
const AgentModel       = require('../../models/agent.model');
const TovarModel       = require('../../models/tovar.model');
const { turkumToldir } = require('../../utils/turkum.utils');
const { reytingYoz, reytingQaytar } = require('../../utils/reyting.utils');
const DostavchiModel   = require('../../models/dostavchi.model');
const TovarRegisterModel = require('../../models/tovar_register.model');
const AgentRegisterModel = require('../../models/agent_register.model');
const KassaModel       = require('../../models/kassa.model');
const { TripSheetModel } = require('../../models/tripSheet.model');
const HttpException    = require('../../utils/HttpException.utils');
const { generateRaqam } = require('../../utils/arizaRaqam.utils');
const { kreditTekshir } = require('../../utils/kreditLimit.utils');
const { zaxiraTekshir, mavjudQoldiq } = require('../../utils/zaxira.utils');
const { arizaYetkazildiEffektlari } = require('../../utils/arizaYetkazildi.utils');
const { yetkazilganSotuvniBekorQil, adminTekshir } = require('../../utils/sotuvBekor.utils');
const { ASOSIY_OMBOR, XOM_ASHYO_OMBOR, AGENT_PREFIKS, agentOmbori, agentNomi } = require('../../utils/ombor.utils');
const { qulflabOl, tovarlarniQulfla } = require('../../utils/qulf.utils');

/* Savdo kanali: avtolavka hujjati agentning o'z omboridan chiqadi ("Agent: <ism>"),
   distributsiya buyurtmasi — asosiy ombordan (zakaz → tasdiq → yig'ish → dostavchik). */
function kanalSharti(kanal) {
  // Won Sell = avtolavka (agent mashinasidan) + sklad (admin asosiy skladdan xodimsiz)
  if (kanal === 'avtolavka')     return { kanal: { [Op.in]: ['avtolavka', 'sklad'] } };
  if (kanal === 'distributsiya') return { kanal: 'distributsiya' };
  return null;
}

// ── Holat o'tish qoidalari ────────────────────────────────
const HOLAT_NEXT = {
  yangi:        ['tasdiqlangan', 'bekor'],
  tasdiqlangan: ['yigilmoqda',   'bekor'],
  yigilmoqda:   ['yolda',        'bekor'],
  yolda:        ['yetkazildi',   'bekor'],
  yetkazildi:   [],
  bekor:        [],
};

// ── Ombor qoldig'ini hisoblash ────────────────────────────
// Buyurtmaning O'Z omboridagi jismoniy qoldiq (chiqim shu ombordan yoziladi).
// Avtolavka mashinalari va brak ombori qo'shilmaydi — ilgari barcha omborlar
// yig'indisi olinardi va sklad minusga tushib qolishi mumkin edi.
// Standart ombor nomlari: "Основной склад" / "Запасной склад".
async function omborQoldigi(tovar_id, ombor, transaction) {
  const row = await TovarRegisterModel.findOne({
    attributes: [[fn('SUM', col('donada')), 'qoldiq']],
    where: { tovar_id, ombor: ombor || ASOSIY_OMBOR },
    raw: true,
    transaction,
  });
  return parseFloat(row?.qoldiq || 0);
}

/* Yo'lga chiqqan buyurtma dostavchining bugungi ochiq reysiga (trip sheet) qo'shiladi —
   reys ertalab tuzilgan bo'lsa ham, keyin jo'natilgan zakaz uning marshrutida tursin.
   Boshqa dostavchining reysida turgan bo'lsa — undan chiqariladi. */
async function reysMaydonlari(ariza, dostavchiId, transaction) {
  if (!dostavchiId) return {};
  const d = new Date();
  const sana = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const trip = await TripSheetModel.findOne({
    where: { dostavchi_id: dostavchiId, sana, holat: { [Op.ne]: 'yakunlandi' } },
    order: [['id', 'DESC']], transaction,
  });
  if (trip) {
    if (ariza.trip_sheet_id === trip.id) return {};
    const oxirgi = await ArizaModel.max('trip_tartib', { where: { trip_sheet_id: trip.id }, transaction });
    return { trip_sheet_id: trip.id, trip_tartib: (oxirgi || 0) + 1 };
  }
  if (ariza.trip_sheet_id && ariza.dostavchi_id !== dostavchiId) return { trip_sheet_id: null, trip_tartib: null };
  return {};
}

/* Distributsiya arizasi avtolavka agentiga yoki uning mijoziga yozilmaydi — u mashinasidan
   sotadi, ombor zakazi bermaydi (kanallar aralashmasin; forma ro'yxati ham shunday — spravochnik). */
async function kanalTekshir({ agent_id, mijoz_id }, transaction) {
  if (agent_id) {
    const a = await AgentModel.findByPk(agent_id, { attributes: ['fullname', 'avtolavka'], transaction });
    if (a?.avtolavka) throw new HttpException(400, `${a.fullname} — Won Sell agenti: u mashinadan sotadi, distributsiya arizasi unga yozilmaydi`);
  }
  if (mijoz_id) {
    const m = await MijozModel.findByPk(mijoz_id, {
      attributes: ['nomi'], include: [{ model: AgentModel, as: 'agent', attributes: ['fullname', 'avtolavka'] }], transaction,
    });
    if (m?.agent?.avtolavka) throw new HttpException(400, `"${m.nomi}" Won Sell mijozi (${m.agent.fullname}) — unga distributsiya arizasi berilmaydi`);
  }
}

// ── Include ───────────────────────────────────────────────
const INCLUDE = [
  { model: ArizaQatorModel, as: 'qatorlar' },
  { model: MijozModel,      as: 'mijoz',       attributes: ['id','nomi','telefon','manzil','balans','sinf','lat','lng'] },
  { model: AgentModel,      as: 'agent',        attributes: ['id','fullname','telefon'] },
  { model: DostavchiModel,  as: 'dostavchi',    attributes: ['id','ism','telefon','transport','mashina_raqam'], required: false },
];

// ── Summa hisoblash ───────────────────────────────────────
function calcQator(q) {
  const blokDona   = (parseFloat(q.blok) || 0) * (parseFloat(q.blokdagi_soni) || 1);
  const jami_dona  = blokDona + (parseFloat(q.dona) || 0);
  const brutto     = jami_dona * (parseFloat(q.narx) || 0);
  const ch_summa   = brutto * ((parseFloat(q.chegirma_foiz) || 0) / 100);
  return {
    jami_dona:      parseFloat(jami_dona.toFixed(3)),
    summa:          parseFloat((brutto - ch_summa).toFixed(2)),
    chegirma_summa: parseFloat(ch_summa.toFixed(2)),
  };
}

const n = v => parseFloat(v) || 0;

// Tahrirlash faqat ombordan chiqim yozilmaguncha ("yolda"dan oldin) mumkin
const TAHRIR_HOLAT = ['yangi', 'tasdiqlangan', 'yigilmoqda'];
// Ro'yxat chegarasi: sahifa uchun va all=true (eksport/forma) uchun
const ROYXAT_MAX_LIMIT = 500;
const ROYXAT_ALL_MAX   = 5000;

// Klient yuborishi mumkin bo'lgan maydonlar (qolganlari — tolangan_summa, yetkazilgan_sana,
// dostavchi_id, trip_sheet_id, tasdiqlagan_id, tolov_sana, mobil_id, id ... — faqat server yozadi)
const ARIZA_MAYDONLAR = ['turi', 'mijoz_id', 'mijoz_nomi', 'agent_id', 'agent_nomi',
  'chegirma_foiz', 'bonus_summa', 'tolov_turi', 'ombor', 'jonatish_sana', 'izoh'];
const QATOR_MAYDONLAR = ['tovar_id', 'tovar_nomi', 'turkum', 'shtrix_kod', 'narx', 'blok', 'dona', 'hajm', 'chegirma_foiz'];

function tanla(obj, maydonlar) {
  const r = {};
  for (const k of maydonlar) if (obj[k] !== undefined) r[k] = obj[k];
  return r;
}

// Qatorlarni hisoblaydi va tekshiradi: narx >= 0, miqdor > 0 (manfiy blok/dona yo'q)
function qatorlarniHisobla(qatorlar) {
  let jami = 0;
  const processed = (qatorlar || []).map(q => {
    const nomi = q.tovar_nomi || (q.tovar_id ? `#${q.tovar_id}` : 'tovar');
    if (n(q.narx) < 0) throw new HttpException(400, `"${nomi}": narx manfiy bo'lishi mumkin emas`);
    if (n(q.blok) < 0 || n(q.dona) < 0 || n(q.blokdagi_soni) < 0) {
      throw new HttpException(400, `"${nomi}": miqdor manfiy bo'lishi mumkin emas`);
    }
    const calc = calcQator(q);
    if (!(calc.jami_dona > 0)) throw new HttpException(400, `"${nomi}": miqdor 0 dan katta bo'lishi kerak`);
    jami += calc.summa;
    return { ...tanla(q, QATOR_MAYDONLAR), ...calc };
  });
  return { processed, jami };
}

// Umumiy chegirma: summa berilsa — o'sha, aks holda foizdan. Buyurtma summasidan oshmaydi.
function chegirmaHisobla(jami, chFoiz, chSummaXom) {
  const chSumma = parseFloat(chSummaXom || (jami * chFoiz / 100)) || 0;
  if (chSumma < 0) throw new HttpException(400, "Chegirma manfiy bo'lishi mumkin emas");
  if (chSumma > jami + 0.005) {
    throw new HttpException(400, `Chegirma (${chSumma.toFixed(2)}) buyurtma summasidan (${jami.toFixed(2)}) oshib ketdi`);
  }
  return chSumma;
}

// Arizaning qatorlarini tranzaksiya ichida qulflab o'qiydi (ariza allaqachon qulflangan bo'lishi kerak)
function qatorlarniQulflabOl(arizaId, t) {
  return ArizaQatorModel.findAll({ where: { ariza_id: arizaId }, order: [['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE });
}

class ArizaController {

  // ── GET /arizalar ─────────────────────────────────────────
  getAll = async (req, res) => {
    const {
      holat, turi, agent_id, mijoz_id, kanal,
      search, date_from, date_to,
      jonatish_sana, jonatish_dan, jonatish_gacha, ochiq,
      page = 1, limit = 50, all,
    } = req.query;

    const where = {};
    const shartlar = [];
    // Kanal: distributsiya (agent zakazi → ombor → dostavchik) yoki avtolavka (mashinadan to'g'ridan-to'g'ri)
    if (kanalSharti(kanal)) shartlar.push(kanalSharti(kanal));
    // holat bir nechta bo'lishi mumkin: "tasdiqlangan,yigilmoqda,yolda"
    if (holat) {
      const list = String(holat).split(',').map(s => s.trim()).filter(Boolean);
      where.holat = list.length > 1 ? { [Op.in]: list } : list[0];
    }
    if (turi)     where.turi     = turi;
    if (agent_id) where.agent_id = agent_id;
    if (mijoz_id) where.mijoz_id = mijoz_id;
    if (search) {
      where[Op.or] = [
        { raqam:      { [Op.like]: `%${search}%` } },
        { mijoz_nomi: { [Op.like]: `%${search}%` } },
        { agent_nomi: { [Op.like]: `%${search}%` } },
      ];
    }
    if (date_from || date_to) {
      where.createdAt = {};
      if (date_from) where.createdAt[Op.gte] = new Date(date_from);
      if (date_to)   where.createdAt[Op.lte] = new Date(date_to + 'T23:59:59');
    }
    // Yetkazish sanasi bo'yicha filtr — Buyurtmalar sahifasi shu bilan ishlaydi.
    // ochiq=true (Buyurtmalar "bugun"): o'sha kun + sanasidan qat'i nazar hali yetkazilmagan
    // barcha buyurtmalar. Mobil zakaz yetkazish sanasini ertaga qilib keladi (yoki bo'sh) —
    // tasdiqlangach u ombor navbatidan yashirinib qolmasligi kerak.
    if (jonatish_sana && ochiq === 'true') {
      shartlar.push({ [Op.or]: [
        { jonatish_sana },
        { holat: { [Op.in]: ['tasdiqlangan', 'yigilmoqda', 'yolda'] } },
      ] });
    } else if (jonatish_sana) {
      where.jonatish_sana = { [Op.gte]: new Date(jonatish_sana), [Op.lte]: new Date(jonatish_sana + 'T23:59:59') };
    } else if (jonatish_dan || jonatish_gacha) {
      where.jonatish_sana = {};
      if (jonatish_dan)    where.jonatish_sana[Op.gte] = new Date(jonatish_dan);
      if (jonatish_gacha)  where.jonatish_sana[Op.lte] = new Date(jonatish_gacha + 'T23:59:59');
    }
    if (shartlar.length) where[Op.and] = shartlar;

    if (all === 'true') {
      // all=true ham cheksiz emas — eng yangi ROYXAT_ALL_MAX ta
      const rows = await ArizaModel.findAll({ where, include: INCLUDE, order: [['createdAt','DESC']], limit: ROYXAT_ALL_MAX });
      return res.send(rows);
    }

    const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), ROYXAT_MAX_LIMIT);
    const sahifa = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (sahifa - 1) * lim;
    const { count, rows } = await ArizaModel.findAndCountAll({
      where, include: INCLUDE,
      order: [['createdAt','DESC']],
      limit: lim, offset,
      distinct: true,
    });

    res.send({ count, rows, page: sahifa, pages: Math.ceil(count / lim) });
  };

  // ── GET /arizalar/:id ─────────────────────────────────────
  getById = async (req, res) => {
    const a = await ArizaModel.findByPk(req.params.id, { include: INCLUDE });
    if (!a) throw new HttpException(404, 'Ariza topilmadi');
    res.send(a);
  };

  // ── POST /arizalar ────────────────────────────────────────
  create = async (req, res) => {
    const { qatorlar } = req.body;
    // Faqat ruxsat etilgan maydonlar (mass assignment: tolangan_summa, dostavchi_id va h.k. klientdan olinmaydi)
    const body = tanla(req.body, ARIZA_MAYDONLAR);

    // Qatorlardan jami summa hisoblash (miqdor > 0, narx >= 0, chegirma <= summa)
    const { processed: processedQatorlar, jami } = qatorlarniHisobla(qatorlar);
    const chFoiz   = parseFloat(body.chegirma_foiz  || 0);
    const chSumma  = chegirmaHisobla(jami, chFoiz, req.body.chegirma_summa);
    const jami_net = jami - chSumma;
    const sotishMi = (body.turi || 'sotish') === 'sotish';

    const t = await sequelize.transaction();
    try {
      // Tovar qatorlari BIRINCHI bo'lib qulflanadi (tranzaksiya snapshot'i qulfdan keyin olinsin):
      // shu tovarlarni parallel band qilayotgan buyurtmalar navbatma-navbat o'tadi
      if (sotishMi) await tovarlarniQulfla(processedQatorlar.map(q => q.tovar_id), t);

      // Mijoz/agent nomlarini avtomatik to'ldirish
      if (body.mijoz_id && !body.mijoz_nomi) {
        const m = await MijozModel.findByPk(body.mijoz_id, { attributes: ['nomi'], transaction: t });
        if (m) body.mijoz_nomi = m.nomi;
      }
      if (body.agent_id && !body.agent_nomi) {
        const a = await AgentModel.findByPk(body.agent_id, { attributes: ['fullname'], transaction: t });
        if (a) body.agent_nomi = a.fullname;
      }

      await turkumToldir(processedQatorlar, t);   // forma turkum yubormaydi — tovardan olinadi

      // Kredit limit / muddati o'tgan qarz tekshiruvi (naqd to'lov qarz hosil qilmaydi)
      const naqdMi = body.tolov_turi === 'naqt' || body.tolov_turi === 'naqd';
      if (body.mijoz_id && !naqdMi) {
        const mijozKredit = await MijozModel.findByPk(body.mijoz_id, { transaction: t });
        const kredit = await kreditTekshir(mijozKredit, jami_net, t);
        if (kredit.bloklangan) {
          throw new HttpException(400, kredit.xabar);
        }
      }

      // Zakaz faqat skladda mavjud tovardan (boshqa ochiq buyurtmalarga band qilingani ayiriladi)
      if (sotishMi) {
        await kanalTekshir(body, t);
        await zaxiraTekshir(processedQatorlar, { ombor: body.ombor || ASOSIY_OMBOR, transaction: t });
      }

      const raqam = await generateRaqam(t);

      const ariza = await ArizaModel.create({
        ...body,
        raqam,
        manba:         'web',
        kanal:         'distributsiya',
        holat:         'yangi',
        jami_summa:    parseFloat(jami_net.toFixed(2)),
        chegirma_summa: parseFloat(chSumma.toFixed(2)),
      }, { transaction: t });

      if (processedQatorlar.length) {
        await ArizaQatorModel.bulkCreate(
          processedQatorlar.map(q => ({ ...q, ariza_id: ariza.id })),
          { transaction: t }
        );
      }

      // Mijoz reytingi: zakaz berdi (+ball; bekor qilinsa yoki o'chirilsa qaytadi)
      if ((body.turi || 'sotish') === 'sotish' && body.mijoz_id) {
        const u = req.currentUser || {};
        await reytingYoz(body.mijoz_id, {
          tur: 'buyurtma', sabab: 'Zakaz berdi (web)', summa: parseFloat(jami_net.toFixed(2)), manba_tur: 'ariza', manba_id: ariza.id,
          xodim: { rol: 'web', id: u.id || null, nomi: u.username || u.fullname || null },
        }, t);
      }

      await t.commit();
      const full = await ArizaModel.findByPk(ariza.id, { include: INCLUDE });
      res.status(201).send(full);
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }
  };

  // ── PATCH /arizalar/:id ───────────────────────────────────
  update = async (req, res) => {
    const { qatorlar } = req.body;
    const body = tanla(req.body, ARIZA_MAYDONLAR);

    const t = await sequelize.transaction();
    let arizaId;
    try {
      // Hujjat qulflanib qayta o'qiladi: parallel holat o'zgarishi (masalan "yolda" — chiqim
      // yozilgan) bilan tahrir aralashmasin
      const ariza = await qulflabOl(ArizaModel, req.params.id, t);
      if (!ariza) throw new HttpException(404, 'Ariza topilmadi');
      arizaId = ariza.id;
      if (!TAHRIR_HOLAT.includes(ariza.holat)) {
        throw new HttpException(400, ['yetkazildi', 'bekor'].includes(ariza.holat)
          ? "Yakunlangan arizani tahrirlash mumkin emas"
          : `"${ariza.holat}" holatidagi arizani tahrirlash mumkin emas (tovar ombordan chiqqan)`);
      }
      if (body.turi !== undefined && body.turi !== ariza.turi) {
        throw new HttpException(400, "Ariza turini o'zgartirib bo'lmaydi");
      }
      delete body.turi;

      if (ariza.turi === 'sotish' && ariza.kanal === 'distributsiya'
          && (body.agent_id !== undefined || body.mijoz_id !== undefined)) {
        await kanalTekshir({ agent_id: body.agent_id, mijoz_id: body.mijoz_id }, t);
      }

      const eskiJami = n(ariza.jami_summa);
      let processed = null;
      let jami;
      if (qatorlar?.length) {
        ({ processed, jami } = qatorlarniHisobla(qatorlar));
        if (ariza.turi === 'sotish') await tovarlarniQulfla(processed.map(q => q.tovar_id), t);
        await turkumToldir(processed, t);
      } else if (body.chegirma_foiz !== undefined || req.body.chegirma_summa !== undefined) {
        // Faqat chegirma o'zgardi — jami mavjud qatorlardan qayta hisoblanadi
        const bor = await ArizaQatorModel.findAll({ where: { ariza_id: ariza.id }, transaction: t });
        jami = bor.reduce((s, q) => s + n(q.summa), 0);
      }
      if (jami !== undefined) {
        const chFoiz  = parseFloat(body.chegirma_foiz ?? ariza.chegirma_foiz ?? 0) || 0;
        const chSumma = chegirmaHisobla(jami, chFoiz, req.body.chegirma_summa);
        body.jami_summa     = parseFloat((jami - chSumma).toFixed(2));
        body.chegirma_summa = parseFloat(chSumma.toFixed(2));
      }

      // Kredit limit — summa oshsa, mijoz yoki to'lov turi o'zgarsa qayta tekshiriladi
      if (ariza.turi === 'sotish') {
        const yangiJami  = body.jami_summa !== undefined ? body.jami_summa : eskiJami;
        const mijozId    = body.mijoz_id !== undefined ? body.mijoz_id : ariza.mijoz_id;
        const tolovTuri  = body.tolov_turi !== undefined ? body.tolov_turi : ariza.tolov_turi;
        const naqdMi     = tolovTuri === 'naqt' || tolovTuri === 'naqd';
        const eskiNaqd   = ariza.tolov_turi === 'naqt' || ariza.tolov_turi === 'naqd';
        const ozgardi    = yangiJami > eskiJami + 0.005 || mijozId !== ariza.mijoz_id || (eskiNaqd && !naqdMi);
        if (mijozId && !naqdMi && ozgardi) {
          const mijozKredit = await MijozModel.findByPk(mijozId, { transaction: t });
          const kredit = await kreditTekshir(mijozKredit, yangiJami, t);
          if (kredit.bloklangan) throw new HttpException(400, kredit.xabar);
        }
      }

      if (processed) {
        if (ariza.turi === 'sotish') {
          await zaxiraTekshir(processed, { ombor: body.ombor || ariza.ombor || ASOSIY_OMBOR, istisnoArizaId: ariza.id, transaction: t });
        }

        await ArizaQatorModel.destroy({ where: { ariza_id: ariza.id }, transaction: t });
        await ArizaQatorModel.bulkCreate(
          processed.map(q => ({ ...q, ariza_id: ariza.id })),
          { transaction: t }
        );
      }

      await ariza.update(body, { transaction: t });
      await t.commit();
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }

    const full = await ArizaModel.findByPk(arizaId, { include: INCLUDE });
    res.send(full);
  };

  // ── PATCH /arizalar/:id/holat ────────────────────────────
  // ASOSIY JARAYON (transaction ichida):
  //   tasdiqlangan → dostavchi tayinlanadi
  //   yigilmoqda   → ombor zaxirasi tekshiriladi (yetmasa bloklanadi)
  //   yolda        → tovarlar ombordan CHIQIM bo'ladi (tovar_register)
  //   yetkazildi   → mijoz balansiga summa yoziladi (qarz)
  //   bekor        → agar chiqim bo'lgan bo'lsa, ombordan QAYTARILADI
  changeHolat = async (req, res) => {
    const { holat: yangiHolat, bekor_sababi, dostavchi_id } = req.body;

    // Hujjat va uning holati TRANZAKSIYA ICHIDA qulflab o'qiladi va o'tish shu yangi
    // nusxada tekshiriladi: ikki parallel PATCH'dan ikkinchisi birinchisi commit bo'lguncha
    // kutadi, so'ng yangilangan holatni ko'rib rad etiladi (ikki marta chiqim yoki ikki
    // marta kassa/qarz/bonus yozilmaydi).
    let arizaId, natijaBekor = null;
    const t = await sequelize.transaction();
    try {
      const ariza = await qulflabOl(ArizaModel, req.params.id, t);
      if (!ariza) throw new HttpException(404, 'Ariza topilmadi');
      arizaId = ariza.id;
      const eskiHolat = ariza.holat;

      // ─── YETKAZILGAN → BEKOR: faqat Admin (takror / xato yozilgan sotuv). HOLAT_NEXT'da yo'q —
      // oddiy jarayon emas: tovar omborga, naqd kassadan, qarz mijozdan, bonus agentdan teskari
      // yoziladi (utils/sotuvBekor.utils.js, Won Sell jurnali ham shu funksiyani ishlatadi) ───
      if (eskiHolat === 'yetkazildi' && yangiHolat === 'bekor') {
        adminTekshir(req.currentUser);
        natijaBekor = await yetkazilganSotuvniBekorQil(ariza, { sabab: bekor_sababi, user: req.currentUser, transaction: t });
        await t.commit();
      } else {
        const ruxsat = HOLAT_NEXT[eskiHolat] || [];

        if (!ruxsat.includes(yangiHolat)) {
          throw new HttpException(400,
            `"${eskiHolat}" holatidan "${yangiHolat}" holatiga o'tish mumkin emas`
          );
        }
        // Qaytarish hujjati sotuv jarayonidan (yig'ish → chiqim → yetkazildi) o'tmaydi —
        // u "Qaytarishni qabul qilish" (qaytarishQabul) orqali omborga kiradi
        if (ariza.turi === 'qaytarish' && ['yigilmoqda', 'yolda', 'yetkazildi'].includes(yangiHolat)) {
          throw new HttpException(400, "Qaytarish hujjati sotuv jarayonidan o'tmaydi — u qabul qilish orqali omborga kiradi");
        }

        const qatorlar = await qatorlarniQulflabOl(ariza.id, t);
        const ombor    = ariza.ombor || 'Основной склад';

        // Zaxira tekshiruvi/chiqimdan oldin tovar qatorlari qulflanadi — parallel
        // yo'lga chiqarishlar bir qoldiqni ikki marta ishlatmaydi
        if (yangiHolat === 'yigilmoqda' || yangiHolat === 'yolda') {
          await tovarlarniQulfla(qatorlar.map(q => q.tovar_id), t);
        }

        const updates = { holat: yangiHolat };

        // ─── TASDIQLANGAN: hali dostavchi tayinlanmaydi — bu mahsulot tayyor
        // bo'lgach ("yolda" bosqichida, skladchi tomonidan) belgilanadi ───
        if (yangiHolat === 'tasdiqlangan') {
          updates.tasdiqlagan_id   = req.currentUser?.id || null;
          updates.tasdiqlagan_sana = new Date();
        }

        // ─── YIG'ILMOQDA: ombor zaxirasini tekshirish (yetmasa bloklaymiz) ───
        if (yangiHolat === 'yigilmoqda') {
          for (const q of qatorlar) {
            if (!q.tovar_id) continue;
            const qoldiq = await omborQoldigi(q.tovar_id, ombor, t);
            const kerak  = parseFloat(q.jami_dona || 0);
            if (kerak > qoldiq) {
              throw new HttpException(400,
                `"${q.tovar_nomi}" omborida yetarli emas. Kerak: ${kerak} kg, mavjud: ${qoldiq} kg`
              );
            }
          }
        }

        // ─── YO'LDA: mahsulot tayyor — dostavchi shu yerda tayinlanadi (ixtiyoriy),
        // so'ng tovarlar ombordan CHIQIM bo'ladi ───
        if (yangiHolat === 'yolda') {
          if (dostavchi_id) {
            const d = await DostavchiModel.findByPk(dostavchi_id, { transaction: t });
            if (d) {
              updates.dostavchi_id   = d.id;
              updates.dostavchi_nomi = d.ism;
            }
          }
          Object.assign(updates, await reysMaydonlari(ariza, updates.dostavchi_id || ariza.dostavchi_id, t));
          // Yana bir bor zaxira tekshiramiz (yig'ish va yo'l orasida o'zgargan bo'lishi mumkin)
          for (const q of qatorlar) {
            if (!q.tovar_id) continue;
            const qoldiq = await omborQoldigi(q.tovar_id, ombor, t);
            const kerak  = parseFloat(q.jami_dona || 0);
            if (kerak > qoldiq) {
              throw new HttpException(400,
                `"${q.tovar_nomi}" omborida yetarli emas (yo'lga chiqarish). Kerak: ${kerak}, mavjud: ${qoldiq}`
              );
            }
          }
          // Chiqim yozuvlari (manfiy donada)
          await TovarRegisterModel.bulkCreate(
            qatorlar.filter(q => q.tovar_id).map(q => ({
              tovar_id:   q.tovar_id,
              tovar_nomi: q.tovar_nomi,
              turkum:     q.turkum || null,
              ombor,
              tur:        'chiqim',
              manba_tur:  'sotuv',
              manba_id:   ariza.id,
              donada:     -Math.abs(parseFloat(q.jami_dona || 0)),
              bloklarda:  -Math.abs(parseFloat(q.blok || 0)),
              qutilarda:  0,
              hajm:       0,
              kirim_narx: 0,
              sotuv_narx: parseFloat(q.narx || 0),
              summa:      -Math.abs(parseFloat(q.summa || 0)),
              sana:       new Date(),
            })),
            { transaction: t }
          );
        }

        // ─── YETKAZILDI: to'lov/qarz + agent plan-fakt + bonus + kassa ───
        if (yangiHolat === 'yetkazildi') {
          updates.yetkazilgan_sana = new Date();
          await arizaYetkazildiEffektlari(ariza, { transaction: t, userId: req.currentUser?.id || null });
        }

        // ─── BEKOR: agar tovar allaqachon ombordan chiqqan bo'lsa, qaytaramiz ───
        if (yangiHolat === 'bekor') {
          updates.bekor_sababi = bekor_sababi || null;
          await reytingQaytar({ manba_tur: 'ariza', manba_id: ariza.id }, t);   // zakaz uchun berilgan reyting balli qaytadi
          // Faqat "yolda" bo'lgan (chiqim qilingan) arizada qaytarish kerak
          if (eskiHolat === 'yolda') {
            const chiqimlar = await TovarRegisterModel.findAll({
              where: { manba_tur: 'sotuv', manba_id: ariza.id, tur: 'chiqim' },
              transaction: t,
            });
            // Teskari (kirim) yozuvlar bilan qaytaramiz
            for (const c of chiqimlar) {
              await TovarRegisterModel.create({
                tovar_id:   c.tovar_id,
                tovar_nomi: c.tovar_nomi,
                turkum:     c.turkum,
                ombor:      c.ombor,
                tur:        'qaytarma_kirim',
                manba_tur:  'qaytarma',
                manba_id:   ariza.id,
                donada:     Math.abs(parseFloat(c.donada)),
                bloklarda:  Math.abs(parseFloat(c.bloklarda || 0)),
                qutilarda:  0,
                hajm:       0,
                kirim_narx: 0,
                sotuv_narx: parseFloat(c.sotuv_narx || 0),
                summa:      Math.abs(parseFloat(c.summa || 0)),
                sana:       new Date(),
              }, { transaction: t });
            }
          }
        }

        await ariza.update(updates, { transaction: t });
        await t.commit();
      }
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }

    const full = await ArizaModel.findByPk(arizaId, { include: INCLUDE });
    if (natijaBekor) {
      return res.send({
        ...full.toJSON(), _holat_ozgardi: true, _yangi_holat: 'bekor', _keyingi_holat: [],
        _bekor: { tovar: natijaBekor.tovar, naqd: natijaBekor.naqd, qarz: natijaBekor.qarz, bonus: natijaBekor.bonus, ogohlantirishlar: natijaBekor.ogohlantirishlar },
      });
    }
    res.send({
      ...full.toJSON(),
      _holat_ozgardi: true,
      _yangi_holat: yangiHolat,
      _keyingi_holat: HOLAT_NEXT[yangiHolat] || [],
    });
  };

  // ── PATCH /arizalar/toplu-yolda ───────────────────────────
  // Bitta hududdagi bir nechta zakazni bitta dostavchiga biriktirib,
  // birdaniga "yo'lda" holatiga o'tkazadi. Har bir ariza alohida
  // tranzaksiyada bajariladi — biror arizada zaxira yetmasa, faqat o'sha
  // tushib qoladi, qolganlari yo'lga chiqaveradi (operator qayta urinmasin).
  /* ═══════════════════════════════════════════════════════════════
   * QAYTARISHNI QABUL QILISH (skladchi)
   *
   * Agent qaytargan tovar "Agent: <ism>" omborida "qabul_kutilmoqda"
   * holatida turadi. Skladchi sanab tekshiradi va qabul qiladi:
   *   · qabul qilingan miqdor  → agent omboridan CHIQIM, asosiyga KIRIM
   *   · qabul qilinmagan farq  → agent omborida qoladi (tushuntirilmagan)
   *
   * Farq yo'qolmaydi — hisobotda ko'rinib turadi.
   * ═══════════════════════════════════════════════════════════════ */

  // GET /arizalar/qabul-kutilmoqda
  qabulKutilmoqda = async (req, res) => {
    const { agent_id } = req.query;
    const where = { turi: 'qaytarish', holat: 'qabul_kutilmoqda' };
    if (agent_id) where.agent_id = agent_id;

    const rows = await ArizaModel.findAll({
      where, include: INCLUDE, order: [['createdAt', 'ASC']], limit: 200,
    });

    const hozir = Date.now();
    res.send(rows.map(a => {
      const j = a.toJSON();
      const qatorlar = (j.qatorlar || []).map(q => ({
        ...q,
        // Skladchi o'zgartirmasa — agent aytgan miqdor qabul qilinadi
        qabul_dona: q.qabul_dona ?? q.jami_dona,
      }));
      return {
        ...j,
        qatorlar,
        kutgan_kun: Math.floor((hozir - new Date(j.createdAt).getTime()) / 86400000),
        jami_dona: qatorlar.reduce((s, q) => s + parseFloat(q.jami_dona || 0), 0),
      };
    }));
  };

  // PATCH /arizalar/:id/qabul
  // body: { qatorlar: [{ id, qabul_dona }], izoh }
  qaytarishQabul = async (req, res) => {
    const { qatorlar: kelgan = [], izoh } = req.body;
    const qabulMap = {};
    (Array.isArray(kelgan) ? kelgan : []).forEach(q => { qabulMap[q.id] = q.qabul_dona; });
    const asosiyOmbor = ASOSIY_OMBOR;

    const t = await sequelize.transaction();
    try {
      // Qulflab qayta o'qish: ikki marta "qabul" bosilsa tovar ikki marta ko'chmasin
      const ariza = await qulflabOl(ArizaModel, req.params.id, t);
      if (!ariza) throw new HttpException(404, 'Ariza topilmadi');

      if (ariza.turi !== 'qaytarish') {
        throw new HttpException(400, 'Bu ariza qaytarish emas');
      }
      if (ariza.holat !== 'qabul_kutilmoqda') {
        throw new HttpException(400,
          `Ariza "${ariza.holat}" holatida — faqat "qabul_kutilmoqda" qabul qilinadi`);
      }

      const agentOmbor = ariza.ombor || agentOmbori(ariza.agent_nomi);
      const qatorlar   = await qatorlarniQulflabOl(ariza.id, t);

      const chiqim = [], kirim = [];
      let jamiQabul = 0, jamiFarq = 0;

      for (const q of qatorlar) {
        const aytilgan = parseFloat(q.jami_dona || 0);
        // Skladchi qiymat bermasa — to'liq qabul qilingan hisoblanadi
        const xom = qabulMap[q.id];
        let qabul = xom === undefined || xom === null ? aytilgan : parseFloat(xom);

        if (isNaN(qabul) || qabul < 0) qabul = 0;
        if (qabul > aytilgan) {
          throw new HttpException(400,
            `"${q.tovar_nomi}": qabul (${qabul}) agent aytganidan (${aytilgan}) ko'p bo'lolmaydi`);
        }

        await q.update({ qabul_dona: qabul }, { transaction: t });
        jamiQabul += qabul;
        jamiFarq  += aytilgan - qabul;

        if (!q.tovar_id || qabul <= 0) continue;

        const birlikNarx = parseFloat(q.narx || 0);
        const summa = +(birlikNarx * qabul).toFixed(2);

        // Agent omboridan chiqadi
        chiqim.push({
          tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum || null,
          ombor: agentOmbor, tur: 'qaytarma_chiqim', manba_tur: 'qaytarma',
          manba_id: ariza.id,
          donada: -Math.abs(qabul), bloklarda: 0, qutilarda: 0, hajm: 0,
          kirim_narx: 0, sotuv_narx: birlikNarx, summa: -Math.abs(summa),
          sana: new Date(),
        });

        // Asosiy omborga kiradi
        kirim.push({
          tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum || null,
          ombor: asosiyOmbor, tur: 'qaytarma_kirim', manba_tur: 'qaytarma',
          manba_id: ariza.id,
          donada: Math.abs(qabul), bloklarda: 0, qutilarda: 0, hajm: 0,
          kirim_narx: 0, sotuv_narx: birlikNarx, summa: Math.abs(summa),
          sana: new Date(),
        });
      }

      if (chiqim.length) await TovarRegisterModel.bulkCreate(chiqim, { transaction: t });
      if (kirim.length)  await TovarRegisterModel.bulkCreate(kirim,  { transaction: t });

      await ariza.update({
        holat: 'qabul_qilindi',
        ombor: asosiyOmbor,
        qabul_qilgan_id: req.currentUser?.id || null,
        qabul_sana: new Date(),
        izoh: izoh ? `${ariza.izoh ? ariza.izoh + ' | ' : ''}${izoh}` : ariza.izoh,
      }, { transaction: t });

      await t.commit();

      const full = await ArizaModel.findByPk(ariza.id, { include: INCLUDE });
      res.send({
        ...full.toJSON(),
        _qabul: {
          jami_qabul: +jamiQabul.toFixed(3),
          jami_farq:  +jamiFarq.toFixed(3),
          // Farq nolga teng bo'lmasa — agent omborida tushuntirilmagan qoldiq bor
          farq_bor: jamiFarq > 0.001,
          agent_ombor: agentOmbor,
        },
      });
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }
  };

  /* GET /arizalar/agent-ombor-qoldiq
   * Agent omborlarida qolgan tovar — qabul qilinmagan yoki farq bo'lib
   * qolgan miqdor. Nazorat uchun: uzoq turgan qoldiq muammoni bildiradi. */
  agentOmborQoldiq = async (req, res) => {
    const rows = await sequelize.query(`
      SELECT ombor, tovar_id, tovar_nomi, turkum,
             SUM(donada) qoldiq,
             SUM(summa)  summa,
             MAX(sana)   oxirgi
      FROM tovar_register
      WHERE ombor LIKE :prefiks
      GROUP BY ombor, tovar_id, tovar_nomi, turkum
      HAVING ABS(SUM(donada)) > 0.001
      ORDER BY ombor ASC, qoldiq DESC`,
      { replacements: { prefiks: AGENT_PREFIKS + '%' }, type: sequelize.QueryTypes.SELECT });

    // Ombor bo'yicha guruhlaymiz
    const guruh = {};
    rows.forEach(r => {
      const g = guruh[r.ombor] = guruh[r.ombor] || {
        ombor: r.ombor, agent: agentNomi(r.ombor), tovarlar: [], jami_dona: 0, jami_summa: 0,
      };
      const dona = parseFloat(r.qoldiq || 0);
      g.tovarlar.push({
        tovar_id: r.tovar_id, tovar_nomi: r.tovar_nomi, turkum: r.turkum,
        qoldiq: +dona.toFixed(3), summa: +parseFloat(r.summa || 0).toFixed(2),
        oxirgi: r.oxirgi,
      });
      g.jami_dona  += dona;
      g.jami_summa += parseFloat(r.summa || 0);
    });

    const natija = Object.values(guruh).map(g => ({
      ...g,
      jami_dona:  +g.jami_dona.toFixed(3),
      jami_summa: +g.jami_summa.toFixed(2),
    })).sort((a, b) => b.jami_dona - a.jami_dona);

    res.send({
      omborlar: natija,
      jami: {
        ombor_soni: natija.length,
        dona:  +natija.reduce((s, g) => s + g.jami_dona, 0).toFixed(3),
        summa: +natija.reduce((s, g) => s + g.jami_summa, 0).toFixed(2),
      },
    });
  };

  topluYolda = async (req, res) => {
    const { ariza_idlar, dostavchi_id } = req.body;
    if (!Array.isArray(ariza_idlar) || !ariza_idlar.length) {
      throw new HttpException(400, "Kamida bitta ariza tanlanishi kerak");
    }

    let dostavchi = null;
    if (dostavchi_id) {
      dostavchi = await DostavchiModel.findByPk(dostavchi_id);
      if (!dostavchi) throw new HttpException(404, 'Dostavchi topilmadi');
    }

    const muvaffaqiyat = [];
    const xatolar = [];

    for (const id of ariza_idlar) {
      const t = await sequelize.transaction();
      try {
        // Qulflab o'qish — parallel changeHolat/topluYolda bilan ikki marta chiqim yozilmasin
        const ariza = await qulflabOl(ArizaModel, id, t);
        if (!ariza) throw new HttpException(404, 'Ariza topilmadi');

        if (!(HOLAT_NEXT[ariza.holat] || []).includes('yolda')) {
          throw new HttpException(400, `"${ariza.holat}" holatidan yo'lga chiqarib bo'lmaydi`);
        }
        if (ariza.turi === 'qaytarish') {
          throw new HttpException(400, "Qaytarish hujjati yo'lga chiqarilmaydi");
        }

        const qatorlar = await qatorlarniQulflabOl(ariza.id, t);
        const ombor    = ariza.ombor || 'Основной склад';
        await tovarlarniQulfla(qatorlar.map(q => q.tovar_id), t);

        for (const q of qatorlar) {
          if (!q.tovar_id) continue;
          const qoldiq = await omborQoldigi(q.tovar_id, ombor, t);
          const kerak  = parseFloat(q.jami_dona || 0);
          if (kerak > qoldiq) {
            throw new HttpException(400,
              `"${q.tovar_nomi}" omborda yetarli emas. Kerak: ${kerak}, mavjud: ${qoldiq}`
            );
          }
        }

        await TovarRegisterModel.bulkCreate(
          qatorlar.filter(q => q.tovar_id).map(q => ({
            tovar_id:   q.tovar_id,
            tovar_nomi: q.tovar_nomi,
            turkum:     q.turkum || null,
            ombor,
            tur:        'chiqim',
            manba_tur:  'sotuv',
            manba_id:   ariza.id,
            donada:     -Math.abs(parseFloat(q.jami_dona || 0)),
            bloklarda:  -Math.abs(parseFloat(q.blok || 0)),
            qutilarda:  0,
            hajm:       0,
            kirim_narx: 0,
            sotuv_narx: parseFloat(q.narx || 0),
            summa:      -Math.abs(parseFloat(q.summa || 0)),
            sana:       new Date(),
          })),
          { transaction: t }
        );

        await ariza.update({
          holat: 'yolda',
          ...(dostavchi ? { dostavchi_id: dostavchi.id, dostavchi_nomi: dostavchi.ism } : {}),
          ...await reysMaydonlari(ariza, dostavchi ? dostavchi.id : ariza.dostavchi_id, t),
        }, { transaction: t });

        await t.commit();
        muvaffaqiyat.push({ ariza_id: ariza.id, raqam: ariza.raqam });
      } catch (e) {
        if (!t.finished) await t.rollback();
        xatolar.push({
          ariza_id: id,
          xato: e instanceof HttpException ? e.message : (e.message || 'Xatolik'),
        });
      }
    }

    res.send({
      yuborildi:  muvaffaqiyat.length,
      xato_soni:  xatolar.length,
      muvaffaqiyat,
      xatolar,
      dostavchi:  dostavchi ? { id: dostavchi.id, ism: dostavchi.ism } : null,
    });
  };

  // ── DELETE /arizalar/:id ──────────────────────────────────
  delete = async (req, res) => {
    await sequelize.transaction(async (t) => {
      // Holat qulflangan nusxada tekshiriladi (parallel tasdiqlash/yo'lga chiqarish bilan poyga yo'q)
      const ariza = await qulflabOl(ArizaModel, req.params.id, t);
      if (!ariza) throw new HttpException(404, 'Ariza topilmadi');
      if (['yetkazildi','tasdiqlangan','yolda','yigilmoqda'].includes(ariza.holat))
        throw new HttpException(400, "Bu holatdagi arizani o'chirib bo'lmaydi");
      await reytingQaytar({ manba_tur: 'ariza', manba_id: ariza.id }, t);
      await ariza.destroy({ transaction: t });
    });
    res.send({ message: "Ariza o'chirildi" });
  };

  // ── GET /arizalar/statistika ──────────────────────────────
  statistika = async (req, res) => {
    const k = kanalSharti(req.query.kanal);
    const w = (x) => (k ? { [Op.and]: [k, x] } : x);
    const [
      jami, yangi, tasdiqlangan, yolda, yetkazildi, bekor,
      bugungi_summa, oylik_summa, yigilmoqda, yolda_sof, avtolavka, distributsiya,
    ] = await Promise.all([
      ArizaModel.count({ where: w({}) }),
      ArizaModel.count({ where: w({ holat: 'yangi' }) }),
      ArizaModel.count({ where: w({ holat: 'tasdiqlangan' }) }),
      ArizaModel.count({ where: w({ holat: { [Op.in]: ['yolda','yigilmoqda'] } }) }),
      ArizaModel.count({ where: w({ holat: 'yetkazildi' }) }),
      ArizaModel.count({ where: w({ holat: 'bekor' }) }),
      // Summa yetkazilgan kun bo'yicha (yaratilgan kun emas); eski yozuvlarda sana bo'lmasa — createdAt
      ArizaModel.findOne({
        where: {
          holat: 'yetkazildi',
          [Op.and]: [sequelize.where(fn('COALESCE', col('yetkazilgan_sana'), col('createdAt')), Op.gte, new Date(new Date().setHours(0,0,0,0)))],
        },
        attributes: [[fn('COALESCE', fn('SUM', col('jami_summa')), 0), 'summa']],
        raw: true,
      }),
      ArizaModel.findOne({
        where: {
          holat: 'yetkazildi',
          [Op.and]: [sequelize.where(fn('COALESCE', col('yetkazilgan_sana'), col('createdAt')), Op.gte, new Date(new Date().getFullYear(), new Date().getMonth(), 1))],
        },
        attributes: [[fn('COALESCE', fn('SUM', col('jami_summa')), 0), 'summa']],
        raw: true,
      }),
      ArizaModel.count({ where: w({ holat: 'yigilmoqda' }) }),
      ArizaModel.count({ where: w({ holat: 'yolda' }) }),
      ArizaModel.count({ where: { [Op.and]: [kanalSharti('avtolavka'), { holat: { [Op.ne]: 'bekor' } }] } }),
      ArizaModel.count({ where: { [Op.and]: [kanalSharti('distributsiya'), { holat: { [Op.ne]: 'bekor' } }] } }),
    ]);

    res.send({
      jami, yangi, tasdiqlangan, yolda, yetkazildi, bekor,
      // Aniq bosqichlar (yolda = faqat 'yolda') va kanal bo'yicha soni — Arizalar sahifasidagi jarayon chizig'i
      bosqich: { yangi, tasdiqlangan, yigilmoqda, yolda: yolda_sof, yetkazildi, bekor },
      kanal: { distributsiya, avtolavka },
      bugungi_summa: Number(bugungi_summa?.summa || 0),
      oylik_summa:   Number(oylik_summa?.summa   || 0),
    });
  };

  // ── GET /arizalar/spravochnik ─────────────────────────────
  // Yangi ariza uchun kerakli ma'lumotlar.
  // Faqat distributsiya kanali: avtolavka agenti mashinasidan sotadi, ombor zakazi
  // bermaydi — u ham, uning mijozlari ham bu ro'yxatga kirmaydi (mijoz.controller kanal qoidasi).
  spravochnik = async (req, res) => {
    const [mijozlar, agentlar, dostavchilar, tovarlar, tovarBloklar] = await Promise.all([
      MijozModel.findAll({
        where: { faol: true, [Op.or]: [{ agent_id: null }, { '$agent.avtolavka$': false }] },
        attributes: ['id','nomi','telefon','manzil','balans','sinf','agent_id','narx_turi'],
        include: [{ model: AgentModel, as: 'agent', attributes: ['id','fullname','avtolavka'] }],
        order: [['nomi','ASC']],
      }),
      AgentModel.findAll({
        where: { faol: true, avtolavka: false },
        attributes: ['id','fullname','telefon','territoriya_id'],
        order: [['fullname','ASC']],
      }),
      // Dostavchilar (buyurtma yetkazuvchi haydovchilar)
      DostavchiModel.findAll({
        where: { faol: true },
        attributes: ['id','ism','telefon','transport','mashina_raqam'],
        order: [['ism','ASC']],
      }),
      // Ombor qoldiqlari (kirim - chiqim), barcha omborlar bo'yicha JAMI —
      // faqat tovar_id bo'yicha guruhlanadi, aks holda bitta tovar har bir
      // ombor uchun alohida qatorda (masalan 3 marta) chiqib, tanlashda
      // chalkashlik keltirib chiqaradi. Tegishli ombor formadagi umumiy
      // "Ombor" tanlovi orqali belgilanadi.
      sequelize.query(`
        SELECT
          r.tovar_id,
          MAX(r.tovar_nomi) AS tovar_nomi,
          MAX(r.turkum)     AS turkum,
          SUM(r.donada)     AS jami_dona,
          (
            SELECT r2.optom_narx
            FROM tovar_register r2
            WHERE r2.tovar_id = r.tovar_id
              AND r2.optom_narx > 0
            ORDER BY r2.id DESC
            LIMIT 1
          ) AS optom_narx,
          (
            SELECT r4.chakana_narx
            FROM tovar_register r4
            WHERE r4.tovar_id = r.tovar_id
              AND r4.chakana_narx > 0
            ORDER BY r4.id DESC
            LIMIT 1
          ) AS chakana_narx,
          (
            SELECT r3.kirim_narx
            FROM tovar_register r3
            WHERE r3.tovar_id = r.tovar_id
              AND r3.kirim_narx > 0
            ORDER BY r3.id DESC
            LIMIT 1
          ) AS kirim_narx
        FROM tovar_register r
        WHERE r.ombor <> :xomOmbor
          AND r.tovar_id NOT IN (SELECT id FROM tovar WHERE turi = 'xom_ashyo')
        GROUP BY r.tovar_id
        HAVING SUM(r.donada) > 0
        ORDER BY tovar_nomi ASC
      `, { replacements: { xomOmbor: XOM_ASHYO_OMBOR }, type: sequelize.QueryTypes.SELECT }),
      // blokdagi_soni — asosiy Tovar jadvalidan
      TovarModel.findAll({
        attributes: ['id', 'blokdagi_soni', 'olchov_birligi'],
        raw: true,
      }),
    ]);

    // Zakaz uchun MAVJUD qoldiq — asosiy sklad, boshqa ochiq buyurtmalarga band qilingani ayirilgan
    const mavjudMap = await mavjudQoldiq({ tovarIds: tovarlar.map(t => t.tovar_id) });

    // blokdagi_soni ni map qilish (tovar_id bo'yicha)
    const blokMap = {};
    const olchovMap = {};
    for (const t of tovarBloklar) { blokMap[t.id] = parseInt(t.blokdagi_soni || 1, 10); olchovMap[t.id] = t.olchov_birligi || 'kg'; }

    res.send({
      mijozlar,
      agentlar,
      dostavchilar: dostavchilar.map(d => ({
        id:            d.id,
        ism:           d.ism,
        telefon:       d.telefon || null,
        transport:     d.transport || null,
        mashina_raqam: d.mashina_raqam || null,
      })),
      tovarlar: tovarlar.map(t => ({
        tovar_id:      t.tovar_id,
        tovar_nomi:    t.tovar_nomi,
        turkum:        t.turkum || 'Boshqa',
        olchov_birligi: olchovMap[t.tovar_id] || 'kg',
        mavjud:        mavjudMap.get(Number(t.tovar_id))?.mavjud || 0,
        jami_qoldiq:   Math.max(0, parseFloat(t.jami_dona || 0)),
        optom_narx:    parseFloat(t.optom_narx || 0),
        chakana_narx:  parseFloat(t.chakana_narx || 0),
        // Moslik uchun: mijoz narx_turi bo'yicha tanlanmagan holatlar uchun standart chakana narx
        sotuv_narx:    parseFloat(t.chakana_narx || 0),
        kirim_narx:    parseFloat(t.kirim_narx || 0),
        blokdagi_soni: blokMap[t.tovar_id] ?? 1,
      })),
      omborlar: ['Основной склад', 'Запасной склад'],
    });
  };
}

module.exports = new ArizaController();
