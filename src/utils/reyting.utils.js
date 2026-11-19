/**
 * MIJOZ REYTINGI — mijozning buyurtma va to'lov intizomi ballari (foydalanuvchi so'rovi 2026-11-10).
 *
 * Ball 0…200, yangi mijoz 100 dan boshlanadi. Darajalar (DARAJALAR):
 *   150+ A'lo · 110+ Yaxshi · 70+ O'rta · 30+ Past · 0–29 Kritik.
 * Hodisalar (ball Sozlamalar → Mijoz reytingi'da o'zgaradi, standart qiymatlar STANDART'da):
 *   buyurtma       +10  savdo   — mijoz zakaz berdi / sotib oldi (mobil zakaz, Won Sell sotuvi, web zakaz).
 *                                  Zakaz bekor qilinsa yoki o'chirilsa — ball qaytariladi (reytingQaytar).
 *   rad_etildi     −10  savdo   — agent "Sotmadim / rad etdi" + sabab. Neytral sabab ("Do'kon yopiq") ball
 *                                  bermaydi va ketma-ketlikka kirmaydi. Ketma-ket `kritik_soni` (5) marta
 *                                  rad etilsa — reyting Kritik'ga (0) tushiriladi ('kritik' yozuvi).
 *   tolov_surildi  −15  moliya  — agent "To'lov surildi": mijoz qarzni to'lamay, boshqa kunga va'da berdi.
 *   tolov_qabul    +15  moliya  — qarzdor mijozdan to'lov qabul qilindi (agent, dostavchik, kassa).
 *                                  To'lov o'chirilsa — ball qaytariladi.
 *   qolda          ±    — admin tuzatishi (izoh majburiy).
 * Har tur bo'yicha kuniga bitta hodisa ball oladi; o'sha kunning keyingilari tarixda 0 ball bilan qoladi —
 * bir kunda bir nechta zakaz / to'lov / rad etish reytingni sun'iy oshirib-tushirmasin.
 * Faqat shu util `mijoz.reyting*` ustunlarini o'zgartiradi. Chaqiruvchining tranzaksiyasi ichida ishlaydi.
 */
const { Op } = require('sequelize');
const sequelize = require('../db/db-sequelize');
const SozlamaModel = require('../models/sozlama.model');
const MijozReytingModel = require('../models/mijozReyting.model');
const HttpException = require('./HttpException.utils');

const BOSH = 100, MIN = 0, MAX = 200;
const STANDART = { buyurtma: 10, rad_etildi: -10, tolov_surildi: -15, tolov_qabul: 15, kritik_soni: 5 };
const KALIT = { buyurtma: 'reyting_buyurtma', rad_etildi: 'reyting_rad', tolov_surildi: 'reyting_surildi', tolov_qabul: 'reyting_tolov', kritik_soni: 'reyting_kritik_soni' };
const DARAJALAR = [
  { kod: 'alo',    nom: "A'lo",   min: 150 },
  { kod: 'yaxshi', nom: 'Yaxshi', min: 110 },
  { kod: 'orta',   nom: "O'rta",  min: 70 },
  { kod: 'past',   nom: 'Past',   min: 30 },
  { kod: 'kritik', nom: 'Kritik', min: 0 },
];
/* Rad etish sabablari ichida ball bermaydiganlari: mijoz rad etmagan, do'kon yopiq bo'lgan */
const NEYTRAL_SABAB = new Set(['1']);
const YONALISH = { buyurtma: 'savdo', rad_etildi: 'savdo', kritik: 'savdo', tolov_qabul: 'moliya', tolov_surildi: 'moliya' };

const daraja = (ball) => DARAJALAR.find(d => (Number(ball) || 0) >= d.min) || DARAJALAR[DARAJALAR.length - 1];
const darajaChegara = (kod) => {
  const i = DARAJALAR.findIndex(d => d.kod === kod);
  if (i < 0) return null;
  return { dan: DARAJALAR[i].min, gacha: i === 0 ? MAX : DARAJALAR[i - 1].min - 1 };
};

async function qoidalar(transaction = null) {
  const rows = await SozlamaModel.findAll({ where: { kalit: Object.values(KALIT) }, raw: true, transaction });
  const m = Object.fromEntries(rows.map(r => [r.kalit, r.qiymat]));
  const q = {};
  for (const [k, kalit] of Object.entries(KALIT)) {
    const v = m[kalit];
    q[k] = v !== undefined && v !== null && v !== '' && !isNaN(Number(v)) ? Math.round(Number(v)) : STANDART[k];
  }
  q.kritik_soni = Math.max(2, q.kritik_soni);
  return { ...q, bosh: BOSH, min: MIN, max: MAX, darajalar: DARAJALAR, neytral_sabablar: [...NEYTRAL_SABAB] };
}

