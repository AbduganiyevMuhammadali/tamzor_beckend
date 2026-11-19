/**
 * ISHLAB CHIQARISH — kichik sex jarayoni (partiya = IC-2026-0001):
 *
 *   1. Qoralama   — reja: qaysi xom ashyodan qancha, qanday xarajat, nima chiqishi kutiladi.
 *   2. Jarayonda  — "Boshlash": xom ashyo O'Z omboridan chiqadi (tovar_register chiqim, o'rtacha tannarxda).
 *                   Mavjud (boshqa buyurtmalarga band qilinmagan) miqdordan ko'p berib bo'lmaydi.
 *   3. Yakunlandi — "Yakunlash": haqiqatda chiqqan sof mahsulot (va qo'shimcha mahsulot) kiritiladi,
 *                   tannarx hisoblanadi (utils/ishlab.utils.js), mahsulot skladga KIRIM bo'ladi —
 *                   tannarxi bilan; kassadan to'langan xarajatlar kassaga chiqim bo'ladi.
 *   Bekor        — qoralama/jarayonda: xom ashyo omborga qaytadi; yakunlangan — mahsulot hali omborda
 *                   bo'lsagina (u chiqib, xom ashyo qaytadi, bu hujjat yozgan kassa yozuvlari o'chadi).
 *
 * Omborlar tovar TURI bo'yicha (ombor.utils turOmbori): xom ashyo turidagi tovar "Xom ashyo ombori"dan
 * chiqadi / unga kiradi (yarim tayyor mahsulot ham), savdo tovari — asosiy skladdan / skladga.
 * Qator qaysi omborda harakat qilgani ishlab_chiqarish_qator.ombor'da saqlanadi — bekor qilinganda o'sha joyga.
 *
 * Tovar harakati tovar_register'da manba_tur='ishlab_chiqarish', manba_id = hujjat id:
 *   xom ashyo — tur 'chiqim'; mahsulot — tur 'kirim' (kirim_narx = tannarx, tannarx xaritasi shuni o'qiydi);
 *   bekor qilinganda — 'qaytarma_kirim' / 'qaytarma_chiqim' (tannarx o'rtachasiga ta'sir qilmaydi).
 * Kassa: kategoriya 'ishlab_chiqarish' — foyda-zararda operatsion xarajat emas (mahsulot tannarxida).
 */
const { Op } = require('sequelize');
const sequelize = require('../../db/db-sequelize');
const { IshlabModel, IshlabQatorModel, IshlabXarajatModel } = require('../../models/ishlabChiqarish.model');
const TovarModel = require('../../models/tovar.model');
const TovarRegisterModel = require('../../models/tovar_register.model');
const KassaModel = require('../../models/kassa.model');
const HttpException = require('../../utils/HttpException.utils');
const { tovarlarniQulfla, keyingiTartib, maksRaqam } = require('../../utils/qulf.utils');
const { ASOSIY_OMBOR, XOM_ASHYO_OMBOR, turOmbori, omborNomi } = require('../../utils/ombor.utils');
const { tartibsizQoldiq, tartibla } = require('../../utils/omborKochirish.utils');
const { tannarxXaritasi } = require('../../utils/tahlil.utils');
const { narxMap } = require('../../utils/avtolavka.utils');
const { mavjudQoldiq } = require('../../utils/zaxira.utils');
const { tannarxHisobla, yax, n } = require('../../utils/ishlab.utils');

const MANBA = 'ishlab_chiqarish';
const TURLAR = ['xom_ashyo', 'mahsulot', 'qoshimcha'];
const XARAJAT_TAKLIF = ['Ish haqi', 'Elektr energiya', 'Gaz / yoqilg\'i', 'Qadoq', 'Transport', 'Sex ijarasi'];
const INCLUDE = [
  { model: IshlabQatorModel, as: 'qatorlar' },
  { model: IshlabXarajatModel, as: 'xarajatlar' },
];
const tartib = [[{ model: IshlabQatorModel, as: 'qatorlar' }, 'id', 'ASC'], [{ model: IshlabXarajatModel, as: 'xarajatlar' }, 'id', 'ASC']];

/* Partiya raqami: hujjat_raqam hisoblagichidan (parallel yaratishda ham takrorlanmaydi;
   birinchi marta mavjud IC-YYYY-NNNN larning eng kattasidan davom etadi) */
async function raqamYarat(t) {
  const yil = new Date().getFullYear();
  const prefiks = `IC-${yil}`;
  const k = await keyingiTartib(prefiks, () => maksRaqam('ishlab_chiqarish', prefiks, t), t);
  return `${prefiks}-${String(k).padStart(4, '0')}`;
}

async function topHujjat(id, t) {
  const h = await IshlabModel.findByPk(id, { include: INCLUDE, order: tartib, transaction: t, lock: t ? t.LOCK.UPDATE : undefined });
  if (!h) throw new HttpException(404, 'Ishlab chiqarish hujjati topilmadi');
  return h;
}

