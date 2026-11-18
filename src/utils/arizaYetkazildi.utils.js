const { MijozModel } = require('../models/mijoz.model');
const AgentModel = require('../models/agent.model');
const AgentRegisterModel = require('../models/agent_register.model');
const KassaModel = require('../models/kassa.model');

// Ariza "yetkazildi" holatiga o'tganda bajarilishi shart bo'lgan barcha
// yon-effektlar: to'lov/qarz, agent plan-fakt+bonus yozuvi, kassa kirimi.
// Web (ariza.controller.js changeHolat), mobil delivery (orderDelivery) va
// dostavchik ilovasi (dostavchik.controller.js) — barcha yo'llar shu
// funksiyani chaqiradi, aks holda yetkazilgan buyurtmalar agent
// statistikasi/oylik planidan va kassadan tushib qolib qoladi.
//
// kassaManbaTur: 'ariza' (odatiy), 'avtolavka' (mashinadan naqd sotuv) yoki
//   'dostavchik' (yetkazishda olingan naqd — dostavchik qo'lida, inkassatsiya
//   uni dostavchik yig'gan pul sifatida sanaydi, user_id = dostavchi).
// tolangan: yetkazishda joyida olingan naqd. Berilmasa (null) — eski mantiq:
//   tolov_turi naqd bo'lsa to'liq summa, aks holda hammasi qarzga.
//   Berilsa — shu summa kassaga, qolgani (jami − tolangan) mijoz qarziga.
// sana: amalning haqiqiy vaqti (mobil oflayn sotuv keyin yuborilganda) — kassa va agent registri shu kunga yoziladi.
async function arizaYetkazildiEffektlari(ariza, {
  transaction, userId = null, kassaManbaTur = 'ariza', tolangan = null, izoh = null, sana = null,
} = {}) {
  const vaqt = sana || new Date();
  const summa = parseFloat(ariza.jami_summa || 0);
  const naqdMi = ariza.tolov_turi === 'naqt' || ariza.tolov_turi === 'naqd';
  const naqd = tolangan === null || tolangan === undefined
    ? (naqdMi ? summa : 0)
    : Math.max(0, Math.min(summa, parseFloat(tolangan) || 0));
  const qarz = +(summa - naqd).toFixed(2);

  if (naqd > 0) {
    await KassaModel.create({
      tur:        'kirim',
      kategoriya: 'sotuv',
      summa:      naqd,
      tolov_usul: 'naqt',
      manba_tur:  kassaManbaTur,
      manba_id:   ariza.id,
      mijoz_id:   ariza.mijoz_id,
      mijoz_nomi: ariza.mijoz_nomi,
      izoh:       izoh || `${ariza.raqam} — ${qarz > 0 ? 'qisman naqd' : 'naqd sotuv'}`,
      sana:       vaqt,
      user_id:    userId,
    }, { transaction });
  }
  if (qarz > 0.005 && ariza.mijoz_id) {
    await MijozModel.decrement('balans', { by: qarz, where: { id: ariza.mijoz_id }, transaction });
  }

  if (ariza.agent_id) {
    const agent = await AgentModel.findByPk(ariza.agent_id, { transaction });
    const bonusFoiz  = agent ? parseFloat(agent.bonus_foiz || 0) : 0;
    const bonusSumma = Math.round(summa * bonusFoiz / 100);
    await AgentRegisterModel.create({
      agent_id:    ariza.agent_id,
      ariza_id:    ariza.id,
      tur:         'savdo',
      summa,
      bonus_foiz:  bonusFoiz,
      bonus_summa: bonusSumma,
      sana:        vaqt,
      izoh:        `${ariza.raqam} — ${ariza.mijoz_nomi || 'mijoz'}`,
    }, { transaction });
  }
  return { naqd, qarz };
}

module.exports = { arizaYetkazildiEffektlari };
