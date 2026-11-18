const TovarRegisterModel = require('../../models/tovar_register.model');
const { PrixodModel } = require('../../models/prixod.model');
const { YetkazuvchiModel, YetkazuvchiHarakatlarModel } = require('../../models/yetkazuvchi.model');
const { AuditModel, SotmaslikModel, AgentLocationModel } = require('../../models/hisobot.model');
const { InkassatsiyaModel } = require('../../models/inkassatsiya.model');
const { MarshrutRejaModel, TashrifModel } = require('../../models/marshrut.model');
const { MijozModel } = require('../../models/mijoz.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');
const AgentModel = require('../../models/agent.model');
const DostavchiModel = require('../../models/dostavchi.model');
const TovarModel = require('../../models/tovar.model');
const HttpException = require('../../utils/HttpException.utils');
const { dostavchiTopshir, dostavchiYigildi, dostavchiTopshirildi } = require('../../utils/dostavchiInkassatsiya.utils');
const { Op, fn, col, literal } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { tannarxXaritasi } = require('../../utils/tahlil.utils');

// Barcha tovar+ombor pozitsiyalari uchun FIFO qoldiq (dona + tannarx summasi).
// qoldiqlar() va omborKpi() bir xil hisob-kitob mantig'idan foydalanadi, shu
// bilan ikki hisobotdagi "jami qoldiq qiymati" har doim mos keladi.
async function fifoQoldiqlarHisobla(where = {}) {
  // Qiymat — butun tizimda yagona tannarx qoidasi (utils/tahlil.utils.js):
  // og'irlikli o'rtacha kirim narxi. Oddiy AVG(kirim_narx) qaytarma yozuvlaridagi
  // nol narx tufayli qiymatni pasaytirardi.
  const tannarx = await tannarxXaritasi(new Date());
  // Eslatma: guruhlash faqat tovar_id+ombor bo'yicha (turkum/nom bo'yicha EMAS),
  // aks holda bir xil tovar+ombor uchun turli turkum qiymatli (masalan bo'sh
  // turkumli qaytarma) yozuvlar alohida guruhga tushib, FIFO ketma-ketligi va
  // umumiy summa boshqa hisobotlar bilan mos kelmay qoladi.
  const kirimRows = await TovarRegisterModel.findAll({
    where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] }, ...where },
    attributes: [
      'tovar_id', 'ombor',
      [fn('SUM', col('donada')),     'kirim_dona'],
      [fn('SUM', col('bloklarda')),  'kirim_blok'],
      [fn('SUM', col('qutilarda')),  'kirim_quti'],
      [fn('SUM', col('summa')),      'kirim_summa'],
      [fn('AVG', col('sotuv_narx')), 'sotuv_narx'],
      [fn('AVG', col('kirim_narx')), 'kirim_narx'],
      [fn('AVG', col('sotuv_narx_usd')), 'sotuv_narx_usd'],
      [fn('AVG', col('kirim_narx_usd')), 'kirim_narx_usd'],
      [fn('MIN', col('sana')),       'kirim_sana'],
      [fn('MAX', col('tovar_nomi')), 'tovar_nomi'],
      [fn('MAX', col('turkum')),     'turkum'],
    ],
    group: ['tovar_id', 'ombor'],
    raw: true,
  });
  const chiqimRows = await TovarRegisterModel.findAll({
    where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] }, ...where },
    attributes: ['tovar_id', 'ombor', [fn('SUM', col('donada')), 'chiqim_dona']],
    group: ['tovar_id', 'ombor'],
    raw: true,
  });
  const chiqimQoldiq = {};
  chiqimRows.forEach(r => { chiqimQoldiq[`${r.tovar_id}_${r.ombor}`] = Math.abs(Number(r.chiqim_dona || 0)); });

  return kirimRows
    .slice()
    .sort((a, b) => new Date(a.kirim_sana || 0) - new Date(b.kirim_sana || 0))
    .map(r => {
      const key = `${r.tovar_id}_${r.ombor}`;
      const kirimDona = Number(r.kirim_dona || 0);
      const sarflanadigan = Math.min(kirimDona, chiqimQoldiq[key] || 0);
      chiqimQoldiq[key] = (chiqimQoldiq[key] || 0) - sarflanadigan;
      const qoldiq_dona = kirimDona - sarflanadigan;
      const narx1 = tannarx[r.tovar_id] || Number(r.kirim_narx || 0);
      return {
        tovar_id: r.tovar_id,
        tovar_nomi: r.tovar_nomi,
        turkum: r.turkum,
        ombor: r.ombor,
        kirim_dona: kirimDona,
        kirim_blok: Number(r.kirim_blok || 0),
        kirim_quti: Number(r.kirim_quti || 0),
        chiqim_dona: sarflanadigan,
        kirim_narx: narx1,
        kirim_narx_usd: Number(r.kirim_narx_usd || 0),
        sotuv_narx: Number(r.sotuv_narx || 0),
        sotuv_narx_usd: Number(r.sotuv_narx_usd || 0),
        kirim_summa: Number(r.kirim_summa || 0),
        qoldiq_dona,
        qoldiq_summa: qoldiq_dona * narx1,
        qoldiq_summa_usd: +(qoldiq_dona * Number(r.kirim_narx_usd || 0)).toFixed(2),
      };
    });
}

class HisobotController {

  // Umumiy statistika kartochkalari
  umumiy = async (req, res) => {
    const { date_from, date_to, ombor } = req.query;

    const where = { tur: 'kirim', manba_tur: 'prixod' };
    if (ombor)     where.ombor = ombor;
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to)   where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const [kirim, oylik, prixodSon] = await Promise.all([
      // Jami kirim summasi
      TovarRegisterModel.findOne({
        where,
        attributes: [
          [fn('SUM', col('summa')),   'jami_summa'],
          [fn('SUM', col('donada')),  'jami_dona'],
          [fn('COUNT', col('id')),    'qator_son'],
        ],
        raw: true,
      }),
      // Joriy oy
      TovarRegisterModel.findOne({
        where: {
          ...where,
          sana: {
            [Op.gte]: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            [Op.lte]: new Date(),
          },
        },
        attributes: [
          [fn('SUM', col('summa')),  'jami_summa'],
          [fn('SUM', col('donada')), 'jami_dona'],
        ],
        raw: true,
      }),
      // Tasdiqlangan prixodlar soni
      PrixodModel.count({ where: { holat: 'tasdiqlangan' } }),
    ]);

