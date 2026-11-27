'use strict';
/* AGENT KPI (2026-11-27) — bitta oy bo'yicha agentning o'z ko'rsatkichlari.
   Mobil (GET agentKpi — agent faqat o'zinikini) va web (GET /agents/:id/kpi) shu funksiyadan oladi.

   savdo     — agent_register (tur 'savdo'): sotuv summasi skidka va vozvratdan keyingi haqiqiy summa,
               bonus — shu yerdan (agent plan-fakti bilan bir xil manba). Diller: ariza 'diller_sotuv', plan/bonus yo'q.
   cheklar   — oyda yetkazilgan sotuvlar soni, sotilgan tovar (dona) — ariza_qator.jami_dona.
   yangi     — agentga biriktirilgan va shu oyda yaratilgan mijozlar.
   tashrif   — check-in soni, tashrif qilingan mijozlar, natija (savdo / sotmaslik).
   marshrut  — reja (marshrut_reja) bugungacha bo'lgan kunlar: rejadagi mijozga shu kuni tashrif bo'lsa bajarilgan.
   qarz      — mijozlardan yig'ilgan to'lov: naqd (kassa mijoz_tolov, agent_id) + tasdiqlangan plastik;
               tasdiq kutayotgan plastik alohida.
   kunlik    — oy kunlari bo'yicha sotuv summasi (grafik uchun). */
const sequelize = require('../db/db-sequelize');
const HttpException = require('./HttpException.utils');

const n = (v) => Number(v) || 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const kunKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** 'YYYY-MM' (berilmasa — joriy oy) → { oy, dan, gacha, danKun, gachaKun (oxirgi kun yoki bugun) } */
function oyOl(v) {
  const hozir = new Date();
  let oy = v === undefined || v === null || v === '' ? null : String(v);
  if (oy !== null && !/^\d{4}-(0[1-9]|1[0-2])$/.test(oy)) throw new HttpException(400, "oy YYYY-MM ko'rinishida bo'lsin");
  if (!oy) oy = `${hozir.getFullYear()}-${String(hozir.getMonth() + 1).padStart(2, '0')}`;
  const [y, m] = oy.split('-').map(Number);
  const dan = new Date(y, m - 1, 1), gacha = new Date(y, m, 1);
  const oxirgi = new Date(y, m, 0);
  const bugun = new Date(hozir.getFullYear(), hozir.getMonth(), hozir.getDate());
  const gachaKun = kunKey(oxirgi < bugun ? oxirgi : bugun);
  return { oy, dan, gacha, danKun: kunKey(dan), gachaKun, kunlarSoni: oxirgi.getDate(), kelajak: dan > bugun };
}

