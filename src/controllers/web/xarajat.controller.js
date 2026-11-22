/**
 * MOLIYA → KUNLIK XARAJATLAR: kassadan rasxod (benzin, ovqat, ijara, ish haqi …).
 * Har xarajat — `kassa` yozuvi (tur='chiqim', kategoriya = toifa kodi, manba_tur='xarajat'), shuning uchun
 * kassa qoldig'idan ayriladi va foyda-zarar hisobotida operatsion xarajat bo'lib ko'rinadi.
 * Kassa sahifasidan qo'lda kiritilgan xarajatlar (manba_tur='qol') ham shu ro'yxatda ko'rinadi.
 *
 * 2026-11-27 XARAJAT LIMITI (FRONTEND-UCHUN §22):
 *   - har YANGI xarajat kassaga (kassalar, faol) bog'lanadi: kassa_id majburiy, tolov_usul kassa turidan
 *     (naqd → 'naqt', plastik → 'karta'); summa kassa balansidan katta bo'lsa — 400.
 *   - user.xarajat_limit (faqat role 'User'; NULL — cheksiz, 0 — har xarajat tasdiqqa): summa > limit bo'lsa
 *     xarajat jurnalga YOZILMAYDI — xarajat_sorov 'kutilmoqda' (202). Tasdiqlovchi (Admin/Programmer yoki
 *     moliya 'approve') tasdiqlasa — jurnal yozuvi (manba_tur 'xarajat', manba_id = so'rov id), balans shu
 *     paytda qayta tekshiriladi. Rad (sabab majburiy) / bekor (yaratuvchi) — so'rov yozuvi qoladi.
 */
const fs = require('fs');
const path = require('path');
const sequelize = require('../../db/db-sequelize');
const KassaModel = require('../../models/kassa.model');
const XarajatTuriModel = require('../../models/xarajatTuri.model');
const HttpException = require('../../utils/HttpException.utils');
const U = require('../../utils/tahlil.utils');
const { xarajatTurlari, tasdiqlanganSorovYozuvimi, TASDIQLI_OCHIRISH_XATO } = require('../../utils/xarajat.utils');
const XarajatSorovModel = require('../../models/xarajatSorov.model');
const { KassalarModel } = require('../../models/kassalar.model');
const { qulflabOl } = require('../../utils/qulf.utils');
const { kassaQulfla, kassaBalansTekshir, kassaUsul, kassaBalanslari, auditYoz, auditRoyxat, sababOl, userNomi } = require('../../utils/agentPul.utils');
const { ruxsatBormi } = require('../../middleware/ruxsat.middleware');

const n = v => Number(v) || 0;
const yax = v => Math.round(n(v) * 100) / 100;
const USUL = ['naqt', 'karta', 'bank'];
const TAHRIR_MANBA = ['xarajat', 'qol'];
const Q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });

