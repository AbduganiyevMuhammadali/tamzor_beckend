/**
 * DOSTAVCHIK INKASSATSIYASI.
 *
 * Dostavchik yetkazishda olgan naqd (manba_tur='dostavchik') va undirgan qarz
 * (manba_tur='mijoz_dostavchik') kassa.kirim bo'lib yoziladi, user_id = dostavchi.id —
 * ya'ni pul biznesniki, lekin hali dostavchik qo'lida. Kassirga topshirgani agentlardagi
 * kabi `inkassatsiya` jadvalida (dostavchi_id, sana) qatorida saqlanadi.
 *
 * Kassaga CHIQIM yozilmaydi. 2026-10-31 gacha topshirish kassa.chiqim
 * ('dostavchik_inkassatsiya') edi — Kassa sahifasi, KPI va dashboard uni xarajat deb
 * ayirib, kun qoldig'ini pul miqdoricha kamaytirardi (29.10: 2 554 000 kirim + shuncha
 * "chiqim" → 5 108 000 ko'rinadigan farq). Migratsiya 20261031000001 eski qatorlarni
 * inkassatsiya yozuviga ko'chirgan.
 */
const sequelize = require('../db/db-sequelize');
const { InkassatsiyaModel } = require('../models/inkassatsiya.model');
const HttpException = require('./HttpException.utils');
const { tzOffset } = require('./tahlil.utils');

const n = (v) => Number(v) || 0;

/** Shu kun dostavchik yig'gan naqd: yetkazish + qarz undirish */
async function dostavchiYigildi(dostavchiId, sana, transaction = null) {
  const [r] = await sequelize.query(`SELECT COALESCE(SUM(summa),0) summa, COUNT(*) soni,
      COALESCE(SUM(CASE WHEN manba_tur='dostavchik' THEN summa ELSE 0 END),0) yetkazish,
      COALESCE(SUM(CASE WHEN manba_tur='mijoz_dostavchik' THEN summa ELSE 0 END),0) qarz_undirish
    FROM kassa WHERE tur='kirim' AND tolov_usul='naqt' AND user_id=:id
      AND manba_tur IN ('dostavchik','mijoz_dostavchik')
      AND DATE(CONVERT_TZ(sana, '+00:00', :tz))=:sana`,
    // kassa.sana UTC saqlanadi — kun mahalliy (Toshkent) vaqt bo'yicha, agentlar inkassatsiyasi kabi
    { replacements: { id: dostavchiId, sana, tz: tzOffset() }, type: sequelize.QueryTypes.SELECT, transaction });
  return { summa: n(r.summa), soni: Number(r.soni || 0), yetkazish: n(r.yetkazish), qarz_undirish: n(r.qarz_undirish) };
}

/** Shu kun kassirga topshirgani (inkassatsiya yozuvi) */
async function dostavchiTopshirildi(dostavchiId, sana, transaction = null) {
  const row = await InkassatsiyaModel.findOne({ where: { dostavchi_id: dostavchiId, sana }, transaction });
  return { summa: row ? n(row.topshirilgan_summa) : 0, vaqt: row ? (row.tasdiqlagan_sana || row.updatedAt) : null, row };
}

