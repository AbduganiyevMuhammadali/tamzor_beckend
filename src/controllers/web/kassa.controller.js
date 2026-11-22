const { Op, fn, col } = require('sequelize');
const { reytingYoz, reytingQaytar } = require('../../utils/reyting.utils');
const sequelize = require('../../db/db-sequelize');
const KassaModel = require('../../models/kassa.model');
const { MijozModel } = require('../../models/mijoz.model');
const HttpException = require('../../utils/HttpException.utils');
const BaseController = require('../BaseController');
const { xarajatTurlari } = require('../../utils/xarajat.utils');

// Kategoriya yorliqlari (frontda ko'rsatish uchun)
const KATEGORIYA = {
  sotuv:             { label: 'Sotuv (naqd)',        tur: 'kirim' },
  sotuv_qaytarish:   { label: 'Qaytarish (naqd mijozga qaytarildi)', tur: 'chiqim' },   // mobil savdoQaytarish, user_id = agent
  mijoz_tolov:       { label: 'Mijoz to\'lovi',       tur: 'kirim' },
  dostavchik_inkassatsiya: { label: 'Dostavchik naqd topshirdi', tur: 'chiqim' },
  boshqa_daromad:    { label: 'Boshqa daromad',       tur: 'kirim' },
  boshlangich_kapital: { label: 'Boshlang\'ich qoldiq (kapital)', tur: 'kirim' },   // tizimga o'tishdagi pul / egadan kiritilgan — daromad emas
  yetkazuvchi_tolov: { label: 'Yetkazuvchiga to\'lov', tur: 'chiqim' },
  xarajat:           { label: 'Xarajat',              tur: 'chiqim' },
  ish_haqi:          { label: 'Ish haqi',             tur: 'chiqim' },
  ijara:             { label: 'Ijara',                tur: 'chiqim' },
  boshqa_chiqim:     { label: 'Boshqa chiqim',        tur: 'chiqim' },
  ishlab_chiqarish:  { label: 'Ishlab chiqarish xarajati', tur: 'chiqim' },
  // Moliya → Qarz oldi-berdi (uchinchi shaxslar): daromad ham, xarajat ham emas — qarz harakati
  qarz_berildi:      { label: 'Qarz berildi',            tur: 'chiqim' },
  qarz_qaytdi:       { label: 'Berilgan qarz qaytdi',    tur: 'kirim' },
  qarz_olindi:       { label: 'Qarz olindi',             tur: 'kirim' },
  qarz_qaytarildi:   { label: 'Olingan qarz qaytarildi', tur: 'chiqim' },
};

/* Faqat avtomatik (tizim) yozadigan kategoriyalar — qo'lda kiritib bo'lmaydi:
 * ular o'z bo'limida yaratiladi va bog'liq hisobni (yetkazuvchi/shaxs/dostavchi balansi,
 * sotuv) ham to'g'rilaydi. Kassa sahifasidan kiritilsa hisob buziladi. */
const TIZIM_KATEGORIYA = new Set([
  'sotuv', 'sotuv_qaytarish', 'dostavchik_inkassatsiya', 'yetkazuvchi_tolov', 'ishlab_chiqarish',
  'qarz_berildi', 'qarz_qaytdi', 'qarz_olindi', 'qarz_qaytarildi',
]);

const TOLOV_USUL = ['naqt', 'karta', 'bank'];       // kassa.tolov_usul ENUM bilan bir xil
const USUL_NOMI = { naqt: 'Naqd', karta: 'Plastik', bank: 'Bank' };
const { KassalarModel } = require('../../models/kassalar.model');
const AgentModel = require('../../models/agent.model');
const HISOBOT_MAX_QATOR = 20000;                      // javobdagi harakatlar soni cheklovi