/* Kelgan qatorlarni tekshirish: tovar bor, tur to'g'ri, miqdor manfiy emas */
async function qatorlarniOl(royxat, { qaysi = TURLAR, t } = {}) {
  const kirgan = (Array.isArray(royxat) ? royxat : []).filter(q => qaysi.includes(q.tur));
  const ids = [...new Set(kirgan.map(q => Number(q.tovar_id)).filter(Boolean))];
  const tovarlar = ids.length ? await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'nomi', 'turkum', 'olchov_birligi', 'turi'], raw: true, transaction: t }) : [];
  const tm = Object.fromEntries(tovarlar.map(x => [x.id, x]));
  return kirgan.map((q, i) => {
    const tv = tm[Number(q.tovar_id)];
    if (!TURLAR.includes(q.tur)) throw new HttpException(400, `${i + 1}-qator: tur noto'g'ri`);
    if (!tv) throw new HttpException(400, `${i + 1}-qator: tovar tanlanmagan yoki topilmadi`);
    const miqdor = n(q.miqdor);
    if (miqdor < 0) throw new HttpException(400, `"${tv.nomi}": miqdor manfiy bo'lmaydi`);
    return {
      tur: q.tur, tovar_id: tv.id, tovar_nomi: tv.nomi, turkum: tv.turkum || null, olchov: tv.olchov_birligi || 'kg', ombor: turOmbori(tv.turi),
      reja_miqdor: q.reja_miqdor !== undefined ? n(q.reja_miqdor) : miqdor, miqdor,
      narx: Math.max(0, n(q.narx)), optom_narx: Math.max(0, n(q.optom_narx)), chakana_narx: Math.max(0, n(q.chakana_narx)),
    };
  });
}
/* Qatorlar / xarajatlar soni va sana tekshiruvi (tranzaksiyadan oldin) */
const MAX_QATOR = 200;
function kirishniTekshir(body = {}) {
  if (Array.isArray(body.qatorlar) && body.qatorlar.length > MAX_QATOR) throw new HttpException(400, `Qatorlar soni ${MAX_QATOR} tadan oshmasligi kerak`);
  if (Array.isArray(body.xarajatlar) && body.xarajatlar.length > MAX_QATOR) throw new HttpException(400, `Xarajatlar soni ${MAX_QATOR} tadan oshmasligi kerak`);
  if (body.sana && Number.isNaN(new Date(body.sana).getTime())) throw new HttpException(400, 'Sana noto\'g\'ri formatda');
}

/* Xom ashyo tovarlarini TRANZAKSIYA BOSHIDA qulflash (hujjatdagi va so'rovda kelganlari).
   InnoDB REPEATABLE READ: snapshot birinchi oddiy SELECT da olinadi — qulf undan OLDIN olinmasa,
   keyingi qoldiq o'qishlari qulfdan oldingi (eskirgan) holatni ko'radi va xom ashyo minusga tushishi mumkin.
   topHujjat (FOR UPDATE) va bu funksiya — locking read, snapshot yaratmaydi. */
async function xomQulfla(h, body, t) {
  const xomIds = q => (Array.isArray(q) ? q : []).filter(x => x && x.tur === 'xom_ashyo').map(x => Number(x.tovar_id));
  await tovarlarniQulfla([...xomIds(h ? h.qatorlar : []), ...xomIds(body && body.qatorlar)], t);
}

function xarajatlarniOl(royxat) {
  return (Array.isArray(royxat) ? royxat : [])
    .map(x => ({ nomi: String(x.nomi || '').trim().slice(0, 120), summa: Math.max(0, n(x.summa)), kassadan: !!x.kassadan,
      tolov_usul: ['naqt', 'karta', 'bank'].includes(x.tolov_usul) ? x.tolov_usul : 'naqt', kassa_id: x.kassa_id || null }))
    .filter(x => x.nomi && x.summa > 0);
}

/* Register yozuvi */
function reg(h, q, { tur, ishora, narx, summa, sana, optom = 0, chakana = 0 }) {
  return {
    tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum || null, ombor: q.ombor || h.ombor,
    tur, manba_tur: MANBA, manba_id: h.id,
    donada: ishora * n(q.miqdor), bloklarda: 0, qutilarda: 0, hajm: 0,
    kirim_narx: narx, sotuv_narx: chakana, optom_narx: optom, chakana_narx: chakana,
    summa: ishora * yax(summa), sana,
  };
}

