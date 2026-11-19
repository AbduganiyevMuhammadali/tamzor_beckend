const { PrixodModel, PrixodQatorModel } = require('../../models/prixod.model');
const { kunParam, kunOraligi, kunBoshi, kunOxiri } = require('../../utils/sana.utils');
const TovarRegisterModel = require('../../models/tovar_register.model');
const { YetkazuvchiModel, YetkazuvchiHarakatlarModel } = require('../../models/yetkazuvchi.model');
const KassaModel = require('../../models/kassa.model');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { Op, fn, col } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { joriyKurs } = require('../../utils/kurs.utils');
const TovarModel = require('../../models/tovar.model');
const { XOM_ASHYO_OMBOR } = require('../../utils/ombor.utils');
const { adminMi } = require('../../utils/sotuvBekor.utils');
const { ochirishParoliTekshir } = require('../../utils/xavfsizlik.utils');
const { miq } = require('../../utils/tahlil.utils');
const { qulflabOl, tovarlarniQulfla } = require('../../utils/qulf.utils');

const ROYXAT_MAX_LIMIT = 500;

// Qatordagi $ narxlarni joriy kursga ko'paytirib so'm narxini avtomatik
// hisoblaydi. Foydalanuvchi $ kiritsa — so'm shundan hosil bo'ladi; agar $
// berilmasa (0/bo'sh), qator so'mda qo'lda kiritilgan deb hisoblanadi va
// tegilmaydi. Har bir qatorga o'sha paytdagi kurs yozib qo'yiladi — kurs
// keyinchalik o'zgarsa ham eski hujjatlar o'z tarixiy qiymatini saqlaydi.
// Optom va chakana narxlar alohida-alohida shu tarzda hisoblanadi.
function qatorNarxHisobla(q, kurs) {
  const narxUsd        = Number(q.narx_usd)         || 0;
  const optomNarxUsd   = Number(q.optom_narx_usd)   || 0;
  const chakanaNarxUsd = Number(q.chakana_narx_usd) || 0;
  const optomNarx      = optomNarxUsd > 0   ? +(optomNarxUsd * kurs).toFixed(2)   : (Number(q.optom_narx)   || 0);
  const chakanaNarx    = chakanaNarxUsd > 0 ? +(chakanaNarxUsd * kurs).toFixed(2) : (Number(q.chakana_narx) || 0);
  const narx           = narxUsd > 0 ? +(narxUsd * kurs).toFixed(2) : (Number(q.narx) || 0);
  const donada         = Number(q.donada) || 0;
  if (narx < 0 || donada < 0) throw new HttpException(400, `"${q.tovar_nomi || q.tovar_id}": narx va miqdor manfiy bo'lishi mumkin emas`);
  return {
    ...q,
    narx,
    // Qator summasi serverda hisoblanadi (narx × jami miqdor) — klient yuborgan summa
    // ishonilmaydi (yetkazuvchi qarzi va kassa shundan yoziladi). narxlar() bilan bir xil formula.
    summa:            +(narx * donada).toFixed(2),
    narx_usd:         narxUsd,
    optom_narx:       optomNarx,
    optom_narx_usd:   optomNarxUsd,
    chakana_narx:     chakanaNarx,
    chakana_narx_usd: chakanaNarxUsd,
    // Eski ustun — moslik uchun chakana narxga tenglashtiriladi (eng ko'p ishlatiladigan)
    sotuv_narx:     chakanaNarx,
    sotuv_narx_usd: chakanaNarxUsd,
    kurs: (narxUsd > 0 || optomNarxUsd > 0 || chakanaNarxUsd > 0) ? kurs : (q.kurs || null),
  };
}

/* Prixod kirimlari (tranzaksiya ichida qulflab) va ularni olib tashlash mumkinmi:
   shu ombordagi qoldiq hujjat miqdoridan kam bo'lsa — tovar allaqachon sotilgan.
   Avval kirim qatorlari, so'ng tovarlar qulflanadi (FOR UPDATE) — qoldiq yig'indisi
   qulfdan KEYIN o'qiladi, parallel chiqim yozuvchilar kutadi. */
