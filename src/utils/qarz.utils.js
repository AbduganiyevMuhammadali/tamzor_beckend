/**
 * MIJOZ QARZI QISMLARI — qarz qaysi sotuvlarga tegishli va qachon to'lanishi kerak.
 *
 * Mijoz balansi = to'lovlar − yetkazilgan savdolar (manfiy = qarz). To'lovlar eng
 * eski savdolarni yopadi (FIFO), demak qolgan qarz eng YANGI qarzli savdolarga
 * tegishli. Har sotuvning "qarzga ketgan" qismi:
 *   • naqd sotuv — joyida olingan pul (tolangan_summa) yetmagan qism, aks holda 0;
 *   • qarz / qisman / boshqa — summa − joyida olingan pul.
 * Bu yetmasa (eski ma'lumot), qolgan qarz qolgan savdolarga, undan ham ortsa —
 * "boshlang'ich qoldiq" (sanasi noma'lum) deb belgilanadi.
 *
 * To'lov sanasi: agent qarzga sotuvda kalendardan belgilagan `ariza.tolov_sana`,
 * bo'lmasa — sotuv sanasi + mijozning to'lov muddati (tolov_muddati_kun, standart 30).
 * Shu qoida hisobotlar (Mijozlar qarzi, Biznes holati) va kredit tekshiruvida bir xil.
 */
const sequelize = require('../db/db-sequelize');

const NAQD = ['naqt', 'naqd'];
const n = v => Number(v) || 0;
const kunBoshi = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const kunQosh = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };
const isoKun = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * @param mijozlar [{ id, balans, tolov_muddati_kun }]
 * @returns Map<mijoz_id, Qism[]> — Qism: { ariza_id, raqam, sana, summa, tolov_sana (YYYY-MM-DD|null),
 *          belgilangan (agent kalendardan qo'ygan), yosh_kun, kechikkan_kun (0 — muddati o'tmagan) }
 */
async function qarzQismlari(mijozlar, { transaction } = {}) {
  const qarzdor = mijozlar.filter(m => n(m.balans) < -0.5);
  const natija = new Map();
  if (!qarzdor.length) return natija;

  const savdolar = await sequelize.query(`
    SELECT id, raqam, mijoz_id, COALESCE(yetkazilgan_sana, createdAt) AS sana,
           jami_summa, tolangan_summa, tolov_turi, tolov_sana
    FROM ariza
    WHERE turi IN ('sotish', 'diller_sotuv') AND holat = 'yetkazildi' AND deletedAt IS NULL AND mijoz_id IN (:ids)
    ORDER BY sana DESC, id DESC`,
  { replacements: { ids: qarzdor.map(m => m.id) }, type: sequelize.QueryTypes.SELECT, transaction });

  const guruh = new Map();
  savdolar.forEach(s => { if (!guruh.has(s.mijoz_id)) guruh.set(s.mijoz_id, []); guruh.get(s.mijoz_id).push(s); });

  const bugun = kunBoshi();
  for (const m of qarzdor) {
    const muddat = parseInt(m.tolov_muddati_kun, 10) || 30;
    const ss = guruh.get(m.id) || [];
    let qoldi = -n(m.balans);
    const band = new Map();               // ariza_id → shu sotuvga yozilgan qarz
    const qismlar = [];
    const yoz = (s, summa) => {
      band.set(s.id, (band.get(s.id) || 0) + summa);
      qoldi -= summa;
    };
    // 1) qarzga ketgan qismlar — yangidan eskiga
    for (const s of ss) {
      if (qoldi <= 0.5) break;
      const jami = n(s.jami_summa), tol = n(s.tolangan_summa);
      const kredit = NAQD.includes(String(s.tolov_turi || '').toLowerCase()) ? (tol > 0 ? Math.max(0, jami - tol) : 0) : Math.max(0, jami - tol);
      if (kredit > 0.5) yoz(s, Math.min(qoldi, kredit));
    }
    // 2) yetmasa — qolgan savdo summalari (eski ma'lumotda to'lov turi ko'rsatilmagan)
    for (const s of ss) {
      if (qoldi <= 0.5) break;
      const bosh = n(s.jami_summa) - (band.get(s.id) || 0);
      if (bosh > 0.5) yoz(s, Math.min(qoldi, bosh));
    }
    for (const s of ss) {
      const summa = band.get(s.id);
      if (!summa) continue;
      const sana = new Date(s.sana);
      const belgilangan = !!s.tolov_sana;
      const tolovSana = belgilangan ? new Date(`${String(s.tolov_sana).slice(0, 10)}T00:00:00`) : kunQosh(kunBoshi(sana), muddat);
      qismlar.push({
        ariza_id: s.id, raqam: s.raqam, sana: s.sana, summa: Math.round(summa),
        tolov_sana: isoKun(tolovSana), belgilangan,
        yosh_kun: Math.max(0, Math.floor((bugun - kunBoshi(sana)) / 86400000)),
        kechikkan_kun: Math.max(0, Math.floor((bugun - tolovSana) / 86400000)),
      });
    }
    // 3) savdolar bilan tushuntirib bo'lmagan qoldiq — boshlang'ich qarz, sanasi noma'lum
    if (qoldi > 0.5) {
      qismlar.push({ ariza_id: null, raqam: null, sana: null, summa: Math.round(qoldi), tolov_sana: null, belgilangan: false, yosh_kun: null, kechikkan_kun: null });
    }
    natija.set(m.id, qismlar);
  }
  return natija;
}

module.exports = { qarzQismlari, kunBoshi, isoKun };