    res.send({
      jami_summa:   Number(kirim?.jami_summa  || 0),
      jami_dona:    Number(kirim?.jami_dona   || 0),
      qator_son:    Number(kirim?.qator_son   || 0),
      oylik_summa:  Number(oylik?.jami_summa  || 0),
      oylik_dona:   Number(oylik?.jami_dona   || 0),
      prixod_son:   prixodSon,
    });
  };

  // Oylik trend (so'nggi 12 oy)
  oylikTrend = async (req, res) => {
    const { ombor } = req.query;
    const where = { tur: 'kirim', manba_tur: 'prixod' };
    if (ombor) where.ombor = ombor;

    const rows = await TovarRegisterModel.findAll({
      where,
      attributes: [
        [fn('DATE_FORMAT', col('sana'), '%Y-%m'), 'oy'],
        [fn('SUM', col('summa')),                 'summa'],
        [fn('SUM', col('donada')),                'dona'],
        [fn('COUNT', col('id')),                  'son'],
      ],
      group: [literal("DATE_FORMAT(sana, '%Y-%m')")],
      order: [[literal("DATE_FORMAT(sana, '%Y-%m')"), 'ASC']],
      limit: 12,
      raw: true,
    });

    res.send(rows.map(r => ({
      oy:    r.oy,
      summa: Number(r.summa || 0),
      dona:  Number(r.dona  || 0),
      son:   Number(r.son   || 0),
    })));
  };

  // Turkum bo'yicha kirim
  turkumHisobot = async (req, res) => {
    const { date_from, date_to, ombor } = req.query;
    const where = { tur: 'kirim', manba_tur: 'prixod' };
    if (ombor)     where.ombor = ombor;
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to)   where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const rows = await TovarRegisterModel.findAll({
      where,
      attributes: [
        'turkum',
        [fn('SUM', col('summa')),  'summa'],
        [fn('SUM', col('donada')), 'dona'],
        [fn('COUNT', col('id')),   'son'],
      ],
      group: ['turkum'],
      order: [[fn('SUM', col('summa')), 'DESC']],
      raw: true,
    });

    const total = rows.reduce((s, r) => s + Number(r.summa || 0), 0);
    res.send(rows.map(r => ({
      turkum: r.turkum || 'Boshqa',
      summa:  Number(r.summa || 0),
      dona:   Number(r.dona  || 0),
      son:    Number(r.son   || 0),
      foiz:   total ? +((Number(r.summa || 0) / total * 100).toFixed(1)) : 0,
    })));
  };

  // ══ TOVAR HISOBOTI: kirim narxi, sotilgan, foyda, joriy qoldiq ══
  // Foyda taxminiy — o'rtacha kirim narxiga asoslanadi (aniq FIFO/lot-based
  // foyda MODUL 5 — WMS/yaroqlilik muddati bilan birga quriladi).
  tovarHisobot = async (req, res) => {
    const { date_from, date_to, turkum, search } = req.query;

    // Tovar nomi/turkumi TovarModel'dan olinadi (spravochnik) — tovar_register'da
    // bir xil tovar turli yozuvlarda turli turkum/nom bilan kelishi mumkin
    // (masalan qaytarma yozuvlarida turkum bo'sh), shu sabab GROUP BY'da
    // ishlatilmaydi, aks holda bitta tovar bir necha qatorga bo'linib ketadi.
    const tovarWhere = { faol: true };
    if (turkum) tovarWhere.turkum = turkum;
    if (search) tovarWhere.nomi = { [Op.like]: `%${search}%` };
    const tovarlar = await TovarModel.findAll({ where: tovarWhere, attributes: ['id', 'nomi', 'turkum', 'blokdagi_soni', 'olchov_birligi'], raw: true });
    const tovarMap = {};
    tovarlar.forEach(t => { tovarMap[t.id] = t; });

    // 1) Kirim (prixod + qaytarma/brak) — tannarx va joriy qoldiq manbai
    const kirimRows = await TovarRegisterModel.findAll({
      where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] }, tovar_id: { [Op.in]: Object.keys(tovarMap).map(Number) } },
      attributes: [
        'tovar_id',
        [fn('SUM', col('donada')),     'kirim_dona'],
        [fn('SUM', col('summa')),      'kirim_summa'],
        [fn('AVG', col('kirim_narx')), 'kirim_narx'],
        [fn('AVG', col('kirim_narx_usd')), 'kirim_narx_usd'],
        [fn('MAX', col('sana')),       'oxirgi_kirim_sana'],
      ],
      group: ['tovar_id'],
      raw: true,
    });

    // 2) Umumiy chiqim (sotuv + qaytarma-chiqim) — joriy qoldiqni hisoblash uchun
    const chiqimRows = await TovarRegisterModel.findAll({
      where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] } },
      attributes: [
        'tovar_id',
        [fn('SUM', col('donada')), 'chiqim_dona'],
      ],
      group: ['tovar_id'],
      raw: true,
    });
    const chiqimMap = {};
    chiqimRows.forEach(r => { chiqimMap[r.tovar_id] = Math.abs(Number(r.chiqim_dona || 0)); });

    // 3) Yetkazilgan sotuvlar (davr bo'yicha) — haqiqiy savdo hajmi/summasi/foyda uchun
    const arizaWhere = { turi: 'sotish', holat: 'yetkazildi' };
    if (date_from || date_to) {
      arizaWhere.yetkazilgan_sana = {};
      if (date_from) arizaWhere.yetkazilgan_sana[Op.gte] = new Date(date_from);
      if (date_to)   arizaWhere.yetkazilgan_sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }
    const sotuvRows = await sequelize.query(`
      SELECT aq.tovar_id,
        SUM(aq.jami_dona) AS sotilgan_dona,
        SUM(aq.summa)     AS sotuv_summa,
        COUNT(DISTINCT ar.id) AS buyurtma_soni,
        COUNT(DISTINCT ar.mijoz_id) AS mijoz_soni
      FROM ariza_qator aq
      JOIN ariza ar ON ar.id = aq.ariza_id
      WHERE ar.turi = 'sotish' AND ar.holat = 'yetkazildi' AND ar.deletedAt IS NULL
        ${date_from ? 'AND ar.yetkazilgan_sana >= :date_from' : ''}
        ${date_to   ? "AND ar.yetkazilgan_sana <= :date_to_end" : ''}
      GROUP BY aq.tovar_id
    `, {
      replacements: { date_from, date_to_end: date_to ? `${date_to} 23:59:59` : null },
      type: sequelize.QueryTypes.SELECT,
    });
    const sotuvMap = {};
    sotuvRows.forEach(r => { sotuvMap[r.tovar_id] = r; });

    const result = kirimRows
      .map(r => {
        const tovar      = tovarMap[r.tovar_id] || {};
        const kirimDona  = Number(r.kirim_dona  || 0);
        const kirimNarx  = Number(r.kirim_narx  || 0);
        const kirimNarxUsd = Number(r.kirim_narx_usd || 0);
        const qoldiq     = kirimDona - (chiqimMap[r.tovar_id] || 0);
        const s          = sotuvMap[r.tovar_id] || {};
        const sotilganDona = Number(s.sotilgan_dona || 0);
        const sotuvSumma    = Number(s.sotuv_summa    || 0);
        const tannarxSumma  = sotilganDona * kirimNarx;
        const foydaSumma    = sotuvSumma - tannarxSumma;
        const blokdagiSoni  = Number(tovar.blokdagi_soni || 1) || 1;
        return {
          tovar_id:        r.tovar_id,
          tovar_nomi:      tovar.nomi || '—',
          turkum:          tovar.turkum || 'Boshqa',
          olchov_birligi:  tovar.olchov_birligi || 'kg',
          blokdagi_soni:   blokdagiSoni,
          kirim_narx:      kirimNarx,
          kirim_narx_usd:  kirimNarxUsd,
          qoldiq_dona:     qoldiq,
          qoldiq_pachka:   +(qoldiq / blokdagiSoni).toFixed(1),
          qoldiq_pachka_dona: Math.floor(qoldiq / blokdagiSoni),
          qoldiq_ortiqcha_dona: qoldiq - Math.floor(qoldiq / blokdagiSoni) * blokdagiSoni,
          qoldiq_summa:    +(qoldiq * kirimNarx).toFixed(0),
          qoldiq_summa_usd: +(qoldiq * kirimNarxUsd).toFixed(2),
          sotilgan_dona:   sotilganDona,
          sotuv_summa:     sotuvSumma,
          tannarx_summa:   +tannarxSumma.toFixed(0),
          foyda_summa:     +foydaSumma.toFixed(0),
          foyda_foiz:      sotuvSumma > 0 ? +((foydaSumma / sotuvSumma) * 100).toFixed(1) : 0,
          buyurtma_soni:   Number(s.buyurtma_soni || 0),
          mijoz_soni:      Number(s.mijoz_soni    || 0),
          oxirgi_kirim_sana: r.oxirgi_kirim_sana,
        };
      })
      .sort((a, b) => b.sotuv_summa - a.sotuv_summa);

    res.send(result);
  };

  // Bitta tovar bo'yicha sotuv tafsiloti: kimga, qachon, qancha, kim yetkazgan
  tovarHisobotDetail = async (req, res) => {
    const { tovar_id } = req.params;
    const { date_from, date_to } = req.query;

    const arizaWhere = { turi: 'sotish', holat: 'yetkazildi' };
    if (date_from || date_to) {
      arizaWhere.yetkazilgan_sana = {};
      if (date_from) arizaWhere.yetkazilgan_sana[Op.gte] = new Date(date_from);
      if (date_to)   arizaWhere.yetkazilgan_sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const qatorlar = await ArizaQatorModel.findAll({
      where: { tovar_id },
      include: [{
        model: ArizaModel,
        as: 'ariza',
        where: arizaWhere,
        attributes: ['id', 'raqam', 'mijoz_id', 'mijoz_nomi', 'agent_id', 'agent_nomi',
          'dostavchi_id', 'dostavchi_nomi', 'yetkazilgan_sana', 'ombor'],
      }],
      order: [[{ model: ArizaModel, as: 'ariza' }, 'yetkazilgan_sana', 'DESC']],
      limit: 200,
    });

    res.send(qatorlar.map(q => ({
      ariza_id:         q.ariza.id,
      raqam:            q.ariza.raqam,
      mijoz_id:         q.ariza.mijoz_id,
      mijoz_nomi:       q.ariza.mijoz_nomi,
      agent_nomi:       q.ariza.agent_nomi,
      dostavchi_id:     q.ariza.dostavchi_id,
      dostavchi_nomi:   q.ariza.dostavchi_nomi || '—',
      yetkazilgan_sana: q.ariza.yetkazilgan_sana,
      ombor:            q.ariza.ombor,
      dona:             Number(q.jami_dona || 0),
      narx:             Number(q.narx || 0),
      summa:            Number(q.summa || 0),
    })));
  };

  // Top tovarlar (summasi bo'yicha)
  topTovarlar = async (req, res) => {
    const { date_from, date_to, ombor, limit = 10 } = req.query;
    const where = { tur: 'kirim', manba_tur: 'prixod' };
    if (ombor)     where.ombor = ombor;
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to)   where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const rows = await TovarRegisterModel.findAll({
      where,
      attributes: [
        'tovar_id',
        'tovar_nomi',
        'turkum',
        [fn('SUM', col('summa')),      'summa'],
        [fn('SUM', col('donada')),     'dona'],
        [fn('COUNT', col('manba_id')), 'prixod_son'],
        [fn('AVG',  col('kirim_narx')),'ort_narx'],
      ],
      group: ['tovar_id', 'tovar_nomi', 'turkum'],
      order: [[fn('SUM', col('summa')), 'DESC']],
      limit: Number(limit),
      raw: true,
    });

    res.send(rows.map(r => ({
      tovar_id:   r.tovar_id,
      tovar_nomi: r.tovar_nomi,
      turkum:     r.turkum || 'Boshqa',
      summa:      Number(r.summa     || 0),
      dona:       Number(r.dona      || 0),
      prixod_son: Number(r.prixod_son|| 0),
      ort_narx:   Number(r.ort_narx  || 0),
    })));
  };

  // Ombor bo'yicha taqsimot (kirim, davr ichidagi chiqim, joriy qoldiq)
  omborHisobot = async (req, res) => {
    const { date_from, date_to } = req.query;
    const dateWhere = {};
    if (date_from || date_to) {
      dateWhere.sana = {};
      if (date_from) dateWhere.sana[Op.gte] = new Date(date_from);
      if (date_to)   dateWhere.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const [kirimDavr, chiqimDavr, kirimJami, chiqimJami] = await Promise.all([
      TovarRegisterModel.findAll({
        where: { tur: 'kirim', manba_tur: 'prixod', ...dateWhere },
        attributes: ['ombor', [fn('SUM', col('summa')), 'summa'], [fn('SUM', col('donada')), 'dona'], [fn('COUNT', col('id')), 'son']],
        group: ['ombor'], raw: true,
      }),
      TovarRegisterModel.findAll({
        where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] }, ...dateWhere },
        attributes: ['ombor', [fn('SUM', col('summa')), 'summa'], [fn('SUM', col('donada')), 'dona'], [fn('COUNT', col('id')), 'son']],
        group: ['ombor'], raw: true,
      }),
      // joriy (davr filtrisiz) qoldiq uchun jami kirim/chiqim — qoldiq_summa
      // o'rtacha KIRIM (tannarx) narxida hisoblanadi, chiqimdagi (sotuv narxidagi)
      // summa bilan aralashtirilmaydi — aks holda qoldiq qiymati noto'g'ri chiqadi.
      TovarRegisterModel.findAll({
        where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] } },
        attributes: ['ombor', [fn('SUM', col('donada')), 'dona'], [fn('AVG', col('kirim_narx')), 'kirim_narx']],
        group: ['ombor'], raw: true,
      }),
      TovarRegisterModel.findAll({
        where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] } },
        attributes: ['ombor', [fn('SUM', col('donada')), 'dona']],
        group: ['ombor'], raw: true,
      }),
    ]);

    const mk = rows => { const m = {}; rows.forEach(r => { m[r.ombor || 'Nomaʼlum'] = r; }); return m; };
    const chiqimMap = mk(chiqimDavr);
    const kirimJamiMap = mk(kirimJami);
    const chiqimJamiMap = mk(chiqimJami);

    const omborlar = [...new Set([...kirimDavr, ...chiqimDavr, ...kirimJami].map(r => r.ombor || 'Nomaʼlum'))];
    const totalSumma = kirimDavr.reduce((s, r) => s + Number(r.summa || 0), 0);

    const rows = omborlar.map(ombor => {
      const k  = kirimDavr.find(r => (r.ombor || 'Nomaʼlum') === ombor) || {};
      const c  = chiqimMap[ombor] || {};
      const kj = kirimJamiMap[ombor] || {};
      const cj = chiqimJamiMap[ombor] || {};
      const qoldiqDona  = Number(kj.dona || 0) - Math.abs(Number(cj.dona || 0));
      const qoldiqSumma = qoldiqDona * Number(kj.kirim_narx || 0);
      return {
        ombor,
        summa:       Number(k.summa || 0),
        dona:        Number(k.dona  || 0),
        son:         Number(k.son   || 0),
        chiqim_summa: Math.abs(Number(c.summa || 0)),
        chiqim_dona:  Math.abs(Number(c.dona  || 0)),
        chiqim_son:   Number(c.son || 0),
        qoldiq_dona:  qoldiqDona,
        qoldiq_summa: +qoldiqSumma.toFixed(0),
        foiz: totalSumma ? +((Number(k.summa || 0) / totalSumma * 100).toFixed(1)) : 0,
      };
    }).sort((a, b) => b.summa - a.summa);

    res.send(rows);
  };

  // ══ OMBOR HISOBOTI — KPI qatori (joriy holat + davr faoliyati) ══
  omborKpi = async (req, res) => {
    const { date_from, date_to } = req.query;
    const dateWhere = {};
    if (date_from || date_to) {
      dateWhere.sana = {};
      if (date_from) dateWhere.sana[Op.gte] = new Date(date_from);
      if (date_to)   dateWhere.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const [fifoQoldiq, kirimDavr, chiqimDavr, tovarSoni] = await Promise.all([
      // Asosiy Qoldiqlar hisoboti bilan bir xil FIFO mantig'i — ikkala
      // hisobotdagi "jami qoldiq qiymati" har doim mos kelishi uchun.
      fifoQoldiqlarHisobla(),
      TovarRegisterModel.findOne({ where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] }, ...dateWhere }, attributes: [[fn('SUM', col('summa')), 'summa'], [fn('SUM', col('donada')), 'dona']], raw: true }),
      TovarRegisterModel.findOne({ where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] }, ...dateWhere }, attributes: [[fn('SUM', col('summa')), 'summa'], [fn('SUM', col('donada')), 'dona']], raw: true }),
      TovarRegisterModel.count({ distinct: true, col: 'tovar_id', where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] } } }),
    ]);

    const qoldiqSumma = fifoQoldiq.reduce((s, r) => s + r.qoldiq_summa, 0);
    const qoldiqDona   = fifoQoldiq.reduce((s, r) => s + r.qoldiq_dona, 0);
    const kirimDavrDona  = Number(kirimDavr?.dona  || 0);
    const chiqimDavrDona = Math.abs(Number(chiqimDavr?.dona || 0));
    const aylanishFoiz = kirimDavrDona > 0 ? Math.min(100, +((chiqimDavrDona / kirimDavrDona) * 100).toFixed(1)) : 0;

    // Harakatsiz tovarlar: kirimi bor, lekin tanlangan davrda hech qanday chiqimi yo'q
    const chiqimBorTovarlar = await TovarRegisterModel.findAll({
      where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] }, ...dateWhere },
      attributes: [[fn('DISTINCT', col('tovar_id')), 'tovar_id']],
      raw: true,
    });
    const chiqimBorIds = new Set(chiqimBorTovarlar.map(r => r.tovar_id));
    const barchaTovarIds = await TovarRegisterModel.findAll({
      where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] } },
      attributes: [[fn('DISTINCT', col('tovar_id')), 'tovar_id']],
      raw: true,
    });
    const harakatsizSoni = barchaTovarIds.filter(r => !chiqimBorIds.has(r.tovar_id)).length;

    res.send({
      qoldiq_summa: +qoldiqSumma.toFixed(0),
      qoldiq_dona:  qoldiqDona,
      tovar_turi:   tovarSoni,
      davr_kirim_summa:  Number(kirimDavr?.summa  || 0),
      davr_kirim_dona:   kirimDavrDona,
      davr_chiqim_summa: Math.abs(Number(chiqimDavr?.summa || 0)),
      davr_chiqim_dona:  chiqimDavrDona,
      aylanish_foiz: aylanishFoiz,
      harakatsiz_soni: harakatsizSoni,
    });
  };

  // Kunlik kirim/chiqim trend (davr ichida, ikkalasi ham)
  omborTrend = async (req, res) => {
    const { date_from, date_to } = req.query;
    const from = date_from ? new Date(date_from) : new Date(Date.now() - 29 * 86400000);
    const to   = date_to   ? new Date(date_to + 'T23:59:59') : new Date();

    const [kirimRows, chiqimRows] = await Promise.all([
      TovarRegisterModel.findAll({
        where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] }, sana: { [Op.gte]: from, [Op.lte]: to } },
        attributes: [[fn('DATE', col('sana')), 'kun'], [fn('SUM', col('summa')), 'summa'], [fn('SUM', col('donada')), 'dona']],
        group: [literal('DATE(sana)')], raw: true,
      }),
      TovarRegisterModel.findAll({
        where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] }, sana: { [Op.gte]: from, [Op.lte]: to } },
        attributes: [[fn('DATE', col('sana')), 'kun'], [fn('SUM', col('summa')), 'summa'], [fn('SUM', col('donada')), 'dona']],
        group: [literal('DATE(sana)')], raw: true,
      }),
    ]);

    const kirimMap = {}; kirimRows.forEach(r => { kirimMap[r.kun] = r; });
    const chiqimMap = {}; chiqimRows.forEach(r => { chiqimMap[r.kun] = r; });

    const days = [];
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      days.push(d.toISOString().slice(0, 10));
    }

    res.send(days.map(kun => ({
      kun,
      kirim_summa:  Number(kirimMap[kun]?.summa || 0),
      kirim_dona:   Number(kirimMap[kun]?.dona  || 0),
      chiqim_summa: Math.abs(Number(chiqimMap[kun]?.summa || 0)),
      chiqim_dona:  Math.abs(Number(chiqimMap[kun]?.dona  || 0)),
    })));
  };

  // Eng tez sotiladigan va harakatsiz (sekin sotiladigan) tovarlar
  omborAylanish = async (req, res) => {
    const { date_from, date_to } = req.query;
    const dateWhere = {};
    if (date_from || date_to) {
      dateWhere.sana = {};
      if (date_from) dateWhere.sana[Op.gte] = new Date(date_from);
      if (date_to)   dateWhere.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const tovarlar = await TovarModel.findAll({ where: { faol: true }, attributes: ['id', 'nomi', 'turkum'], raw: true });
    const tovarMap = {}; tovarlar.forEach(t => { tovarMap[t.id] = t; });

    const [chiqimRows, kirimJami, chiqimJami] = await Promise.all([
      TovarRegisterModel.findAll({
        where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] }, ...dateWhere },
        attributes: ['tovar_id', [fn('SUM', col('donada')), 'chiqim_dona'], [fn('SUM', col('summa')), 'chiqim_summa'], [fn('MAX', col('sana')), 'oxirgi_sotuv']],
        group: ['tovar_id'], raw: true,
      }),
      TovarRegisterModel.findAll({ where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] } }, attributes: ['tovar_id', [fn('SUM', col('donada')), 'kirim_dona']], group: ['tovar_id'], raw: true }),
      TovarRegisterModel.findAll({ where: { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] } }, attributes: ['tovar_id', [fn('SUM', col('donada')), 'chiqim_dona']], group: ['tovar_id'], raw: true }),
    ]);

    const kirimMap = {}; kirimJami.forEach(r => { kirimMap[r.tovar_id] = Number(r.kirim_dona || 0); });
    const chiqimJamiMap = {}; chiqimJami.forEach(r => { chiqimJamiMap[r.tovar_id] = Math.abs(Number(r.chiqim_dona || 0)); });

    const tezSotiladigan = chiqimRows
      .map(r => ({
        tovar_id: r.tovar_id,
        tovar_nomi: tovarMap[r.tovar_id]?.nomi || '—',
        turkum: tovarMap[r.tovar_id]?.turkum || 'Boshqa',
        chiqim_dona: Math.abs(Number(r.chiqim_dona || 0)),
        chiqim_summa: Math.abs(Number(r.chiqim_summa || 0)),
        oxirgi_sotuv: r.oxirgi_sotuv,
      }))
      .filter(r => tovarMap[r.tovar_id])
      .sort((a, b) => b.chiqim_dona - a.chiqim_dona)
      .slice(0, 8);

    const harakatsiz = Object.keys(kirimMap)
      .map(Number)
      .filter(id => tovarMap[id] && (kirimMap[id] - (chiqimJamiMap[id] || 0)) > 0)
      .map(id => ({
        tovar_id: id,
        tovar_nomi: tovarMap[id]?.nomi || '—',
        turkum: tovarMap[id]?.turkum || 'Boshqa',
        qoldiq_dona: kirimMap[id] - (chiqimJamiMap[id] || 0),
        chiqim_bormi: chiqimRows.some(r => r.tovar_id === id),
      }))
      .filter(r => !chiqimRows.some(c => c.tovar_id === r.tovar_id))
      .sort((a, b) => b.qoldiq_dona - a.qoldiq_dona)
      .slice(0, 8);

    res.send({ tez_sotiladigan: tezSotiladigan, harakatsiz });
  };

  // So'nggi ombor harakatlari (kirim/chiqim aralash jurnal)
  omborJurnal = async (req, res) => {
    const { limit = 25, ombor } = req.query;
    const where = {};
    if (ombor) where.ombor = ombor;

    const rows = await TovarRegisterModel.findAll({
      where,
      order: [['sana', 'DESC'], ['id', 'DESC']],
      limit: Number(limit),
    });

    const prixodIds = [...new Set(rows.filter(r => r.manba_tur === 'prixod').map(r => r.manba_id))];
    const arizaIds   = [...new Set(rows.filter(r => ['sotuv', 'qaytarma'].includes(r.manba_tur)).map(r => r.manba_id))];
    const [prixodlar, arizalar] = await Promise.all([
      prixodIds.length ? PrixodModel.findAll({ where: { id: { [Op.in]: prixodIds } }, attributes: ['id', 'hujjat_raqam', 'yetkazuvchi'], raw: true }) : [],
      arizaIds.length ? ArizaModel.findAll({ where: { id: { [Op.in]: arizaIds } }, attributes: ['id', 'raqam', 'mijoz_nomi'], raw: true }) : [],
    ]);
    const prixodMap = {}; prixodlar.forEach(p => { prixodMap[p.id] = p; });
    const arizaMap = {}; arizalar.forEach(a => { arizaMap[a.id] = a; });

    res.send(rows.map(r => {
      const isKirim = ['kirim', 'qaytarma_kirim'].includes(r.tur);
      let manba_nomi = '—';
      if (r.manba_tur === 'prixod') {
        const p = prixodMap[r.manba_id];
        manba_nomi = p ? `${p.hujjat_raqam || '#' + p.id} — ${p.yetkazuvchi || ''}`.trim() : `Kirim #${r.manba_id}`;
      } else if (['sotuv', 'qaytarma'].includes(r.manba_tur)) {
        const a = arizaMap[r.manba_id];
        manba_nomi = a ? `${a.raqam} — ${a.mijoz_nomi || 'mijoz'}` : `Ariza #${r.manba_id}`;
      }
      return {
        id: r.id,
        sana: r.sana,
        tur: r.tur,
        yonalish: isKirim ? 'kirim' : 'chiqim',
        tovar_nomi: r.tovar_nomi,
        ombor: r.ombor,
        dona: Math.abs(Number(r.donada || 0)),
        summa: Math.abs(Number(r.summa || 0)),
        manba_nomi,
      };
    }));
  };

  // Kunlik register yozuvlari (jadval uchun)
  // Tovar register — TO'LIQ LEDGER: barcha tur (kirim, chiqim, qaytarma_kirim,
  // qaytarma_chiqim) yagona xronologik jadvalda, har biri o'z manba hujjatiga
  // (prixod yoki ariza) bog'langan holda.
  registerRuyxat = async (req, res) => {
    const { date_from, date_to, ombor, turkum, tur, manba_tur, search, page = 1, limit = 50 } = req.query;
    const where = {};
    if (ombor)     where.ombor     = ombor;
    if (turkum)    where.turkum    = turkum;
    if (tur)       where.tur       = tur;
    if (manba_tur) where.manba_tur = manba_tur;
    if (search)    where.tovar_nomi = { [Op.like]: `%${search}%` };
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to)   where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const offset = (Number(page) - 1) * Number(limit);
    const { count, rows } = await TovarRegisterModel.findAndCountAll({
      where,
      order: [['sana', 'DESC'], ['id', 'DESC']],
      limit:  Number(limit),
      offset,
    });

    // Manba hujjatlarini turiga qarab to'g'ri bog'lash: prixod → PrixodModel,
    // sotuv/qaytarma → ArizaModel (ilgari har doim prixod deb yo'naltirilardi).
    const prixodIds = [...new Set(rows.filter(r => r.manba_tur === 'prixod').map(r => r.manba_id))];
    const arizaIds   = [...new Set(rows.filter(r => ['sotuv', 'qaytarma'].includes(r.manba_tur)).map(r => r.manba_id))];
    const [prixodlar, arizalar] = await Promise.all([
      prixodIds.length ? PrixodModel.findAll({ where: { id: { [Op.in]: prixodIds } }, attributes: ['id', 'hujjat_raqam', 'yetkazuvchi'], raw: true }) : [],
      arizaIds.length ? ArizaModel.findAll({ where: { id: { [Op.in]: arizaIds } }, attributes: ['id', 'raqam', 'mijoz_nomi'], raw: true }) : [],
    ]);
    const prixodMap = {}; prixodlar.forEach(p => { prixodMap[p.id] = p; });
    const arizaMap = {}; arizalar.forEach(a => { arizaMap[a.id] = a; });

    const data = rows.map(r => {
      const row = r.toJSON();
      const isKirim = ['kirim', 'qaytarma_kirim'].includes(row.tur);
      row.yonalish = isKirim ? 'kirim' : 'chiqim';
      row.dona_abs = Math.abs(Number(row.donada || 0));
      row.summa_abs = Math.abs(Number(row.summa || 0));
      if (row.manba_tur === 'prixod') {
        const p = prixodMap[row.manba_id];
        row.hujjat_yoli = p ? `/ombor/prixod/${p.id}` : null;
        row.hujjat_raqam = p ? (p.hujjat_raqam || `Prixod #${p.id}`) : `Prixod #${row.manba_id}`;
        row.hujjat_qoshimcha = p?.yetkazuvchi || null;
      } else if (['sotuv', 'qaytarma'].includes(row.manba_tur)) {
        const a = arizaMap[row.manba_id];
        row.hujjat_yoli = a ? `/sotuvlar/arizalar?doc=${a.id}` : null;
        row.hujjat_raqam = a ? a.raqam : `Ariza #${row.manba_id}`;
        row.hujjat_qoshimcha = a?.mijoz_nomi || null;
      } else {
        row.hujjat_yoli = null;
        row.hujjat_raqam = `#${row.manba_id}`;
        row.hujjat_qoshimcha = null;
      }
      return row;
    });

    res.send({
      data,
      total: count,
      page:  Number(page),
      pages: Math.ceil(count / Number(limit)),
    });
  };

  // Register uchun jami statistika (davr bo'yicha, tur kesimida)
  registerKpi = async (req, res) => {
    const { date_from, date_to, ombor, turkum } = req.query;
    const where = {};
    if (ombor)  where.ombor  = ombor;
    if (turkum) where.turkum = turkum;
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to)   where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const rows = await TovarRegisterModel.findAll({
      where,
      attributes: ['tur', [fn('SUM', col('donada')), 'dona'], [fn('SUM', col('summa')), 'summa'], [fn('COUNT', col('id')), 'son']],
      group: ['tur'], raw: true,
    });

    const map = {};
    rows.forEach(r => { map[r.tur] = { dona: Math.abs(Number(r.dona || 0)), summa: Math.abs(Number(r.summa || 0)), son: Number(r.son || 0) }; });

    const kirim  = map.kirim  || { dona: 0, summa: 0, son: 0 };
    const chiqim = map.chiqim || { dona: 0, summa: 0, son: 0 };
    const qaytarmaKirim  = map.qaytarma_kirim  || { dona: 0, summa: 0, son: 0 };
    const qaytarmaChiqim = map.qaytarma_chiqim || { dona: 0, summa: 0, son: 0 };

    res.send({
      kirim, chiqim, qaytarma_kirim: qaytarmaKirim, qaytarma_chiqim: qaytarmaChiqim,
      jami_yozuv: kirim.son + chiqim.son + qaytarmaKirim.son + qaytarmaChiqim.son,
      jami_kirim_dona:  kirim.dona + qaytarmaKirim.dona,
      jami_chiqim_dona: chiqim.dona + qaytarmaChiqim.dona,
    });
  };

  // Tovar qoldiqlari (SUM kirim - SUM chiqim per tovar per ombor)
  qoldiqlar = async (req, res) => {
    const { ombor, turkum, search } = req.query;

    // Pachka/blok hisobi uchun spravochnik (tovar_register'da yo'q)
    const blokMap = {};
    const olchovMap = {};
    (await TovarModel.findAll({ attributes: ['id', 'blokdagi_soni', 'olchov_birligi'], raw: true }))
      .forEach(t => { blokMap[t.id] = Number(t.blokdagi_soni || 1) || 1; olchovMap[t.id] = t.olchov_birligi || 'kg'; });

    const where = {};
    if (ombor)  where.ombor  = ombor;
    if (turkum) where.turkum = turkum;
    if (search) where.tovar_nomi = { [Op.like]: `%${search}%` };

    const fifoRows = await fifoQoldiqlarHisobla(where);

    const result = fifoRows
      .map(r => {
        const blokdagiSoni = blokMap[r.tovar_id] || 1;
        return {
          tovar_id:    r.tovar_id,
          tovar_nomi:  r.tovar_nomi,
          turkum:      r.turkum     || 'Boshqa',
          ombor:       r.ombor      || 'Asosiy',
          kirim_dona:  r.kirim_dona,
          kirim_blok:  r.kirim_blok,
          kirim_quti:  r.kirim_quti,
          chiqim_dona: r.chiqim_dona,
          qoldiq_dona: r.qoldiq_dona,
          olchov_birligi: olchovMap[r.tovar_id] || 'kg',
          blokdagi_soni:  blokdagiSoni,
          qoldiq_pachka_dona: Math.floor(r.qoldiq_dona / blokdagiSoni),
          qoldiq_ortiqcha_dona: r.qoldiq_dona - Math.floor(r.qoldiq_dona / blokdagiSoni) * blokdagiSoni,
          kirim_narx:  r.kirim_narx,
          kirim_narx_usd: r.kirim_narx_usd,
          sotuv_narx:  r.sotuv_narx,
          sotuv_narx_usd: r.sotuv_narx_usd,
          qoldiq_summa: +r.qoldiq_summa.toFixed(0),
          qoldiq_summa_usd: r.qoldiq_summa_usd,
          kirim_summa: r.kirim_summa,
        };
      })
      .filter(r => r.qoldiq_dona > 0)
      .sort((a, b) => b.qoldiq_summa - a.qoldiq_summa);

    res.send(result);
  };

  // Bitta tovar (+ ixtiyoriy ombor) bo'yicha to'liq harakat tarixi
  // (kirim/chiqim/qaytarma) — Qoldiqlar sahifasidagi tafsilot paneli uchun.
  qoldiqDetail = async (req, res) => {
    const { tovar_id } = req.params;
    const { ombor, limit = 100 } = req.query;

    const where = { tovar_id };
    if (ombor) where.ombor = ombor;

    const rows = await TovarRegisterModel.findAll({
      where,
      order: [['sana', 'DESC'], ['id', 'DESC']],
      limit: Number(limit),
    });

    // Manba hujjatlarini (prixod raqami yoki ariza+mijoz) bog'lash
    const prixodIds = [...new Set(rows.filter(r => r.manba_tur === 'prixod').map(r => r.manba_id))];
    const arizaIds   = [...new Set(rows.filter(r => ['sotuv', 'qaytarma'].includes(r.manba_tur)).map(r => r.manba_id))];

    const prixodlar = prixodIds.length
      ? await PrixodModel.findAll({ where: { id: { [Op.in]: prixodIds } }, attributes: ['id', 'hujjat_raqam', 'yetkazuvchi'], raw: true })
      : [];
    const prixodMap = {}; prixodlar.forEach(p => { prixodMap[p.id] = p; });

    const arizalar = arizaIds.length
      ? await ArizaModel.findAll({ where: { id: { [Op.in]: arizaIds } }, attributes: ['id', 'raqam', 'mijoz_nomi', 'dostavchi_nomi'], raw: true })
      : [];
    const arizaMap = {}; arizalar.forEach(a => { arizaMap[a.id] = a; });

    res.send(rows.map(r => {
      const isKirim = ['kirim', 'qaytarma_kirim'].includes(r.tur);
      let manba_nomi = '—';
      if (r.manba_tur === 'prixod') {
        const p = prixodMap[r.manba_id];
        manba_nomi = p ? `Kirim ${p.hujjat_raqam || '#' + p.id} — ${p.yetkazuvchi || ''}`.trim() : `Kirim #${r.manba_id}`;
      } else if (['sotuv', 'qaytarma'].includes(r.manba_tur)) {
        const a = arizaMap[r.manba_id];
        manba_nomi = a ? `${a.raqam} — ${a.mijoz_nomi || 'mijoz'}` : `Ariza #${r.manba_id}`;
      }
      return {
        id: r.id,
        sana: r.sana,
        tur: r.tur,
        yonalish: isKirim ? 'kirim' : 'chiqim',
        ombor: r.ombor,
        dona: Math.abs(Number(r.donada || 0)),
        summa: Math.abs(Number(r.summa || 0)),
        manba_tur: r.manba_tur,
        manba_nomi,
      };
    }));
  };

  // Partiya (prixod) bo'yicha qoldiqlar
  partiyaQoldiqlar = async (req, res) => {
    const { ombor, turkum, search } = req.query;

    // Har bir prixod_id uchun kirim
    const kirimWhere = { tur: 'kirim', manba_tur: 'prixod' };
    if (ombor)  kirimWhere.ombor  = ombor;
    if (turkum) kirimWhere.turkum = turkum;
    if (search) kirimWhere.tovar_nomi = { [Op.like]: `%${search}%` };

    const kirimRows = await TovarRegisterModel.findAll({
      where: kirimWhere,
      attributes: [
        'tovar_id', 'tovar_nomi', 'turkum', 'ombor', 'manba_id', 'kirim_narx', 'sotuv_narx',
        [fn('SUM', col('donada')),  'kirim_dona'],
        [fn('SUM', col('summa')),   'kirim_summa'],
        [fn('MIN', col('sana')),    'kirim_sana'],
      ],
      group: ['tovar_id', 'tovar_nomi', 'turkum', 'ombor', 'manba_id', 'kirim_narx', 'sotuv_narx'],
      raw: true,
    });

    // Prixod hujjat raqamlari va sanalarini olish
    const prixodIds = [...new Set(kirimRows.map(r => r.manba_id))];
    const prixodlar = prixodIds.length
      ? await PrixodModel.findAll({
          where: { id: { [Op.in]: prixodIds } },
          attributes: ['id', 'sana', 'yetkazuvchi', 'hujjat_raqam'],
          raw: true,
        })
      : [];

    const prixodMap = {};
    prixodlar.forEach(p => { prixodMap[p.id] = p; });

    // Chiqim yozuvlari partiya (prixod)ga bog'lanmagan — faqat tovar+ombor
    // darajasida ma'lum. Aniq lot/FIFO taqqoslash MODUL 5 (WMS/yaroqlilik
    // muddati) bilan birga quriladi. Hozircha jami chiqimni tovar+ombor bo'yicha
    // FIFO tartibida (eng eski partiyadan boshlab) qatorlarga taqsimlaymiz —
    // shu orqali qoldiq soni haqiqiy holatga mos keladi.
    const tovarOmborKalit = r => `${r.tovar_id}_${r.ombor}`;
    const chiqimWhere = { tur: { [Op.in]: ['chiqim', 'qaytarma_chiqim'] } };
    if (ombor)  chiqimWhere.ombor  = ombor;
    if (turkum) chiqimWhere.turkum = turkum;
    if (search) chiqimWhere.tovar_nomi = { [Op.like]: `%${search}%` };
    const chiqimRows = await TovarRegisterModel.findAll({
      where: chiqimWhere,
      attributes: [
        'tovar_id', 'ombor',
        [fn('SUM', col('donada')), 'chiqim_dona'],
      ],
      group: ['tovar_id', 'ombor'],
      raw: true,
    });
    const chiqimQoldiq = {};
    chiqimRows.forEach(r => { chiqimQoldiq[tovarOmborKalit(r)] = Math.abs(Number(r.chiqim_dona || 0)); });

    const partiyalar = kirimRows
      .map(r => {
        const p = prixodMap[r.manba_id] || {};
        return {
          prixod_id:    r.manba_id,
          hujjat_raqam: p.hujjat_raqam || `#${r.manba_id}`,
          yetkazuvchi:  p.yetkazuvchi  || '—',
          prixod_sana:  p.sana         || r.kirim_sana,
          tovar_id:     r.tovar_id,
          tovar_nomi:   r.tovar_nomi,
          turkum:       r.turkum       || 'Boshqa',
          ombor:        r.ombor        || 'Asosiy',
          kirim_dona:   Number(r.kirim_dona  || 0),
          kirim_narx:   Number(r.kirim_narx  || 0),
          sotuv_narx:   Number(r.sotuv_narx  || 0),
          kirim_summa:  Number(r.kirim_summa || 0),
        };
      })
      // FIFO: eng eski kirim avval sarflanadi
      .sort((a, b) => new Date(a.prixod_sana) - new Date(b.prixod_sana));

    const qoldiqHolati = { ...chiqimQoldiq };
    const result = partiyalar.map(r => {
      const key = tovarOmborKalit(r);
      const sarflanadigan = Math.min(r.kirim_dona, qoldiqHolati[key] || 0);
      qoldiqHolati[key] = (qoldiqHolati[key] || 0) - sarflanadigan;
      const qoldiq_dona  = r.kirim_dona - sarflanadigan;
      const qoldiq_summa = qoldiq_dona * r.kirim_narx;
      return { ...r, qoldiq_dona, qoldiq_summa };
    });

    result.sort((a, b) => new Date(b.prixod_sana) - new Date(a.prixod_sana));
    res.send(result);
  };

  // Yetkazuvchilar moliyaviy hisoboti
  yetkazuvchilarHisobot = async (req, res) => {
    const { search } = req.query;
    const where = {};
    if (search) where.ism = { [Op.like]: `%${search}%` };

    const yetkazuvchilar = await YetkazuvchiModel.findAll({
      where,
      order: [['ism', 'ASC']],
    });

    const result = await Promise.all(yetkazuvchilar.map(async (y) => {
      const [qarz, tolov] = await Promise.all([
        YetkazuvchiHarakatlarModel.findOne({
          where: { yetkazuvchi_id: y.id, tur: 'qarz' },
          attributes: [[fn('SUM', col('summa')), 'jami']],
          raw: true,
        }),
        YetkazuvchiHarakatlarModel.findOne({
          where: { yetkazuvchi_id: y.id, tur: 'tolov' },
          attributes: [[fn('SUM', col('summa')), 'jami']],
          raw: true,
        }),
      ]);
      return {
        id:         y.id,
        ism:        y.ism,
        telefon:    y.telefon,
        jami_qarz:  Number(qarz?.jami  || 0),
        jami_tolov: Number(tolov?.jami || 0),
        balans:     Number(y.balans),
      };
    }));

    res.send(result);
  };

  /* ══ MOBIL HISOBOTLAR (web'da ko'rsatish) ══════════════════════════════ */

  // Audit natijalari ro'yxati (mobil chekUp)
  auditRuyxat = async (req, res) => {
    const { agent_id, date_from, date_to } = req.query;
    const where = {};
    if (agent_id) where.agent_id = agent_id;
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to)   where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }
    const rows = await AuditModel.findAll({ where, order: [['sana', 'DESC']], limit: 200 });
    res.send(rows);
  };

  // Sotmaslik sabablari ro'yxati (mobil clientNotSell)
  sotmaslikRuyxat = async (req, res) => {
    const { agent_id, date_from, date_to } = req.query;
    const where = {};
    if (agent_id) where.agent_id = agent_id;
    if (date_from || date_to) {
      where.sana = {};
      if (date_from) where.sana[Op.gte] = new Date(date_from);
      if (date_to)   where.sana[Op.lte] = new Date(date_to + 'T23:59:59');
    }
    const rows = await SotmaslikModel.findAll({ where, order: [['sana', 'DESC']], limit: 300 });
    res.send(rows);
  };

  // Agent savdo hisoboti (agentlar bo'yicha savdo statistikasi)
  agentSavdo = async (req, res) => {
    const { date_from, date_to } = req.query;
    const arizaWhere = 'ar.turi = \'sotish\' AND ar.deletedAt IS NULL'
      + (date_from ? ' AND ar.createdAt >= :date_from' : '')
      + (date_to ? ' AND ar.createdAt <= :date_to_end' : '');
    const rows = await sequelize.query(`
      SELECT a.id, a.fullname, a.plan_summa,
        COALESCE(COUNT(ar.id), 0) AS savdo_soni,
        COALESCE(SUM(ar.jami_summa), 0) AS savdo_summa,
        COALESCE(SUM(CASE WHEN ar.holat='yetkazildi' THEN 1 ELSE 0 END), 0) AS yetkazilgan
      FROM agent a
      LEFT JOIN ariza ar ON ar.agent_id = a.id AND ${arizaWhere}
      WHERE a.deletedAt IS NULL AND a.faol = 1
      GROUP BY a.id, a.fullname, a.plan_summa
      ORDER BY savdo_summa DESC
    `, {
      replacements: { date_from, date_to_end: date_to ? `${date_to} 23:59:59` : null },
      type: sequelize.QueryTypes.SELECT,
    });
    res.send(rows.map(r => {
      const summa = Number(r.savdo_summa || 0);
      const plan  = Number(r.plan_summa || 0);
      return {
        id: r.id, fullname: r.fullname,
        savdo_soni: Number(r.savdo_soni || 0),
        savdo_summa: summa,
        yetkazilgan: Number(r.yetkazilgan || 0),
        plan,
        foiz: plan > 0 ? Math.min(100, +((summa / plan) * 100).toFixed(1)) : 0,
      };
    }));
  };

  // Agent GPS marshruti + o'sha kungi tashriflar (savdo/sotmaslik, mijoz koordinatalari)
  /* ═══════════════════════════════════════════════════════════════
   * GET /hisobot/agent-online
   *
   * Agentlar hozir qayerda — real vaqt xaritasi uchun.
   * Har agent bo'yicha: oxirgi GPS nuqtasi, signal yoshi, bugungi
   * trek, tashrif holati va batareya.
   *
   * Online holati signal yoshi bo'yicha aniqlanadi:
   *   online  — 5 daqiqagacha
   *   kutish  — 30 daqiqagacha
   *   oflayn  — undan uzoq
   * ═══════════════════════════════════════════════════════════════ */
  static ONLINE_CHEGARA = { ONLINE_DAQ: 5, KUTISH_DAQ: 30 };

  agentOnline = async (req, res) => {
    const C = HisobotController.ONLINE_CHEGARA;
    const sana = /^\d{4}-\d{2}-\d{2}$/.test(req.query.sana || '')
      ? req.query.sana
      : new Date().toISOString().slice(0, 10);
    // Trek kerakmi (xaritada yo'lni chizish uchun)
    const trekBilan = req.query.trek !== 'false';

    const agentlar = await AgentModel.findAll({
      where: { faol: true },
      attributes: ['id', 'fullname', 'telefon'],
      order: [['fullname', 'ASC']],
      raw: true,
    });
    if (!agentlar.length) {
      return res.send({ sana, hozir: new Date(), agentlar: [], jami: {} });
    }
    const ids = agentlar.map(a => a.id);

    // Har agentning ENG OXIRGI nuqtasi (sanadan qat'i nazar) —
    // kecha ishlagan bo'lsa ham "oxirgi ko'ringan joyi" ma'lum bo'lsin
    const oxirgilar = await sequelize.query(`
      SELECT l.agent_id, l.lat, l.lng, l.battery, l.sana
      FROM agent_location l
      JOIN (
        SELECT agent_id, MAX(sana) mx
        FROM agent_location
        WHERE rol = 'agent' AND agent_id IN (:ids)
        GROUP BY agent_id
      ) t ON t.agent_id = l.agent_id AND t.mx = l.sana
      WHERE l.rol = 'agent'`,
      { replacements: { ids }, type: sequelize.QueryTypes.SELECT });

    const oxirgiMap = {};
    oxirgilar.forEach(o => { oxirgiMap[o.agent_id] = o; });

    // Tanlangan kunning treki
    let trekMap = {};
    if (trekBilan) {
      const trek = await AgentLocationModel.findAll({
        where: {
          rol: 'agent',
          agent_id: { [Op.in]: ids },
          sana: { [Op.between]: [sana + ' 00:00:00', sana + ' 23:59:59'] },
        },
        attributes: ['agent_id', 'lat', 'lng', 'sana'],
        order: [['agent_id', 'ASC'], ['sana', 'ASC']],
        raw: true, limit: 5000,
      });
      trek.forEach(t => {
        if (t.lat == null || t.lng == null) return;
        (trekMap[t.agent_id] = trekMap[t.agent_id] || []).push({
          lat: Number(t.lat), lng: Number(t.lng), vaqt: t.sana,
        });
      });
    }

    // Bugungi tashrif holati — agent qaerda bo'lganini tushuntiradi
    const tashriflar = await TashrifModel.findAll({
      where: { sana, agent_id: { [Op.in]: ids } },
      attributes: ['agent_id', 'mijoz_id', 'mijoz_nomi', 'checkin_vaqt', 'checkout_vaqt', 'natija'],
      order: [['checkin_vaqt', 'ASC']],
      raw: true, limit: 2000,
    });
    const tashrifMap = {};
    tashriflar.forEach(t => { (tashrifMap[t.agent_id] = tashrifMap[t.agent_id] || []).push(t); });

    const rejalar = await MarshrutRejaModel.findAll({
      where: { sana, agent_id: { [Op.in]: ids } },
      attributes: ['agent_id'], raw: true,
    });
    const rejaSoni = {};
    rejalar.forEach(r => { rejaSoni[r.agent_id] = (rejaSoni[r.agent_id] || 0) + 1; });

    const hozir = Date.now();
    const natija = agentlar.map(a => {
      const o = oxirgiMap[a.id];
      const yoshDaq = o ? Math.floor((hozir - new Date(o.sana).getTime()) / 60000) : null;

      const holat = yoshDaq === null ? 'malumot_yoq'
        : yoshDaq <= C.ONLINE_DAQ  ? 'online'
        : yoshDaq <= C.KUTISH_DAQ  ? 'kutish' : 'oflayn';

      const kunTashrif = tashrifMap[a.id] || [];
      // Ochiq tashrif = check-in bor, check-out yo'q → agent hozir mijozda
      const ochiq = kunTashrif.find(t => t.checkin_vaqt && !t.checkout_vaqt);

      return {
        id: a.id,
        fullname: a.fullname,
        telefon: a.telefon,
        holat,
        oxirgi: o ? {
          lat: Number(o.lat), lng: Number(o.lng),
          vaqt: o.sana, battery: o.battery,
          yosh_daq: yoshDaq,
        } : null,
        trek: trekMap[a.id] || [],
        bugun: {
          reja: rejaSoni[a.id] || 0,
          tashrif: kunTashrif.length,
          savdo: kunTashrif.filter(t => t.natija === 'savdo').length,
          hozir_mijozda: ochiq ? ochiq.mijoz_nomi : null,
        },
      };
    });

    // Xaritani markazlash uchun — koordinatasi borlarning o'rtachasi
    const koordBor = natija.filter(a => a.oxirgi);
    const markaz = koordBor.length ? {
      lat: +(koordBor.reduce((s, a) => s + a.oxirgi.lat, 0) / koordBor.length).toFixed(6),
      lng: +(koordBor.reduce((s, a) => s + a.oxirgi.lng, 0) / koordBor.length).toFixed(6),
    } : null;

    res.send({
      sana,
      hozir: new Date(),
      markaz,
      chegara: C,
      agentlar: natija,
      jami: {
        online:  natija.filter(a => a.holat === 'online').length,
        kutish:  natija.filter(a => a.holat === 'kutish').length,
        oflayn:  natija.filter(a => a.holat === 'oflayn').length,
        malumot_yoq: natija.filter(a => a.holat === 'malumot_yoq').length,
        jami: natija.length,
        yolda: natija.filter(a => a.bugun.hozir_mijozda).length,
      },
    });
  };

  agentMarshrut = async (req, res) => {
    const { agent_id } = req.query;
    if (!agent_id) throw new HttpException(400, 'agent_id majburiy');
    // date faqat to'g'ri YYYY-MM-DD formatda bo'lsa qabul qilinadi
    const date = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '') ? req.query.date : null;

    const where = { agent_id, rol: 'agent' };
    if (date) {
      where.sana = { [Op.gte]: new Date(date + 'T00:00:00'), [Op.lte]: new Date(date + 'T23:59:59') };
    }
    const nuqtalar = await AgentLocationModel.findAll({
      where, order: [['sana', 'ASC']], limit: 2000,
      attributes: ['id', 'lat', 'lng', 'battery', 'sana'],
    });

    // Tashriflar: savdo (ariza) — yashil, sotmaslik — qizil (xarita markerlari uchun)
    const dateFilterAriza = date ? 'AND DATE(ar.createdAt) = :date' : '';
    const savdolar = await sequelize.query(`
      SELECT ar.id, ar.raqam, ar.jami_summa, ar.createdAt AS sana,
             m.id AS mijoz_id, m.nomi, m.lat, m.lng
      FROM ariza ar JOIN mijoz m ON m.id = ar.mijoz_id
      WHERE ar.agent_id = :agent_id AND ar.turi = 'sotish' AND ar.deletedAt IS NULL
        ${dateFilterAriza}
        AND m.lat IS NOT NULL AND m.lng IS NOT NULL
      ORDER BY ar.createdAt ASC LIMIT 200
    `, { replacements: { agent_id, date }, type: sequelize.QueryTypes.SELECT });

    const dateFilterSot = date ? 'AND DATE(s.sana) = :date' : '';
    const sotmasliklar = await sequelize.query(`
      SELECT s.id, s.sabab_id, s.sabab_nomi, s.sana,
             m.id AS mijoz_id, m.nomi, m.lat, m.lng
      FROM sotmaslik s JOIN mijoz m ON m.id = s.mijoz_id
      WHERE s.agent_id = :agent_id ${dateFilterSot}
        AND m.lat IS NOT NULL AND m.lng IS NOT NULL
      ORDER BY s.sana ASC LIMIT 200
    `, { replacements: { agent_id, date }, type: sequelize.QueryTypes.SELECT });

    const tashriflar = [
      ...savdolar.map(r => ({
        tur: 'savdo', mijoz_id: r.mijoz_id, nomi: r.nomi,
        lat: Number(r.lat), lng: Number(r.lng),
        info: `${r.raqam || ''} · ${Number(r.jami_summa || 0).toLocaleString('uz-UZ')} so'm`,
        sana: r.sana,
      })),
      ...sotmasliklar.map(r => ({
        tur: 'sotmaslik', mijoz_id: r.mijoz_id, nomi: r.nomi,
        lat: Number(r.lat), lng: Number(r.lng),
        info: r.sabab_nomi || (r.sabab_id ? `Sabab #${r.sabab_id}` : 'Sotilmadi'),
        sana: r.sana,
      })),
    ];

    res.send({ nuqtalar, tashriflar });
  };

  // Agentlar ro'yxati (hisobot filtrlari uchun)
  agentlarRuyxat = async (req, res) => {
    const rows = await AgentModel.findAll({
      where: { faol: true },
      attributes: ['id', 'fullname'],
      order: [['fullname', 'ASC']],
    });
    res.send(rows);
  };

  /* ══ INKASSATSIYA: agent naqd yig'gani vs kassaga topshirgani ══════════ */

  // Bugungi (yoki berilgan kun) barcha agentlar bo'yicha yig'ilgan/topshirilgan solishtiruvi
  inkassatsiyaRuyxat = async (req, res) => {
    const sana = /^\d{4}-\d{2}-\d{2}$/.test(req.query.sana || '') ? req.query.sana : new Date().toISOString().slice(0, 10);

    // Shu kun har agent naqd yig'gani (mobil savePayment orqali, user_id = agent)
    const yigilgan = await sequelize.query(`
      SELECT k.user_id AS agent_id, a.fullname,
        COALESCE(SUM(k.summa), 0) AS yigilgan_summa
      FROM kassa k JOIN agent a ON a.id = k.user_id
      WHERE k.tur = 'kirim' AND k.tolov_usul = 'naqt' AND k.manba_tur IN ('mijoz','avtolavka')
        AND DATE(k.sana) = :sana AND k.user_id IS NOT NULL
      GROUP BY k.user_id, a.fullname
    `, { replacements: { sana }, type: sequelize.QueryTypes.SELECT });

    // Dostavchiklar — yetkazishda olgan naqd va undirgan qarz (user_id = dostavchi).
    // Topshirgani ham shu jadvalda (dostavchi_id) — kassaga chiqim yozilmaydi.
    const dYigilgan = await sequelize.query(`
      SELECT k.user_id AS dostavchi_id, d.ism AS nomi, COALESCE(SUM(k.summa), 0) AS yigilgan_summa
      FROM kassa k JOIN dostavchi d ON d.id = k.user_id
      WHERE k.tur = 'kirim' AND k.tolov_usul = 'naqt' AND k.manba_tur IN ('dostavchik','mijoz_dostavchik')
        AND DATE(k.sana) = :sana AND k.user_id IS NOT NULL
      GROUP BY k.user_id, d.ism
    `, { replacements: { sana }, type: sequelize.QueryTypes.SELECT });

    // Shu kun uchun mavjud inkassatsiya yozuvlari (topshirilgan): agent yoki dostavchik
    const mavjud = await InkassatsiyaModel.findAll({ where: { sana } });
    const mavjudA = {}, mavjudD = {};
    mavjud.forEach(m => { if (m.dostavchi_id) mavjudD[m.dostavchi_id] = m; else if (m.agent_id) mavjudA[m.agent_id] = m; });

    const qator = (tur, id, y, m, nomi) => {
      const yigSumma = Number(y?.yigilgan_summa || 0);
      const topSumma = Number(m?.topshirilgan_summa || 0);
      return {
        id: m?.id || null,
        tur, xodim_id: id,
        agent_id: tur === 'agent' ? id : null,
        dostavchi_id: tur === 'dostavchi' ? id : null,
        agent_nomi: nomi,
        sana,
        yigilgan_summa: yigSumma,
        topshirilgan_summa: topSumma,
        farq: yigSumma - topSumma,
        holat: m?.holat || (yigSumma > 0 ? 'ochiq' : 'yopiq'),
      };
    };
    // Naqd yig'gan HAR xodim (topshirmagan bo'lsa ham) ko'rinsin
    const agentIds = new Set([...yigilgan.map(y => y.agent_id), ...Object.keys(mavjudA).map(Number)]);
    const dostIds  = new Set([...dYigilgan.map(y => y.dostavchi_id), ...Object.keys(mavjudD).map(Number)]);
    const natija = [
      ...[...agentIds].map(id => { const y = yigilgan.find(r => r.agent_id === id); return qator('agent', id, y, mavjudA[id], y?.fullname || mavjudA[id]?.agent_nomi || '—'); }),
      ...[...dostIds].map(id => { const y = dYigilgan.find(r => r.dostavchi_id === id); return qator('dostavchi', id, y, mavjudD[id], y?.nomi || mavjudD[id]?.agent_nomi || '—'); }),
    ];
    res.send(natija);
  };

  // Agent (yoki dostavchik — dostavchi_id) kassaga naqd topshirdi — qayd qilish (yopish).
  // Summa kunning JAMI topshirilgani.
  inkassatsiyaTopshir = async (req, res) => {
    const { agent_id, dostavchi_id, sana, topshirilgan_summa, izoh } = req.body;
    if ((!agent_id && !dostavchi_id) || !sana) throw new HttpException(400, 'agent_id yoki dostavchi_id va sana majburiy');

    if (dostavchi_id) {
      const d = await DostavchiModel.findByPk(dostavchi_id);
      if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
      const summa = Number(topshirilgan_summa || 0);
      if (!(summa >= 0)) throw new HttpException(400, "Summa noto'g'ri");
      const { row } = await dostavchiTopshir(d, sana, { summa, jami: true, izoh: izoh || null, userId: req.currentUser?.id || null });
      return res.send(row);
    }

    const agent = await AgentModel.findByPk(agent_id);
    const [yigRow] = await sequelize.query(`
      SELECT COALESCE(SUM(summa), 0) AS yigilgan_summa
      FROM kassa WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND manba_tur IN ('mijoz','avtolavka')
        AND DATE(sana) = :sana AND user_id = :agent_id
    `, { replacements: { sana, agent_id }, type: sequelize.QueryTypes.SELECT });

    const yigSumma = Number(yigRow?.yigilgan_summa || 0);
    const topSumma = Number(topshirilgan_summa || 0);
    const farq = yigSumma - topSumma;
    const holat = farq > 0 ? 'kamomad' : 'yopiq';

    const [row] = await InkassatsiyaModel.findOrCreate({
      where: { agent_id, sana },
      defaults: { agent_nomi: agent?.fullname || null },
    });
    await row.update({
      agent_nomi: agent?.fullname || row.agent_nomi,
      yigilgan_summa: yigSumma,
      topshirilgan_summa: topSumma,
      farq, holat, izoh: izoh || row.izoh,
      tasdiqlagan_id: req.currentUser?.id || null,
      tasdiqlagan_sana: new Date(),
    });
    res.send(row);
  };

  // Kamomadni keyinroq qabul qilish: xodim o'sha kuni topshirmagan naqdni olib keldi.
  // Summa kunning topshirilganiga QO'SHILADI (POST /inkassatsiya esa jamini yozadi) va kamomaddan
  // oshmasligi shart — 5 900 000 o'rniga 59 000 000 yozilishining oldini oladi.
  // Kassaga yangi kirim yozilmaydi: naqd mijozdan olinganda kassa kirimi bo'lib yozilgan,
  // inkassatsiya faqat xodim uni kassirga topshirganini solishtiradi.
  inkassatsiyaKamomad = async (req, res) => {
    const { agent_id, dostavchi_id, sana, summa, izoh } = req.body;
    if ((!agent_id && !dostavchi_id) || !/^\d{4}-\d{2}-\d{2}$/.test(sana || '')) {
      throw new HttpException(400, 'agent_id yoki dostavchi_id va sana majburiy');
    }
    const s = Math.round(Number(summa) * 100) / 100;
    if (!(s > 0)) throw new HttpException(400, "Qabul qilingan summa 0 dan katta bo'lishi kerak");

    const fmt = (v) => Math.round(Number(v) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const p2 = (v) => String(v).padStart(2, '0');
    const d = new Date();
    const kim = req.currentUser?.fullname || req.currentUser?.username || 'foydalanuvchi';
    const satr = `Kamomad qabul qilindi: ${fmt(s)} so'm (${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}, ${kim})`
      + (izoh && String(izoh).trim() ? ` — ${String(izoh).trim().slice(0, 200)}` : '');
    const qosh = (eski) => [eski, satr].filter(Boolean).join('\n');
    const oshdi = (kamomad) => new HttpException(400,
      kamomad > 0.5 ? `Kamomad ${fmt(kamomad)} so'm — undan ko'p qabul qilib bo'lmaydi` : "Bu kunda kamomad yo'q");

    if (dostavchi_id) {
      const dost = await DostavchiModel.findByPk(dostavchi_id);
      if (!dost) throw new HttpException(404, 'Dostavchi topilmadi');
      const [yig, top] = await Promise.all([dostavchiYigildi(dost.id, sana), dostavchiTopshirildi(dost.id, sana)]);
      const kamomad = +(yig.summa - top.summa).toFixed(2);
      if (s > kamomad + 0.5) throw oshdi(kamomad);
      const { row } = await dostavchiTopshir(dost, sana, { summa: s, jami: false, izoh: qosh(top.row?.izoh), userId: req.currentUser?.id || null });
      return res.send(row);
    }

    const agent = await AgentModel.findByPk(agent_id);
    if (!agent) throw new HttpException(404, 'Agent topilmadi');
    const row = await sequelize.transaction(async (transaction) => {
      const [yigRow] = await sequelize.query(`
        SELECT COALESCE(SUM(summa), 0) AS yigilgan_summa
        FROM kassa WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND manba_tur IN ('mijoz','avtolavka')
          AND DATE(sana) = :sana AND user_id = :agent_id
      `, { replacements: { sana, agent_id: agent.id }, type: sequelize.QueryTypes.SELECT, transaction });
      const yig = Number(yigRow?.yigilgan_summa || 0);
      const [r] = await InkassatsiyaModel.findOrCreate({
        where: { agent_id: agent.id, sana },
        defaults: { agent_nomi: agent.fullname },
        transaction, lock: transaction.LOCK.UPDATE,
      });
      const top = Number(r.topshirilgan_summa || 0);
      const kamomad = +(yig - top).toFixed(2);
      if (s > kamomad + 0.5) throw oshdi(kamomad);
      const yangiTop = +(top + s).toFixed(2);
      const farq = +(yig - yangiTop).toFixed(2);
      await r.update({
        agent_nomi: agent.fullname,
        yigilgan_summa: yig, topshirilgan_summa: yangiTop, farq,
        holat: farq > 0.5 ? 'kamomad' : 'yopiq',
        izoh: qosh(r.izoh),
        tasdiqlagan_id: req.currentUser?.id || null, tasdiqlagan_sana: new Date(),
      }, { transaction });
      return r;
    });
    res.send(row);
  };

  // Davr bo'yicha inkassatsiya hisoboti — har kun/agent bo'yicha yig'ilgan/topshirilgan/farq,
  // shu bilan birga agent bo'yicha va umumiy jami statistika.
  inkassatsiyaHisobot = async (req, res) => {
    const today = new Date().toISOString().slice(0, 10);
    const dateFrom = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_from || '')
      ? req.query.date_from
      : (() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10); })();
    const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date_to || '') ? req.query.date_to : today;
    const agentId = req.query.agent_id || null;

    // Har kun har agent naqd yig'gani (mobil orqali, manba_tur='mijoz')
    const agentFilter = agentId ? 'AND k.user_id = :agentId' : '';
    const yigilganRows = await sequelize.query(`
      SELECT DATE(k.sana) AS sana, k.user_id AS agent_id, a.fullname AS agent_nomi,
        COALESCE(SUM(k.summa), 0) AS yigilgan_summa
      FROM kassa k JOIN agent a ON a.id = k.user_id
      WHERE k.tur = 'kirim' AND k.tolov_usul = 'naqt' AND k.manba_tur IN ('mijoz','avtolavka')
        AND DATE(k.sana) BETWEEN :dateFrom AND :dateTo AND k.user_id IS NOT NULL
        ${agentFilter}
      GROUP BY DATE(k.sana), k.user_id, a.fullname
      ORDER BY sana DESC
    `, { replacements: { dateFrom, dateTo, agentId }, type: sequelize.QueryTypes.SELECT });

    // Dostavchiklar (faqat agent filtri bo'lmaganda) — yetkazish + qarz undirish naqdi
    const dYigRows = agentId ? [] : await sequelize.query(`
      SELECT DATE(k.sana) AS sana, k.user_id AS dostavchi_id, d.ism AS agent_nomi,
        COALESCE(SUM(k.summa), 0) AS yigilgan_summa
      FROM kassa k JOIN dostavchi d ON d.id = k.user_id
      WHERE k.tur = 'kirim' AND k.tolov_usul = 'naqt' AND k.manba_tur IN ('dostavchik','mijoz_dostavchik')
        AND DATE(k.sana) BETWEEN :dateFrom AND :dateTo AND k.user_id IS NOT NULL
      GROUP BY DATE(k.sana), k.user_id, d.ism
    `, { replacements: { dateFrom, dateTo }, type: sequelize.QueryTypes.SELECT });

    // Shu davrdagi mavjud inkassatsiya (topshirilgan) yozuvlari — agent yoki dostavchik
    const inkasWhere = { sana: { [Op.between]: [dateFrom, dateTo] } };
    if (agentId) inkasWhere.agent_id = agentId;
    const mavjudRows = (await InkassatsiyaModel.findAll({ where: inkasWhere, raw: true }))
      .map(m => ({ ...m, tur: m.dostavchi_id ? 'dostavchi' : 'agent', xodim_id: m.dostavchi_id || m.agent_id }));
    const mavjudMap = {};
    mavjudRows.forEach(m => { mavjudMap[`${m.sana}_${m.tur}_${m.xodim_id}`] = m; });

    // Kun+xodim bo'yicha birlashtirish
    const keySet = new Set([
      ...yigilganRows.map(r => `${r.sana}_agent_${r.agent_id}`),
      ...dYigRows.map(r => `${r.sana}_dostavchi_${r.dostavchi_id}`),
      ...mavjudRows.map(m => `${m.sana}_${m.tur}_${m.xodim_id}`),
    ]);
    const kunlar = [...keySet].map(key => {
      const [sana, tur, idStr] = key.split('_');
      const xId = Number(idStr);
      const y = tur === 'agent'
        ? yigilganRows.find(r => r.sana === sana && r.agent_id === xId)
        : dYigRows.find(r => r.sana === sana && r.dostavchi_id === xId);
      const m = mavjudMap[key];
      const yigSumma = Number(y?.yigilgan_summa || 0);
      const topSumma = Number(m?.topshirilgan_summa || 0);
      return {
        sana, tur, xodim_id: xId,
        agent_id: tur === 'agent' ? xId : null,
        dostavchi_id: tur === 'dostavchi' ? xId : null,
        agent_nomi: y?.agent_nomi || m?.agent_nomi || '—',
        yigilgan_summa: yigSumma,
        topshirilgan_summa: topSumma,
        farq: yigSumma - topSumma,
        holat: m?.holat || (yigSumma > 0 ? 'ochiq' : 'yopiq'),
      };
    }).sort((a, b) => (a.sana < b.sana ? 1 : a.sana > b.sana ? -1 : 0));

    // Xodim bo'yicha jamlanma
    const agentMap = {};
    kunlar.forEach(k => {
      const kk = `${k.tur}_${k.xodim_id}`;
      if (!agentMap[kk]) {
        agentMap[kk] = { tur: k.tur, xodim_id: k.xodim_id, agent_id: k.agent_id, dostavchi_id: k.dostavchi_id, agent_nomi: k.agent_nomi, yigilgan_summa: 0, topshirilgan_summa: 0, farq: 0, kun_soni: 0 };
      }
      const a = agentMap[kk];
      a.yigilgan_summa += k.yigilgan_summa;
      a.topshirilgan_summa += k.topshirilgan_summa;
      a.farq += k.farq;
      a.kun_soni += 1;
    });
    const agentlar_jami = Object.values(agentMap).sort((a, b) => b.yigilgan_summa - a.yigilgan_summa);

    const jami = {
      yigilgan_summa: kunlar.reduce((s, k) => s + k.yigilgan_summa, 0),
      topshirilgan_summa: kunlar.reduce((s, k) => s + k.topshirilgan_summa, 0),
      farq: kunlar.reduce((s, k) => s + Math.max(0, k.farq), 0),
    };

    res.send({ date_from: dateFrom, date_to: dateTo, kunlar, agentlar: agentlar_jami, jami });
  };

  /* ══ MARSHRUT REJA (Plan) + PLAN-FACT TAHLILI ══════════════════════════ */

  // Berilgan agent+sana uchun reja ro'yxati (mijoz ma'lumotlari bilan)
  marshrutRejaRuyxat = async (req, res) => {
    const { agent_id, sana } = req.query;
    if (!agent_id) throw new HttpException(400, 'agent_id majburiy');
    const kun = /^\d{4}-\d{2}-\d{2}$/.test(sana || '') ? sana : new Date().toISOString().slice(0, 10);

    const rejalar = await MarshrutRejaModel.findAll({
      where: { agent_id, sana: kun },
      order: [['tartib', 'ASC'], ['id', 'ASC']],
    });
    const mijozIds = rejalar.map(r => r.mijoz_id);
    const mijozlar = mijozIds.length
      ? await MijozModel.findAll({ where: { id: mijozIds }, attributes: ['id', 'nomi', 'manzil', 'telefon'] })
      : [];
    const mijozMap = {};
    mijozlar.forEach(m => { mijozMap[m.id] = m; });

    const tashriflar = await TashrifModel.findAll({ where: { agent_id, sana: kun } });
    const tashrifMap = {};
    tashriflar.forEach(t => { tashrifMap[t.mijoz_id] = t; });

    res.send(rejalar.map(r => {
      const m = mijozMap[r.mijoz_id] || {};
      const t = tashrifMap[r.mijoz_id];
      return {
        id: r.id, mijoz_id: r.mijoz_id, mijoz_nomi: m.nomi, manzil: m.manzil, telefon: m.telefon,
        sana: r.sana, tartib: r.tartib, izoh: r.izoh,
        bajarildi: !!(t && t.checkout_vaqt),
        checkin_vaqt: t?.checkin_vaqt || null,
        checkout_vaqt: t?.checkout_vaqt || null,
        natija: t?.natija || null,
      };
    }));
  };

  // Bir kunlik rejani belgilash: berilgan mijoz_id ro'yxatini shu sana uchun yozadi
  // (mavjudlarni saqlab, yangilarini qo'shadi — to'liq almashtirmaydi)
  marshrutRejaBelgila = async (req, res) => {
    const { agent_id, sana, mijoz_idlar } = req.body;
    if (!agent_id || !sana || !Array.isArray(mijoz_idlar)) {
      throw new HttpException(400, 'agent_id, sana, mijoz_idlar majburiy');
    }
    const t = await sequelize.transaction();
    try {
      for (let i = 0; i < mijoz_idlar.length; i++) {
        await MarshrutRejaModel.findOrCreate({
          where: { agent_id, mijoz_id: mijoz_idlar[i], sana },
          defaults: { tartib: i + 1 },
          transaction: t,
        });
      }
      await t.commit();
      const rows = await MarshrutRejaModel.findAll({ where: { agent_id, sana } });
      res.send(rows);
    } catch (e) {
      throw e;
    }
  };

  // Bitta reja yozuvini o'chirish
  marshrutRejaOchir = async (req, res) => {
    const row = await MarshrutRejaModel.findByPk(req.params.id);
    if (!row) throw new HttpException(404, 'Topilmadi');
    await row.destroy();
    res.send({ success: true });
  };

  // Haftalik rejani mijoz.tashrif_kunlari asosida avtomatik generatsiya qilish
  // (berilgan hafta oralig'i uchun — har mijozning odatiy tashrif kunlariga mos sanalarga reja qo'shadi)
  marshrutRejaGenerate = async (req, res) => {
    const { agent_id, from, to } = req.body;
    if (!agent_id || !from || !to) throw new HttpException(400, 'agent_id, from, to majburiy');

    const WEEK_KEYS = { 1: 'Du', 2: 'Se', 3: 'Ch', 4: 'Pa', 5: 'Ju', 6: 'Sh', 7: 'Ya' };
    const mijozlar = await MijozModel.findAll({ where: { agent_id, faol: true } });

    const yaratildi = [];
    const start = new Date(from);
    const end = new Date(to);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const kunRaqam = d.getDay() === 0 ? 7 : d.getDay();   // 1=Du..7=Ya
      const kalit = WEEK_KEYS[kunRaqam];
      const sanaStr = d.toISOString().slice(0, 10);
      for (const m of mijozlar) {
        if (m.tashrif_kunlari && m.tashrif_kunlari.includes(kalit)) {
          const [row, created] = await MarshrutRejaModel.findOrCreate({
            where: { agent_id, mijoz_id: m.id, sana: sanaStr },
            defaults: { tartib: 1 },
          });
          if (created) yaratildi.push(row);
        }
      }
    }
    res.send({ yaratildi: yaratildi.length });
  };

  // Plan-Fact tahlili: berilgan davr uchun agentlar bo'yicha reja/bajarilgan solishtiruvi
  planFactHisobot = async (req, res) => {
    const { agent_id, date_from, date_to } = req.query;
    const from = date_from || new Date().toISOString().slice(0, 10);
    const to = date_to || from;

    const rejaWhere = { sana: { [Op.between]: [from, to] } };
    if (agent_id) rejaWhere.agent_id = agent_id;

    const rejalar = await MarshrutRejaModel.findAll({ where: rejaWhere, attributes: ['agent_id', 'sana'], raw: true });
    const tashrifWhere = { sana: { [Op.between]: [from, to] } };
    if (agent_id) tashrifWhere.agent_id = agent_id;
    const tashriflar = await TashrifModel.findAll({ where: tashrifWhere, raw: true });

    // agent_id bo'yicha guruhlash
    const byAgent = {};
    rejalar.forEach(r => {
      byAgent[r.agent_id] = byAgent[r.agent_id] || { reja: 0, bajarildi: 0, savdo: 0, sotmaslik: 0 };
      byAgent[r.agent_id].reja++;
    });
    tashriflar.forEach(t => {
      byAgent[t.agent_id] = byAgent[t.agent_id] || { reja: 0, bajarildi: 0, savdo: 0, sotmaslik: 0 };
      if (t.checkout_vaqt) byAgent[t.agent_id].bajarildi++;
      if (t.natija === 'savdo') byAgent[t.agent_id].savdo++;
      if (t.natija === 'sotmaslik') byAgent[t.agent_id].sotmaslik++;
    });

    const agentIds = Object.keys(byAgent).map(Number);
    const agentlar = agentIds.length
      ? await AgentModel.findAll({ where: { id: agentIds }, attributes: ['id', 'fullname'] })
      : [];
    const agentMap = {};
    agentlar.forEach(a => { agentMap[a.id] = a.fullname; });

    res.send(agentIds.map(id => {
      const s = byAgent[id];
      return {
        agent_id: id,
        agent_nomi: agentMap[id] || '—',
        reja_soni: s.reja,
        bajarildi_soni: s.bajarildi,
        bajarilish_foizi: s.reja > 0 ? +((s.bajarildi / s.reja) * 100).toFixed(1) : 0,
        savdo_soni: s.savdo,
        sotmaslik_soni: s.sotmaslik,
      };
    }));
  };

  // ══ SOTUVLAR HISOBOTI: to'liq dashboard — KPI (tushum/tannarx/sof foyda),
  // funnel, agent samaradorligi, kunlik trend, holat taqsimoti, top mijozlar ══
  // Foyda taxminiy — o'rtacha kirim narxiga asoslanadi (aniq FIFO/lot-based
  // foyda MODUL 5 — WMS/yaroqlilik muddati bilan birga quriladi).
  sotuvHisobot = async (req, res) => {
    const { date_from, date_to, agent_id } = req.query;

    const arizaWhere = { turi: 'sotish', deletedAt: null };
    if (agent_id) arizaWhere.agent_id = agent_id;
    if (date_from || date_to) {
      arizaWhere.createdAt = {};
      if (date_from) arizaWhere.createdAt[Op.gte] = new Date(date_from);
      if (date_to)   arizaWhere.createdAt[Op.lte] = new Date(date_to + 'T23:59:59');
    }

    const arizalar = await ArizaModel.findAll({
      where: arizaWhere,
      attributes: ['id', 'raqam', 'holat', 'agent_id', 'agent_nomi', 'mijoz_id', 'mijoz_nomi', 'jami_summa', 'createdAt', 'yetkazilgan_sana'],
      order: [['createdAt', 'DESC']],
      raw: true,
    });

    const arizaIds = arizalar.filter(a => a.holat === 'yetkazildi').map(a => a.id);

    // Yetkazilgan arizalarning tannarxini hisoblash uchun qatorlar + kirim narx
    let tannarxByAriza = {};
    let totalTannarx = 0;
    if (arizaIds.length) {
      const qatorlar = await ArizaQatorModel.findAll({
        where: { ariza_id: { [Op.in]: arizaIds } },
        attributes: ['ariza_id', 'tovar_id', 'jami_dona'],
        raw: true,
      });
      const tovarIds = [...new Set(qatorlar.map(q => q.tovar_id).filter(Boolean))];
      const kirimRows = tovarIds.length
        ? await TovarRegisterModel.findAll({
            where: { tur: { [Op.in]: ['kirim', 'qaytarma_kirim'] }, tovar_id: { [Op.in]: tovarIds } },
            attributes: ['tovar_id', [fn('AVG', col('kirim_narx')), 'kirim_narx']],
            group: ['tovar_id'], raw: true,
          })
        : [];
      const kirimNarxMap = {};
      kirimRows.forEach(r => { kirimNarxMap[r.tovar_id] = Number(r.kirim_narx || 0); });

      qatorlar.forEach(q => {
        const tannarx = Number(q.jami_dona || 0) * (kirimNarxMap[q.tovar_id] || 0);
        tannarxByAriza[q.ariza_id] = (tannarxByAriza[q.ariza_id] || 0) + tannarx;
        totalTannarx += tannarx;
      });
    }

    const yetkazilganSumma = arizalar.filter(a => a.holat === 'yetkazildi').reduce((s, a) => s + Number(a.jami_summa || 0), 0);
    const sofFoyda = yetkazilganSumma - totalTannarx;
    const foydaFoiz = yetkazilganSumma > 0 ? +((sofFoyda / yetkazilganSumma) * 100).toFixed(1) : 0;

    // ── Funnel (holat bo'yicha) ──
    const HOLATLAR = ['yangi', 'tasdiqlangan', 'yigilmoqda', 'yolda', 'yetkazildi', 'bekor'];
    const funnel = {};
    HOLATLAR.forEach(h => { funnel[h] = 0; });
    arizalar.forEach(a => { if (funnel[a.holat] !== undefined) funnel[a.holat]++; });

    // ── Agent samaradorligi ──
    const agentMap = {};
    arizalar.forEach(a => {
      if (!a.agent_id) return;
      if (!agentMap[a.agent_id]) agentMap[a.agent_id] = { agent_id: a.agent_id, agent_nomi: a.agent_nomi || '—', count: 0, summa: 0, foyda: 0 };
      agentMap[a.agent_id].count++;
      if (a.holat === 'yetkazildi') {
        agentMap[a.agent_id].summa += Number(a.jami_summa || 0);
        agentMap[a.agent_id].foyda += (Number(a.jami_summa || 0) - (tannarxByAriza[a.id] || 0));
      }
    });
    const agentStats = Object.values(agentMap)
      .map(a => ({ ...a, foyda: +a.foyda.toFixed(0) }))
      .sort((a, b) => b.summa - a.summa);

    // ── Haftalik trend (oxirgi 7 kun, yaratilgan sana bo'yicha) ──
    const kunlar = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      kunlar.push(d.toISOString().slice(0, 10));
    }
    const trendMap = {};
    kunlar.forEach(k => { trendMap[k] = 0; });
    arizalar.forEach(a => {
      const k = new Date(a.createdAt).toISOString().slice(0, 10);
      if (trendMap[k] !== undefined) trendMap[k]++;
    });
    const weeklyTrend = kunlar.map(k => ({ kun: k, count: trendMap[k] }));

    // ── Top mijozlar ──
    const mijozMap = {};
    arizalar.forEach(a => {
      if (!a.mijoz_id) return;
      if (!mijozMap[a.mijoz_id]) mijozMap[a.mijoz_id] = { mijoz_id: a.mijoz_id, mijoz_nomi: a.mijoz_nomi || '—', agent_nomi: a.agent_nomi || '—', count: 0, summa: 0, yetkazildi: 0, oxirgi: a.createdAt };
      const m = mijozMap[a.mijoz_id];
      m.count++;
      if (a.holat === 'yetkazildi') { m.summa += Number(a.jami_summa || 0); m.yetkazildi++; }
      if (new Date(a.createdAt) > new Date(m.oxirgi)) m.oxirgi = a.createdAt;
    });
    const topMijozlar = Object.values(mijozMap).sort((a, b) => b.summa - a.summa).slice(0, 8);

    res.send({
      jami_ariza:       arizalar.length,
      jami_tushum:      yetkazilganSumma,
      jami_tannarx:     +totalTannarx.toFixed(0),
      sof_foyda:        +sofFoyda.toFixed(0),
      foyda_foiz:       foydaFoiz,
      konversiya_foiz:  arizalar.length ? +((funnel.yetkazildi / arizalar.length) * 100).toFixed(1) : 0,
      funnel,
      agent_stats:      agentStats,
      weekly_trend:     weeklyTrend,
      top_mijozlar:     topMijozlar,
    });
  };

  /* ═══════════════════════════════════════════════════════════════
   * GET /hisobot/agent-monitoring?dan=&gacha=&agent_id=
   *
   * Agent nazorati uchun yagona endpoint. Bazadagi tashrif jadvali
   * (check-in/check-out, GPS masofa, davomiylik, natija) va marshrut
   * rejasini birlashtirib, to'rt kesimda qaytaradi:
   *   1. jurnal      — har bir tashrif tafsiloti
   *   2. reja_fakt   — agent kesimida rejalashtirilgan/bajarilgan
   *   3. kpi         — konversiya, o'rtacha vaqt/chek, dinamika
   *   4. anomaliyalar— uzoqdan check-in, juda qisqa tashrif
   * ═══════════════════════════════════════════════════════════════ */

  // Anomaliya chegaralari — bir joyda tursin, o'zgartirish oson bo'lsin
  static ANOMALIYA = {
    UZOQ_M:      200,   // check-in mijozdan shuncha metrdan uzoq bo'lsa — shubhali
    QISQA_SEK:   180,   // 3 daqiqadan qisqa tashrif — ehtimol formal
    UZUN_SEK:    5400,  // 1.5 soatdan uzun — ehtimol check-out unutilgan
  };

  /* ═══════════════════════════════════════════════════════════════
   * GET /hisobot/agent-marshrut?sana=&agent_id=
   *
   * "Agent bugun qayerga bordi" — kunlik marshrut.
   * Har agent uchun: tashriflar vaqt bo'yicha tartibda (1, 2, 3...),
   * ular orasidagi masofa, GPS trek nuqtalari va umumiy yo'l.
   *
   * Xaritada ko'rsatish uchun mo'ljallangan: nuqtalar + ular orasidagi
   * chiziq + har bir to'xtash haqida ma'lumot.
   * ═══════════════════════════════════════════════════════════════ */
  /* ── Yo'l geometriyasi keshi ────────────────────────────────
   * OSRM javobi o'zgarmaydi (bir xil nuqtalar → bir xil yo'l),
   * shuning uchun xotirada saqlaymiz. Server qayta ishga tushsa
   * yo'qoladi — bu maqbul, chunki qayta so'rash arzon.
   */
  static YOL_KESH = new Map();
  static YOL_KESH_MAX = 500;

  /**
   * To'xtashlar orasidagi HAQIQIY avtomobil yo'lini qaytaradi (OSRM).
   * Xato yoki internet yo'q bo'lsa null — chaqiruvchi to'g'ri chiziqqa qaytadi.
   */
  static async osrmYol(nuqtalar) {
    if (nuqtalar.length < 2) return null;

    // OSRM bir so'rovda ko'p nuqtani qabul qiladi, lekin juda uzun URL
    // muammo tug'diradi — 25 tadan ko'pini yubormaymiz
    const kesilgan = nuqtalar.slice(0, 25);
    const kalit = kesilgan.map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(';');

    const K = HisobotController.YOL_KESH;
    if (K.has(kalit)) return K.get(kalit);

    try {
      const koord = kesilgan.map(p => `${p.lng},${p.lat}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${koord}`
                + `?overview=full&geometries=geojson`;

      // Xarita so'rovi sekin bo'lsa foydalanuvchini kuttirmaymiz
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const javob = await fetch(url, { signal: ctrl.signal });
      clearTimeout(timer);

      if (!javob.ok) return null;
      const j = await javob.json();
      if (j.code !== 'Ok' || !j.routes?.length) return null;

      const r = j.routes[0];
      const natija = {
        // GeoJSON [lng,lat] → Leaflet [lat,lng]
        yol: r.geometry.coordinates.map(c => [ +c[1].toFixed(6), +c[0].toFixed(6) ]),
        km:  +(r.distance / 1000).toFixed(1),
        daq: Math.round(r.duration / 60),
      };

      if (K.size >= HisobotController.YOL_KESH_MAX) K.delete(K.keys().next().value);
      K.set(kalit, natija);
      return natija;
    } catch {
      return null;   // internet yo'q / vaqt tugadi — to'g'ri chiziqqa qaytamiz
    }
  }

  agentKunlikMarshrut = async (req, res) => {
    const sana = /^\d{4}-\d{2}-\d{2}$/.test(req.query.sana || '')
      ? req.query.sana
      : new Date().toISOString().slice(0, 10);
    const agentId = req.query.agent_id ? parseInt(req.query.agent_id, 10) : null;

    // Ikki nuqta orasidagi masofa (km)
    const km = (aLat, aLng, bLat, bLng) => {
      const R = 6371, r = Math.PI / 180;
      const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
      const x = Math.sin(dLat / 2) ** 2 +
        Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
      return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
    };

    const tashrifWhere = { sana };
    const gpsWhere = {
      rol: 'agent',
      sana: { [Op.between]: [sana + ' 00:00:00', sana + ' 23:59:59'] },
    };
    if (agentId) { tashrifWhere.agent_id = agentId; gpsWhere.agent_id = agentId; }

    const [tashriflar, gpsNuqtalar, agentlar, rejalar] = await Promise.all([
      TashrifModel.findAll({
        where: tashrifWhere,
        order: [['agent_id', 'ASC'], ['checkin_vaqt', 'ASC']],
        raw: true, limit: 2000,
      }),
      AgentLocationModel.findAll({
        where: gpsWhere,
        attributes: ['agent_id', 'lat', 'lng', 'sana', 'battery'],
        order: [['agent_id', 'ASC'], ['sana', 'ASC']],
        raw: true, limit: 5000,
      }),
      AgentModel.findAll({
        where: { faol: true },
        attributes: ['id', 'fullname', 'telefon'],
        order: [['fullname', 'ASC']], raw: true,
      }),
      MarshrutRejaModel.findAll({
        where: agentId ? { sana, agent_id: agentId } : { sana },
        attributes: ['agent_id', 'mijoz_id'], raw: true,
      }),
    ]);

    // Mijoz koordinatalari — tashrifda checkin_lat bo'lmasa zaxira sifatida
    const mijozIds = [...new Set([
      ...tashriflar.map(t => t.mijoz_id),
      ...rejalar.map(r => r.mijoz_id),
    ].filter(Boolean))];
    const mijozlar = mijozIds.length
      ? await MijozModel.findAll({
          where: { id: mijozIds },
          attributes: ['id', 'nomi', 'manzil', 'lat', 'lng'], raw: true })
      : [];
    const mijozMap = {};
    mijozlar.forEach(m => { mijozMap[m.id] = m; });

    // Savdo summasi: tashrif.ariza_id ko'pincha bo'sh — agent+mijoz+sana bo'yicha topamiz
    const kunArizalar = await ArizaModel.findAll({
      where: {
        turi: 'sotish',
        ...(agentId ? { agent_id: agentId } : {}),
        [Op.and]: [literal(`DATE(ArizaModel.createdAt) = '${sana}'`)],
      },
      attributes: ['id', 'raqam', 'jami_summa', 'agent_id', 'mijoz_id'],
      raw: true, limit: 2000,
    });
    const arizaKalit = {};
    kunArizalar.forEach(a => {
      const k = `${a.agent_id}|${a.mijoz_id}`;
      if (!arizaKalit[k]) arizaKalit[k] = { raqam: a.raqam, summa: 0 };
      arizaKalit[k].summa += parseFloat(a.jami_summa || 0);
    });

    const rejaSet = new Set(rejalar.map(r => `${r.agent_id}|${r.mijoz_id}`));
    const rejaSoni = {};
    rejalar.forEach(r => { rejaSoni[r.agent_id] = (rejaSoni[r.agent_id] || 0) + 1; });

    // ── Agent kesimida marshrut yig'amiz ──
    const byAgent = {};
    tashriflar.forEach(t => {
      (byAgent[t.agent_id] = byAgent[t.agent_id] || []).push(t);
    });

    const gpsByAgent = {};
    gpsNuqtalar.forEach(g => {
      if (g.lat == null || g.lng == null) return;
      (gpsByAgent[g.agent_id] = gpsByAgent[g.agent_id] || []).push({
        lat: Number(g.lat), lng: Number(g.lng), vaqt: g.sana, battery: g.battery,
      });
    });

    const natija = await Promise.all(agentlar
      .filter(a => !agentId || a.id === agentId)
      .map(async a => {
        const list = byAgent[a.id] || [];

        // To'xtashlar — vaqt bo'yicha tartiblangan
        let oldingi = null, jamiKm = 0;
        const toxtashlar = list.map((t, i) => {
          const m = mijozMap[t.mijoz_id] || {};
          // Check-in koordinatasi aniqroq; bo'lmasa mijoz koordinatasi
          const lat = t.checkin_lat != null ? Number(t.checkin_lat)
                    : (m.lat != null ? Number(m.lat) : null);
          const lng = t.checkin_lng != null ? Number(t.checkin_lng)
                    : (m.lng != null ? Number(m.lng) : null);

          let oraliqKm = null;
          if (lat != null && oldingi) {
            oraliqKm = +km(oldingi.lat, oldingi.lng, lat, lng).toFixed(2);
            jamiKm += oraliqKm;
          }
          if (lat != null) oldingi = { lat, lng };

          const ar = arizaKalit[`${t.agent_id}|${t.mijoz_id}`];
          const davom = t.davomiylik_sek != null ? Number(t.davomiylik_sek) : null;

          return {
            tartib: i + 1,
            tashrif_id: t.id,
            mijoz_id: t.mijoz_id,
            mijoz_nomi: t.mijoz_nomi || m.nomi || '—',
            manzil: m.manzil || null,
            lat, lng,
            checkin_vaqt: t.checkin_vaqt,
            checkout_vaqt: t.checkout_vaqt,
            davomiylik_daq: davom != null ? Math.round(davom / 60) : null,
            masofa_m: t.checkin_masofa != null ? Math.round(Number(t.checkin_masofa)) : null,
            natija: t.natija,
            summa: ar ? ar.summa : 0,
            ariza_raqam: ar ? ar.raqam : null,
            rejada_bor: rejaSet.has(`${t.agent_id}|${t.mijoz_id}`),
            oraliq_km: oraliqKm,
          };
        });

        const koordBor = toxtashlar.filter(s => s.lat != null);
        const boshlanish = list.length ? list[0].checkin_vaqt : null;
        const tugash = list.length ? list[list.length - 1].checkout_vaqt : null;

        // Ish vaqti (birinchi check-in → oxirgi check-out)
        let ishVaqtiDaq = null;
        if (boshlanish && tugash) {
          ishVaqtiDaq = Math.max(0, Math.round((new Date(tugash) - new Date(boshlanish)) / 60000));
        }

        /* ── Yo'l chizig'i: uch bosqichli zaxira ──────────────────
         * 1. GPS izi zich bo'lsa (har to'xtashga >1 nuqta) — agent
         *    haqiqatan yurgan iz, eng ishonchli manba;
         * 2. Aks holda OSRM'dan ko'chalar bo'ylab yo'l so'raymiz;
         * 3. Internet yo'q / xato bo'lsa — front to'g'ri chiziq chizadi.
         */
        const trek = gpsByAgent[a.id] || [];
        let yol = null, yolManba = 'togri', yolKm = null, yolDaq = null;

        // GPS izi to'xtashlardan sezilarli ko'p bo'lsa — u haqiqiy yo'l
        if (trek.length >= Math.max(3, koordBor.length * 2)) {
          yol = trek.map(g => [g.lat, g.lng]);
          yolManba = 'gps';
        } else if (koordBor.length >= 2) {
          const r = await HisobotController.osrmYol(koordBor);
          if (r) {
            yol = r.yol; yolManba = 'osrm';
            yolKm = r.km; yolDaq = r.daq;
          }
        }

        return {
          agent_id: a.id,
          agent_nomi: a.fullname,
          telefon: a.telefon,
          toxtashlar,
          gps_trek: trek,
          // Xaritada chiziladigan yo'l: [[lat,lng], ...]
          yol,
          yol_manba: yolManba,        // gps | osrm | togri
          yol_km:  yolKm,             // OSRM hisoblagan haqiqiy masofa
          yol_daq: yolDaq,            // OSRM hisoblagan yo'l vaqti
          reja_soni: rejaSoni[a.id] || 0,
          tashrif_soni: list.length,
          savdo_soni: list.filter(t => t.natija === 'savdo').length,
          jami_km: +jamiKm.toFixed(1),
          jami_summa: toxtashlar.reduce((s, x) => s + x.summa, 0),
          boshlanish, tugash, ish_vaqti_daq: ishVaqtiDaq,
          // Xaritani markazlash uchun
          markaz: koordBor.length ? {
            lat: +(koordBor.reduce((s, x) => s + x.lat, 0) / koordBor.length).toFixed(6),
            lng: +(koordBor.reduce((s, x) => s + x.lng, 0) / koordBor.length).toFixed(6),
          } : null,
        };
      }));

    natija.sort((a, b) => b.tashrif_soni - a.tashrif_soni);

    res.send({
      sana,
      agentlar: natija,
      jami: {
        agent_soni:   natija.filter(a => a.tashrif_soni > 0).length,
        tashrif_soni: natija.reduce((s, a) => s + a.tashrif_soni, 0),
        km:          +natija.reduce((s, a) => s + a.jami_km, 0).toFixed(1),
        summa:        natija.reduce((s, a) => s + a.jami_summa, 0),
      },
      agent_royxati: agentlar.map(a => ({ id: a.id, fullname: a.fullname })),
    });
  };

  agentMonitoring = async (req, res) => {
    const A = HisobotController.ANOMALIYA;
    const bugun = new Date().toISOString().slice(0, 10);
    const dan   = req.query.dan   || bugun;
    const gacha = req.query.gacha || dan;
    const agentId = req.query.agent_id ? parseInt(req.query.agent_id, 10) : null;

    const sanaSharti = { sana: { [Op.between]: [dan, gacha] } };
    const tashrifWhere = { ...sanaSharti };
    const rejaWhere    = { ...sanaSharti };
    if (agentId) { tashrifWhere.agent_id = agentId; rejaWhere.agent_id = agentId; }

    const [tashriflar, rejalar, agentlar] = await Promise.all([
      TashrifModel.findAll({ where: tashrifWhere, order: [['sana', 'DESC'], ['checkin_vaqt', 'ASC']], limit: 5000, raw: true }),
      MarshrutRejaModel.findAll({ where: rejaWhere, attributes: ['id', 'agent_id', 'mijoz_id', 'sana'], raw: true }),
      AgentModel.findAll({ attributes: ['id', 'fullname', 'telefon'], order: [['fullname', 'ASC']], raw: true }),
    ]);

    const agentNomi = {};
    agentlar.forEach(a => { agentNomi[a.id] = a.fullname; });

    // Tashrifga bog'langan arizalar — savdo summasini ko'rsatish uchun
    const arizaIds = [...new Set(tashriflar.map(t => t.ariza_id).filter(Boolean))];
    const arizalar = arizaIds.length
      ? await ArizaModel.findAll({ where: { id: arizaIds }, attributes: ['id', 'raqam', 'jami_summa'], raw: true })
      : [];
    const arizaMap = {};
    arizalar.forEach(a => { arizaMap[a.id] = a; });

    // Zaxira: tashrif.ariza_id ko'pincha to'ldirilmagan bo'ladi (mobil ilova
    // uni yozmasligi mumkin). Shunda o'sha agent + mijoz + sana bo'yicha
    // arizani topamiz — savdo summasi hisobotda nol bo'lib qolmasin.
    const davrArizalar = await ArizaModel.findAll({
      where: {
        turi: 'sotish',
        ...(agentId ? { agent_id: agentId } : {}),
        [Op.and]: [literal(`DATE(ArizaModel.createdAt) BETWEEN '${dan}' AND '${gacha}'`)],
      },
      attributes: ['id', 'raqam', 'jami_summa', 'agent_id', 'mijoz_id', 'createdAt'],
      raw: true, limit: 5000,
    });
    const arizaKalit = {};
    davrArizalar.forEach(a => {
      const sana = new Date(a.createdAt).toISOString().slice(0, 10);
      const k = `${a.agent_id}|${a.mijoz_id}|${sana}`;
      // Bir kunda bir mijozga bir nechta ariza bo'lsa — summalarni qo'shamiz
      if (!arizaKalit[k]) arizaKalit[k] = { raqam: a.raqam, summa: 0 };
      arizaKalit[k].summa += parseFloat(a.jami_summa || 0);
    });

    // Mijoz koordinatasi — anomaliya tekshiruvi uchun
    const mijozIds = [...new Set(tashriflar.map(t => t.mijoz_id).filter(Boolean))];
    const mijozlar = mijozIds.length
      ? await MijozModel.findAll({ where: { id: mijozIds }, attributes: ['id', 'nomi', 'lat', 'lng'], raw: true })
      : [];
    const mijozMap = {};
    mijozlar.forEach(m => { mijozMap[m.id] = m; });

    /* ── 1. JURNAL ────────────────────────────────────────────── */
    const jurnal = tashriflar.map(t => {
      // Avval to'g'ridan-to'g'ri bog'lanish, bo'lmasa agent+mijoz+sana bo'yicha
      const ar = (t.ariza_id ? arizaMap[t.ariza_id] : null)
              || arizaKalit[`${t.agent_id}|${t.mijoz_id}|${t.sana}`]
              || null;
      const masofa = t.checkin_masofa != null ? Math.round(Number(t.checkin_masofa)) : null;
      const davom  = t.davomiylik_sek != null ? Number(t.davomiylik_sek) : null;

      // Bir tashrifda bir nechta muammo bo'lishi mumkin — hammasini yig'amiz
      const belgilar = [];
      if (masofa != null && masofa > A.UZOQ_M)   belgilar.push({ tur: 'uzoq',  matn: `Mijozdan ${masofa}m uzoqda check-in` });
      if (davom  != null && davom  < A.QISQA_SEK) belgilar.push({ tur: 'qisqa', matn: `Juda qisqa tashrif (${Math.round(davom / 60)} daq)` });
      if (davom  != null && davom  > A.UZUN_SEK)  belgilar.push({ tur: 'uzun',  matn: `Juda uzun (${(davom / 3600).toFixed(1)} soat) — check-out unutilganmi?` });
      if (!t.checkout_vaqt)                       belgilar.push({ tur: 'ochiq', matn: 'Check-out qilinmagan' });

      return {
        id: t.id,
        sana: t.sana,
        agent_id: t.agent_id,
        agent_nomi: t.agent_nomi || agentNomi[t.agent_id] || '—',
        mijoz_id: t.mijoz_id,
        mijoz_nomi: t.mijoz_nomi || mijozMap[t.mijoz_id]?.nomi || '—',
        checkin_vaqt: t.checkin_vaqt,
        checkout_vaqt: t.checkout_vaqt,
        davomiylik_sek: davom,
        davomiylik_daq: davom != null ? Math.round(davom / 60) : null,
        masofa_m: masofa,
        natija: t.natija,
        rejada_bor: !!t.reja_id,
        ariza_raqam: ar?.raqam || null,
        // ar ikki manbadan kelishi mumkin: to'g'ridan-to'g'ri ariza yozuvi
        // (jami_summa) yoki agent+mijoz+sana bo'yicha yig'ilgan zaxira (summa)
        summa: ar ? parseFloat(ar.summa ?? ar.jami_summa ?? 0) : 0,
        lat: t.checkin_lat != null ? Number(t.checkin_lat) : null,
        lng: t.checkin_lng != null ? Number(t.checkin_lng) : null,
        belgilar,
      };
    });

    /* ── 2. REJA-FAKT ─────────────────────────────────────────── */
    // Reja "agent+mijoz+sana" bo'yicha yagona hisoblanadi
    const kalit = (a, m, s) => `${a}|${m}|${s}`;
    const rejaSet = new Set(rejalar.map(r => kalit(r.agent_id, r.mijoz_id, r.sana)));
    const tashrifSet = new Set(tashriflar.map(t => kalit(t.agent_id, t.mijoz_id, t.sana)));

    const rejaFaktMap = {};
    const olish = (id) => (rejaFaktMap[id] = rejaFaktMap[id] || {
      agent_id: id, agent_nomi: agentNomi[id] || '—',
      reja: 0, bajarildi: 0, rejadan_tashqari: 0,
      savdo: 0, sotmaslik: 0, ochiq: 0, summa: 0,
    });

    rejalar.forEach(r => {
      const s = olish(r.agent_id);
      s.reja++;
      if (tashrifSet.has(kalit(r.agent_id, r.mijoz_id, r.sana))) s.bajarildi++;
    });

    jurnal.forEach(t => {
      const s = olish(t.agent_id);
      if (!rejaSet.has(kalit(t.agent_id, t.mijoz_id, t.sana))) s.rejadan_tashqari++;
      if (t.natija === 'savdo')     { s.savdo++; s.summa += t.summa; }
      else if (t.natija === 'sotmaslik') s.sotmaslik++;
      else s.ochiq++;
    });

    const rejaFakt = Object.values(rejaFaktMap).map(s => ({
      ...s,
      qoldi: Math.max(0, s.reja - s.bajarildi),
      bajarilish_foiz: s.reja ? Math.round(s.bajarildi / s.reja * 100) : 0,
      konversiya_foiz: (s.savdo + s.sotmaslik) ? Math.round(s.savdo / (s.savdo + s.sotmaslik) * 100) : 0,
    })).sort((a, b) => b.bajarilish_foiz - a.bajarilish_foiz || b.bajarildi - a.bajarildi);

    /* ── 3. KPI ───────────────────────────────────────────────── */
    const davomlar = jurnal.map(t => t.davomiylik_sek).filter(v => v != null && v > 0);
    const savdolar = jurnal.filter(t => t.natija === 'savdo');
    const jamiSumma = savdolar.reduce((s, t) => s + t.summa, 0);

    const kpi = {
      tashrif_soni:    jurnal.length,
      savdo_soni:      savdolar.length,
      sotmaslik_soni:  jurnal.filter(t => t.natija === 'sotmaslik').length,
      konversiya_foiz: jurnal.length ? Math.round(savdolar.length / jurnal.length * 100) : 0,
      ort_davomiylik_daq: davomlar.length ? Math.round(davomlar.reduce((a, b) => a + b, 0) / davomlar.length / 60) : 0,
      jami_summa:      jamiSumma,
      ort_chek:        savdolar.length ? Math.round(jamiSumma / savdolar.length) : 0,
      reja_jami:       rejalar.length,
      bajarildi_jami:  rejaFakt.reduce((s, r) => s + r.bajarildi, 0),
      agent_soni:      new Set(jurnal.map(t => t.agent_id)).size,
    };

    // Kunlik dinamika — grafik uchun
    const kunMap = {};
    jurnal.forEach(t => {
      const k = kunMap[t.sana] = kunMap[t.sana] || { sana: t.sana, tashrif: 0, savdo: 0, summa: 0 };
      k.tashrif++;
      if (t.natija === 'savdo') { k.savdo++; k.summa += t.summa; }
    });
    const dinamika = Object.values(kunMap).sort((a, b) => String(a.sana).localeCompare(String(b.sana)));

    // Sotmaslik sabablari
    const sotmaslikWhere = { sana: { [Op.between]: [dan + ' 00:00:00', gacha + ' 23:59:59'] } };
    if (agentId) sotmaslikWhere.agent_id = agentId;
    const sotmasliklar = await SotmaslikModel.findAll({
      where: sotmaslikWhere, attributes: ['sabab_nomi'], raw: true, limit: 3000,
    });
    const sababMap = {};
    sotmasliklar.forEach(s => {
      const n = s.sabab_nomi || 'Sabab ko\'rsatilmagan';
      sababMap[n] = (sababMap[n] || 0) + 1;
    });
    const sabablar = Object.entries(sababMap)
      .map(([nomi, soni]) => ({ nomi, soni }))
      .sort((a, b) => b.soni - a.soni);

    /* ── 4. ANOMALIYALAR ──────────────────────────────────────── */
    const anomaliyalar = jurnal
      .filter(t => t.belgilar.length)
      .map(t => ({
        tashrif_id: t.id, sana: t.sana,
        agent_id: t.agent_id, agent_nomi: t.agent_nomi,
        mijoz_nomi: t.mijoz_nomi,
        checkin_vaqt: t.checkin_vaqt,
        masofa_m: t.masofa_m, davomiylik_daq: t.davomiylik_daq,
        belgilar: t.belgilar,
        // Eng jiddiy belgi bo'yicha tartiblaymiz: uzoq > qisqa > uzun > ochiq
        ogirlik: t.belgilar.some(b => b.tur === 'uzoq') ? 3
               : t.belgilar.some(b => b.tur === 'qisqa') ? 2
               : t.belgilar.some(b => b.tur === 'uzun') ? 1 : 0,
      }))
      .sort((a, b) => b.ogirlik - a.ogirlik || String(b.sana).localeCompare(String(a.sana)));

    res.send({
      davr: { dan, gacha },
      kpi,
      reja_fakt: rejaFakt,
      jurnal,
      dinamika,
      sabablar,
      anomaliyalar,
      anomaliya_chegara: { uzoq_m: A.UZOQ_M, qisqa_daq: A.QISQA_SEK / 60, uzun_soat: A.UZUN_SEK / 3600 },
      agentlar: agentlar.map(a => ({ id: a.id, fullname: a.fullname, telefon: a.telefon })),
    });
  };
}

module.exports = new HisobotController();