async function prixodQoldiqTekshir(prixodId, t) {
  const kirimlar = (await TovarRegisterModel.findAll({
    where: { manba_tur: 'prixod', manba_id: prixodId }, transaction: t, lock: t.LOCK.UPDATE,
  })).map(k => k.get({ plain: true }));
  await tovarlarniQulfla(kirimlar.map(k => k.tovar_id), t);
  const yetmaydi = [];
  for (const k of kirimlar) {
    const kerak = Number(k.donada) || 0;
    if (kerak <= 0) continue;
    const [r] = await sequelize.query(`SELECT COALESCE(SUM(donada), 0) s FROM tovar_register WHERE tovar_id = :t AND ombor = :o`,
      { replacements: { t: k.tovar_id, o: k.ombor }, type: sequelize.QueryTypes.SELECT, transaction: t });
    const qoldiq = Number(r.s) || 0;
    if (qoldiq - kerak < -0.0005) yetmaydi.push(`${k.tovar_nomi}: omborda ${miq(qoldiq)} kg, hujjatda ${miq(kerak)} kg (${miq(kerak - qoldiq)} kg allaqachon sotilgan)`);
  }
  return { kirimlar, yetmaydi };
}

class PrixodController extends BaseController {

  getAll = async (req, res) => {
    const { search, holat, page = 1, limit = 50, date_from, date_to } = req.query;

    const where = {};
    if (holat)     where.holat = holat;
    if (search)    where.yetkazuvchi = { [Op.like]: `%${search}%` };
    const { from, to } = kunOraligi({ date_from, date_to });
    if (from || to) {
      where.sana = {};
      if (from) where.sana[Op.gte] = kunBoshi(from);
      if (to)   where.sana[Op.lte] = kunOxiri(to);
    }

    const lim    = Math.min(Math.max(parseInt(limit, 10) || 50, 1), ROYXAT_MAX_LIMIT);
    const sahifa = Math.max(parseInt(page, 10) || 1, 1);
    const offset = (sahifa - 1) * lim;
    const { count, rows } = await PrixodModel.findAndCountAll({
      where,
      order: [['sana', 'DESC'], ['id', 'DESC']],
      limit: lim,
      offset,
    });

    // Ro'yxatda bloklarda/donada/hajm ustunlarini to'ldirish uchun har bir
    // hujjat bo'yicha qatorlar jamlanmasi — alohida yengil so'rov, N+1 emas.
    const prixodIds = rows.map(r => r.id);
    const jamlar = prixodIds.length
      ? await PrixodQatorModel.findAll({
          where: { prixod_id: { [Op.in]: prixodIds } },
          attributes: [
            'prixod_id',
            [fn('SUM', col('bloklarda')), 'bloklarda'],
            [fn('SUM', col('donada')),    'donada'],
            [fn('SUM', col('hajm')),      'hajm'],
            [fn('COUNT', col('id')),      'tovar_soni'],
          ],
          group: ['prixod_id'],
          raw: true,
        })
      : [];
    const jamMap = {};
    jamlar.forEach(j => { jamMap[j.prixod_id] = j; });

    const data = rows.map(r => {
      const row = r.toJSON();
      const j = jamMap[row.id];
      row.jami_bloklarda = j ? Number(j.bloklarda || 0) : 0;
      row.jami_donada    = j ? Number(j.donada    || 0) : 0;
      row.jami_hajm      = j ? Number(j.hajm       || 0) : 0;
      row.tovar_soni     = j ? Number(j.tovar_soni || 0) : 0;
      return row;
    });

    res.send({ data, total: count, page: sahifa, pages: Math.ceil(count / lim) });
  };

  getById = async (req, res) => {
    const prixod = await PrixodModel.findOne({
      where: { id: req.params.id },
      include: [{ model: PrixodQatorModel, as: 'qatorlar' }],
    });
    if (!prixod) throw new HttpException(404, req.mf('data not found'));
    res.send(prixod);
  };