/* Ixtiyoriy idempotentlik kaliti (web: ikki marta bosish). kassa.mobil_id (UNIQUE) ga yoziladi. */
function sorovIdOl(v) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v).trim();
  if (!/^[A-Za-z0-9_.:-]{8,64}$/.test(s)) throw new HttpException(400, "sorov_id noto'g'ri (8–64 belgi: harf, raqam, - _ . :)");
  return s;
}
const takrorXato = (e) => !!e && (e.name === 'SequelizeUniqueConstraintError' || (e.parent && e.parent.code === 'ER_DUP_ENTRY'));

/* YYYY-MM-DD (ixtiyoriy vaqt bilan) sanani tekshiradi; noto'g'ri bo'lsa 400 */
function sanaOl(v, nomi) {
  if (v === undefined || v === null || v === '') return null;
  const s = String(v);
  const d = new Date(s);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || Number.isNaN(d.getTime())) {
    throw new HttpException(400, `${nomi} sanasi noto'g'ri (YYYY-MM-DD)`);
  }
  return d;
}

function periodRange(period, from_q, to_q) {
  const now = new Date();
  let from = new Date(now.getFullYear(), now.getMonth(), 1);
  let to   = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  if (from_q || to_q) {
    // Noto'g'ri sana 500 emas, 400 qaytaradi
    if (from_q) sanaOl(from_q, 'from');
    if (to_q)   sanaOl(to_q, 'to');
    from = from_q ? new Date(String(from_q).slice(0, 10) + 'T00:00:00') : new Date(2000, 0, 1);
    to   = to_q   ? new Date(String(to_q).slice(0, 10)   + 'T23:59:59') : now;
  } else if (period === 'today') {
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    to   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  } else if (period === 'week') {
    const d = now.getDay() || 7;
    from = new Date(now); from.setDate(now.getDate() - d + 1); from.setHours(0,0,0,0);
  } else if (period === 'year') {
    from = new Date(now.getFullYear(), 0, 1);
    to   = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
  }
  return { from, to };
}

class KassaController extends BaseController {