async function agentKpi(agent, oyParam) {
  const O = oyOl(oyParam);
  const R = { a: agent.id, dan: O.dan, gacha: O.gacha, danKun: O.danKun, gachaKun: O.gachaKun };
  const Q = (sql) => sequelize.query(sql, { replacements: R, type: sequelize.QueryTypes.SELECT });
  const diller = !!agent.diller;
  const SOTUV = diller ? `turi = 'diller_sotuv'` : `turi = 'sotish'`;

  const [[reg], [chek], [yangi], [tash], [marsh], [naqd], [plas], kunRows] = await Promise.all([
    diller
      ? Q(`SELECT COALESCE(SUM(jami_summa), 0) summa, 0 bonus FROM ariza WHERE agent_id = :a AND ${SOTUV} AND holat = 'yetkazildi'
             AND deletedAt IS NULL AND yetkazilgan_sana >= :dan AND yetkazilgan_sana < :gacha`)
      : Q(`SELECT COALESCE(SUM(summa), 0) summa, COALESCE(SUM(bonus_summa), 0) bonus FROM agent_register
             WHERE agent_id = :a AND tur = 'savdo' AND sana >= :dan AND sana < :gacha`),
    Q(`SELECT COUNT(*) soni, COUNT(DISTINCT a.mijoz_id) mijozlar,
         COALESCE((SELECT SUM(q.jami_dona) FROM ariza_qator q JOIN ariza a2 ON a2.id = q.ariza_id WHERE a2.agent_id = :a AND a2.${SOTUV}
           AND a2.holat = 'yetkazildi' AND a2.deletedAt IS NULL AND a2.yetkazilgan_sana >= :dan AND a2.yetkazilgan_sana < :gacha), 0) dona
       FROM ariza a WHERE a.agent_id = :a AND a.${SOTUV} AND a.holat = 'yetkazildi' AND a.deletedAt IS NULL
         AND a.yetkazilgan_sana >= :dan AND a.yetkazilgan_sana < :gacha`),
    Q(`SELECT COUNT(*) soni FROM mijoz WHERE agent_id = :a AND deletedAt IS NULL AND createdAt >= :dan AND createdAt < :gacha`),
    Q(`SELECT COUNT(*) soni, COUNT(DISTINCT mijoz_id) mijozlar, COALESCE(SUM(natija = 'savdo'), 0) savdo, COALESCE(SUM(natija = 'sotmaslik'), 0) sotmaslik
       FROM tashrif WHERE agent_id = :a AND sana >= :danKun AND sana <= :gachaKun`),
    Q(`SELECT COUNT(*) reja, COALESCE(SUM(EXISTS (SELECT 1 FROM tashrif t WHERE t.agent_id = r.agent_id AND t.mijoz_id = r.mijoz_id AND t.sana = r.sana)), 0) bajarilgan
       FROM marshrut_reja r WHERE r.agent_id = :a AND r.sana >= :danKun AND r.sana <= :gachaKun`),
    // Diller: to'lovlar diller_pul daftarida (naqd/plastik, tekshiruvsiz)
    diller
      ? Q(`SELECT COALESCE(SUM(CASE WHEN usul = 'naqd' THEN summa ELSE 0 END), 0) s, COALESCE(SUM(usul = 'naqd'), 0) c FROM diller_pul
             WHERE diller_id = :a AND tur = 'kirim' AND kategoriya = 'mijoz_tolov' AND sana >= :dan AND sana < :gacha`)
      : Q(`SELECT COALESCE(SUM(summa), 0) s, COUNT(*) c FROM kassa WHERE kategoriya = 'mijoz_tolov' AND tur = 'kirim' AND agent_id = :a
             AND sana >= :dan AND sana < :gacha`),
    diller
      ? Q(`SELECT COALESCE(SUM(summa), 0) tasdiq, 0 kutilmoqda, COUNT(*) c FROM diller_pul WHERE diller_id = :a AND tur = 'kirim'
             AND kategoriya = 'mijoz_tolov' AND usul = 'plastik' AND sana >= :dan AND sana < :gacha`)
      : Q(`SELECT COALESCE(SUM(CASE WHEN holat = 'tasdiqlangan' THEN summa ELSE 0 END), 0) tasdiq,
                COALESCE(SUM(CASE WHEN holat = 'kutilmoqda' THEN summa ELSE 0 END), 0) kutilmoqda,
                COALESCE(SUM(holat = 'tasdiqlangan'), 0) c
         FROM plastik_tolov WHERE tur = 'qarz_tolov' AND agent_id = :a AND sana >= :dan AND sana < :gacha`),
    diller
      ? Q(`SELECT DATE_FORMAT(yetkazilgan_sana, '%Y-%m-%d') kun, SUM(jami_summa) summa FROM ariza WHERE agent_id = :a AND ${SOTUV}
             AND holat = 'yetkazildi' AND deletedAt IS NULL AND yetkazilgan_sana >= :dan AND yetkazilgan_sana < :gacha GROUP BY kun`)
      : Q(`SELECT DATE_FORMAT(sana, '%Y-%m-%d') kun, SUM(summa) summa FROM agent_register WHERE agent_id = :a AND tur = 'savdo'
             AND sana >= :dan AND sana < :gacha GROUP BY kun`),
  ]);

  const plan = diller ? 0 : r2(agent.plan_summa);
  const savdo = r2(reg.summa);
  const kunBy = new Map(kunRows.map(x => [x.kun, r2(x.summa)]));
  const kunlik = [];
  for (let d = 1; d <= O.kunlarSoni; d++) {
    const k = `${O.oy}-${String(d).padStart(2, '0')}`;
    kunlik.push({ sana: k, summa: kunBy.get(k) || 0 });
  }
  const reja = n(marsh.reja), bajarilgan = n(marsh.bajarilgan);
  return {
    oy: O.oy, agent: { id: agent.id, fullname: agent.fullname, diller },
    savdo: {
      plan, summa: savdo,
      plan_foiz: plan > 0 ? Math.round((savdo / plan) * 1000) / 10 : null,
      qolgan: plan > 0 ? r2(Math.max(0, plan - savdo)) : null,
      bonus_foiz: diller ? 0 : n(agent.bonus_foiz), bonus: r2(reg.bonus),
      cheklar: n(chek.soni), mijozlar: n(chek.mijozlar), dona: Math.round(n(chek.dona) * 1000) / 1000,
      ortacha_chek: n(chek.soni) ? r2(savdo / n(chek.soni)) : 0,
    },
    yangi_mijozlar: n(yangi.soni),
    tashrif: { soni: n(tash.soni), mijozlar: n(tash.mijozlar), savdo: n(tash.savdo), sotmaslik: n(tash.sotmaslik) },
    marshrut: { reja, bajarilgan, foiz: reja > 0 ? Math.round((bajarilgan / reja) * 1000) / 10 : null },
    qarz_yigildi: {
      naqd: r2(naqd.s), plastik: r2(plas.tasdiq), jami: r2(n(naqd.s) + n(plas.tasdiq)),
      plastik_kutilmoqda: r2(plas.kutilmoqda), tolovlar_soni: n(naqd.c) + n(plas.c),
    },
    kunlik,
  };
}

module.exports = { agentKpi, oyOl };