  create = async (req, res) => {
    this.checkValidation(req);
    const body = req.body;
    const kurs = await joriyKurs();
    const qatorlar = (body.qatorlar || []).map(q => qatorNarxHisobla(q, kurs));
    const t = await sequelize.transaction();
    try {
      const jami = qatorlar.reduce((s, q) => s + Number(q.summa || 0), 0);

      const prixod = await PrixodModel.create({
        hujjat_raqam:      body.hujjat_raqam      || null,
        sana:              body.sana,
        yetkazuvchi:       body.yetkazuvchi        || null,
        yetkazuvchi_id:    body.yetkazuvchi_id     || null,
        tolov_turi:        body.tolov_turi         || null,
        tolangan_summa:    body.tolangan_summa     || 0,
        ombor:             body.ombor              || 'Основной склад',
        izoh:              body.izoh               || null,
        qoshimcha_xarajat: body.qoshimcha_xarajat  || 0,
        jami_summa:        jami,
        holat:             'qoralama',
      }, { transaction: t });

      if (qatorlar.length) {
        await PrixodQatorModel.bulkCreate(
          qatorlar.map(q => ({ ...q, sotuv_narx: q.sotuv_narx ?? 0, prixod_id: prixod.id })),
          { transaction: t }
        );
      }

      await t.commit();
      const result = await PrixodModel.findOne({
        where: { id: prixod.id },
        include: [{ model: PrixodQatorModel, as: 'qatorlar' }],
      });
      res.status(201).send(result);
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }
  };

  update = async (req, res) => {
    this.checkValidation(req);
    const body = req.body;
    const prixod = await PrixodModel.findOne({ where: { id: req.params.id } });
    if (!prixod) throw new HttpException(404, req.mf('data not found'));
    if (prixod.holat === 'tasdiqlangan') throw new HttpException(400, 'Tasdiqlangan hujjatni tahrirlash mumkin emas');

    const kurs = await joriyKurs();
    const qatorlar = body.qatorlar ? body.qatorlar.map(q => qatorNarxHisobla(q, kurs)) : null;

    const t = await sequelize.transaction();
    try {
      // Tahrir paytida parallel tasdiqlash bo'lsa — tasdiqlangan hujjat qatorlari o'zgarmasin
      const qulf = await qulflabOl(PrixodModel, prixod.id, t);
      if (!qulf || qulf.holat === 'tasdiqlangan') throw new HttpException(400, 'Tasdiqlangan hujjatni tahrirlash mumkin emas');
      const jami = (qatorlar || []).reduce((s, q) => s + Number(q.summa || 0), 0);

      await prixod.update({
        sana:              body.sana              ?? prixod.sana,
        yetkazuvchi:       body.yetkazuvchi       ?? prixod.yetkazuvchi,
        yetkazuvchi_id:    body.yetkazuvchi_id    !== undefined ? (body.yetkazuvchi_id || null) : prixod.yetkazuvchi_id,
        tolov_turi:        body.tolov_turi        !== undefined ? (body.tolov_turi     || null) : prixod.tolov_turi,
        tolangan_summa:    body.tolangan_summa    ?? prixod.tolangan_summa,
        ombor:             body.ombor             ?? prixod.ombor,
        izoh:              body.izoh              ?? prixod.izoh,
        qoshimcha_xarajat: body.qoshimcha_xarajat ?? prixod.qoshimcha_xarajat,
        jami_summa:        qatorlar ? jami : prixod.jami_summa,
      }, { transaction: t });

      if (qatorlar) {
        await PrixodQatorModel.destroy({ where: { prixod_id: prixod.id }, transaction: t });
        if (qatorlar.length) {
          await PrixodQatorModel.bulkCreate(
            qatorlar.map(q => ({ ...q, prixod_id: prixod.id })),
            { transaction: t }
          );
        }
      }

      await t.commit();
      const result = await PrixodModel.findOne({
        where: { id: prixod.id },
        include: [{ model: PrixodQatorModel, as: 'qatorlar' }],
      });
      res.send(result);
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }
  };

  tasdiqla = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      // 0. Hujjat qulflanib qayta o'qiladi — ikki marta "tasdiqlash" bosilsa ombor kirimi,
      //    yetkazuvchi qarzi va kassa chiqimi ikki marta yozilmasin
      const prixod = await qulflabOl(PrixodModel, req.params.id, t);
      if (!prixod) throw new HttpException(404, req.mf('data not found'));
      if (prixod.holat === 'tasdiqlangan') throw new HttpException(400, 'Allaqachon tasdiqlangan');
      const qatorlar = await PrixodQatorModel.findAll({ where: { prixod_id: prixod.id }, order: [['id', 'ASC']], transaction: t });
      if (!qatorlar.length) throw new HttpException(400, 'Qatorlar bo\'sh — tasdiqlash mumkin emas');