async function qoidalarniYoz(body) {
  // Avval HAMMA kalit tekshiriladi, keyin hammasi bitta tranzaksiyada yoziladi —
  // bittasi xato bo'lsa qolganlari ham yozilmaydi (yarim saqlangan sozlama bo'lmaydi)
  const yoz = [];
  for (const [k, kalit] of Object.entries(KALIT)) {
    if (body[k] === undefined) continue;
    const v = Math.round(Number(body[k]));
    if (!Number.isFinite(v)) throw new HttpException(400, `"${k}" son bo'lishi kerak`);
    if (k === 'kritik_soni' && (v < 2 || v > 30)) throw new HttpException(400, 'Ketma-ket rad etish soni 2 dan 30 gacha');
    if (k !== 'kritik_soni' && Math.abs(v) > 100) throw new HttpException(400, 'Ball −100…+100 oralig\'ida bo\'lsin');
    if ((k === 'buyurtma' || k === 'tolov_qabul') && v < 0) throw new HttpException(400, 'Zakaz va to\'lov uchun ball manfiy bo\'lmaydi');
    if ((k === 'rad_etildi' || k === 'tolov_surildi') && v > 0) throw new HttpException(400, 'Rad etish va to\'lov surilishi uchun ball musbat bo\'lmaydi');
    yoz.push({ k, kalit, v });
  }
  if (yoz.length) {
    await sequelize.transaction(async (transaction) => {
      for (const { k, kalit, v } of yoz) {
        const [row] = await SozlamaModel.findOrCreate({ where: { kalit }, defaults: { qiymat: String(v), izoh: `Mijoz reytingi: ${k}` }, transaction });
        await row.update({ qiymat: String(v) }, { transaction });
      }
    });
  }
  return qoidalar();
}

function kunOraligi(sana) {
  const d = new Date(sana || Date.now());
  const dan = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return { dan, gacha: new Date(dan.getTime() + 864e5) };
}

/**
 * Hodisani yozadi va mijoz reytingini yangilaydi.
 * o: { tur, sabab_id, sabab, izoh, summa, vada_sana, manba_tur, manba_id, xodim: {rol,id,nomi}, mobil_id, sana, ball (qolda), yonalish (qolda) }
 * Qaytaradi: { yozuv, reyting, daraja, kritik } yoki null (yozilmadi).
 */