const fmtSom = (v) => Math.round(Number(v) || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/**
 * Kassir dostavchikdan naqd qabul qildi — kun bo'yicha bitta yozuv.
 *   jami=false — summa avvalgisiga QO'SHILADI (Dostavchilar → Kassa: "yana shuncha oldim")
 *   jami=true  — summa kunning JAMI topshirilgani (Inkassatsiya sahifasi, agentlardagi kabi)
 *
 * Qo'shimcha tekshiruvlar qulflar OSTIDA (tranzaksiya ichida, eng so'nggi qiymat bilan) bajariladi:
 *   maxQoshish            — true (yoki son — ruxsat etilgan ortiqcha, standart 0.5): summa
 *                           kamomaddan (yig'ilgan − hozirgi topshirilgan) oshmasligi kerak, aks holda 400
 *   izohQosh              — satr qulflangan yozuvning izohi oxiriga qo'shiladi (izoh o'rniga)
 *   kutilganTopshirilgan  — mijoz ko'rgan topshirilgan summa; bazadagidan farq qilsa 409
 *   izoh                  — (eski) izohni butunlay almashtiradi
 */
async function dostavchiTopshir(dostavchi, sana, {
  summa, jami = false, izoh = null, userId = null,
  maxQoshish = false, izohQosh = null, kutilganTopshirilgan,
} = {}) {
  const s = Number(summa);
  if (!Number.isFinite(s) || s < 0) throw new HttpException(400, "Summa noto'g'ri");
  const kutilgan = kutilganTopshirilgan === undefined || kutilganTopshirilgan === null || kutilganTopshirilgan === ''
    ? null : Number(kutilganTopshirilgan);
  if (kutilgan !== null && !Number.isFinite(kutilgan)) throw new HttpException(400, "kutilgan topshirilgan summa noto'g'ri");
  return sequelize.transaction(async (transaction) => {
    // Dostavchi qatori qulflanadi: shu dostavchi bo'yicha parallel topshirishlar navbatma-navbat
    // bajariladi — "o'qib-qo'shib-yozish" da summa yo'qolmaydi, kun yozuvi ikki marta ochilmaydi
    const [d] = await sequelize.query('SELECT id FROM dostavchi WHERE id = :id FOR UPDATE', {
      replacements: { id: dostavchi.id }, type: sequelize.QueryTypes.SELECT, transaction,
    });
    if (!d) throw new HttpException(404, 'Dostavchi topilmadi');
    const yig = await dostavchiYigildi(dostavchi.id, sana, transaction);
    const [topilgan] = await InkassatsiyaModel.findOrCreate({
      where: { dostavchi_id: dostavchi.id, sana },
      defaults: { agent_id: null, agent_nomi: dostavchi.ism },
      transaction,
    });
    // Kun yozuvi ham qulflab qayta o'qiladi (eng so'nggi topshirilgan_summa)
    const row = await InkassatsiyaModel.findByPk(topilgan.id, { transaction, lock: transaction.LOCK.UPDATE });
    const hozirgi = n(row.topshirilgan_summa);
    if (kutilgan !== null && Math.abs(hozirgi - kutilgan) > 0.005) {
      throw new HttpException(409, "Ma'lumot o'zgargan, sahifani yangilang");
    }
    if (maxQoshish !== false && maxQoshish !== null && maxQoshish !== undefined) {
      const tol = typeof maxQoshish === 'number' && Number.isFinite(maxQoshish) ? maxQoshish : 0.5;
      const kamomad = +(yig.summa - hozirgi).toFixed(2);
      if (s > kamomad + tol) {
        throw new HttpException(400, kamomad > 0.5
          ? `Kamomad ${fmtSom(kamomad)} so'm — undan ko'p qabul qilib bo'lmaydi`
          : "Bu kunda kamomad yo'q");
      }
    }
    const topshirilgan = +((jami ? 0 : hozirgi) + s).toFixed(2);
    const farq = +(yig.summa - topshirilgan).toFixed(2);
    const yangiIzoh = izohQosh ? [row.izoh, izohQosh].filter(Boolean).join('\n') : (izoh || row.izoh);
    await row.update({
      agent_nomi: dostavchi.ism,
      yigilgan_summa: yig.summa, topshirilgan_summa: topshirilgan, farq,
      holat: farq > 0.5 ? 'kamomad' : 'yopiq',
      izoh: yangiIzoh,
      tasdiqlagan_id: userId, tasdiqlagan_sana: new Date(),
    }, { transaction });
    return { row, yigildi: yig.summa, topshirildi: topshirilgan, kerak: Math.max(0, farq) };
  });
}

module.exports = { dostavchiYigildi, dostavchiTopshirildi, dostavchiTopshir };