      // 1. Holat o'zgartir
      await prixod.update({ holat: 'tasdiqlangan' }, { transaction: t });

      // 2. Har bir qator uchun tovar_register ga kirim yoz.
      //    Xom ashyo turidagi tovar savdo skladiga emas, "Xom ashyo ombori"ga tushadi.
      const xomIds = new Set((await TovarModel.findAll({
        where: { id: qatorlar.map(q => q.tovar_id).filter(Boolean), turi: 'xom_ashyo' },
        attributes: ['id'], raw: true, transaction: t, paranoid: false,
      })).map(x => x.id));
      await TovarRegisterModel.bulkCreate(
        qatorlar.map(q => ({
          tovar_id:   q.tovar_id,
          tovar_nomi: q.tovar_nomi,
          turkum:     q.turkum     || null,
          ombor:      xomIds.has(q.tovar_id) ? XOM_ASHYO_OMBOR : (prixod.ombor || 'Основной склад'),
          tur:        'kirim',
          manba_tur:  'prixod',
          manba_id:   prixod.id,
          donada:     Number(q.donada)     || 0,
          bloklarda:  Number(q.bloklarda)  || 0,
          qutilarda:  Number(q.qutilarda)  || 0,
          hajm:       Number(q.hajm)       || 0,
          kirim_narx:       Number(q.narx)             || 0,
          kirim_narx_usd:   Number(q.narx_usd)         || 0,
          optom_narx:       Number(q.optom_narx)       || 0,
          optom_narx_usd:   Number(q.optom_narx_usd)   || 0,
          chakana_narx:     Number(q.chakana_narx)     || 0,
          chakana_narx_usd: Number(q.chakana_narx_usd) || 0,
          sotuv_narx:       Number(q.chakana_narx)     || 0,
          sotuv_narx_usd:   Number(q.chakana_narx_usd) || 0,
          summa:      Number(q.summa)      || 0,
          sana:       prixod.sana,
        })),
        { transaction: t }
      );

      // 3. Yetkazuvchi qarz va to'lov yozuvlari
      if (prixod.yetkazuvchi_id) {
        const yetk = await YetkazuvchiModel.findByPk(prixod.yetkazuvchi_id, { transaction: t });
        if (!yetk) throw new HttpException(404, 'Yetkazuvchi topilmadi');

        const jamiSumma = Number(prixod.jami_summa);
        const tolangan  = Number(prixod.tolangan_summa) || 0;
        const hujjat    = prixod.hujjat_raqam || `#${prixod.id}`;

        // Qarz yozish (balans kamayadi)
        await yetk.decrement('balans', { by: jamiSumma, transaction: t });
        await YetkazuvchiHarakatlarModel.create({
          yetkazuvchi_id: prixod.yetkazuvchi_id,
          prixod_id:      prixod.id,
          tur:            'qarz',
          summa:          jamiSumma,
          tolov_turi:     prixod.tolov_turi || null,
          izoh:           `Prixod ${hujjat} bo'yicha qarz`,
          sana:           prixod.sana,
        }, { transaction: t });

        // Darhol to'lov bo'lsa — to'lov ham yoziladi
        if (tolangan > 0) {
          await yetk.increment('balans', { by: tolangan, transaction: t });
          await YetkazuvchiHarakatlarModel.create({
            yetkazuvchi_id: prixod.yetkazuvchi_id,
            prixod_id:      prixod.id,
            tur:            'tolov',
            summa:          tolangan,
            tolov_turi:     prixod.tolov_turi || null,
            izoh:           `Prixod ${hujjat} uchun oldindan to'lov`,
            sana:           prixod.sana,
          }, { transaction: t });

          // Kassadan CHIQIM — yetkazuvchiga to'lov
          await KassaModel.create({
            tur:        'chiqim',
            kategoriya: 'yetkazuvchi_tolov',
            summa:      tolangan,
            tolov_usul: 'naqt',
            manba_tur:  'prixod',
            manba_id:   prixod.id,
            izoh:       `Prixod ${hujjat} — ${yetk.ism} ga to'lov`,
            sana:       prixod.sana,
          }, { transaction: t });
        }
      }

