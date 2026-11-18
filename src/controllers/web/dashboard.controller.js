const { Op, fn, col } = require('sequelize');
const sequelize          = require('../../db/db-sequelize');
const { sotuvTahlil, tannarxXaritasi, BRAK_OMBOR } = require('../../utils/tahlil.utils');
const TovarRegisterModel = require('../../models/tovar_register.model');
const { PrixodModel }    = require('../../models/prixod.model');
const { MijozModel } = require('../../models/mijoz.model');
const AgentModel         = require('../../models/agent.model');
const { YetkazuvchiModel } = require('../../models/yetkazuvchi.model');
const { ArizaModel, ArizaQatorModel } = require('../../models/ariza.model');

// ── Yordamchi: sana oralig'i ──────────────────────────────
function periodRange(period) {
  const now  = new Date();
  const from = new Date();
  if (period === 'today') {
    from.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    const day = now.getDay() || 7;
    from.setDate(now.getDate() - day + 1);
    from.setHours(0, 0, 0, 0);
  } else if (period === 'year') {
    from.setMonth(0, 1);
    from.setHours(0, 0, 0, 0);
  } else {
    // month — default
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
  }
  return { from, to: now };
}

// ── Oldingi period uchun sana oralig'i (o'sish % uchun) ──
function prevPeriodRange(period) {
  const { from, to } = periodRange(period);
  const diff = to - from;
  return { from: new Date(from - diff), to: new Date(from - 1) };
}