  // ── GET /kassa — hisobot (kirim/chiqim ro'yxati + jami) ──
  hisobot = async (req, res) => {
    const { period = 'month', from: fq, to: tq, tur, kategoriya, search, kassa_id, agent_id } = req.query;
    const { from, to } = periodRange(period, fq, tq);
    if (to < from) throw new HttpException(400, "Davr noto'g'ri: 'from' sanasi 'to' dan keyin");

    const where = { sana: { [Op.between]: [from, to] } };
    if (tur)        where.tur = tur;
    if (kategoriya) where.kategoriya = kategoriya;
    // 2026-11-22: kassa bo'yicha (kassa_id=0 — kassaga bog'lanmagan) va agent bo'yicha filtr
    if (kassa_id !== undefined && kassa_id !== '') {
      const k = Number(kassa_id);
      if (!Number.isInteger(k) || k < 0) throw new HttpException(400, "kassa_id noto'g'ri");
      where.kassa_id = k === 0 ? null : k;
    }
    if (agent_id !== undefined && agent_id !== '') {
      const a = Number(agent_id);
      if (!Number.isInteger(a) || a <= 0) throw new HttpException(400, "agent_id noto'g'ri");
      where.agent_id = a;
    }
    if (search) {
      where[Op.or] = [
        { mijoz_nomi: { [Op.like]: `%${String(search).slice(0, 100)}%` } },
        { izoh:       { [Op.like]: `%${String(search).slice(0, 100)}%` } },
      ];
    }

    // Cheksiz davr (masalan faqat `to` berilsa 2000-yildan) serverni yuklamasin
    const soni = await KassaModel.count({ where });
    if (soni > HISOBOT_MAX_QATOR) {
      throw new HttpException(400, `Tanlangan davrda yozuvlar juda ko'p (${soni}) — davrni qisqartiring yoki filtr qo'llang`);
    }
    const rows = await KassaModel.findAll({ where, order: [['sana', 'DESC'], ['id', 'DESC']] });
    // Xarajat toifalari nomi — foydalanuvchi o'zgartirgan bo'lishi mumkin (Moliya → Kunlik xarajatlar → Toifalar)
    const turlar = await xarajatTurlari();
    const yorliq = k => turlar.get(k)?.nomi || KATEGORIYA[k]?.label || k;

    const kIds = [...new Set(rows.map(r => r.kassa_id).filter(Boolean))];
    const aIds = [...new Set(rows.map(r => r.agent_id).filter(Boolean))];
    const kassaNom = new Map(kIds.length ? (await KassalarModel.findAll({ where: { id: kIds }, attributes: ['id', 'nomi'], raw: true })).map(k => [k.id, k.nomi]) : []);
    const agentNom = new Map(aIds.length ? (await AgentModel.findAll({ where: { id: aIds }, attributes: ['id', 'fullname'], raw: true, paranoid: false })).map(a => [a.id, a.fullname]) : []);
    const kirim  = rows.filter(r => r.tur === 'kirim').reduce((s, r) => s + r.summa, 0);
    const chiqim = rows.filter(r => r.tur === 'chiqim').reduce((s, r) => s + r.summa, 0);

    // Kategoriya bo'yicha taqsimot
    const byKat = {};
    for (const r of rows) {
      const k = r.kategoriya;
      if (!byKat[k]) byKat[k] = { kategoriya: k, label: yorliq(k), tur: r.tur, summa: 0, soni: 0 };
      byKat[k].summa += r.summa;
      byKat[k].soni  += 1;
    }

    res.send({
      jami: {
        kirim,
        chiqim,
        qoldiq: kirim - chiqim,
        soni:   rows.length,
      },
      kategoriyalar: Object.values(byKat).sort((a, b) => b.summa - a.summa),
      harakatlar: rows.map(r => ({
        ...r.toJSON(),
        kategoriya_label: yorliq(r.kategoriya),
        // To'lov turi nomi: kassa nomi (2026-11-22), bo'lmasa usul bo'yicha; agent qo'lidagi naqd — "Agent: <ism>"
        kassa_nomi: r.kassa_id ? (kassaNom.get(r.kassa_id) || null) : null,
        tolov_turi_nomi: r.kassa_id && kassaNom.get(r.kassa_id) ? kassaNom.get(r.kassa_id)
          : (r.agent_id && agentNom.get(r.agent_id) ? `Agent: ${agentNom.get(r.agent_id)}` : (USUL_NOMI[r.tolov_usul] || r.tolov_usul)),
      })),
    });
  };

  // ── GET /kassa/kpi — umumiy qoldiq (period berilmasdan jami) ──
  kpi = async (req, res) => {
    const row = await KassaModel.findAll({
      attributes: ['tur', [fn('SUM', col('summa')), 'jami']],
      group: ['tur'], raw: true,
    });
    let kirim = 0, chiqim = 0;
    for (const r of row) {
      if (r.tur === 'kirim')  kirim  = parseFloat(r.jami || 0);
      if (r.tur === 'chiqim') chiqim = parseFloat(r.jami || 0);
    }
    res.send({ kirim, chiqim, qoldiq: kirim - chiqim });
  };