/* Qator ombori — tovarning HOZIRGI turi bo'yicha (boshlash va yakunlash paytida yangilanadi) */
async function omborlarniBelgila(qatorlar, t) {
  const ids = [...new Set(qatorlar.map(q => q.tovar_id))];
  if (!ids.length) return;
  const tv = await TovarModel.findAll({ where: { id: ids }, attributes: ['id', 'turi'], raw: true, transaction: t, paranoid: false });
  const tm = Object.fromEntries(tv.map(x => [x.id, x.turi]));
  for (const q of qatorlar) {
    const om = turOmbori(tm[q.tovar_id]);
    if (q.ombor !== om) await q.update({ ombor: om }, { transaction: t });
  }
}

/* Har ombor bo'yicha mavjud qoldiq: Map(ombor → Map(tovar_id → { mavjud })) */
async function omborlarBoyicha(juftlar, t) {
  const guruh = {};
  for (const x of juftlar) (guruh[x.ombor] ||= new Set()).add(Number(x.tovar_id));
  const natija = new Map();
  for (const [om, ids] of Object.entries(guruh)) natija.set(om, await mavjudQoldiq({ tovarIds: [...ids], ombor: om, transaction: t || undefined }));
  return natija;
}

/* 2-bosqich: xom ashyo o'z omboridan chiqadi (o'rtacha tannarxda) */
async function boshla(h, t) {
  const xom = h.qatorlar.filter(q => q.tur === 'xom_ashyo' && n(q.miqdor) > 0);
  if (!xom.length) throw new HttpException(400, 'Xom ashyo kiritilmagan');
  await omborlarniBelgila(xom, t);

  // Xom ashyo tovarlari qulflanadi: parallel boshlash/buyurtmalar bir xil qoldiqni ikki marta ishlatmasin.
  // Chaqiruvchilar qulfni tranzaksiya boshida (xomQulfla) oladi — bu yerda qayta chaqiruv zararsiz.
  await tovarlarniQulfla(xom.map(q => q.tovar_id), t);
  const kerak = {};
  for (const q of xom) {
    const k = `${q.ombor}|${q.tovar_id}`;
    kerak[k] = { tovar_id: q.tovar_id, ombor: q.ombor, nomi: q.tovar_nomi, olchov: q.olchov, dona: (kerak[k]?.dona || 0) + n(q.miqdor) };
  }
  const [mavjud, narx] = await Promise.all([omborlarBoyicha(Object.values(kerak), t), tannarxXaritasi(new Date())]);
  const yetmaydi = Object.values(kerak)
    .map(x => ({ ...x, bor: n(mavjud.get(x.ombor)?.get(Number(x.tovar_id))?.mavjud) }))
    .filter(x => x.dona > x.bor + 0.0005);
  if (yetmaydi.length) {
    throw new HttpException(400, 'Xom ashyo yetarli emas: ' + yetmaydi.map(x => `"${x.nomi}" kerak ${yax(x.dona, 3)} ${x.olchov}, ${omborNomi(x.ombor)}da mavjud ${yax(x.bor, 3)}`).join('; '));
  }
  const sana = new Date();
  const yozuvlar = [];
  for (const q of xom) {
    // Tannarx: so'nggi 90 kunlik kirimlarning og'irlikli o'rtachasi (tahlil.utils bilan bir xil);
    // noma'lum bo'lsa — qoralamada qo'lda kiritilgani
    const nx = yax(n(narx[q.tovar_id]) || n(q.narx));
    if (!(nx > 0)) throw new HttpException(400, `"${q.tovar_nomi}" tannarxi noma'lum — avval kirim (prixod) qiling yoki qatorda narxini kiriting`);
    const summa = yax(n(q.miqdor) * nx);
    await q.update({ narx: nx, summa }, { transaction: t });
    yozuvlar.push(reg(h, q, { tur: 'chiqim', ishora: -1, narx: nx, summa, sana }));
  }
  await TovarRegisterModel.bulkCreate(yozuvlar, { transaction: t });
  await h.update({
    holat: 'jarayonda', boshlangan_vaqt: sana,
    xom_ashyo_miqdor: xom.reduce((s, q) => s + n(q.miqdor), 0), xom_ashyo_summa: xom.reduce((s, q) => s + n(q.summa), 0),
  }, { transaction: t });
}

/* Mahsulot / qo'shimcha qatorlari va xarajatlarni almashtirish (xom ashyo jarayonda o'zgarmaydi).
   Yangilangan hujjatni (qatorlari bilan) qaytaradi. */