// ── So'nggi N kunlik sana ro'yxati (KPI kartalar uchun sparkline) ──
function lastNDays(n) {
  const days = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
// Kunlik qatorlarni to'liq kun ro'yxatiga moslashtirish (bo'sh kunlar 0 bilan to'ldiriladi)
function alignDaily(rows, days, dateKey, valKey) {
  const map = {};
  rows.forEach(r => { map[String(r[dateKey]).slice(0, 10)] = Number(r[valKey] || 0); });
  return days.map(d => map[d] || 0);
}

// ── Mahalliy vaqt ──────────────────────────────────────────
// Sequelize DB sessiyasini UTC'da ochadi, server esa (Electron) foydalanuvchi
// kompyuterida ishlaydi. Soat/kun bo'yicha guruhlashda vaqtni mahalliy
// mintaqaga o'giramiz — aks holda Toshkentda "bugun" 05:00 da boshlanadi.
function tzOffset() {
  const m = -new Date().getTimezoneOffset();
  const a = Math.abs(m);
  return `${m >= 0 ? '+' : '-'}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
const pad2   = n => String(n).padStart(2, '0');
const kunKey = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const oyKey  = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
function yarimTun(kunOldin = 0) {
  const d = new Date(); d.setDate(d.getDate() - kunOldin); d.setHours(0, 0, 0, 0); return d;
}

// ── "Sotuv trendi" grafigi uchun period'ga mos granularity ──
// today → bugungi soatlar, week → so'nggi 7 kun, month → so'nggi 30 kun,
// year → so'nggi 12 oy. Har bir nuqtaga oldingi davrdagi mos nuqta
// biriktiriladi (bugun ↔ kecha, 30 kun ↔ undan oldingi 30 kun, ...).
function trendConfig(period) {
  const now = new Date();
  const buckets = [];
  if (period === 'today') {
    const from = yarimTun(0), prevFrom = yarimTun(1);
    for (let h = 0; h <= now.getHours(); h++) {
      buckets.push({ key: `${kunKey(from)} ${pad2(h)}:00`, prev: `${kunKey(prevFrom)} ${pad2(h)}:00` });
    }
    return { fmt: '%Y-%m-%d %H:00', from, prevFrom, buckets };
  }
  if (period === 'year') {
    const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
    const prevFrom = new Date(now.getFullYear() - 1, now.getMonth() - 11, 1);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const p = new Date(now.getFullYear() - 1, now.getMonth() - i, 1);
      buckets.push({ key: oyKey(d), prev: oyKey(p) });
    }
    return { fmt: '%Y-%m', from, prevFrom, buckets };
  }
  const n = period === 'week' ? 7 : 30;
  const from = yarimTun(n - 1), prevFrom = yarimTun(2 * n - 1);
  for (let i = n - 1; i >= 0; i--) {
    buckets.push({ key: kunKey(yarimTun(i)), prev: kunKey(yarimTun(i + n)) });
  }
  return { fmt: '%Y-%m-%d', from, prevFrom, buckets };
}

// ── Savdo rejasi davrga moslashtiriladi (agent.plan_summa — oylik) ──
// Bugun → kunlik ulush, hafta → 7 kunlik, yil → 12 oylik.
function rejaKoef(period) {
  const now = new Date();
  const oyKunlari = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  if (period === 'today') return 1 / oyKunlari;
  if (period === 'week')  return 7 / oyKunlari;
  if (period === 'year')  return 12;
  return 1;
}

class DashboardController {

  // ── GET /dashboard — bosh sahifa uchun barcha ma'lumot ──
  main = async (req, res) => {
    const { period = 'month' } = req.query;
    const { from, to }   = periodRange(period);
    const { from: pFrom, to: pTo } = prevPeriodRange(period);
    const trendCfg = trendConfig(period);
    const TZ    = tzOffset();
    const BUGUN = kunKey(new Date());   // mahalliy bugungi sana (YYYY-MM-DD)
    const TREND_SQL = `
      SELECT DATE_FORMAT(CONVERT_TZ(a.createdAt, '+00:00', :tz), :fmt) AS oy,
        COALESCE(SUM(a.jami_summa), 0) AS summa,
        COALESCE(SUM(q.dona), 0) AS dona,
        COUNT(*) AS son
      FROM ariza a
      LEFT JOIN (
        SELECT ariza_id, SUM(jami_dona) AS dona FROM ariza_qator GROUP BY ariza_id
      ) q ON q.ariza_id = a.id
      WHERE a.turi = 'sotish' AND a.deletedAt IS NULL AND a.holat <> 'bekor'
        AND a.createdAt >= :from AND a.createdAt < :to
      GROUP BY oy
    `;

    // Parallel barcha so'rovlar
    const [
      // Joriy period
      kirimStat,
      prixodSon,
      // Oldingi period (o'sish %)
      kirimStatPrev,
      prixodSonPrev,
      // Mijozlar
      mijozSon,
      mijozFaol,
      // Agentlar
      agentSon,
      // Yetkazuvchilar
      yetkazuvchiSon,
      // Ombor qoldig'i (dona + tannarx bo'yicha qiymat)
      omborQoldiqRows,
      // So'nggi prixodlar
      oxirgiPrixodlar,
      // Oylik trend (12 oy)
      oylikTrend,
      // Turkum taqsimoti
      turkumStat,
      // Top tovarlar
      topTovarlar,
    ] = await Promise.all([

      // ── Kirim statistika (joriy) ──
      TovarRegisterModel.findOne({
        where: { tur: 'kirim', manba_tur: 'prixod', sana: { [Op.between]: [from, to] } },
        attributes: [
          [fn('COALESCE', fn('SUM', col('summa')), 0),  'jami_summa'],
          [fn('COALESCE', fn('SUM', col('donada')), 0), 'jami_dona'],
          [fn('COUNT',    col('id')), 'qator_son'],
        ],
        raw: true,
      }),

      // ── Prixod soni (joriy) ──
      PrixodModel.count({
        where: { holat: 'tasdiqlangan', sana: { [Op.between]: [from, to] } },
      }),

      // ── Kirim statistika (oldingi) ──
      TovarRegisterModel.findOne({
        where: { tur: 'kirim', manba_tur: 'prixod', sana: { [Op.between]: [pFrom, pTo] } },
        attributes: [[fn('COALESCE', fn('SUM', col('summa')), 0), 'jami_summa']],
        raw: true,
      }),

      // ── Prixod soni (oldingi) ──
      PrixodModel.count({
        where: { holat: 'tasdiqlangan', sana: { [Op.between]: [pFrom, pTo] } },
      }),

      // ── Jami mijozlar ──
      MijozModel.count(),

      // ── Faol mijozlar ──
      MijozModel.count({ where: { faol: true } }),

      // ── Faol agentlar ──
      AgentModel.count({ where: { faol: true } }),

      // ── Yetkazuvchilar ──
      YetkazuvchiModel.count(),

      // ── Ombor qoldig'i ──
      // Chiqim yozuvlarida donada manfiy saqlanadi, shuning uchun qoldiq —
      // barcha harakatlarning oddiy yig'indisi. Qiymat esa sotuv summasi
      // (chiqim) bilan aralashmasligi uchun o'rtacha kirim narxida hisoblanadi.
      // Qiymat — Hisobotlar va Qoldiqlar bilan bir xil: (tovar, ombor) bo'yicha
      // musbat qoldiq × og'irlikli o'rtacha tannarx; Brak ombori hisobga olinmaydi.
      Promise.all([
        sequelize.query(`
          SELECT tovar_id, SUM(donada) AS q FROM tovar_register
          WHERE ombor IS NULL OR ombor <> :brak GROUP BY tovar_id, ombor HAVING q > 0.0001
        `, { replacements: { brak: BRAK_OMBOR }, type: sequelize.QueryTypes.SELECT }),
        tannarxXaritasi(new Date()),
      ]).then(([rows, narx]) => [{
        dona: rows.reduce((s, r) => s + Number(r.q), 0),
        summa: rows.reduce((s, r) => s + Number(r.q) * (narx[r.tovar_id] || 0), 0),
      }]),

      // ── So'nggi 6 ta prixod ──
      PrixodModel.findAll({
        where: { holat: 'tasdiqlangan' },
        order: [['sana', 'DESC']],
        limit: 6,
        attributes: ['id', 'hujjat_raqam', 'sana', 'yetkazuvchi', 'jami_summa', 'holat', 'ombor'],
        raw: true,
      }),

      // ── Sotuv trendi — period'ga mos granularity (soat/kun/oy), joriy + oldingi davr ──
      // "Sotuv" KPI bilan bir xil manba: bekor qilinmagan sotish arizalari
      // (buyurtma berilgan vaqt bo'yicha), son = buyurtmalar soni.
      sequelize.query(TREND_SQL, { replacements: { tz: TZ, fmt: trendCfg.fmt, from: trendCfg.prevFrom, to: new Date(Date.now() + 60000) }, type: sequelize.QueryTypes.SELECT }),

      // ── Turkum bo'yicha SOTUV ulushi (chiqim = sotilgan; summa/dona manfiy → ABS) ──
      TovarRegisterModel.findAll({
        where: { tur: 'chiqim', manba_tur: 'sotuv', sana: { [Op.between]: [from, to] } },
        attributes: [
          'turkum',
          [fn('ABS', fn('COALESCE', fn('SUM', col('summa')), 0)),  'summa'],
          [fn('ABS', fn('COALESCE', fn('SUM', col('donada')), 0)), 'dona'],
        ],
        group: ['turkum'],
        order: [[fn('ABS', fn('SUM', col('summa'))), 'DESC']],
        limit: 6,
        raw: true,
      }),

      // ── Top 5 eng ko'p SOTILGAN tovar ──
      TovarRegisterModel.findAll({
        where: { tur: 'chiqim', manba_tur: 'sotuv', sana: { [Op.between]: [from, to] } },
        attributes: [
          'tovar_id',
          'tovar_nomi',
          'turkum',
          [fn('ABS', fn('COALESCE', fn('SUM', col('summa')), 0)),  'summa'],
          [fn('ABS', fn('COALESCE', fn('SUM', col('donada')), 0)), 'dona'],
        ],
        group: ['tovar_id', 'tovar_nomi', 'turkum'],
        order: [[fn('ABS', fn('SUM', col('summa'))), 'DESC']],
        limit: 5,
        raw: true,
      }),
    ]);

    // ── O'sish foizlari ──
    const prevSumma = Number(kirimStatPrev?.jami_summa || 0);
    const curSumma  = Number(kirimStat?.jami_summa     || 0);
    const kirimOsish = prevSumma > 0
      ? +((curSumma - prevSumma) / prevSumma * 100).toFixed(1)
      : 0;

    const prixodOsish = prixodSonPrev > 0
      ? +((prixodSon - prixodSonPrev) / prixodSonPrev * 100).toFixed(1)
      : 0;

    // ── Ombor qoldiqlari ──
    const omborQoldiqDona  = Number(omborQoldiqRows[0]?.dona  || 0);
    const omborQoldiqSumma = Number(omborQoldiqRows[0]?.summa || 0);

    // ── Turkum total ──
    const turkumTotal = turkumStat.reduce((s, r) => s + Number(r.summa || 0), 0);

    // ── Debitorlik (mijoz qarzi) — balans manfiy = qarz ──
    const [debitorRow] = await sequelize.query(`
      SELECT
        COALESCE(SUM(CASE WHEN balans < 0 THEN -balans ELSE 0 END), 0) AS jami_qarz,
        COUNT(CASE WHEN balans < 0 THEN 1 END) AS qarzdor_soni
      FROM mijoz WHERE deletedAt IS NULL
    `, { type: sequelize.QueryTypes.SELECT });
    // Muddati o'tgan qarz (FIFO yoshi): mijoz qarzini avval eng yangi savdolar
    // "qoplaydi" deb hisoblanadi. To'lov muddati (mijoz.tolov_muddati_kun) ichidagi
    // savdolardan oshgan qism — muddati o'tgan. Natija hech qachon jami qarzdan
    // oshmaydi (ilgari to'lovlarni hisobga olmay barcha nasiya savdolarni qo'shardi).
    const [muddatRow] = await sequelize.query(`
      SELECT COALESCE(SUM(GREATEST(0, -m.balans - COALESCE(r.yaqin, 0))), 0) AS muddati_otgan
      FROM mijoz m
      LEFT JOIN (
        SELECT a.mijoz_id, SUM(a.jami_summa) AS yaqin
        FROM ariza a
        JOIN mijoz mm ON mm.id = a.mijoz_id
        WHERE a.turi = 'sotish' AND a.deletedAt IS NULL AND a.holat <> 'bekor'
          AND a.createdAt >= DATE_SUB(NOW(), INTERVAL COALESCE(NULLIF(mm.tolov_muddati_kun, 0), 30) DAY)
        GROUP BY a.mijoz_id
      ) r ON r.mijoz_id = m.id
      WHERE m.deletedAt IS NULL AND m.balans < 0
    `, { type: sequelize.QueryTypes.SELECT });

    // ── SOTUV (buyurtmalar) — bekor qilinganlardan tashqari barcha sotish arizalari ──
    const SOTUV_SQL = `
      SELECT COALESCE(SUM(jami_summa), 0) AS summa, COUNT(*) AS son,
        COUNT(DISTINCT mijoz_id) AS akb,
        COALESCE(SUM(CASE WHEN holat = 'yetkazildi' THEN jami_summa ELSE 0 END), 0) AS yetkazilgan_summa,
        SUM(CASE WHEN holat = 'yetkazildi' THEN 1 ELSE 0 END) AS yetkazilgan_son
      FROM ariza
      WHERE turi = 'sotish' AND deletedAt IS NULL AND holat <> 'bekor'
        AND createdAt BETWEEN :from AND :to
    `;
    const SOTUV_FILTR = `a.turi = 'sotish' AND a.deletedAt IS NULL AND a.holat <> 'bekor'
        AND a.createdAt BETWEEN :from AND :to`;
    const Q = sequelize.QueryTypes.SELECT;

    const [
      [sotuvRow], [sotuvPrevRow], [qaytarishRow],
      oqimRows, [bugunYetkazRow], [kechikkanRow],
      dostavchiRows, hududRows, tolovRows, [omborHolatRow], oxirgiBuyurtmaRows,
    ] = await Promise.all([
      sequelize.query(SOTUV_SQL, { replacements: { from, to }, type: Q }),
      sequelize.query(SOTUV_SQL, { replacements: { from: pFrom, to: pTo }, type: Q }),

      // Qaytarishlar: alohida qaytarish arizalari + yetkazishda qisman qaytarilgan/brak
      sequelize.query(`
        SELECT
          (SELECT COALESCE(SUM(jami_summa), 0) FROM ariza
            WHERE turi = 'qaytarish' AND deletedAt IS NULL AND holat <> 'bekor'
              AND createdAt BETWEEN :from AND :to) AS ariza_summa,
          (SELECT COALESCE(SUM(summa), 0) FROM yetkazish_qaytarish
            WHERE sana BETWEEN :from AND :to) AS yetkazish_summa,
          (SELECT COUNT(*) FROM ariza
            WHERE turi = 'sotish' AND deletedAt IS NULL AND holat = 'bekor'
              AND createdAt BETWEEN :from AND :to) AS bekor_son,
          (SELECT COUNT(*) FROM ariza
            WHERE turi = 'qaytarish' AND deletedAt IS NULL AND holat = 'qabul_kutilmoqda') AS qabul_kutilmoqda
      `, { replacements: { from, to }, type: Q }),

      // Jonli oqim: hozir yo'lning qaysi bosqichida nechta buyurtma turibdi (davrga bog'liq emas)
      sequelize.query(`
        SELECT holat, COUNT(*) AS son, COALESCE(SUM(jami_summa), 0) AS summa
        FROM ariza
        WHERE turi = 'sotish' AND deletedAt IS NULL
          AND holat IN ('yangi', 'tasdiqlangan', 'yigilmoqda', 'yolda')
        GROUP BY holat
      `, { type: Q }),
      sequelize.query(`
        SELECT COUNT(*) AS son, COALESCE(SUM(jami_summa), 0) AS summa
        FROM ariza
        WHERE turi = 'sotish' AND deletedAt IS NULL AND holat = 'yetkazildi'
          AND DATE(CONVERT_TZ(yetkazilgan_sana, '+00:00', :tz)) = :bugun
      `, { replacements: { tz: TZ, bugun: BUGUN }, type: Q }),
      // Kechikkan: jo'natish sanasi o'tib ketgan, lekin hali yetkazilmagan
      sequelize.query(`
        SELECT COUNT(*) AS son, COALESCE(SUM(jami_summa), 0) AS summa
        FROM ariza
        WHERE turi = 'sotish' AND deletedAt IS NULL
          AND holat IN ('tasdiqlangan', 'yigilmoqda', 'yolda')
          AND jonatish_sana IS NOT NULL AND jonatish_sana < :bugun
      `, { replacements: { bugun: BUGUN }, type: Q }),

      // Dostavchilar: ochiq yuk (tasdiqlangan → yo'lda) va bugun yetkazilgani
      sequelize.query(`
        SELECT d.id, d.ism, d.transport, d.mashina_raqam,
          SUM(CASE WHEN a.holat = 'yetkazildi' THEN 1 ELSE 0 END) AS yetkazildi,
          SUM(CASE WHEN a.holat IN ('tasdiqlangan', 'yigilmoqda', 'yolda') THEN 1 ELSE 0 END) AS kutilmoqda,
          SUM(CASE WHEN a.holat = 'yolda' THEN 1 ELSE 0 END) AS yolda,
          COALESCE(SUM(CASE WHEN a.holat = 'yetkazildi' THEN a.jami_summa ELSE 0 END), 0) AS yetkazildi_summa,
          COALESCE(SUM(CASE WHEN a.holat IN ('tasdiqlangan', 'yigilmoqda', 'yolda') THEN a.jami_summa ELSE 0 END), 0) AS kutilmoqda_summa,
          (SELECT CASE
              WHEN SUM(t.holat = 'yolda') > 0 THEN 'yolda'
              WHEN SUM(t.holat = 'yangi') > 0 THEN 'yangi'
              WHEN COUNT(*) > 0 THEN 'yakunlandi'
            END
            FROM trip_sheet t WHERE t.dostavchi_id = d.id AND t.sana = :bugun) AS trip_holat
        FROM dostavchi d
        LEFT JOIN ariza a ON a.dostavchi_id = d.id AND a.turi = 'sotish' AND a.deletedAt IS NULL
          AND (a.holat IN ('tasdiqlangan', 'yigilmoqda', 'yolda')
               OR (a.holat = 'yetkazildi' AND DATE(CONVERT_TZ(a.yetkazilgan_sana, '+00:00', :tz)) = :bugun))
        WHERE d.faol = 1
        GROUP BY d.id, d.ism, d.transport, d.mashina_raqam
        ORDER BY (SUM(CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END)) DESC, d.ism ASC
        LIMIT 8
      `, { replacements: { tz: TZ, bugun: BUGUN }, type: Q }),

      // Hududlar bo'yicha sotuv
      sequelize.query(`
        SELECT t.id, COALESCE(t.nomi, 'Hududsiz') AS hudud,
          COUNT(a.id) AS son, COALESCE(SUM(a.jami_summa), 0) AS summa,
          COUNT(DISTINCT a.mijoz_id) AS mijoz
        FROM ariza a
        LEFT JOIN mijoz m ON m.id = a.mijoz_id
        LEFT JOIN territoriya t ON t.id = m.territoriya_id
        WHERE ${SOTUV_FILTR}
        GROUP BY t.id, t.nomi
        ORDER BY summa DESC
        LIMIT 7
      `, { replacements: { from, to }, type: Q }),

      // To'lov turi bo'yicha sotuv
      sequelize.query(`
        SELECT LOWER(COALESCE(NULLIF(a.tolov_turi, ''), '-')) AS tur,
          COUNT(*) AS son, COALESCE(SUM(a.jami_summa), 0) AS summa
        FROM ariza a
        WHERE ${SOTUV_FILTR}
        GROUP BY tur
      `, { replacements: { from, to }, type: Q }),

      // Ombor salomatligi: faol tovarlar qoldiq bo'yicha guruhlanadi
      sequelize.query(`
        SELECT COUNT(*) AS jami,
          SUM(CASE WHEN x.q <= 0 THEN 1 ELSE 0 END) AS tugagan,
          SUM(CASE WHEN x.q > 0 AND x.q < 20 THEN 1 ELSE 0 END) AS kam,
          SUM(CASE WHEN x.q >= 20 THEN 1 ELSE 0 END) AS yetarli
        FROM (
          SELECT t.id, COALESCE(SUM(tr.donada), 0) AS q
          FROM tovar t LEFT JOIN tovar_register tr ON tr.tovar_id = t.id
          WHERE t.faol = 1 AND t.deletedAt IS NULL
          GROUP BY t.id
        ) x
      `, { type: Q }),

      // So'nggi buyurtmalar (jonli lenta)
      sequelize.query(`
        SELECT id, raqam, holat, manba, mijoz_nomi, agent_nomi, dostavchi_nomi,
          jami_summa, tolov_turi, createdAt
        FROM ariza
        WHERE turi = 'sotish' AND deletedAt IS NULL
        ORDER BY createdAt DESC
        LIMIT 8
      `, { type: Q }),
    ]);

    const sotuvSumma     = Number(sotuvRow?.summa || 0);
    const sotuvSon       = Number(sotuvRow?.son || 0);
    const sotuvPrevSumma = Number(sotuvPrevRow?.summa || 0);
    const sotuvPrevSon   = Number(sotuvPrevRow?.son || 0);
    // Oldingi davrda asos bo'lmasa o'sish noma'lum (null) — UI uni ko'rsatmaydi
    const osishFoiz = (cur, prev) => prev > 0 ? +(((cur - prev) / prev) * 100).toFixed(1) : null;
    const ortachaChek     = sotuvSon ? sotuvSumma / sotuvSon : 0;
    const ortachaChekPrev = sotuvPrevSon ? sotuvPrevSumma / sotuvPrevSon : 0;
    const qaytarishSumma = Number(qaytarishRow?.ariza_summa || 0) + Number(qaytarishRow?.yetkazish_summa || 0);

    const sotuv = {
      summa:             sotuvSumma,
      son:               sotuvSon,
      osish:             osishFoiz(sotuvSumma, sotuvPrevSumma),
      son_osish:         osishFoiz(sotuvSon, sotuvPrevSon),
      ortacha_chek:      ortachaChek,
      ortacha_chek_osish: osishFoiz(ortachaChek, ortachaChekPrev),
      akb:               Number(sotuvRow?.akb || 0),
      akb_osish:         osishFoiz(Number(sotuvRow?.akb || 0), Number(sotuvPrevRow?.akb || 0)),
      qamrov:            mijozFaol > 0 ? Math.min(100, +((Number(sotuvRow?.akb || 0) / mijozFaol) * 100).toFixed(1)) : 0,
      yetkazilgan_summa: Number(sotuvRow?.yetkazilgan_summa || 0),
      yetkazilgan_son:   Number(sotuvRow?.yetkazilgan_son || 0),
      yetkazish_foiz:    sotuvSon ? +((Number(sotuvRow?.yetkazilgan_son || 0) / sotuvSon) * 100).toFixed(1) : 0,
      bekor_son:         Number(qaytarishRow?.bekor_son || 0),
      qaytarish_summa:   qaytarishSumma,
      qaytarish_foiz:    sotuvSumma ? +((qaytarishSumma / sotuvSumma) * 100).toFixed(1) : 0,
    };

    const oqimMap = {};
    oqimRows.forEach(r => { oqimMap[r.holat] = { son: Number(r.son || 0), summa: Number(r.summa || 0) }; });
    const bosqich = (holat, label) => ({ holat, label, ...(oqimMap[holat] || { son: 0, summa: 0 }) });
    const distributsiya_oqimi = {
      bosqichlar: [
        bosqich('yangi',        'Yangi'),
        bosqich('tasdiqlangan', 'Tasdiqlangan'),
        bosqich('yigilmoqda',   "Yig'ilmoqda"),
        bosqich('yolda',        "Yo'lda"),
        { holat: 'yetkazildi', label: 'Bugun yetkazildi',
          son: Number(bugunYetkazRow?.son || 0), summa: Number(bugunYetkazRow?.summa || 0) },
      ],
      kechikkan:        { son: Number(kechikkanRow?.son || 0), summa: Number(kechikkanRow?.summa || 0) },
      qabul_kutilmoqda: Number(qaytarishRow?.qabul_kutilmoqda || 0),
    };

    const dostavchilar = dostavchiRows.map(r => ({
      id:               r.id,
      ism:              r.ism || '—',
      transport:        [r.transport, r.mashina_raqam].filter(Boolean).join(' · '),
      yetkazildi:       Number(r.yetkazildi || 0),
      kutilmoqda:       Number(r.kutilmoqda || 0),
      yolda:            Number(r.yolda || 0),
      yetkazildi_summa: Number(r.yetkazildi_summa || 0),
      kutilmoqda_summa: Number(r.kutilmoqda_summa || 0),
      trip_holat:       r.trip_holat || null,
    }));

    const hududJami = hududRows.reduce((s, r) => s + Number(r.summa || 0), 0);
    const hudud_stat = hududRows.map(r => ({
      id:     r.id,
      hudud:  r.hudud,
      son:    Number(r.son || 0),
      summa:  Number(r.summa || 0),
      mijoz:  Number(r.mijoz || 0),
      foiz:   hududJami ? +((Number(r.summa || 0) / hududJami) * 100).toFixed(1) : 0,
    }));

    // "naqd" va "naqt" bir xil — yozilishi turlicha kelgan
    const tolovMap = {};
    tolovRows.forEach(r => {
      const k = r.tur === 'naqd' ? 'naqt' : r.tur;
      tolovMap[k] = tolovMap[k] || { tur: k, son: 0, summa: 0 };
      tolovMap[k].son   += Number(r.son || 0);
      tolovMap[k].summa += Number(r.summa || 0);
    });
    const tolovJami = Object.values(tolovMap).reduce((s, r) => s + r.summa, 0);
    const tolov_turlari = Object.values(tolovMap)
      .sort((a, b) => b.summa - a.summa)
      .map(r => ({ ...r, foiz: tolovJami ? +((r.summa / tolovJami) * 100).toFixed(1) : 0 }));

    const ombor_holati = {
      jami:     Number(omborHolatRow?.jami || 0),
      tugagan:  Number(omborHolatRow?.tugagan || 0),
      kam:      Number(omborHolatRow?.kam || 0),
      yetarli:  Number(omborHolatRow?.yetarli || 0),
    };

    const oxirgi_buyurtmalar = oxirgiBuyurtmaRows.map(r => ({
      id:         r.id,
      raqam:      r.raqam || `#${r.id}`,
      holat:      r.holat,
      manba:      r.manba,
      mijoz:      r.mijoz_nomi || '—',
      agent:      r.agent_nomi || '',
      dostavchi:  r.dostavchi_nomi || '',
      summa:      Number(r.jami_summa || 0),
      tolov_turi: r.tolov_turi || '',
      vaqt:       r.createdAt,
    }));

    // ── Savdo rejasi KPI (agentlar plan_summa yig'indisiga nisbatan joriy SOTUV) ──
    const [planRow] = await sequelize.query(`
      SELECT COALESCE(SUM(plan_summa), 0) AS jami_plan FROM agent WHERE deletedAt IS NULL AND faol = 1
    `, { type: sequelize.QueryTypes.SELECT });
    const REJA_KOEF = rejaKoef(period);
    const jamiPlan = Number(planRow?.jami_plan || 0) * REJA_KOEF;
    const savdoRejaFoiz = jamiPlan > 0 ? Math.min(100, +((sotuvSumma / jamiPlan) * 100).toFixed(1)) : 0;

    // ── YALPI FOYDA (sotuv summasi − sotilgan tovar tannarxi) ──
    // Hisobot sahifasi (sotuvHisobot) bilan bir xil mantiq: faqat "yetkazildi"
    // holatidagi arizalar hisobga olinadi, tannarx har bir tovarning barcha
    // kirim yozuvlari bo'yicha O'RTACHA narxi asosida hisoblanadi (FIFO emas).
    // Yalpi foyda — Hisobotlar bo'limi bilan bir xil qoida (utils/tahlil.utils.js):
    // yetkazilgan sana bo'yicha, qaytarishlar ayirilgan, og'irlikli o'rtacha tannarx.
    const yalpiFoyda = async (fromD, toD) => (await sotuvTahlil(fromD, toD)).jami.foyda;
    const [yalpiFoydaCur, yalpiFoydaPrev] = await Promise.all([
      yalpiFoyda(from, to),
      yalpiFoyda(pFrom, pTo),
    ]);
    const yalpiFoydaOsish = yalpiFoydaPrev > 0
      ? +(((yalpiFoydaCur - yalpiFoydaPrev) / yalpiFoydaPrev) * 100).toFixed(1)
      : null;

    // ── SOF KASSA OQIMI (davr bo'yicha kirim − chiqim) ──
    const [kassaOqimRow] = await sequelize.query(`
      SELECT COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END), 0) AS oqim
      FROM kassa WHERE sana BETWEEN :from AND :to
    `, { replacements: { from, to }, type: sequelize.QueryTypes.SELECT });
    const sofKassaOqimi = Number(kassaOqimRow?.oqim || 0);

    // ── Top agentlar (savdo summasi + reja bajarish %) — joriy period ──
    const topAgentRows = await sequelize.query(`
      SELECT a.id, a.fullname, a.plan_summa,
        COALESCE(SUM(ar.jami_summa), 0) AS savdo
      FROM agent a
      LEFT JOIN ariza ar ON ar.agent_id = a.id
        AND ar.turi = 'sotish' AND ar.deletedAt IS NULL AND ar.holat <> 'bekor'
        AND ar.createdAt BETWEEN :from AND :to
      WHERE a.deletedAt IS NULL AND a.faol = 1
      GROUP BY a.id, a.fullname, a.plan_summa
      ORDER BY savdo DESC
      LIMIT 5
    `, { replacements: { from, to }, type: sequelize.QueryTypes.SELECT });
    const top_agentlar = topAgentRows.map(r => {
      const savdo = Number(r.savdo || 0);
      const plan  = Number(r.plan_summa || 0) * REJA_KOEF;
      return {
        id: r.id,
        fullname: r.fullname || '—',
        savdo,
        plan,
        foiz: plan > 0 ? Math.min(100, +((savdo / plan) * 100).toFixed(1)) : 0,
      };
    });

    // ── Kassa va Bank balansi (kirim − chiqim, tolov_usul bo'yicha) ──
    const kassaRows = await sequelize.query(`
      SELECT tolov_usul,
        COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END), 0) AS balans
      FROM kassa GROUP BY tolov_usul
    `, { type: sequelize.QueryTypes.SELECT });
    const kassaMap = {};
    kassaRows.forEach(r => { kassaMap[r.tolov_usul] = Number(r.balans || 0); });
    const moliya = {
      naqd: kassaMap.naqt || 0,
      bank: (kassaMap.bank || 0) + (kassaMap.karta || 0),
      jami: (kassaMap.naqt || 0) + (kassaMap.bank || 0) + (kassaMap.karta || 0),
    };

    // ── BUGUNGI operatsiyalar (jonli snapshot) ──
    // Sana-vaqt ustunlari UTC'da saqlanadi → mahalliy sanaga o'giriladi;
    // DATEONLY ustunlar (marshrut_reja, tashrif) esa allaqachon mahalliy sana.
    const LOKAL = col => `DATE(CONVERT_TZ(${col}, '+00:00', :tz)) = :bugun`;
    const [bugunRow] = await sequelize.query(`
      SELECT
        (SELECT COUNT(*) FROM ariza WHERE turi='sotish' AND deletedAt IS NULL AND ${LOKAL('createdAt')}) AS zakaz_soni,
        (SELECT COUNT(*) FROM ariza WHERE turi='sotish' AND deletedAt IS NULL AND holat='yetkazildi' AND ${LOKAL('yetkazilgan_sana')}) AS yetkazilgan,
        (SELECT COALESCE(SUM(summa),0) FROM kassa WHERE tur='kirim' AND kategoriya='mijoz_tolov' AND ${LOKAL('sana')}) AS tolov_summa,
        (SELECT COUNT(DISTINCT agent_id) FROM agent_location WHERE rol='agent' AND ${LOKAL('sana')}) AS faol_agentlar,
        (SELECT COUNT(*) FROM mijoz WHERE deletedAt IS NULL AND ${LOKAL('createdAt')}) AS yangi_mijozlar,
        (SELECT COALESCE(SUM(jami_summa),0) FROM ariza WHERE turi='sotish' AND deletedAt IS NULL AND holat<>'bekor' AND ${LOKAL('createdAt')}) AS zakaz_summa,
        (SELECT COUNT(*) FROM marshrut_reja WHERE sana = :bugun) AS reja_tashrif,
        (SELECT COUNT(*) FROM tashrif WHERE sana = :bugun AND checkin_vaqt IS NOT NULL) AS tashrif
    `, { replacements: { tz: TZ, bugun: BUGUN }, type: sequelize.QueryTypes.SELECT });
    const bugun = {
      zakaz_soni:    Number(bugunRow?.zakaz_soni || 0),
      yetkazilgan:   Number(bugunRow?.yetkazilgan || 0),
      tolov_summa:   Number(bugunRow?.tolov_summa || 0),
      faol_agentlar: Number(bugunRow?.faol_agentlar || 0),
      yangi_mijozlar: Number(bugunRow?.yangi_mijozlar || 0),
      zakaz_summa:   Number(bugunRow?.zakaz_summa || 0),
      reja_tashrif:  Number(bugunRow?.reja_tashrif || 0),
      tashrif:       Number(bugunRow?.tashrif || 0),
    };

    // ── OGOHLANTIRISHLAR (amaliy signallar) ──
    const kamQoldiq = await sequelize.query(`
      SELECT t.id, t.nomi, COALESCE(SUM(tr.donada),0) AS qoldiq
      FROM tovar t LEFT JOIN tovar_register tr ON tr.tovar_id = t.id
      WHERE t.faol = 1 AND t.deletedAt IS NULL
      GROUP BY t.id, t.nomi HAVING qoldiq < 20
      ORDER BY qoldiq ASC LIMIT 6
    `, { type: sequelize.QueryTypes.SELECT });
    const muddatiYaqin = await sequelize.query(`
      SELECT pq.tovar_nomi, pq.yaroqlilik_muddati,
        DATEDIFF(pq.yaroqlilik_muddati, :bugun) AS qolgan_kun
      FROM prixod_qator pq
      WHERE pq.yaroqlilik_muddati IS NOT NULL
        AND pq.yaroqlilik_muddati < DATE_ADD(:bugun, INTERVAL 30 DAY)
        AND pq.yaroqlilik_muddati >= :bugun
      ORDER BY pq.yaroqlilik_muddati ASC LIMIT 6
    `, { replacements: { bugun: BUGUN }, type: sequelize.QueryTypes.SELECT });
    const ogohlantirishlar = {
      kam_qoldiq: kamQoldiq.map(r => ({ id: r.id, nomi: r.nomi, qoldiq: Number(r.qoldiq || 0) })),
      muddati_yaqin: muddatiYaqin.map(r => ({
        tovar_nomi: r.tovar_nomi, muddat: r.yaroqlilik_muddati, qolgan_kun: Number(r.qolgan_kun || 0),
      })),
      muddati_otgan_qarz: Number(muddatRow?.muddati_otgan || 0),
    };

    // ── SPARKLINES: har bir KPI kartasi uchun so'nggi 14 kunlik kunlik qator ──
    const SPARK_DAYS = 14;
    const days = lastNDays(SPARK_DAYS);
    const sparkFrom = new Date(); sparkFrom.setDate(sparkFrom.getDate() - (SPARK_DAYS - 1)); sparkFrom.setHours(0,0,0,0);

    const [
      yalpiFoydaDailyRows, kassaOqimDailyRows, kirimSummaDailyRows,
      prixodDailyRows, mijozDailyRows, agentDailyRows, yetkazuvchiDailyRows, omborDailyRows,
      sotuvDailyRows,
    ] = await Promise.all([
      // Yalpi foyda (taxminiy, o'rtacha kirim narxi asosida) — kunlik yetkazilgan ariza summasi
      sequelize.query(`
        SELECT DATE(createdAt) AS d, COALESCE(SUM(jami_summa), 0) AS v
        FROM ariza WHERE turi='sotish' AND holat='yetkazildi' AND deletedAt IS NULL
          AND createdAt >= :from
        GROUP BY DATE(createdAt)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),

      // Sof kassa oqimi — kunlik (kirim - chiqim), kumulyativ emas
      sequelize.query(`
        SELECT DATE(sana) AS d, COALESCE(SUM(CASE WHEN tur='kirim' THEN summa ELSE -summa END), 0) AS v
        FROM kassa WHERE sana >= :from GROUP BY DATE(sana)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),

      // Ombor kirim summasi (prixod/xarid) — kunlik
      sequelize.query(`
        SELECT DATE(sana) AS d, COALESCE(SUM(summa), 0) AS v
        FROM tovar_register WHERE tur='kirim' AND manba_tur='prixod' AND sana >= :from
        GROUP BY DATE(sana)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),

      // Tasdiqlangan prixodlar soni — kunlik
      sequelize.query(`
        SELECT DATE(sana) AS d, COUNT(*) AS v
        FROM prixod WHERE holat='tasdiqlangan' AND sana >= :from GROUP BY DATE(sana)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),

      // Yangi mijozlar — kunlik, kumulyativ (o'sib boruvchi jami)
      sequelize.query(`
        SELECT DATE(createdAt) AS d, COUNT(*) AS v
        FROM mijoz WHERE deletedAt IS NULL AND createdAt >= :from GROUP BY DATE(createdAt)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),

      // Faol agentlar — kunlik GPS faolligi (distinct)
      sequelize.query(`
        SELECT DATE(sana) AS d, COUNT(DISTINCT agent_id) AS v
        FROM agent_location WHERE rol='agent' AND sana >= :from GROUP BY DATE(sana)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),

      // Yetkazuvchilar — statik (o'zgarmaydi), bo'sh qatordan flat chiziq hosil bo'ladi
      Promise.resolve([]),

      // Ombor qoldig'i — kunlik dona harakati (chiqim manfiy), kumulyativ trend
      sequelize.query(`
        SELECT DATE(sana) AS d, COALESCE(SUM(donada), 0) AS v
        FROM tovar_register WHERE sana >= :from GROUP BY DATE(sana)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),

      // Sotuv — kunlik summa, buyurtma soni va xarid qilgan mijozlar
      sequelize.query(`
        SELECT DATE(createdAt) AS d, COALESCE(SUM(jami_summa), 0) AS v,
          COUNT(*) AS c, COUNT(DISTINCT mijoz_id) AS m
        FROM ariza WHERE turi='sotish' AND holat<>'bekor' AND deletedAt IS NULL
          AND createdAt >= :from
        GROUP BY DATE(createdAt)
      `, { replacements: { from: sparkFrom }, type: sequelize.QueryTypes.SELECT }),
    ]);

    // Kumulyativ qatorlar uchun: kunlik delta'larni o'sib boruvchi jamiga aylantirish
    function cumulative(dailyArr, baseline = 0) {
      let acc = baseline;
      return dailyArr.map(v => { acc += v; return acc; });
    }

    const sparklines = {
      yalpi_foyda:     alignDaily(yalpiFoydaDailyRows, days, 'd', 'v'),
      sof_kassa_oqimi: cumulative(alignDaily(kassaOqimDailyRows, days, 'd', 'v')),
      kirim_summa:     alignDaily(kirimSummaDailyRows, days, 'd', 'v'),
      prixod_son:      alignDaily(prixodDailyRows, days, 'd', 'v'),
      mijoz_son:       cumulative(alignDaily(mijozDailyRows, days, 'd', 'v'), Math.max(0, mijozSon - alignDaily(mijozDailyRows, days, 'd', 'v').reduce((a,b)=>a+b,0))),
      agent_son:       alignDaily(agentDailyRows, days, 'd', 'v'),
      yetkazuvchi_son: days.map(() => yetkazuvchiSon),
      ombor_summa:     cumulative(alignDaily(omborDailyRows, days, 'd', 'v'), Math.max(0, omborQoldiqDona - alignDaily(omborDailyRows, days, 'd', 'v').reduce((a,b)=>a+b,0))),
      sotuv_summa:     alignDaily(sotuvDailyRows, days, 'd', 'v'),
      sotuv_son:       alignDaily(sotuvDailyRows, days, 'd', 'c'),
      akb:             alignDaily(sotuvDailyRows, days, 'd', 'm'),
    };
    const kunlikSon = sparklines.sotuv_son;
    sparklines.ortacha_chek = sparklines.sotuv_summa.map((v, i) => kunlikSon[i] ? v / kunlikSon[i] : 0);

    // ═══════════ TAHLIL DIAGRAMMALARI ═══════════
    const kechaFrom = yarimTun(1);
    const kassaFrom = yarimTun(13);
    const [soatlikRows, faollikRows, kassaKunRows, [mijozHolatRow], qaytaJalbRows] = await Promise.all([
      // Bugun va kecha — soatma-soat sotuv (bosh banner grafigi)
      sequelize.query(`
        SELECT DATE_FORMAT(CONVERT_TZ(createdAt, '+00:00', :tz), '%Y-%m-%d') AS d,
          HOUR(CONVERT_TZ(createdAt, '+00:00', :tz)) AS h,
          COALESCE(SUM(jami_summa), 0) AS summa, COUNT(*) AS son
        FROM ariza
        WHERE turi = 'sotish' AND deletedAt IS NULL AND holat <> 'bekor' AND createdAt >= :from
        GROUP BY d, h
      `, { replacements: { tz: TZ, from: kechaFrom }, type: Q }),

      // Faollik xaritasi: so'nggi 8 hafta, hafta kuni × soat
      sequelize.query(`
        SELECT DAYOFWEEK(CONVERT_TZ(createdAt, '+00:00', :tz)) AS dw,
          HOUR(CONVERT_TZ(createdAt, '+00:00', :tz)) AS h,
          COUNT(*) AS son, COALESCE(SUM(jami_summa), 0) AS summa
        FROM ariza
        WHERE turi = 'sotish' AND deletedAt IS NULL AND holat <> 'bekor'
          AND createdAt >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 56 DAY)
        GROUP BY dw, h
      `, { replacements: { tz: TZ }, type: Q }),

      // Kassa oqimi: so'nggi 14 kun, kirim va chiqim alohida
      sequelize.query(`
        SELECT DATE_FORMAT(CONVERT_TZ(sana, '+00:00', :tz), '%Y-%m-%d') AS d,
          COALESCE(SUM(CASE WHEN tur = 'kirim'  THEN summa ELSE 0 END), 0) AS kirim,
          COALESCE(SUM(CASE WHEN tur = 'chiqim' THEN summa ELSE 0 END), 0) AS chiqim
        FROM kassa WHERE sana >= :from
        GROUP BY d
      `, { replacements: { tz: TZ, from: kassaFrom }, type: Q }),

      // Mijozlar bazasi salomatligi — oxirgi xariddan beri o'tgan vaqt bo'yicha
      sequelize.query(`
        SELECT COUNT(*) AS jami,
          SUM(CASE WHEN x.oxirgi IS NULL THEN 1 ELSE 0 END) AS hech,
          SUM(CASE WHEN x.oxirgi >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS faol,
          SUM(CASE WHEN x.oxirgi <  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
                    AND x.oxirgi >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS sust,
          SUM(CASE WHEN x.oxirgi <  DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY) THEN 1 ELSE 0 END) AS yoqotilgan
        FROM (
          SELECT m.id, MAX(a.createdAt) AS oxirgi
          FROM mijoz m
          LEFT JOIN ariza a ON a.mijoz_id = m.id AND a.turi = 'sotish'
            AND a.deletedAt IS NULL AND a.holat <> 'bekor'
          WHERE m.deletedAt IS NULL AND m.faol = 1
          GROUP BY m.id
        ) x
      `, { type: Q }),

      // Qayta jalb qilish kerak: 30+ kun xarid qilmagan eng qimmatli mijozlar
      sequelize.query(`
        SELECT m.id, m.nomi, m.telefon,
          DATEDIFF(UTC_TIMESTAMP(), MAX(a.createdAt)) AS kun,
          COALESCE(SUM(a.jami_summa), 0) AS jami
        FROM mijoz m
        JOIN ariza a ON a.mijoz_id = m.id AND a.turi = 'sotish'
          AND a.deletedAt IS NULL AND a.holat <> 'bekor'
        WHERE m.deletedAt IS NULL AND m.faol = 1
        GROUP BY m.id, m.nomi, m.telefon
        HAVING MAX(a.createdAt) < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)
        ORDER BY jami DESC
        LIMIT 4
      `, { type: Q }),
    ]);

    const kechaKey = kunKey(kechaFrom);
    const bugun_soatlik = { bugun: Array(24).fill(0), kecha: Array(24).fill(0), soat: new Date().getHours() };
    soatlikRows.forEach(r => {
      const qator = r.d === BUGUN ? bugun_soatlik.bugun : r.d === kechaKey ? bugun_soatlik.kecha : null;
      if (qator) qator[Number(r.h)] += Number(r.summa || 0);
    });

    const faollik = faollikRows.map(r => ({
      dw: Number(r.dw), h: Number(r.h), son: Number(r.son || 0), summa: Number(r.summa || 0),
    }));

    const kassaMapKun = {};
    kassaKunRows.forEach(r => { kassaMapKun[r.d] = r; });
    const kassa_kunlik = Array.from({ length: 14 }, (_, i) => {
      const k = kunKey(yarimTun(13 - i));
      return { sana: k, kirim: Number(kassaMapKun[k]?.kirim || 0), chiqim: Number(kassaMapKun[k]?.chiqim || 0) };
    });

    const mijoz_holati = {
      jami:       Number(mijozHolatRow?.jami || 0),
      faol:       Number(mijozHolatRow?.faol || 0),
      sust:       Number(mijozHolatRow?.sust || 0),
      yoqotilgan: Number(mijozHolatRow?.yoqotilgan || 0),
      hech:       Number(mijozHolatRow?.hech || 0),
      qayta_jalb: qaytaJalbRows.map(r => ({
        id: r.id, nomi: r.nomi, telefon: r.telefon || '', kun: Number(r.kun || 0), jami: Number(r.jami || 0),
      })),
    };

    // ── TOP QARZDORLAR ──
    const qarzRows = await sequelize.query(`
      SELECT id, nomi, telefon, -balans AS qarz
      FROM mijoz WHERE balans < 0 AND deletedAt IS NULL
      ORDER BY balans ASC LIMIT 5
    `, { type: sequelize.QueryTypes.SELECT });
    const top_qarzdorlar = qarzRows.map(r => ({
      id: r.id, nomi: r.nomi, telefon: r.telefon || '',
      qarz: Number(r.qarz || 0),
    }));

    res.send({
      // KPI kartochkalar
      kpi: {
        kirim_summa:     curSumma,
        kirim_summa_osish: kirimOsish,
        prixod_son:      prixodSon,
        prixod_osish:    prixodOsish,
        mijoz_son:       mijozSon,
        faol_mijoz:      mijozFaol,
        agent_son:       agentSon,
        yetkazuvchi_son: yetkazuvchiSon,
        ombor_dona:      Math.max(0, omborQoldiqDona),
        ombor_summa:     Math.max(0, omborQoldiqSumma),
      },

      // Grafiklar — period'ga mos granularity (soat/kun/oy), bo'sh nuqtalar 0 bilan to'ldiriladi
      oylik_trend: (() => {
        const map = {};
        oylikTrend.forEach(r => { map[String(r.oy)] = r; });
        return trendCfg.buckets.map(b => ({
          oy:             b.key,
          summa:          Number(map[b.key]?.summa  || 0),
          dona:           Number(map[b.key]?.dona   || 0),
          son:            Number(map[b.key]?.son    || 0),
          oldingi_summa:  Number(map[b.prev]?.summa || 0),
          oldingi_dona:   Number(map[b.prev]?.dona  || 0),
          oldingi_son:    Number(map[b.prev]?.son   || 0),
        }));
      })(),

      turkum_stat: turkumStat.map(r => ({
        turkum: r.turkum || 'Boshqa',
        summa:  Number(r.summa || 0),
        dona:   Number(r.dona  || 0),
        foiz:   turkumTotal ? +((Number(r.summa||0)/turkumTotal*100).toFixed(1)) : 0,
      })),

      top_tovarlar: topTovarlar.map(r => ({
        tovar_id:   r.tovar_id,
        tovar_nomi: r.tovar_nomi,
        turkum:     r.turkum || 'Boshqa',
        summa:      Number(r.summa || 0),
        dona:       Number(r.dona  || 0),
      })),

      // So'nggi prixodlar
      oxirgi_prixodlar: oxirgiPrixodlar.map(p => ({
        id:           p.id,
        hujjat_raqam: p.hujjat_raqam || `#${p.id}`,
        sana:         p.sana,
        yetkazuvchi:  p.yetkazuvchi || '—',
        jami_summa:   Number(p.jami_summa || 0),
        holat:        p.holat,
        ombor:        p.ombor || '—',
      })),

      // Debitorlik (qarzdorlik)
      debitorlik: {
        jami_qarz:      Number(debitorRow?.jami_qarz || 0),
        qarzdor_soni:   Number(debitorRow?.qarzdor_soni || 0),
        muddati_otgan:  Number(muddatRow?.muddati_otgan || 0),
      },

      // Savdo rejasi KPI
      savdo_rejasi: {
        plan:   jamiPlan,
        fakt:   sotuvSumma,
        foiz:   savdoRejaFoiz,
      },

      // Foyda (yalpi foyda = sotuv − tannarx; sof kassa oqimi = kirim − chiqim)
      foyda: {
        yalpi_foyda:        yalpiFoydaCur,
        yalpi_foyda_osish:  yalpiFoydaOsish,
        sof_kassa_oqimi:    sofKassaOqimi,
      },

      // Sotuv: summa, buyurtmalar, o'rtacha chek, AKB/qamrov, yetkazish va qaytarish darajasi
      sotuv,

      // Jonli distributsiya oqimi (davrga bog'liq emas) + kechikkanlar
      distributsiya_oqimi,

      // Dostavchilar: ochiq yuk va bugun yetkazilgani
      dostavchilar,

      // Hududlar va to'lov turlari bo'yicha sotuv (joriy davr)
      hudud_stat,
      tolov_turlari,

      // Ombor salomatligi (faol tovarlar qoldiq bo'yicha)
      ombor_holati,

      // So'nggi buyurtmalar lentasi
      oxirgi_buyurtmalar,

      // Tahlil: bugun/kecha soatlik, faollik xaritasi, kassa oqimi, mijozlar salomatligi
      bugun_soatlik,
      faollik,
      kassa_kunlik,
      mijoz_holati,


      // Top agentlar (sales leaderboard)
      top_agentlar,

      // Kassa / bank balansi (cashflow)
      moliya,

      // Bugungi jonli operatsiyalar
      bugun,

      // Amaliy ogohlantirishlar (kam qoldiq, muddati yaqin, muddati o'tgan qarz)
      ogohlantirishlar,

      // Eng qarzdor mijozlar
      top_qarzdorlar,

      // Oylik kirim trendi o'sish % (o'tgan oyga nisbatan)
      trend_osish: kirimOsish,

      // KPI kartalar uchun so'nggi 14 kunlik mini-trend (sparkline)
      sparklines,

      period,
      yangilangan: new Date().toISOString(),
    });
  };
}

module.exports = new DashboardController();