/* Sana: bugun tanlansa — hozirgi vaqt, boshqa kun — o'sha kunning tushi (mahalliy) */
function sanaOl(v) {
  if (!v) return new Date();
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    if (s === U.kunKey(new Date())) return new Date();
    return new Date(`${s}T12:00:00`);
  }
  const d = new Date(s);
  if (isNaN(d)) throw new HttpException(400, "Sana noto'g'ri");
  return d;
}
function slug(nomi) {
  const s = String(nomi || '').toLowerCase().replace(/[ʻʼ‘’`´']/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  return s || 'toifa';
}
function rasmniOchir(fayl) {
  if (!fayl || !String(fayl).startsWith('/uploads/kassa/')) return;
  fs.unlink(path.join(__dirname, '../../..', fayl), () => {});
}
/* Jurnal yozuvi rasmi — tasdiqlangan so'rov ham shu faylga ishora qilsa, o'chirilmaydi */
async function yozuvRasminiOchir(fayl) {
  if (!fayl) return;
  const bor = await XarajatSorovModel.count({ where: { chek_rasm: fayl } });
  if (!bor) rasmniOchir(fayl);
}

/* ── Xarajat limiti yordamchilari (2026-11-27) ── */
const TOLIQ = ['Admin', 'Programmer'];
const toliqmi = (u) => !!u && TOLIQ.includes(u.role);
/* Foydalanuvchi limiti: null — cheksiz (Admin/Programmer yoki xarajat_limit NULL) */
function limitOl(u) {
  if (!u || toliqmi(u) || u.role !== 'User') return null;
  const v = u.xarajat_limit;
  return v === null || v === undefined || v === '' ? null : yax(v);
}
const tasdiqlovchimi = (u) => ruxsatBormi(u, 'moliya', ['approve']);
const HOLATLAR = ['kutilmoqda', 'tasdiqlangan', 'rad_etildi', 'bekor'];
const HOLAT_NOMI = { tasdiqlangan: 'tasdiqlangan', rad_etildi: 'rad etilgan', bekor: 'bekor qilingan', kutilmoqda: 'kutilmoqda' };

function sorovIdOl(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(s)) throw new HttpException(400, "sorov_id noto'g'ri (8–64 belgi: harf, raqam, - _ . :)");
  return s;
}
const takrorXato = (e) => !!e && (e.name === 'SequelizeUniqueConstraintError' || (e.parent && e.parent.code === 'ER_DUP_ENTRY'));
function idOl(v, nomi = 'id') {
  const id = Number(v);
  if (!Number.isInteger(id) || id <= 0) throw new HttpException(400, `${nomi} noto'g'ri`);
  return id;
}
const bosmi = (v) => v === undefined || v === null || v === '';

/* kassaQulfla / kassaBalansTekshir / kassaUsul — agentPul.utils (barcha kassadan chiqim oqimlari uchun bitta qoida) */

/* So'rovlar (JOIN: kassa nomi, yaratuvchining joriy limiti) */
async function sorovlarOl(where, rep, { limit = null, offset = 0 } = {}) {
  const rows = await Q(`SELECT s.*, ks.nomi AS kassa_nomi, u.xarajat_limit AS user_limit
     FROM xarajat_sorov s LEFT JOIN kassalar ks ON ks.id = s.kassa_id LEFT JOIN user u ON u.id = s.user_id
     WHERE ${where} ORDER BY s.id DESC ${limit ? 'LIMIT :lim OFFSET :off' : ''}`, { ...rep, lim: limit, off: offset });
  if (!rows.length) return [];
  const [turlar, b] = await Promise.all([xarajatTurlari(), kassaBalanslari()]);
  return rows.map(r => ({
    id: r.id, kategoriya: r.kategoriya, kategoriya_nomi: turlar.get(r.kategoriya)?.nomi || r.kategoriya,
    summa: yax(r.summa), kassa_id: r.kassa_id, kassa_nomi: r.kassa_nomi || null, tolov_usul: r.tolov_usul,
    sana: r.sana, izoh: r.izoh || '', chek_rasm: r.chek_rasm || null,
    user_id: r.user_id, user_nomi: r.user_nomi || null, user_limit: r.user_limit === null || r.user_limit === undefined ? null : yax(r.user_limit),
    holat: r.holat, tasdiqlagan_nomi: r.tasdiqlagan_nomi || null, tasdiq_vaqt: r.tasdiq_vaqt || null,
    rad_sababi: r.rad_sababi || null, kassa_yozuv_id: r.kassa_yozuv_id || null,
    kassa_balans: b.kassalar.get(Number(r.kassa_id))?.balans || 0,
    createdAt: r.createdAt,
  }));
}
async function sorovBitta(id) {
  const [x] = await sorovlarOl('s.id = :id', { id });
  return x || null;
}
const sorovShakli = (s) => ({ holat: s.holat, summa: n(s.summa), kassa_id: s.kassa_id, kassa_yozuv_id: s.kassa_yozuv_id || null });

class XarajatController {

  /* GET /xarajatlar/turlar */
  turlar = async (req, res) => {
    const rows = await XarajatTuriModel.findAll({ order: [['tartib', 'ASC'], ['id', 'ASC']], raw: true });
    // Har toifa necha marta ishlatilgan (so'nggi 90 kun) — tez tanlash tugmalari tartibi uchun
    const d90 = new Date(Date.now() - 90 * 86400000);
    const son = await Q(`SELECT kategoriya, COUNT(*) AS soni FROM kassa WHERE tur = 'chiqim' AND sana >= :d90 GROUP BY kategoriya`, { d90 });
    const sMap = new Map(son.map(r => [r.kategoriya, n(r.soni)]));
    res.send(rows.map(r => ({ ...r, faol: !!r.faol, soni90: sMap.get(r.kod) || 0 })));
  };

  /* POST /xarajatlar/turlar { nomi, ikon } */
  turQosh = async (req, res) => {
    const nomi = String(req.body.nomi || '').trim().slice(0, 100);
    if (!nomi) throw new HttpException(400, 'Toifa nomi kiritilmagan');
    const bor = await XarajatTuriModel.findOne({ where: sequelize.where(sequelize.fn('LOWER', sequelize.col('nomi')), nomi.toLowerCase()) });
    if (bor) throw new HttpException(400, `"${bor.nomi}" toifasi allaqachon bor`);
    let kod = slug(nomi), i = 2;
    while (await XarajatTuriModel.count({ where: { kod } }) || ['boshqa_chiqim', 'qarz_berildi', 'qarz_qaytarildi', 'yetkazuvchi_tolov', 'ishlab_chiqarish', 'sotuv', 'sotuv_qaytarish', 'mijoz_tolov'].includes(kod)) kod = `${slug(nomi).slice(0, 36)}_${i++}`;
    const max = await XarajatTuriModel.max('tartib');
    const t = await XarajatTuriModel.create({ kod, nomi, ikon: req.body.ikon || 'boshqa', tartib: n(max) + 1, faol: true });
    res.status(201).send(t);
  };

  /* PATCH /xarajatlar/turlar/:id { nomi, ikon, faol, tartib } — kod o'zgarmaydi */
  turTahrir = async (req, res) => {
    const t = await XarajatTuriModel.findByPk(req.params.id);
    if (!t) throw new HttpException(404, 'Toifa topilmadi');
    const u = {};
    if (req.body.nomi !== undefined) { const nomi = String(req.body.nomi || '').trim().slice(0, 100); if (!nomi) throw new HttpException(400, 'Toifa nomi kiritilmagan'); u.nomi = nomi; }
    if (req.body.ikon !== undefined) u.ikon = String(req.body.ikon || 'boshqa').slice(0, 30);
    if (req.body.faol !== undefined) u.faol = !!req.body.faol;
    if (req.body.tartib !== undefined) u.tartib = parseInt(req.body.tartib, 10) || 0;
    await t.update(u);
    res.send(t);
  };

  /* GET /xarajatlar?dan&gacha&kategoriya&search — davr xarajatlari + tahlil */
  royxat = async (req, res) => {
    const D = U.davr(req.query, 1);
    const turlar = await xarajatTurlari();
    const kodlar = [...turlar.keys()];
    const shart = ['k.tur = \'chiqim\'', 'k.kategoriya IN (:kodlar)'];
    const rep = { kodlar, from: D.from, to: D.to, tz: D.tz };
    if (req.query.kategoriya && turlar.has(req.query.kategoriya)) { shart.push('k.kategoriya = :kat'); rep.kat = req.query.kategoriya; }
    if (req.query.search) { shart.push('k.izoh LIKE :q'); rep.q = `%${req.query.search}%`; }
    const asos = shart.join(' AND ');
    const d30 = new Date(Date.now() - 30 * 86400000);
    // Kutilayotgan so'rovlar (limitdan oshganlar): tasdiqlovchi — hammasi, boshqalar — o'ziniki
    const meniki = !tasdiqlovchimi(req.currentUser);
    const [rows, kunlar, kassa, oy30, [kut]] = await Promise.all([
      Q(`SELECT k.id, k.sana, k.kategoriya, k.summa, k.tolov_usul, k.izoh, k.chek_rasm, k.manba_tur, k.manba_id, k.user_id,
                k.kassa_id, ks.nomi AS kassa_nomi, COALESCE(u.fullname, u.username) AS kim
         FROM kassa k LEFT JOIN user u ON u.id = k.user_id LEFT JOIN kassalar ks ON ks.id = k.kassa_id
         WHERE ${asos} AND k.sana BETWEEN :from AND :to ORDER BY k.sana DESC, k.id DESC`, rep),
      Q(`SELECT DATE_FORMAT(CONVERT_TZ(k.sana, '+00:00', :tz), '%Y-%m-%d') AS kun, SUM(k.summa) AS summa, COUNT(*) AS soni
         FROM kassa k WHERE ${asos} AND k.sana BETWEEN :from AND :to GROUP BY kun ORDER BY kun`, rep),
      Q(`SELECT tolov_usul, COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END), 0) AS qoldiq FROM kassa GROUP BY tolov_usul`),
      Q(`SELECT COALESCE(SUM(k.summa), 0) AS summa FROM kassa k WHERE k.tur = 'chiqim' AND k.kategoriya IN (:kodlar) AND k.sana >= :d30`, { kodlar, d30 }),
      Q(`SELECT COUNT(*) AS soni, COALESCE(SUM(summa), 0) AS summa FROM xarajat_sorov WHERE holat = 'kutilmoqda' ${meniki ? 'AND user_id = :me' : ''}`,
        { me: req.currentUser?.id || 0 }),
    ]);
    const tur = k => turlar.get(k) || { nomi: k, ikon: 'boshqa' };
    const jami = rows.reduce((a, r) => a + n(r.summa), 0);
    const tMap = new Map();
    for (const r of rows) {
      const key = r.kategoriya === 'boshqa_chiqim' ? 'xarajat' : r.kategoriya;
      const x = tMap.get(key) || { kod: key, nomi: tur(key).nomi, ikon: tur(key).ikon, summa: 0, soni: 0 };
      x.summa += n(r.summa); x.soni++; tMap.set(key, x);
    }
    const kMap = Object.fromEntries(kassa.map(r => [r.tolov_usul, yax(r.qoldiq)]));
    res.send({
      davr: { dan: D.dan, gacha: D.gacha, kunlar: D.kunlar },
      jami: { summa: yax(jami), soni: rows.length, kunlik: yax(jami / D.kunlar) },
      ortacha30: yax(n(oy30[0]?.summa) / 30),
      kutilmoqda: { soni: n(kut?.soni), summa: yax(kut?.summa) },
      xarajat_limit: limitOl(req.currentUser),
      kassa: { naqt: kMap.naqt || 0, karta: kMap.karta || 0, bank: kMap.bank || 0, jami: yax((kMap.naqt || 0) + (kMap.karta || 0) + (kMap.bank || 0)) },
      toifalar: [...tMap.values()].map(x => ({ ...x, summa: yax(x.summa), ulush: jami > 0 ? Math.round(x.summa / jami * 1000) / 10 : 0 })).sort((a, b) => b.summa - a.summa),
      kunlar: kunlar.map(k => ({ kun: k.kun, summa: yax(k.summa), soni: n(k.soni) })),
      rows: rows.map(r => ({
        id: r.id, sana: r.sana, kategoriya: r.kategoriya, nomi: tur(r.kategoriya).nomi, ikon: tur(r.kategoriya).ikon,
        summa: yax(r.summa), tolov_usul: r.tolov_usul, izoh: r.izoh || '', chek_rasm: r.chek_rasm || null,
        manba: r.manba_tur, kim: r.kim || '', tahrir: TAHRIR_MANBA.includes(r.manba_tur),
        kassa_id: r.kassa_id || null, kassa_nomi: r.kassa_nomi || null,
      })),
    });
  };

  /* GET /xarajatlar/kassalar — xarajat formasi uchun faol kassalar va balansi (moliya ruxsatisiz kassir ham ko'radi) */
  kassalar = async (req, res) => {
    const [rows, b] = await Promise.all([
      KassalarModel.findAll({ where: { faol: true }, order: [['tur', 'ASC'], ['nomi', 'ASC']], raw: true }),
      kassaBalanslari(),
    ]);
    res.send({
      xarajat_limit: limitOl(req.currentUser),
      rows: rows.map(k => ({ id: k.id, nomi: k.nomi, tur: k.tur, tolov_usul: kassaUsul(k), balans: b.kassalar.get(k.id)?.balans || 0 })),
    });
  };

  /* POST /xarajatlar (multipart: kategoriya, summa, kassa_id, sana, izoh, rasm?, sorov_id?)
     summa ≤ limit (yoki limitsiz) → 201 jurnal yozuvi { ...yozuv, kassa_nomi, holat:'qabul_qilindi' }
     summa > limit                 → 202 { holat:'kutilmoqda', sorov, message } — jurnalga yozilmaydi */
  create = async (req, res) => {
    const fayl = req.file ? `/uploads/kassa/${req.file.filename}` : null;
    let sorovId = null, user = req.currentUser, summa = 0, kod = null;
    // Takror (shu sorov_id) — avvalgi natija qaytariladi; boshqa ma'lumot bilan — 409
    const takrorJavob = async () => {
      const [rec, sor] = await Promise.all([
        KassaModel.findOne({ where: { mobil_id: sorovId } }),
        XarajatSorovModel.findOne({ where: { sorov_id: sorovId } }),
      ]);
      const mos = (x) => x.kategoriya === kod && Math.abs(n(x.summa) - summa) < 0.005 && Number(x.user_id || 0) === Number(user?.id || 0);
      if (rec) {
        if (rec.tur !== 'chiqim' || rec.manba_tur !== 'xarajat' || !mos(rec)) throw new HttpException(409, 'Bu sorov_id boshqa yozuvga tegishli');
        const k = rec.kassa_id ? await KassalarModel.findByPk(rec.kassa_id) : null;
        res.status(201).send({ ...rec.toJSON(), kassa_nomi: k ? k.nomi : null, holat: 'qabul_qilindi', takror: true });
        return true;
      }
      if (sor) {
        if (!mos(sor)) throw new HttpException(409, 'Bu sorov_id boshqa yozuvga tegishli');
        res.status(202).send({ holat: 'kutilmoqda', sorov: await sorovBitta(sor.id), takror: true });
        return true;
      }
      return false;
    };
    try {
      const turlar = await xarajatTurlari();
      const t = turlar.get(req.body.kategoriya);
      if (!t || t.alias) throw new HttpException(400, 'Xarajat toifasini tanlang');
      if (!t.faol) throw new HttpException(400, `"${t.nomi}" toifasi yashirilgan`);
      kod = t.kod;
      summa = yax(req.body.summa);
      if (!(summa > 0)) throw new HttpException(400, "Summa noto'g'ri");
      if (bosmi(req.body.kassa_id)) throw new HttpException(400, 'Kassani tanlang (kassa_id majburiy)');
      sorovId = sorovIdOl(req.body.sorov_id);
      if (sorovId && await takrorJavob()) { rasmniOchir(fayl); return; }
      const izoh = req.body.izoh ? String(req.body.izoh).trim().slice(0, 255) : null;
      const sana = sanaOl(req.body.sana);
      const limit = limitOl(user);
      const kutish = limit !== null && summa > limit + 0.005;

      const natija = await sequelize.transaction(async (tr) => {
        const k = await kassaQulfla(req.body.kassa_id, tr);
        // Kutilayotgan so'rovda ham erta tekshiriladi; hal qiluvchi tekshiruv — tasdiqda
        await kassaBalansTekshir(k.id, summa, tr);
        if (kutish) {
          const s = await XarajatSorovModel.create({
            kategoriya: t.kod, summa, kassa_id: k.id, tolov_usul: kassaUsul(k), sana, izoh, chek_rasm: fayl,
            user_id: user?.id || null, user_nomi: userNomi(user), holat: 'kutilmoqda', sorov_id: sorovId,
          }, { transaction: tr });
          await auditYoz({ obyekt: 'xarajat_sorov', obyekt_id: s.id, amal: 'yaratildi', yangi: sorovShakli(s),
            sabab: `Limit ${limit} — summa ${summa}`, user }, tr);
          return { s };
        }
        const rec = await KassaModel.create({
          tur: 'chiqim', kategoriya: t.kod, summa, tolov_usul: kassaUsul(k),
          manba_tur: 'xarajat', manba_id: null, mijoz_id: null, mijoz_nomi: null,
          izoh, sana, user_id: user?.id || null, chek_rasm: fayl, kassa_id: k.id, mobil_id: sorovId,
        }, { transaction: tr });
        return { rec, k };
      });
      if (natija.s) {
        return res.status(202).send({
          holat: 'kutilmoqda', sorov: await sorovBitta(natija.s.id),
          message: `Summa limitingizdan (${limit}) oshadi — tasdiqqa yuborildi`,
        });
      }
      res.status(201).send({ ...natija.rec.toJSON(), kassa_nomi: natija.k.nomi, holat: 'qabul_qilindi' });
    } catch (e) {
      if (sorovId && takrorXato(e) && await takrorJavob()) { rasmniOchir(fayl); return; }
      rasmniOchir(fayl);
      throw e;
    }
  };

  /* PATCH /xarajatlar/:id (multipart: kategoriya, summa, kassa_id?, tolov_usul?, sana, izoh, rasm?, rasm_ochir?)
     kassa_id yuborilmasa kassa o'zgarmaydi (eski kassasiz yozuvlar ham tahrirlanadi). Kassali yozuvda
     tolov_usul kassa turidan. Limitli User: yangi summa limitdan oshsa — 400. Kassa o'zgarsa yoki summa
     oshsa — balans qayta tekshiriladi. */
  update = async (req, res) => {
    const fayl = req.file ? `/uploads/kassa/${req.file.filename}` : null;
    const user = req.currentUser;
    const limit = limitOl(user);
    try {
      const turlar = await xarajatTurlari();
      const { rec, eskiRasm, u } = await sequelize.transaction(async (tr) => {
        const rec = await qulflabOl(KassaModel, idOl(req.params.id), tr);
        if (!rec || rec.tur !== 'chiqim' || !turlar.has(rec.kategoriya)) throw new HttpException(404, 'Xarajat topilmadi');
        if (!TAHRIR_MANBA.includes(rec.manba_tur)) throw new HttpException(400, "Bu avtomatik yozuv — tahrirlab bo'lmaydi");
        const u = {};
        if (req.body.kategoriya !== undefined) {
          const t = turlar.get(req.body.kategoriya);
          if (!t || t.alias) throw new HttpException(400, 'Xarajat toifasini tanlang');
          u.kategoriya = t.kod;
        }
        if (req.body.summa !== undefined) { const s = yax(req.body.summa); if (!(s > 0)) throw new HttpException(400, "Summa noto'g'ri"); u.summa = s; }
        const eskiSumma = n(rec.summa);
        const yangiSumma = u.summa !== undefined ? u.summa : eskiSumma;
        if (limit !== null && Math.abs(yangiSumma - eskiSumma) > 0.005 && yangiSumma > limit + 0.005) {
          throw new HttpException(400, `Summa limitingizdan (${limit}) oshadi — yangi xarajat sifatida tasdiqqa yuboring`);
        }
        // Kassa: yuborilgan va joriydan farqli bo'lsa — yangi kassa faol bo'lishi shart
        let k = null;
        if (!bosmi(req.body.kassa_id) && idOl(req.body.kassa_id, 'kassa_id') !== Number(rec.kassa_id || 0)) {
          k = await kassaQulfla(req.body.kassa_id, tr);
          u.kassa_id = k.id;
        } else if (rec.kassa_id) {
          k = await qulflabOl(KassalarModel, rec.kassa_id, tr);
        }
        if (k) {
          if (kassaUsul(k) !== rec.tolov_usul) u.tolov_usul = kassaUsul(k);
          const kassaOzgardi = u.kassa_id !== undefined;
          if (kassaOzgardi || yangiSumma > eskiSumma + 0.005) {
            // Shu kassada qolsa — joriy yozuv balansdan allaqachon ayirilgan
            await kassaBalansTekshir(k.id, yangiSumma, tr, kassaOzgardi ? 0 : eskiSumma);
          }
        } else if (req.body.tolov_usul !== undefined && USUL.includes(req.body.tolov_usul)) u.tolov_usul = req.body.tolov_usul;
        if (req.body.sana) {
          const yangiKun = String(req.body.sana).slice(0, 10);
          // Kun o'zgarmagan bo'lsa, asl vaqt saqlanadi
          const eskiKun = U.kunKey(new Date(rec.sana));
          if (yangiKun !== eskiKun) u.sana = sanaOl(req.body.sana);
        }
        if (req.body.izoh !== undefined) u.izoh = req.body.izoh ? String(req.body.izoh).trim().slice(0, 255) : null;
        const eskiRasm = rec.chek_rasm;
        if (fayl) u.chek_rasm = fayl;
        else if (req.body.rasm_ochir === '1' || req.body.rasm_ochir === true) u.chek_rasm = null;
        await rec.update(u, { transaction: tr });
        return { rec, eskiRasm, u };
      });
      if (eskiRasm && u.chek_rasm !== undefined && u.chek_rasm !== eskiRasm) await yozuvRasminiOchir(eskiRasm);
      const k = rec.kassa_id ? await KassalarModel.findByPk(rec.kassa_id) : null;
      res.send({ ...rec.toJSON(), kassa_nomi: k ? k.nomi : null });
    } catch (e) {
      rasmniOchir(fayl);
      throw e;
    }
  };

  /* ── Limitdan oshgan xarajat so'rovlari ─────────────────────────────── */

  /* GET /xarajatlar/sorovlar?holat=&user_id=&kassa_id=&dan=&gacha=&page=&limit= */
  sorovlar = async (req, res) => {
    const q = req.query;
    const w = ['1 = 1'], R = {};
    if (!bosmi(q.holat)) {
      if (!HOLATLAR.includes(q.holat)) throw new HttpException(400, `holat noto'g'ri (${HOLATLAR.join(', ')})`);
      w.push('s.holat = :holat'); R.holat = q.holat;
    }
    if (!tasdiqlovchimi(req.currentUser)) { w.push('s.user_id = :me'); R.me = req.currentUser.id; }
    else if (!bosmi(q.user_id)) { w.push('s.user_id = :uid'); R.uid = idOl(q.user_id, 'user_id'); }
    if (!bosmi(q.kassa_id)) { w.push('s.kassa_id = :kid'); R.kid = idOl(q.kassa_id, 'kassa_id'); }
    for (const [kalit, op, vaqt] of [['dan', '>=', 'T00:00:00'], ['gacha', '<=', 'T23:59:59.999']]) {
      if (bosmi(q[kalit])) continue;
      if (!U.sanaTogrimi(q[kalit])) throw new HttpException(400, `${kalit} YYYY-MM-DD formatda bo'lishi kerak`);
      w.push(`s.sana ${op} :${kalit}`); R[kalit] = new Date(`${q[kalit]}${vaqt}`);
    }
    const page = Math.max(1, parseInt(q.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(q.limit, 10) || 50));
    const where = w.join(' AND ');
    const [data, [jami]] = await Promise.all([
      sorovlarOl(where, R, { limit, offset: (page - 1) * limit }),
      Q(`SELECT COUNT(*) AS soni, COALESCE(SUM(s.summa), 0) AS summa FROM xarajat_sorov s WHERE ${where}`, R),
    ]);
    res.send({ data, jami: { soni: n(jami?.soni), summa: yax(jami?.summa) }, page, limit });
  };

  /* GET /xarajatlar/sorovlar/:id (+ audit) — boshqaning so'rovi (tasdiqlovchi bo'lmasa) → 404 */
  sorov = async (req, res) => {
    const x = await sorovBitta(idOl(req.params.id));
    if (!x || (!tasdiqlovchimi(req.currentUser) && Number(x.user_id) !== Number(req.currentUser.id))) throw new HttpException(404, "So'rov topilmadi");
    res.send({ ...x, audit: await auditRoyxat('xarajat_sorov', x.id) });
  };

  /* POST /xarajatlar/sorovlar/:id/tasdiqla { izoh? } — moliya 'approve' (routeda) */
  sorovTasdiqla = async (req, res) => {
    const id = idOl(req.params.id);
    const user = req.currentUser;
    const izoh = req.body && req.body.izoh ? String(req.body.izoh).trim().slice(0, 500) : null;
    await sequelize.transaction(async (tr) => {
      const s = await qulflabOl(XarajatSorovModel, id, tr);
      if (!s) throw new HttpException(404, "So'rov topilmadi");
      if (s.holat !== 'kutilmoqda') throw new HttpException(400, `So'rov allaqachon ${HOLAT_NOMI[s.holat]}`);
      if (Number(s.user_id) === Number(user.id) && !toliqmi(user)) throw new HttpException(403, "O'z so'rovingizni o'zingiz tasdiqlay olmaysiz");
      const k = await kassaQulfla(s.kassa_id, tr);
      await kassaBalansTekshir(k.id, n(s.summa), tr);
      const rec = await KassaModel.create({
        tur: 'chiqim', kategoriya: s.kategoriya, summa: n(s.summa), tolov_usul: kassaUsul(k),
        manba_tur: 'xarajat', manba_id: s.id, mijoz_id: null, mijoz_nomi: null,
        izoh: s.izoh || null, sana: s.sana, user_id: s.user_id, chek_rasm: s.chek_rasm || null, kassa_id: k.id,
      }, { transaction: tr });
      const eski = sorovShakli(s);
      await s.update({
        holat: 'tasdiqlangan', tolov_usul: kassaUsul(k), tasdiqlagan_id: user.id, tasdiqlagan_nomi: userNomi(user),
        tasdiq_vaqt: new Date(), kassa_yozuv_id: rec.id,
      }, { transaction: tr });
      await auditYoz({ obyekt: 'xarajat_sorov', obyekt_id: s.id, amal: 'tasdiqlandi', eski, yangi: sorovShakli(s), sabab: izoh, user }, tr);
    });
    res.send(await sorovBitta(id));
  };

  /* POST /xarajatlar/sorovlar/:id/rad { sabab } — sabab 3..500 majburiy */
  sorovRad = async (req, res) => {
    const id = idOl(req.params.id);
    const user = req.currentUser;
    const sabab = sababOl(req.body && req.body.sabab);
    await sequelize.transaction(async (tr) => {
      const s = await qulflabOl(XarajatSorovModel, id, tr);
      if (!s) throw new HttpException(404, "So'rov topilmadi");
      if (s.holat !== 'kutilmoqda') throw new HttpException(400, `So'rov allaqachon ${HOLAT_NOMI[s.holat]}`);
      const eski = sorovShakli(s);
      await s.update({ holat: 'rad_etildi', rad_sababi: sabab, tasdiqlagan_id: user.id, tasdiqlagan_nomi: userNomi(user), tasdiq_vaqt: new Date() }, { transaction: tr });
      await auditYoz({ obyekt: 'xarajat_sorov', obyekt_id: s.id, amal: 'rad_etildi', eski, yangi: sorovShakli(s), sabab, user }, tr);
    });
    res.send(await sorovBitta(id));
  };

  /* POST /xarajatlar/sorovlar/:id/bekor — faqat yaratuvchi, faqat kutilayotgan */
  sorovBekor = async (req, res) => {
    const id = idOl(req.params.id);
    const user = req.currentUser;
    await sequelize.transaction(async (tr) => {
      const s = await qulflabOl(XarajatSorovModel, id, tr);
      if (!s) throw new HttpException(404, "So'rov topilmadi");
      if (Number(s.user_id) !== Number(user.id)) {
        if (!tasdiqlovchimi(user)) throw new HttpException(404, "So'rov topilmadi");
        throw new HttpException(403, "Faqat so'rov egasi bekor qila oladi (siz rad etishingiz mumkin)");
      }
      if (s.holat !== 'kutilmoqda') throw new HttpException(400, `So'rov allaqachon ${HOLAT_NOMI[s.holat]}`);
      const eski = sorovShakli(s);
      await s.update({ holat: 'bekor' }, { transaction: tr });
      await auditYoz({ obyekt: 'xarajat_sorov', obyekt_id: s.id, amal: 'bekor_qilindi', eski, yangi: sorovShakli(s), user }, tr);
    });
    res.send(await sorovBitta(id));
  };

  /* DELETE /xarajatlar/:id */
  delete = async (req, res) => {
    const rec = await KassaModel.findByPk(req.params.id);
    const turlar = await xarajatTurlari();
    if (!rec || rec.tur !== 'chiqim' || !turlar.has(rec.kategoriya)) throw new HttpException(404, 'Xarajat topilmadi');
    if (!TAHRIR_MANBA.includes(rec.manba_tur)) throw new HttpException(400, "Bu avtomatik yozuv — o'chirib bo'lmaydi");
    if (await tasdiqlanganSorovYozuvimi(rec.id)) throw new HttpException(400, TASDIQLI_OCHIRISH_XATO);
    const rasm = rec.chek_rasm;
    await rec.destroy();
    await yozuvRasminiOchir(rasm);
    res.send({ message: "O'chirildi" });
  };
}

module.exports = new XarajatController();