async function chiqishniYoz(h, body, t, { xomHam = false } = {}) {
  if (body.taqsimlash && ['qiymat', 'miqdor'].includes(body.taqsimlash)) h.taqsimlash = body.taqsimlash;
  if (body.izoh !== undefined) h.izoh = body.izoh || null;
  if (body.sana) h.sana = new Date(body.sana);
  await h.save({ transaction: t });
  if (Array.isArray(body.qatorlar)) {
    const qaysi = xomHam ? TURLAR : ['mahsulot', 'qoshimcha'];
    const yangi = await qatorlarniOl(body.qatorlar, { qaysi, t });
    await IshlabQatorModel.destroy({ where: { hujjat_id: h.id, tur: qaysi }, transaction: t });
    await IshlabQatorModel.bulkCreate(yangi.map(q => ({ ...q, hujjat_id: h.id })), { transaction: t });
  }
  if (Array.isArray(body.xarajatlar)) {
    // Kassaga allaqachon yozilgan xarajat o'zgarmaydi (kassa_id saqlanadi)
    const eski = await IshlabXarajatModel.findAll({ where: { hujjat_id: h.id }, transaction: t });
    const yozilgan = eski.filter(x => x.kassa_id);
    await IshlabXarajatModel.destroy({ where: { hujjat_id: h.id, kassa_id: null }, transaction: t });
    const yangi = xarajatlarniOl(body.xarajatlar).filter(x => !x.kassa_id || !yozilgan.some(e => e.kassa_id === x.kassa_id));
    await IshlabXarajatModel.bulkCreate(yangi.map(x => ({ ...x, kassa_id: null, hujjat_id: h.id })), { transaction: t });
  }
  return topHujjat(h.id, t);
}

/* 3-bosqich: tannarx hisoblanadi, mahsulot omborga kiradi, kassadan to'langan xarajat kassaga yoziladi */
async function yakunla(h, user, t) {
  const qatorlar = h.qatorlar.map(q => q.get({ plain: true }));
  const xarajatlar = h.xarajatlar.map(x => x.get({ plain: true }));
  if (qatorlar.some(q => q.tur === 'mahsulot' && !(n(q.miqdor) > 0))) throw new HttpException(400, 'Har bir mahsulot uchun haqiqatda chiqqan miqdorni kiriting');
  const H = tannarxHisobla(qatorlar, xarajatlar, h.taqsimlash);
  if (H.xato) throw new HttpException(400, H.xato);
  // Savdo tovari — asosiy skladga, xom ashyo turidagi (yarim tayyor) mahsulot — Xom ashyo omboriga
  await omborlarniBelgila(h.qatorlar.filter(q => q.tur !== 'xom_ashyo'), t);

  const sana = new Date();
  const yozuvlar = [];
  for (const m of H.mahsulotlar) {
    const q = h.qatorlar[m.i];
    await q.update({ narx: m.narx, summa: m.summa, ulush: m.ulush }, { transaction: t });
    yozuvlar.push(reg(h, q, { tur: 'kirim', ishora: 1, narx: m.narx, summa: m.summa, sana, optom: n(q.optom_narx), chakana: n(q.chakana_narx) }));
  }
  for (const q of h.qatorlar.filter(x => x.tur === 'qoshimcha' && n(x.miqdor) > 0)) {
    const summa = yax(n(q.miqdor) * n(q.narx));
    await q.update({ summa }, { transaction: t });
    yozuvlar.push(reg(h, q, { tur: 'kirim', ishora: 1, narx: n(q.narx), summa, sana, optom: n(q.optom_narx), chakana: n(q.chakana_narx) }));
  }
  await TovarRegisterModel.bulkCreate(yozuvlar, { transaction: t });

  for (const x of h.xarajatlar.filter(x => x.kassadan && !x.kassa_id)) {
    const k = await KassaModel.create({
      tur: 'chiqim', kategoriya: 'ishlab_chiqarish', summa: n(x.summa), tolov_usul: x.tolov_usul,
      manba_tur: MANBA, manba_id: h.id, izoh: `${h.raqam}: ${x.nomi}`.slice(0, 255), sana, user_id: user?.id || null,
    }, { transaction: t });
    await x.update({ kassa_id: k.id }, { transaction: t });
  }

  await h.update({
    holat: 'yakunlandi', yakunlangan_vaqt: sana,
    xom_ashyo_summa: H.X, xarajat_summa: H.E, qoshimcha_summa: H.Q, tannarx_jami: H.C,
    xom_ashyo_miqdor: H.xomMiqdor, mahsulot_miqdor: H.mahsulotMiqdor,
    yoqotish_miqdor: H.yoqotish ?? 0, chiqish_foiz: H.chiqishFoiz,
  }, { transaction: t });
}

/* Ro'yxat qatori: partiya bir qarashda */
function qisqa(h) {
  const q = h.qatorlar || [];
  const mah = q.filter(x => x.tur === 'mahsulot');
  const xom = q.filter(x => x.tur === 'xom_ashyo');
  const yakun = h.holat === 'yakunlandi';
  return {
    id: h.id, raqam: h.raqam, sana: h.sana, holat: h.holat, izoh: h.izoh, user_nomi: h.user_nomi,
    boshlangan_vaqt: h.boshlangan_vaqt, yakunlangan_vaqt: h.yakunlangan_vaqt,
    mahsulotlar: mah.map(x => ({ tovar_nomi: x.tovar_nomi, miqdor: n(x.miqdor), olchov: x.olchov, narx: n(x.narx) })),
    xom_ashyo: xom.map(x => ({ tovar_nomi: x.tovar_nomi, miqdor: n(x.miqdor), olchov: x.olchov })),
    xom_ashyo_miqdor: yakun ? n(h.xom_ashyo_miqdor) : xom.reduce((s, x) => s + n(x.miqdor), 0),
    mahsulot_miqdor: yakun ? n(h.mahsulot_miqdor) : mah.reduce((s, x) => s + n(x.miqdor), 0),
    tannarx_jami: n(h.tannarx_jami), yoqotish_miqdor: n(h.yoqotish_miqdor),
    chiqish_foiz: h.chiqish_foiz != null ? n(h.chiqish_foiz) : null,
    birlik_tannarx: yakun && mah.length === 1 ? n(mah[0].narx) : null,
  };
}