      await t.commit();
      res.send({ ...prixod.toJSON(), qatorlar: qatorlar.map(q => q.toJSON()), holat: 'tasdiqlangan' });
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }
  };

  // Tasdiqlangan prixodni bekor qilish — register dan o'chiradi
  // ── PATCH /prixod/:id/narxlar — NARX va MIQDOR tuzatish (tasdiqlangandan keyin ham) ──
  // Yangilanadi: qator narxlari va miqdori, tovar_register'dagi shu hujjat kirimlari (tannarx
  // xaritasi, sotuv narxi va ombor qoldig'i shundan), hujjat jami summasi, yetkazuvchi qarzi
  // (harakat summasi + balans farqi). Hujjatni bekor qilib qayta tasdiqlash SHART EMAS.
  // Miqdor (`donada`, jami kg) tasdiqlangan hujjatda faqat Admin tuzatadi (foydalanuvchi so'rovi
  // 2026-11-03: "sonini o'zgartirish"); kamaytirilganda shu ombordagi qoldiq tovar allaqachon
  // sotilgan bo'lsa (manfiyga tushsa) rad etiladi. Ombor o'zgarmaydi.
  // Bitta sotish narxi: optom = chakana = sotuv_narx (mijoz narx turi qaysi bo'lsa ham bir xil).
  narxlar = async (req, res) => {
    this.checkValidation(req);
    const kiritilgan = new Map((req.body.qatorlar || []).map(x => [Number(x.id), x]));
    const user = req.currentUser || {};

    // Hujjat, qatorlar va holat TRANZAKSIYA ICHIDA qulf bilan o'qiladi: parallel
    // narx tuzatish / bekor qilish / tasdiqlash bilan poyga bo'lsa, yetkazuvchi
    // balansi farqi ikki marta qo'llanmaydi va `tasdiqlangan` eskirgan nusxadan olinmaydi.
    // Diqqat (REPEATABLE READ): oddiy o'qishlardan OLDIN barcha qulflar olinadi.
    const t = await sequelize.transaction();
    try {
      const prixod = await qulflabOl(PrixodModel, req.params.id, t);
      if (!prixod) throw new HttpException(404, req.mf('data not found'));
      const qatorlar = await PrixodQatorModel.findAll({
        where: { prixod_id: prixod.id }, order: [['id', 'ASC']], transaction: t, lock: t.LOCK.UPDATE,
      });
      const tasdiqlangan = prixod.holat === 'tasdiqlangan';

      // Miqdor o'zgarishlari — tasdiqlangan hujjatda faqat Admin
      const miqdorOzgarishi = qatorlar.some(q => {
        const x = kiritilgan.get(q.id);
        return x && x.donada != null && Math.abs((Number(x.donada) || 0) - (Number(q.donada) || 0)) > 0.0005;
      });
      if (miqdorOzgarishi && tasdiqlangan && !adminMi(user)) {
        throw new HttpException(403, "Tasdiqlangan hujjatda miqdorni faqat Admin tuzata oladi");
      }
      // Miqdor kamaytirilsa qoldiq SUM bilan tekshiriladi — shu tovarlar bo'yicha parallel
      // sotuv/chiqim tekshiruvdan keyin qoldiqni minusga tushirmasligi uchun avval qulflanadi.
      if (miqdorOzgarishi && tasdiqlangan) {
        await tovarlarniQulfla(qatorlar.filter(q => kiritilgan.has(q.id)).map(q => q.tovar_id), t);
      }

      const hujjatKursi = (qatorlar.find(q => Number(q.kurs) > 0) || {}).kurs;
      const kurs = Number(hujjatKursi) > 0 ? Number(hujjatKursi) : await joriyKurs();

      // Register qatorlari tasdiqlashda qatorlar tartibida yozilgan — shu tartibda juftlaymiz
      const regByTovar = {};
      if (tasdiqlangan) {
        const regRows = await TovarRegisterModel.findAll({
          where: { manba_tur: 'prixod', manba_id: prixod.id, tur: 'kirim' }, order: [['id', 'ASC']], transaction: t,
        });
        regRows.forEach(r => { (regByTovar[r.tovar_id] = regByTovar[r.tovar_id] || []).push(r); });
      }

      let jami = 0;
      const miqdorIzoh = [];
      for (const q of qatorlar) {
        const x = kiritilgan.get(q.id);
        const reg = (regByTovar[q.tovar_id] || []).shift();
        if (!x) { jami += Number(q.summa) || 0; continue; }

        const narxUsd = x.narx_usd != null ? (Number(x.narx_usd) || 0) : 0;
        const narx = narxUsd > 0 ? +(narxUsd * kurs).toFixed(2) : (x.narx != null ? (Number(x.narx) || 0) : (Number(q.narx) || 0));
        const sotuv = x.sotuv_narx != null ? (Number(x.sotuv_narx) || 0) : (Number(q.chakana_narx) || Number(q.sotuv_narx) || 0);

        // Miqdor: jami kg. Kamaytirilsa — shu ombordagi qoldiq yetishi tekshiriladi.
        const eskiDona = Number(q.donada) || 0;
        let dona = eskiDona;
        if (x.donada != null && Math.abs((Number(x.donada) || 0) - eskiDona) > 0.0005) {
          dona = Number(x.donada) || 0;
          if (dona <= 0) throw new HttpException(400, `"${q.tovar_nomi}": miqdor 0 dan katta bo'lishi kerak (qatorni olib tashlash uchun hujjatni qoralamaga qaytaring)`);
          if (tasdiqlangan && reg && dona < eskiDona) {
            const [r] = await sequelize.query(`SELECT COALESCE(SUM(donada), 0) s FROM tovar_register WHERE tovar_id = :t AND ombor = :o`,
              { replacements: { t: q.tovar_id, o: reg.ombor }, type: sequelize.QueryTypes.SELECT, transaction: t });
            const qoldiq = Number(r.s) || 0;
            if (qoldiq - (eskiDona - dona) < -0.0005) {
              throw new HttpException(400, `"${q.tovar_nomi}": omborda ${miq(qoldiq)} kg qolgan, ${miq(eskiDona - dona)} kg kamaytirib bo'lmaydi — ${miq(eskiDona - qoldiq)} kg allaqachon sotilgan. Eng kami: ${miq(eskiDona - qoldiq)} kg`);
            }
          }
          miqdorIzoh.push(`${q.tovar_nomi} ${miq(eskiDona)} → ${miq(dona)} kg`);
        }

        const summa = +(dona * narx).toFixed(2);
        jami += summa;

        await q.update({
          narx, narx_usd: narxUsd, kurs: narxUsd > 0 ? kurs : q.kurs,
          sotuv_narx: sotuv, sotuv_narx_usd: 0, optom_narx: sotuv, optom_narx_usd: 0, chakana_narx: sotuv, chakana_narx_usd: 0,
          summa,
          ...(dona !== eskiDona ? { donada: dona, bloklarda: 0, qutilarda: 0 } : {}),
        }, { transaction: t });
        if (reg) {
          await reg.update({
            kirim_narx: narx, kirim_narx_usd: narxUsd, optom_narx: sotuv, chakana_narx: sotuv, sotuv_narx: sotuv,
            ...(dona !== eskiDona ? { donada: dona, bloklarda: 0 } : {}),
            summa: +(dona * narx).toFixed(2),
          }, { transaction: t });
        }
      }

      const farq = +(jami - (Number(prixod.jami_summa) || 0)).toFixed(2);
      const yangilash = { jami_summa: jami };
      if (miqdorIzoh.length) {
        const kim = user.username || user.fullname || `user#${user.id || '?'}`;
        const vaqt = new Date().toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        yangilash.izoh = [prixod.izoh, `Miqdor tuzatildi (${kim}, ${vaqt}): ${miqdorIzoh.join(', ')}`].filter(Boolean).join(' · ').slice(0, 2000);
      }
      await prixod.update(yangilash, { transaction: t });

      // Yetkazuvchiga qarz tasdiqlashda yozilgan — summa o'zgarsa qarz ham farqga o'zgaradi
      if (tasdiqlangan && prixod.yetkazuvchi_id && Math.abs(farq) > 0.005) {
        const h = await YetkazuvchiHarakatlarModel.findOne({ where: { prixod_id: prixod.id, tur: 'qarz' }, transaction: t });
        if (h) await h.update({ summa: jami, izoh: `${h.izoh || ''} (${miqdorIzoh.length ? 'miqdor/narx' : 'narx'} tuzatildi: ${farq > 0 ? '+' : ''}${farq})`.slice(0, 2000) }, { transaction: t });
        await YetkazuvchiModel.decrement('balans', { by: farq, where: { id: prixod.yetkazuvchi_id }, transaction: t });
      }

      await t.commit();
      const result = await PrixodModel.findOne({ where: { id: prixod.id }, include: [{ model: PrixodQatorModel, as: 'qatorlar' }] });
      res.send({ ...result.toJSON(), _farq: farq, _miqdor: miqdorIzoh });
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }
  };

  bekorqilish = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      // Qulflab qayta o'qish: ikki parallel bekor qilish yetkazuvchi balansini ikki marta qaytarmasin
      const prixod = await qulflabOl(PrixodModel, req.params.id, t);
      if (!prixod) throw new HttpException(404, req.mf('data not found'));
      if (prixod.holat !== 'tasdiqlangan') throw new HttpException(400, 'Faqat tasdiqlangan hujjatni bekor qilish mumkin');

      // 0. Hujjat tovari allaqachon sotilgan bo'lsa — kirimni olib tashlash qoldiqni minusga tushiradi
      const { yetmaydi } = await prixodQoldiqTekshir(prixod.id, t);
      if (yetmaydi.length) {
        throw new HttpException(400, `Hujjat tovari allaqachon sotilgan, bekor qilib bo'lmaydi — ${yetmaydi.join('; ')}`);
      }

      // 1. Register dan ushbu prixod yozuvlarini o'chir
      await TovarRegisterModel.destroy({
        where: { manba_tur: 'prixod', manba_id: prixod.id },
        transaction: t,
      });

      // 2. Yetkazuvchi harakatlarini bekor qilish
      if (prixod.yetkazuvchi_id) {
        const harakatlar = await YetkazuvchiHarakatlarModel.findAll({
          where: { prixod_id: prixod.id },
          transaction: t,
        });
        for (const h of harakatlar) {
          // qarz → balansga qaytaramiz (+), tolov → balansdan olamiz (-)
          const delta = h.tur === 'qarz' ? Number(h.summa) : -Number(h.summa);
          await YetkazuvchiModel.increment('balans', {
            by: delta,
            where: { id: prixod.yetkazuvchi_id },
            transaction: t,
          });
        }
        await YetkazuvchiHarakatlarModel.destroy({
          where: { prixod_id: prixod.id },
          transaction: t,
        });
      }

      // 3. Tasdiqlashda yozilgan kassa chiqimi (yetkazuvchiga oldindan to'lov) ham bekor —
      //    aks holda qayta tasdiqlanganda kassadan ikki marta chiqim bo'lardi
      await KassaModel.destroy({
        where: { manba_tur: 'prixod', manba_id: prixod.id, kategoriya: 'yetkazuvchi_tolov', tur: 'chiqim' },
        transaction: t,
      });

      await prixod.update({ holat: 'qoralama' }, { transaction: t });

      await t.commit();
      res.send({ ...prixod.toJSON(), holat: 'qoralama' });
    } catch (e) {
      if (!t.finished) await t.rollback();
      throw e;
    }
  };

  // ── DELETE /prixod/:id  body: { parol } ──────────────────────
  // Qoralama — shunchaki o'chadi (qatorlari bilan, qaytmas).
  // Tasdiqlangan — faqat Admin va o'chirish paroli bilan (sozlama `ochirish_parol`,
  // utils/xavfsizlik.utils.js): ombordagi kirim yozuvlari olib tashlanadi, yetkazuvchi
  // qarz/to'lov harakatlari va balansi, shu hujjatning kassa chiqimi bekor bo'ladi,
  // hujjat izohida kim/qachon yozilib soft-delete qilinadi (prixod paranoid; qatorlar qoladi).
  // Tovar allaqachon sotilgan bo'lsa (shu ombordagi qoldiq hujjat miqdoridan kam) — rad
  // etiladi va qaysi tovardan qancha yetishmasligi aytiladi: qoldiq manfiyga tushmasin.
  delete = async (req, res) => {
    const bor = await PrixodModel.findOne({ where: { id: req.params.id } });
    if (!bor) throw new HttpException(404, req.mf('data not found'));
    const hujjat = bor.hujjat_raqam || `#${bor.id}`;

    if (bor.holat !== 'tasdiqlangan') {
      const t = await sequelize.transaction();
      try {
        // Qulflab qayta tekshiramiz: shu orada tasdiqlangan bo'lsa — qoralama sifatida o'chirilmaydi
        const prixod = await qulflabOl(PrixodModel, bor.id, t);
        if (!prixod) throw new HttpException(404, req.mf('data not found'));
        if (prixod.holat === 'tasdiqlangan') throw new HttpException(409, 'Hujjat hozirgina tasdiqlandi — sahifani yangilab qayta urinib ko\'ring');
        await PrixodQatorModel.destroy({ where: { prixod_id: prixod.id }, transaction: t });
        await prixod.destroy({ force: true, transaction: t });
        await t.commit();
        return res.send({ message: `${hujjat} qoralama hujjati o'chirildi` });
      } catch (e) { if (!t.finished) await t.rollback(); throw e; }
    }

    const user = req.currentUser;
    if (!adminMi(user)) throw new HttpException(403, "Tasdiqlangan hujjatni faqat Admin o'chira oladi");
    await ochirishParoliTekshir(req.body?.parol);

    const t = await sequelize.transaction();
    try {
      // Hujjat va tovarlar qulflanadi, "allaqachon sotilgan" tekshiruvi shu tranzaksiya ichida —
      // tekshiruv va o'chirish orasida sotuv qoldiqni minusga tushirib qo'ymasin
      const prixod = await qulflabOl(PrixodModel, bor.id, t);
      if (!prixod) throw new HttpException(404, req.mf('data not found'));
      if (prixod.holat !== 'tasdiqlangan') throw new HttpException(409, 'Hujjat holati o\'zgardi — sahifani yangilab qayta urinib ko\'ring');
      const { kirimlar, yetmaydi } = await prixodQoldiqTekshir(prixod.id, t);
      if (yetmaydi.length) {
        throw new HttpException(400, `Hujjat tovari allaqachon sotilgan, o'chirib bo'lmaydi — ${yetmaydi.join('; ')}`);
      }

      await TovarRegisterModel.destroy({ where: { manba_tur: 'prixod', manba_id: prixod.id }, transaction: t });

      let yetk = null, balansFarq = 0;
      if (prixod.yetkazuvchi_id) {
        const harakatlar = await YetkazuvchiHarakatlarModel.findAll({ where: { prixod_id: prixod.id }, transaction: t });
        for (const h of harakatlar) balansFarq += h.tur === 'qarz' ? Number(h.summa) : -Number(h.summa);   // qarz → +, to'lov → −
        if (balansFarq) await YetkazuvchiModel.increment('balans', { by: balansFarq, where: { id: prixod.yetkazuvchi_id }, transaction: t });
        await YetkazuvchiHarakatlarModel.destroy({ where: { prixod_id: prixod.id }, transaction: t });
        yetk = await YetkazuvchiModel.findByPk(prixod.yetkazuvchi_id, { transaction: t });
      }
      const kassaSoni = await KassaModel.destroy({ where: { manba_tur: 'prixod', manba_id: prixod.id }, transaction: t });

      const kim = user.username || user.fullname || `user#${user.id}`;
      const vaqt = new Date().toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      await prixod.update({ izoh: [prixod.izoh, `O'chirdi: ${kim}, ${vaqt}`].filter(Boolean).join(' · ').slice(0, 250) }, { transaction: t });
      await prixod.destroy({ transaction: t });   // paranoid — bazada deletedAt bilan qoladi
      await t.commit();

      const jamiKg = kirimlar.reduce((s, k) => s + (Number(k.donada) || 0), 0);
      res.send({
        message: `${hujjat} o'chirildi: ombordan ${miq(jamiKg)} kg chiqarildi${yetk ? `, ${yetk.ism} balansi ${balansFarq >= 0 ? '+' : '−'}${Math.abs(Math.round(balansFarq)).toLocaleString('ru-RU')}` : ''}${kassaSoni ? `, kassadagi ${kassaSoni} ta to'lov yozuvi o'chdi` : ''}`,
        ombordan: kirimlar.map(k => ({ tovar: k.tovar_nomi, ombor: k.ombor, kg: Number(k.donada) || 0 })),
        yetkazuvchi: yetk ? { id: yetk.id, ism: yetk.ism, balans: Number(yetk.balans) || 0, farq: balansFarq } : null,
        kassa_ochirildi: kassaSoni,
      });
    } catch (e) { if (!t.finished) await t.rollback(); throw e; }
  };
}

module.exports = new PrixodController();
