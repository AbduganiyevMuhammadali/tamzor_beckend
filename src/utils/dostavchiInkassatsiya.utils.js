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

const n = (v) => Number(v) || 0;

/** Shu kun dostavchik yig'gan naqd: yetkazish + qarz undirish */
async function dostavchiYigildi(dostavchiId, sana, transaction = null) {
  const [r] = await sequelize.query(`SELECT COALESCE(SUM(summa),0) summa, COUNT(*) soni,
      COALESCE(SUM(CASE WHEN manba_tur='dostavchik' THEN summa ELSE 0 END),0) yetkazish,
      COALESCE(SUM(CASE WHEN manba_tur='mijoz_dostavchik' THEN summa ELSE 0 END),0) qarz_undirish
    FROM kassa WHERE tur='kirim' AND tolov_usul='naqt' AND user_id=:id
      AND manba_tur IN ('dostavchik','mijoz_dostavchik') AND DATE(sana)=:sana`,
    { replacements: { id: dostavchiId, sana }, type: sequelize.QueryTypes.SELECT, transaction });
  return { summa: n(r.summa), soni: Number(r.soni || 0), yetkazish: n(r.yetkazish), qarz_undirish: n(r.qarz_undirish) };
}

/** Shu kun kassirga topshirgani (inkassatsiya yozuvi) */
async function dostavchiTopshirildi(dostavchiId, sana, transaction = null) {
  const row = await InkassatsiyaModel.findOne({ where: { dostavchi_id: dostavchiId, sana }, transaction });
  return { summa: row ? n(row.topshirilgan_summa) : 0, vaqt: row ? (row.tasdiqlagan_sana || row.updatedAt) : null, row };
}

/**
 * Kassir dostavchikdan naqd qabul qildi — kun bo'yicha bitta yozuv.
 *   jami=false — summa avvalgisiga QO'SHILADI (Dostavchilar → Kassa: "yana shuncha oldim")
 *   jami=true  — summa kunning JAMI topshirilgani (Inkassatsiya sahifasi, agentlardagi kabi)
 */
async function dostavchiTopshir(dostavchi, sana, { summa, jami = false, izoh = null, userId = null } = {}) {
  const s = Number(summa);
  if (!Number.isFinite(s) || s < 0) throw new HttpException(400, "Summa noto'g'ri");
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
    const topshirilgan = +((jami ? 0 : n(row.topshirilgan_summa)) + s).toFixed(2);
    const farq = +(yig.summa - topshirilgan).toFixed(2);
    await row.update({
      agent_nomi: dostavchi.ism,
      yigilgan_summa: yig.summa, topshirilgan_summa: topshirilgan, farq,
      holat: farq > 0.5 ? 'kamomad' : 'yopiq',
      izoh: izoh || row.izoh,
      tasdiqlagan_id: userId, tasdiqlagan_sana: new Date(),
    }, { transaction });
    return { row, yigildi: yig.summa, topshirildi: topshirilgan, kerak: Math.max(0, farq) };
  });
}

module.exports = { dostavchiYigildi, dostavchiTopshirildi, dostavchiTopshir };