  // ── POST /kassa — qo'lda kirim/chiqim yoki mijoz to'lovi ──
  create = async (req, res) => {
    const { tur, kategoriya, summa, mijoz_id, izoh, sana } = req.body;
    let { tolov_usul } = req.body;
    if (!tur || !['kirim','chiqim'].includes(tur)) throw new HttpException(400, 'Tur noto\'g\'ri');
    if (!kategoriya) throw new HttpException(400, 'Kategoriya kerak');
    if (!summa || !Number.isFinite(Number(summa)) || Number(summa) <= 0) throw new HttpException(400, 'Summa noto\'g\'ri');
    // Tizim kategoriyalari faqat o'z bo'limidan yoziladi
    if (TIZIM_KATEGORIYA.has(kategoriya)) {
      throw new HttpException(400, 'Bu kategoriya avtomatik yoziladi — uni o\'z bo\'limidan kiriting');
    }
    // Ma'lum kategoriya bo'lsa, tur unga mos bo'lishi shart (mijoz_tolov — faqat kirim)
    if (KATEGORIYA[kategoriya]) {
      if (KATEGORIYA[kategoriya].tur !== tur) throw new HttpException(400, 'Kategoriya va tur mos emas');
    } else {
      // Boshqa kod — faqat foydalanuvchi xarajat toifasi (chiqim) bo'lishi mumkin
      const turlar = await xarajatTurlari();
      if (!turlar.has(kategoriya)) throw new HttpException(400, 'Kategoriya noto\'g\'ri');
      if (tur !== 'chiqim') throw new HttpException(400, 'Kategoriya va tur mos emas');
    }
    if (kategoriya === 'mijoz_tolov' && !mijoz_id) throw new HttpException(400, 'Mijoz tanlanmagan');
    if (tolov_usul != null && tolov_usul !== '' && !TOLOV_USUL.includes(tolov_usul)) {
      throw new HttpException(400, `To'lov usuli noto'g'ri (${TOLOV_USUL.join(', ')})`);
    }
    if (izoh != null && String(izoh).length > 255) throw new HttpException(400, 'Izoh 255 belgidan oshmasin');
    const sanaQiymat = sanaOl(sana, 'sana');
    // 2026-11-27: limitli kassir (role 'User', xarajat_limit) Kassa sahifasi orqali limitni chetlab o'tmasin
    const cu = req.currentUser;
    if (tur === 'chiqim' && cu && cu.role === 'User' && cu.xarajat_limit !== null && cu.xarajat_limit !== undefined
        && Number(summa) > Number(cu.xarajat_limit) + 0.005) {
      throw new HttpException(400, `Summa limitingizdan (${Number(cu.xarajat_limit)}) oshadi — Xarajatlar bo'limidan tasdiqqa yuboring`);
    }
    // 2026-11-22: ixtiyoriy kassa_id — yozuv shu kassaga (kassa balansi). tolov_usul kassa turidan olinadi.
    let kassaId = null;
    if (req.body.kassa_id !== undefined && req.body.kassa_id !== null && req.body.kassa_id !== '') {
      const k = await KassalarModel.findByPk(Number(req.body.kassa_id));
      if (!k || !k.faol) throw new HttpException(400, 'Kassa topilmadi yoki faol emas');
      kassaId = k.id;
      const usul = k.tur === 'plastik' ? 'karta' : 'naqt';
      if (tolov_usul && tolov_usul !== usul && !(k.tur === 'plastik' && tolov_usul === 'bank')) {
        throw new HttpException(400, "To'lov usuli kassa turiga mos emas");
      }
      tolov_usul = tolov_usul || usul;
    }
    // mijoz_id faqat mijoz to'lovida saqlanadi: mijoz hisob-kitobi kassa kirimlarini mijoz_id
    // bo'yicha yig'adi — boshqa kategoriyadagi yozuv mijoz qarzini noto'g'ri kamaytirib ko'rsatardi
    const mijozId = kategoriya === 'mijoz_tolov' ? mijoz_id : null;

    // Ixtiyoriy idempotentlik: shu sorov_id bilan yozuv bor bo'lsa — yangisi yaratilmaydi
    const sorovId = sorovIdOl(req.body.sorov_id);
    const takrorJavob = async () => {
      const bor = await KassaModel.findOne({ where: { mobil_id: sorovId } });
      if (!bor) return false;
      const mos = bor.kategoriya === kategoriya && bor.tur === tur
        && Math.abs(bor.summa - Number(summa)) < 0.005
        && Number(bor.user_id || 0) === Number(req.currentUser?.id || 0);
      if (!mos) throw new HttpException(409, "Bu sorov_id boshqa kassa yozuviga tegishli");
      res.status(200).send(bor);
      return true;
    };
    if (sorovId && await takrorJavob()) return;

    const t = await sequelize.transaction();
    try {
      let mijoz_nomi = null, eskiBalans = null;
      // Mijoz to'lovi bo'lsa — balansni oshiramiz (qarz kamayadi)
      if (kategoriya === 'mijoz_tolov' && mijozId) {
        // Mijoz qatori qulflanadi: parallel to'lovlar eskiBalans/reytingni noto'g'ri hisoblamasin
        const m = await MijozModel.findByPk(mijozId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!m) throw new HttpException(404, 'Mijoz topilmadi');
        mijoz_nomi = m.nomi;
        eskiBalans = parseFloat(m.balans) || 0;
        await m.increment('balans', { by: Number(summa), transaction: t });
      }

      const rec = await KassaModel.create({
        tur,
        kategoriya,
        summa:      Number(summa),
        tolov_usul: tolov_usul || 'naqt',
        manba_tur:  kategoriya === 'mijoz_tolov' ? 'mijoz' : 'qol',
        manba_id:   kategoriya === 'mijoz_tolov' ? (mijozId || null) : null,
        mijoz_id:   mijozId || null,
        mijoz_nomi,
        izoh:       izoh || null,
        sana:       sanaQiymat || new Date(),
        user_id:    req.currentUser?.id || null,
        mobil_id:   sorovId,
        kassa_id:   kassaId,
      }, { transaction: t });

      // Mijoz reytingi: qarzdor mijoz to'ladi (+ball, kuniga bir marta; to'lov o'chirilsa qaytadi)
      if (eskiBalans !== null && eskiBalans < -0.5) {
        const u = req.currentUser || {};
        await reytingYoz(mijozId, {
          tur: 'tolov_qabul', sabab: "Qarz to'lovi (kassa)", summa: Number(summa), manba_tur: 'kassa', manba_id: rec.id,
          qarzYopildi: eskiBalans + Number(summa) >= -0.5,
          xodim: { rol: 'web', id: u.id || null, nomi: u.username || u.fullname || null }, sana: rec.sana,
        }, t);
      }

      await t.commit();
      res.status(201).send(rec);
    } catch (e) {
      if (!t.finished) await t.rollback();
      // Parallel takror (bir xil sorov_id) — UNIQUE indeks ushladi: mavjud yozuv qaytariladi
      if (sorovId && takrorXato(e) && await takrorJavob()) return;
      throw e;
    }
  };