class IshlabController {
  // GET /ishlab?holat&search&dan&gacha&page&limit
  getAll = async (req, res) => {
    const { holat, search, dan, gacha } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(5, parseInt(req.query.limit, 10) || 30));
    const where = {};
    if (holat) where.holat = holat;
    if (dan || gacha) {
      where.sana = {};
      if (dan) where.sana[Op.gte] = new Date(`${dan}T00:00:00`);
      if (gacha) where.sana[Op.lte] = new Date(`${gacha}T23:59:59`);
    }
    if (search) {
      const ids = (await IshlabQatorModel.findAll({ where: { tovar_nomi: { [Op.like]: `%${search}%` } }, attributes: ['hujjat_id'], raw: true })).map(r => r.hujjat_id);
      where[Op.or] = [{ raqam: { [Op.like]: `%${search}%` } }, { id: ids.length ? ids : [0] }];
    }
    const { count, rows } = await IshlabModel.findAndCountAll({
      where, include: [{ model: IshlabQatorModel, as: 'qatorlar' }], distinct: true,
      order: [['sana', 'DESC'], ['id', 'DESC']], limit, offset: (page - 1) * limit,
    });

    // Shu oy: yakunlangan partiyalar, mahsulot qiymati, o'rtacha chiqish foizi, ochiq ishlar
    const oyBoshi = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [[oy], [ochiq], xomQoldiq, tannarx, tartibsiz] = await Promise.all([
      sequelize.query(`SELECT COUNT(*) soni, COALESCE(SUM(tannarx_jami), 0) qiymat, COALESCE(SUM(xarajat_summa), 0) xarajat,
          COALESCE(SUM(CASE WHEN chiqish_foiz IS NOT NULL THEN mahsulot_miqdor END), 0) mah,
          COALESCE(SUM(CASE WHEN chiqish_foiz IS NOT NULL THEN xom_ashyo_miqdor END), 0) xom,
          COALESCE(SUM(CASE WHEN chiqish_foiz IS NOT NULL THEN yoqotish_miqdor END), 0) yoqotish
        FROM ishlab_chiqarish WHERE holat = 'yakunlandi' AND yakunlangan_vaqt >= :oyBoshi`,
        { replacements: { oyBoshi }, type: sequelize.QueryTypes.SELECT }),
      sequelize.query(`SELECT SUM(holat = 'qoralama') qoralama, SUM(holat = 'jarayonda') jarayonda FROM ishlab_chiqarish`,
        { type: sequelize.QueryTypes.SELECT }),
      // Xom ashyo omborida hozir nima turibdi (tannarxda)
      sequelize.query(`SELECT tovar_id, SUM(donada) q FROM tovar_register WHERE ombor = :xom GROUP BY tovar_id HAVING q > 0.0005`,
        { replacements: { xom: XOM_ASHYO_OMBOR }, type: sequelize.QueryTypes.SELECT }),
      tannarxXaritasi(new Date()),
      tartibsizQoldiq(),
    ]);
    res.send({
      count, page, pages: Math.ceil(count / limit), rows: rows.map(qisqa),
      stat: {
        oy: { soni: Number(oy.soni), qiymat: n(oy.qiymat), xarajat: n(oy.xarajat), mahsulot: n(oy.mah), xom_ashyo: n(oy.xom),
              yoqotish: n(oy.yoqotish), chiqish_foiz: n(oy.xom) > 0 ? yax((n(oy.mah) / n(oy.xom)) * 100) : null },
        qoralama: Number(ochiq.qoralama || 0), jarayonda: Number(ochiq.jarayonda || 0),
        xom_ombor: { nomi: XOM_ASHYO_OMBOR, tovar_soni: xomQoldiq.length, qiymat: yax(xomQoldiq.reduce((s, r) => s + n(r.q) * n(tannarx[r.tovar_id]), 0)) },
        tartibsiz,
      },
    });
  };

  // GET /ishlab/spravochnik — tovar tanlash: turi, O'Z omboridagi mavjud qoldiq, o'rtacha tannarx, so'nggi sotuv narxlari;
  // tartibsiz — noto'g'ri omborda turgan qoldiq (asosiy skladdagi xom ashyo va h.k.)
  spravochnik = async (req, res) => {
    const tovarlar = await TovarModel.findAll({ where: { faol: true }, attributes: ['id', 'nomi', 'turkum', 'olchov_birligi', 'turi'], order: [['nomi', 'ASC']], raw: true });
    const ids = tovarlar.map(x => x.id);
    const xomIds = tovarlar.filter(x => x.turi === 'xom_ashyo').map(x => x.id);
    const savdoIds = tovarlar.filter(x => x.turi !== 'xom_ashyo').map(x => x.id);
    const [xomQ, savdoQ, tannarx, narx, tartibsiz] = await Promise.all([
      mavjudQoldiq({ tovarIds: xomIds, ombor: XOM_ASHYO_OMBOR }), mavjudQoldiq({ tovarIds: savdoIds, ombor: ASOSIY_OMBOR }),
      tannarxXaritasi(new Date()), narxMap(ids), tartibsizQoldiq(),
    ]);
    res.send({
      ombor: ASOSIY_OMBOR, xom_ombor: XOM_ASHYO_OMBOR, xarajat_turlari: XARAJAT_TAKLIF, tartibsiz,
      tovarlar: tovarlar.map(x => {
        const xom = x.turi === 'xom_ashyo';
        return {
          id: x.id, nomi: x.nomi, turkum: x.turkum || '', olchov: x.olchov_birligi || 'kg', turi: x.turi,
          ombor: omborNomi(turOmbori(x.turi)),
          qoldiq: yax(n((xom ? xomQ : savdoQ).get(x.id)?.mavjud), 3), tannarx: yax(n(tannarx[x.id])),
          optom_narx: n(narx[x.id]?.optom_narx), chakana_narx: n(narx[x.id]?.chakana_narx),
        };
      }),
    });
  };

  // POST /ishlab/tartibla — noto'g'ri omborda turgan erkin qoldiqni turi omboriga ko'chiradi
  tartibla = async (req, res) => {
    const kochdi = await sequelize.transaction(t => tartibla({ transaction: t }));
    res.send({ kochdi });
  };

  // GET /ishlab/:id — hujjat + xom ashyoning hozirgi qoldig'i + shu mahsulotning oldingi partiyalari
  getById = async (req, res) => {
    const h = await topHujjat(req.params.id);
    const p = h.get({ plain: true });
    // Qator ombori: harakat bo'lgan bo'lsa — saqlangani, aks holda tovarning hozirgi turi bo'yicha
    const barchaIds = [...new Set(p.qatorlar.map(q => q.tovar_id))];
    const turlar = barchaIds.length ? await TovarModel.findAll({ where: { id: barchaIds }, attributes: ['id', 'turi'], raw: true, paranoid: false }) : [];
    const turM = Object.fromEntries(turlar.map(x => [x.id, x.turi]));
    p.qatorlar.forEach(q => { q.ombor = q.ombor || turOmbori(turM[q.tovar_id]); q.turi = turM[q.tovar_id] || 'tovar'; q.ombor_nomi = omborNomi(q.ombor); });
    const mahIds = [...new Set(p.qatorlar.filter(q => q.tur === 'mahsulot').map(q => q.tovar_id))];
    const [mavjud, tannarx, tarix] = await Promise.all([
      omborlarBoyicha(p.qatorlar.filter(q => q.tur === 'xom_ashyo'), null),
      tannarxXaritasi(new Date()),
      mahIds.length ? sequelize.query(`
        SELECT h.id, h.raqam, h.yakunlangan_vaqt, h.chiqish_foiz, q.tovar_id, q.tovar_nomi, q.miqdor, q.narx, q.olchov
        FROM ishlab_chiqarish h JOIN ishlab_chiqarish_qator q ON q.hujjat_id = h.id AND q.tur = 'mahsulot'
        WHERE h.holat = 'yakunlandi' AND h.id <> :id AND q.tovar_id IN (:mahIds)
        ORDER BY h.yakunlangan_vaqt DESC LIMIT 12`, { replacements: { id: h.id, mahIds }, type: sequelize.QueryTypes.SELECT }) : [],
    ]);
    const fm = tarix.filter(r => r.chiqish_foiz != null);
    res.send({
      ...p,
      qatorlar: p.qatorlar.map(q => ({
        ...q, mavjud: q.tur === 'xom_ashyo' ? yax(n(mavjud.get(q.ombor)?.get(Number(q.tovar_id))?.mavjud), 3) : null,
        joriy_tannarx: q.tur === 'xom_ashyo' ? yax(n(tannarx[q.tovar_id])) : null,
      })),
      tarix: {
        partiyalar: tarix.map(r => ({ id: r.id, raqam: r.raqam, sana: r.yakunlangan_vaqt, tovar_nomi: r.tovar_nomi, miqdor: n(r.miqdor),
          olchov: r.olchov, narx: n(r.narx), chiqish_foiz: r.chiqish_foiz != null ? n(r.chiqish_foiz) : null })),
        ortacha_chiqish: fm.length ? yax(fm.reduce((s, r) => s + n(r.chiqish_foiz), 0) / fm.length) : null,
        ortacha_tannarx: tarix.length && mahIds.length === 1 ? yax(tarix.reduce((s, r) => s + n(r.narx) * n(r.miqdor), 0) / Math.max(1e-9, tarix.reduce((s, r) => s + n(r.miqdor), 0))) : null,
      },
    });
  };

  // POST /ishlab — yangi partiya (qoralama). { sana, izoh, taqsimlash, qatorlar[], xarajatlar[], boshlash?, yakunlash? }
  create = async (req, res) => {
    kirishniTekshir(req.body);
    const id = await sequelize.transaction(async (t) => {
      // Boshlanadigan bo'lsa — xom ashyo qulfi har qanday oddiy o'qishdan (raqamYarat ham) oldin
      if (req.body.boshlash || req.body.yakunlash) await xomQulfla(null, req.body, t);
      const h = await IshlabModel.create({
        raqam: await raqamYarat(t), sana: req.body.sana ? new Date(req.body.sana) : new Date(), ombor: ASOSIY_OMBOR,
        taqsimlash: req.body.taqsimlash === 'miqdor' ? 'miqdor' : 'qiymat', izoh: req.body.izoh || null,
        user_id: req.currentUser?.id || null, user_nomi: req.currentUser?.fullname || req.currentUser?.username || null,
      }, { transaction: t });
      const toliq = await chiqishniYoz(h, { qatorlar: req.body.qatorlar || [], xarajatlar: req.body.xarajatlar || [] }, t, { xomHam: true });
      if (req.body.boshlash || req.body.yakunlash) await boshla(toliq, t);
      if (req.body.yakunlash) await yakunla(toliq, req.currentUser, t);
      return h.id;
    });
    res.status(201).send(await topHujjat(id));
  };

  // PATCH /ishlab/:id — qoralamada hammasi, jarayonda — faqat mahsulot, qo'shimcha va xarajatlar
  update = async (req, res) => {
    kirishniTekshir(req.body);
    await sequelize.transaction(async (t) => {
      const h = await topHujjat(req.params.id, t);
      if (!['qoralama', 'jarayonda'].includes(h.holat)) throw new HttpException(400, `"${h.holat}" holatidagi hujjatni o'zgartirib bo'lmaydi`);
      const body = { ...req.body };
      if (h.holat === 'jarayonda' && Array.isArray(body.qatorlar)) body.qatorlar = body.qatorlar.filter(q => q.tur !== 'xom_ashyo');
      await chiqishniYoz(h, body, t, { xomHam: h.holat === 'qoralama' });
    });
    res.send(await topHujjat(req.params.id));
  };

  // POST /ishlab/:id/boshla — xom ashyo ombordan chiqadi
  boshla = async (req, res) => {
    kirishniTekshir(req.body || {});
    await sequelize.transaction(async (t) => {
      const h = await topHujjat(req.params.id, t);
      if (h.holat !== 'qoralama') throw new HttpException(400, 'Faqat qoralamadagi partiyani boshlash mumkin');
      await xomQulfla(h, req.body, t);
      const toliq = req.body && Object.keys(req.body).length ? await chiqishniYoz(h, req.body, t, { xomHam: true }) : h;
      await boshla(toliq, t);
    });
    res.send(await topHujjat(req.params.id));
  };

  // POST /ishlab/:id/yakunla — { qatorlar (mahsulot/qo'shimcha haqiqiy miqdori, narxlar), xarajatlar, taqsimlash }
  yakunla = async (req, res) => {
    kirishniTekshir(req.body || {});
    await sequelize.transaction(async (t) => {
      const h = await topHujjat(req.params.id, t);
      if (!['qoralama', 'jarayonda'].includes(h.holat)) throw new HttpException(400, 'Partiya allaqachon yakunlangan yoki bekor qilingan');
      const qoralama = h.holat === 'qoralama';
      if (qoralama) await xomQulfla(h, req.body, t);
      const toliq = await chiqishniYoz(h, req.body || {}, t, { xomHam: qoralama });
      if (qoralama) await boshla(toliq, t);
      await yakunla(toliq, req.currentUser, t);
    });
    res.send(await topHujjat(req.params.id));
  };

  // POST /ishlab/:id/bekor — { sabab }
  bekor = async (req, res) => {
    await sequelize.transaction(async (t) => {
      const h = await topHujjat(req.params.id, t);
      if (h.holat === 'bekor') throw new HttpException(400, 'Allaqachon bekor qilingan');
      const sana = new Date();
      const yozuvlar = [];
      if (h.holat === 'yakunlandi') {
        // Mahsulot hali omborda bo'lsagina — sotilgan bo'lsa qaytarib bo'lmaydi
        const chiqqan = h.qatorlar.filter(q => q.tur !== 'xom_ashyo' && n(q.miqdor) > 0);
        // Mahsulot qoldig'i tekshiruvidan oldin tovarlar qulflanadi (parallel sotuv bilan poyga yo'q).
        // topHujjat (FOR UPDATE) dan keyin birinchi o'qish shu qulf — snapshot qulfdan keyin olinadi.
        await tovarlarniQulfla(chiqqan.map(q => q.tovar_id), t);
        // Mavjud qoldiq (boshla bilan bir xil): jismoniy qoldiq − ochiq buyurtmalarga band qilingani.
        // Aks holda bekor qilish buyurtmaga band qilingan mahsulotni olib ketib, skladni minusga tushirardi.
        const mavjud = await omborlarBoyicha(chiqqan.map(q => ({ ombor: q.ombor || h.ombor, tovar_id: q.tovar_id })), t);
        const jami = {};
        for (const q of chiqqan) { const k = `${q.ombor || h.ombor}|${q.tovar_id}`; jami[k] = (jami[k] || 0) + n(q.miqdor); }
        const qoldi = q => n(mavjud.get(q.ombor || h.ombor)?.get(Number(q.tovar_id))?.mavjud);
        const yetmaydi = chiqqan.filter(q => qoldi(q) + 0.0005 < jami[`${q.ombor || h.ombor}|${q.tovar_id}`]);
        if (yetmaydi.length) {
          throw new HttpException(400, 'Mahsulotning bir qismi omborda yo\'q yoki buyurtmalarga band (sotilgan, ko\'chirilgan yoki band qilingan): '
            + yetmaydi.map(q => `"${q.tovar_nomi}" ${yax(qoldi(q), 3)} / ${yax(n(q.miqdor), 3)} ${q.olchov} (${omborNomi(q.ombor || h.ombor)})`).join('; ')
            + '. Bekor qilib bo\'lmaydi — farqni inventarizatsiya bilan to\'g\'rilang.');
        }
        for (const q of chiqqan) yozuvlar.push(reg(h, q, { tur: 'qaytarma_chiqim', ishora: -1, narx: n(q.narx), summa: n(q.summa), sana }));
        const kassaIds = h.xarajatlar.map(x => x.kassa_id).filter(Boolean);
        if (kassaIds.length) await KassaModel.destroy({ where: { id: kassaIds, manba_tur: MANBA, manba_id: h.id }, transaction: t });
        await IshlabXarajatModel.update({ kassa_id: null }, { where: { hujjat_id: h.id }, transaction: t });
      }
      if (['jarayonda', 'yakunlandi'].includes(h.holat)) {
        for (const q of h.qatorlar.filter(x => x.tur === 'xom_ashyo' && n(x.miqdor) > 0)) {
          yozuvlar.push(reg(h, q, { tur: 'qaytarma_kirim', ishora: 1, narx: n(q.narx), summa: n(q.summa), sana }));
        }
      }
      if (yozuvlar.length) await TovarRegisterModel.bulkCreate(yozuvlar, { transaction: t });
      await h.update({ holat: 'bekor', bekor_sababi: String(req.body?.sabab || '').slice(0, 255) || null }, { transaction: t });
    });
    res.send(await topHujjat(req.params.id));
  };

  // POST /ishlab/:id/nusxa — shu partiyani takrorlash: yangi qoralama (miqdorlar reja sifatida)
  nusxa = async (req, res) => {
    const id = await sequelize.transaction(async (t) => {
      const asl = await topHujjat(req.params.id, t);
      const h = await IshlabModel.create({
        raqam: await raqamYarat(t), sana: new Date(), ombor: asl.ombor, taqsimlash: asl.taqsimlash,
        izoh: `${asl.raqam} dan nusxa`, user_id: req.currentUser?.id || null, user_nomi: req.currentUser?.fullname || req.currentUser?.username || null,
      }, { transaction: t });
      await IshlabQatorModel.bulkCreate(asl.qatorlar.map(q => ({
        hujjat_id: h.id, tur: q.tur, tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum, olchov: q.olchov,
        reja_miqdor: q.miqdor, miqdor: q.miqdor, narx: q.tur === 'qoshimcha' ? q.narx : 0, optom_narx: q.optom_narx, chakana_narx: q.chakana_narx,
      })), { transaction: t });
      await IshlabXarajatModel.bulkCreate(asl.xarajatlar.map(x => ({ hujjat_id: h.id, nomi: x.nomi, summa: x.summa, kassadan: x.kassadan, tolov_usul: x.tolov_usul })), { transaction: t });
      return h.id;
    });
    res.status(201).send(await topHujjat(id));
  };
}

module.exports = new IshlabController();