async function reytingYoz(mijozId, o, transaction = null) {
  if (!mijozId) return null;
  const ish = async (t) => {
    if (o.mobil_id) {
      const bor = await MijozReytingModel.findOne({ where: { mobil_id: o.mobil_id }, transaction: t });
      if (bor) return { yozuv: bor, takror: true };
    }
    if (o.manba_tur && o.manba_id && o.tur !== 'qolda') {
      const bor = await MijozReytingModel.findOne({ where: { tur: o.tur, manba_tur: o.manba_tur, manba_id: o.manba_id }, transaction: t });
      if (bor) return { yozuv: bor, takror: true };
    }
    const { MijozModel } = require('../models/mijoz.model');
    const m = await MijozModel.findByPk(mijozId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!m) return null;
    const Q = await qoidalar(t);
    const sana = o.sana ? new Date(o.sana) : new Date();
    let ball = 0, izohQosh = null;
    let radKetma = Number(m.rad_ketma_ket) || 0;

    if (o.tur === 'qolda') {
      ball = Math.round(Number(o.ball) || 0);
    } else {
      ball = Q[o.tur] ?? 0;
      if (o.tur === 'rad_etildi' && NEYTRAL_SABAB.has(String(o.sabab_id || ''))) { ball = 0; izohQosh = "ta'sir qilmaydi — mijoz rad etmagan"; }
      if (ball !== 0) {
        const { dan, gacha } = kunOraligi(sana);
        const shuKun = await MijozReytingModel.count({
          where: { mijoz_id: m.id, tur: o.tur, ball: { [Op.ne]: 0 }, sana: { [Op.gte]: dan, [Op.lt]: gacha } }, transaction: t,
        });
        if (shuKun > 0) { ball = 0; izohQosh = 'shu kuni allaqachon hisoblangan'; }
      }
    }
    if (o.tur === 'rad_etildi' && ball !== 0) radKetma += 1;
    if (o.tur === 'buyurtma') radKetma = 0;

    const eski = Number(m.reyting);
    const yangi = Math.max(MIN, Math.min(MAX, eski + ball));
    const qollangan = yangi - eski;
    const yonalish = o.tur === 'qolda' ? (o.yonalish === 'moliya' ? 'moliya' : 'savdo') : YONALISH[o.tur];
    const yozuv = await MijozReytingModel.create({
      mijoz_id: m.id, tur: o.tur, yonalish, ball: qollangan, reyting_keyin: yangi,
      sabab_id: o.sabab_id || null, sabab: o.sabab ? String(o.sabab).slice(0, 150) : null,
      izoh: [o.izoh, izohQosh].filter(Boolean).join(' · ').slice(0, 255) || null,
      summa: o.summa != null ? Number(o.summa) : null, vada_sana: o.vada_sana || null,
      manba_tur: o.manba_tur || null, manba_id: o.manba_id || null,
      xodim_rol: o.xodim?.rol || null, xodim_id: o.xodim?.id || null, xodim_nomi: o.xodim?.nomi || null,
      mobil_id: o.mobil_id || null, sana,
    }, { transaction: t });

    const upd = {
      reyting: yangi, rad_ketma_ket: radKetma, reyting_vaqt: new Date(),
      [yonalish === 'moliya' ? 'reyting_moliya' : 'reyting_savdo']: Number(m[yonalish === 'moliya' ? 'reyting_moliya' : 'reyting_savdo']) + qollangan,
    };
    if (o.tur === 'tolov_surildi' && o.vada_sana) upd.tolov_vada_sana = o.vada_sana;
    if (o.tur === 'tolov_qabul' && o.qarzYopildi) upd.tolov_vada_sana = null;

    // Ketma-ket rad etish chegarasi — reyting Kritik (0) ga tushadi
    let kritik = false;
    if (o.tur === 'rad_etildi' && qollangan !== 0 && radKetma >= Q.kritik_soni && yangi > MIN) {
      const pas = MIN - yangi;
      await MijozReytingModel.create({
        mijoz_id: m.id, tur: 'kritik', yonalish: 'savdo', ball: pas, reyting_keyin: MIN,
        sabab: `${radKetma} marta ketma-ket rad etdi`, izoh: 'Reyting avtomatik Kritik darajaga tushirildi',
        manba_tur: o.manba_tur || null, manba_id: o.manba_id || null,
        xodim_rol: o.xodim?.rol || null, xodim_id: o.xodim?.id || null, xodim_nomi: o.xodim?.nomi || null,
        sana: new Date(sana.getTime() + 1000),
      }, { transaction: t });
      upd.reyting = MIN; upd.reyting_savdo += pas; kritik = true;
    }
    await m.update(upd, { transaction: t });
    return { yozuv, reyting: upd.reyting, daraja: daraja(upd.reyting), kritik };
  };
  if (transaction) return ish(transaction);
  return sequelize.transaction(ish);
}

/** Manba (zakaz / to'lov) bekor bo'lsa yoki o'chsa — shu manba bergan ball qaytariladi, yozuvlar o'chadi */
async function reytingQaytar({ manba_tur, manba_id }, transaction = null) {
  if (!manba_tur || !manba_id) return 0;
  const ish = async (t) => {
    const yozuvlar = await MijozReytingModel.findAll({ where: { manba_tur, manba_id, tur: { [Op.in]: ['buyurtma', 'tolov_qabul'] } }, transaction: t });
    if (!yozuvlar.length) return 0;
    const { MijozModel } = require('../models/mijoz.model');
    for (const y of yozuvlar) {
      const m = await MijozModel.findByPk(y.mijoz_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (m && y.ball) {
        const yangi = Math.max(MIN, Math.min(MAX, Number(m.reyting) - Number(y.ball)));
        const qaytdi = yangi - Number(m.reyting);
        const ustun = y.yonalish === 'moliya' ? 'reyting_moliya' : 'reyting_savdo';
        await m.update({ reyting: yangi, [ustun]: Number(m[ustun]) + qaytdi, reyting_vaqt: new Date() }, { transaction: t });
      }
      await y.destroy({ transaction: t });
    }
    return yozuvlar.length;
  };
  if (transaction) return ish(transaction);
  return sequelize.transaction(ish);
}

/** Mobil ilova va web ro'yxati uchun qisqa ko'rinish */
const reytingKorinish = (m) => {
  const r = Number(m.reyting ?? BOSH), d = daraja(r);
  return { reyting: r, daraja: d.kod, darajaNomi: d.nom, radKetmaKet: Number(m.rad_ketma_ket) || 0, tolovVada: m.tolov_vada_sana || null };
};

module.exports = { reytingYoz, reytingQaytar, qoidalar, qoidalarniYoz, daraja, darajaChegara, reytingKorinish, DARAJALAR, NEYTRAL_SABAB, BOSH, MIN, MAX };