  // ── DELETE /kassa/:id — faqat qo'lda kiritilganlarni o'chirish ──
  delete = async (req, res) => {
    const t = await sequelize.transaction();
    try {
      // Yozuv tranzaksiya ichida qulflab o'qiladi: parallel DELETE lar mijoz balansini
      // bir necha marta kamaytirmasin — ikkinchisi birinchisi commit bo'lgach 404 oladi
      const rec = await KassaModel.findByPk(req.params.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!rec) throw new HttpException(404, 'Topilmadi');
      if (rec.manba_tur === 'uchinchi_shaxs') {
        throw new HttpException(400, "Bu qarz oldi-berdi yozuvi — Moliya → Qarz oldi-berdi bo'limidan o'chiring (shaxs hisobi ham to'g'rilanadi)");
      }
      if (!['qol', 'mijoz', 'xarajat'].includes(rec.manba_tur)) {
        throw new HttpException(400, 'Avtomatik yozuvni o\'chirib bo\'lmaydi (sotuv/prixod)');
      }
      // Mijoz to'lovi bo'lsa — balansni qaytaramiz
      if (rec.kategoriya === 'mijoz_tolov' && rec.mijoz_id) {
        await MijozModel.decrement('balans', { by: rec.summa, where: { id: rec.mijoz_id }, transaction: t });
        await reytingQaytar({ manba_tur: 'kassa', manba_id: rec.id }, t);
      }
      await rec.destroy({ transaction: t });
      await t.commit();
      res.send({ message: 'O\'chirildi' });
    } catch (e) {
      await t.rollback();
      throw e;
    }
  };
}

module.exports = new KassaController();
