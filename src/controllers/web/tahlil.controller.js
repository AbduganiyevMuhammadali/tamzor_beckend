/**
 * TAHLIL — "Hisobotlar" bo'limining yagona backendi (/api/v1/tahlil/*).
 *
 * Har bir endpoint bitta biznes savoliga javob beradi:
 *   umumiy         — biznes bir qarashda: tovar va pul qayerdan kelib, qayerga ketdi
 *   sotuv          — qancha sotdik, qancha foyda qoldi, kim/nima/qayerda
 *   tovarlar       — qaysi tovar pul topadi (ABC), qaysi biri yotib qolgan
 *   qarzlar        — mijozlar qarzi, qanchasi muddati o'tgan (debitorka)
 *   ombor          — omborda qancha pul turibdi va u necha kunga yetadi
 *   kirim          — kimdan, nima, qancha sotib oldik
 *   yetkazuvchilar — yetkazuvchilarga qancha qarzmiz (kreditorka)
 *   jurnal         — har bir tovar harakati (register), ichki ko'chirish alohida
 *   xodim          — bitta xodim: savdo va foyda, reja, tashrif, naqd topshirish, qarz, mashina kunlari
 *   biznes         — biznes holati: balans, sof foyda, salomatlik ko'rsatkichlari
 *   reyting        — mijozlar reytingi: kim ishonchli, kim xavfli, nega rad etishadi, kim va'da berdi
 *
 * Qoidalar (tannarx, davr, ichki ko'chirish) — utils/tahlil.utils.js da.
 */
const sequelize = require('../../db/db-sequelize');
const U = require('../../utils/tahlil.utils');
const HttpException = require('../../utils/HttpException.utils');
const { xarajatTurlari } = require('../../utils/xarajat.utils');
const { n, yax, miq, foiz, sotuvTahlil } = U;
const { kunHisobla } = require('../../utils/avtolavka.utils');
const { agentOmbori, XOM_ASHYO_OMBOR } = require('../../utils/ombor.utils');
const { SOTUV_RADIUS_M } = require('../../utils/geo.utils');
const { sababNomi } = require('../mobile/shared');
const { qarzQismlari } = require('../../utils/qarz.utils');

const Q = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: sequelize.QueryTypes.SELECT });
const pad = v => String(v).padStart(2, '0');
const HAFTA = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];

/** JS sanasini guruh kalitiga (kun / hafta boshi / oy) aylantirish — server vaqtida */
function kalit(sana, guruh) {
  const d = new Date(sana);
  if (guruh === 'oy') return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
  if (guruh === 'hafta') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return U.kunKey(d); }
  return U.kunKey(d);
}
const davrJavob = D => ({ dan: D.dan, gacha: D.gacha, kunlar: D.kunlar, guruh: D.guruh });

/* ═══ Umumiy hisob bloklari ═══════════════════════════════════════ */

/** Joriy ombor qoldig'i: (tovar, ombor) bo'yicha musbat qoldiqlar, tannarxda */
async function omborQoldiq(narx) {
  const rows = await Q(`
    SELECT r.tovar_id, r.ombor, SUM(r.donada) AS dona, MAX(t.nomi) AS nomi, MAX(t.turkum) AS turkum
    FROM tovar_register r LEFT JOIN tovar t ON t.id = r.tovar_id
    GROUP BY r.tovar_id, r.ombor HAVING dona > 0.0001`);
  return rows.map(r => ({
    tovar_id: r.tovar_id, nomi: r.nomi || '—', turkum: r.turkum || 'Boshqa', ombor: r.ombor || 'Nomaʼlum',
    tur: (r.ombor === U.BRAK_OMBOR || String(r.ombor || '').endsWith(' (brak)')) ? 'brak' : r.ombor === XOM_ASHYO_OMBOR ? 'xom_ashyo' : String(r.ombor || '').startsWith(U.AGENT_OMBOR) ? 'mashina' : 'asosiy',
    dona: n(r.dona), qiymat: n(r.dona) * (narx[r.tovar_id] || 0),
  }));
}

async function kirimJami(from, to) {
  const [r] = await Q(`
    SELECT COALESCE(SUM(jami_summa), 0) AS summa, COUNT(*) AS hujjat,
           COUNT(DISTINCT COALESCE(yetkazuvchi_id, yetkazuvchi)) AS yetkazuvchi
    FROM prixod WHERE holat = 'tasdiqlangan' AND deletedAt IS NULL AND sana BETWEEN :from AND :to`, { from, to });
  return { summa: yax(r.summa), hujjat: n(r.hujjat), yetkazuvchi: n(r.yetkazuvchi) };
}

/* Kassa toifalarini bir xil nomga keltirish (bazada eski/yangi yozuvlar aralash) */
const KASSA_TOIFA = {
  mijoz_tolov: "Mijoz to'lovlari", sotuv: 'Naqd savdo', sotuvdan_tushum: 'Naqd savdo', qarz_qaytarish: 'Qarz qaytarish',
  boshqa_daromad: 'Boshqa daromad', boshlangich_kapital: 'Kapital kiritildi',
  yetkazuvchi_tolov: "Yetkazuvchilarga to'lov", "yetkazuvchiga to'lov": "Yetkazuvchilarga to'lov",
  ish_haqi: 'Ish haqi', 'ish haqi': 'Ish haqi', kommunal: 'Kommunal', ijara: 'Ijara',
  transport_xarajat: 'Transport', transport: 'Transport', xarajat: 'Boshqa xarajat', boshqa_chiqim: 'Boshqa xarajat',
  ishlab_chiqarish: 'Ishlab chiqarish xarajati',
  sotuv_qaytarish: 'Qaytarish (naqd qaytarildi)',
  qarz_berildi: 'Qarz berildi', qarz_qaytdi: 'Berilgan qarz qaytdi', qarz_olindi: 'Qarz olindi', qarz_qaytarildi: 'Olingan qarz qaytarildi',
};
const toifaNom = k => KASSA_TOIFA[String(k || '').toLowerCase()] || (k ? String(k).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()) : 'Boshqa');

async function kassaJami(from, to) {
  const [rows, turlar] = await Promise.all([
    Q(`SELECT tur, kategoriya, COALESCE(SUM(summa), 0) AS summa, COUNT(*) AS son
       FROM kassa WHERE sana BETWEEN :from AND :to GROUP BY tur, kategoriya`, { from, to }),
    xarajatTurlari(),   // Kunlik xarajatlar toifalari — foydalanuvchi bergan nom
  ]);
  const g = {};
  let kirim = 0, chiqim = 0;
  for (const r of rows) {
    const nom = (r.tur === 'chiqim' && turlar.get(r.kategoriya)?.nomi) || toifaNom(r.kategoriya);
    const k = `${r.tur}|${nom}`;
    g[k] = g[k] || { tur: r.tur, nom, summa: 0, son: 0 };
    g[k].summa += n(r.summa); g[k].son += n(r.son);
    if (r.tur === 'kirim') kirim += n(r.summa); else chiqim += n(r.summa);
  }
  return {
    kirim: yax(kirim), chiqim: yax(chiqim), sof: yax(kirim - chiqim),
    toifalar: Object.values(g).map(x => ({ ...x, summa: yax(x.summa) })).sort((a, b) => b.summa - a.summa),
  };
}

/**
 * Mijozlar qarzi: kim qancha, qarz qanchadan beri turibdi (yoshi) va qanchasi
 * to'lov sanasidan o'tgan. Qarzning qaysi sotuvlarga tegishliligi va to'lov sanasi
 * (agent belgilagan yoki sotuv + muddat) — utils/qarz.utils.js (kredit tekshiruvi bilan bir xil).
 */
const BOSQICH = [
  { k: 'b7',  nom: '1 haftagacha', max: 7 },
  { k: 'b30', nom: '8–30 kun',     max: 30 },
  { k: 'b60', nom: '31–60 kun',    max: 60 },
  { k: 'b61', nom: '60 kundan ko\'p', max: Infinity },
];
async function qarzTahlil({ agent_id = null } = {}) {
  const mijozlar = await Q(`
    SELECT m.id, m.nomi, m.telefon, m.sinf, m.balans, m.kredit_limit, m.tolov_muddati_kun, m.agent_id,
           ag.fullname AS agent
    FROM mijoz m LEFT JOIN agent ag ON ag.id = m.agent_id
    WHERE m.deletedAt IS NULL AND m.balans < 0 ${agent_id ? 'AND m.agent_id = :agent_id' : ''}`, { agent_id });
  const ids = mijozlar.map(m => m.id);
  const [qismlar, tolovlar] = await Promise.all([
    qarzQismlari(mijozlar),
    ids.length ? Q(`SELECT k.mijoz_id, k.sana, k.summa FROM kassa k
       JOIN (SELECT mijoz_id, MAX(sana) s FROM kassa WHERE tur = 'kirim' AND mijoz_id IN (:ids) GROUP BY mijoz_id) x
         ON x.mijoz_id = k.mijoz_id AND x.s = k.sana
       WHERE k.tur = 'kirim'`, { ids }) : [],
  ]);
  const tolovMap = {};
  tolovlar.forEach(t => { tolovMap[t.mijoz_id] = t; });

  const bugun = Date.now();
  const yaqin = [];                       // 7 kun ichida to'lanishi kerak bo'lgan qismlar
  const rows = mijozlar.map(m => {
    const qarz = -n(m.balans);
    const muddat = n(m.tolov_muddati_kun) || 30;
    const b = { b7: 0, b30: 0, b60: 0, b61: 0 };
    let eskiKun = 0, otgan = 0, kechikkan = 0, keyingi = null;
    for (const q of qismlar.get(m.id) || []) {
      const kun = q.yosh_kun === null ? 61 : q.yosh_kun;
      b[BOSQICH.find(x => kun <= x.max).k] += q.summa;
      eskiKun = Math.max(eskiKun, kun);
      // Sanasi noma'lum (boshlang'ich) qarz — muddati o'tgan deb hisoblanadi
      if (q.tolov_sana === null || q.kechikkan_kun > 0) { otgan += q.summa; kechikkan = Math.max(kechikkan, q.kechikkan_kun ?? 61); }
      else {
        if (!keyingi || q.tolov_sana < keyingi.sana) keyingi = { sana: q.tolov_sana, summa: q.summa, belgilangan: q.belgilangan };
        else if (q.tolov_sana === keyingi.sana) keyingi.summa += q.summa;
        const qoldi = Math.round((new Date(`${q.tolov_sana}T00:00:00`) - new Date(new Date().setHours(0, 0, 0, 0))) / 86400000);
        if (qoldi <= 7) yaqin.push({ mijoz_id: m.id, nomi: m.nomi, telefon: m.telefon, agent: m.agent || '—', raqam: q.raqam, ariza_id: q.ariza_id,
          tolov_sana: q.tolov_sana, belgilangan: q.belgilangan, summa: q.summa, qoldi_kun: qoldi });
      }
    }
    const t = tolovMap[m.id];
    return {
      id: m.id, nomi: m.nomi, telefon: m.telefon, sinf: m.sinf, agent_id: m.agent_id, agent: m.agent || '—',
      qarz: yax(qarz), limit: yax(m.kredit_limit), limit_oshgan: n(m.kredit_limit) > 0 && qarz > n(m.kredit_limit),
      muddat_kun: muddat, eng_eski_kun: eskiKun, muddati_otgan: yax(otgan), kechikkan_kun: kechikkan,
      keyingi_tolov: keyingi,
      b7: yax(b.b7), b30: yax(b.b30), b60: yax(b.b60), b61: yax(b.b61),
      oxirgi_tolov_sana: t?.sana || null, oxirgi_tolov: t ? yax(t.summa) : 0,
      tolovsiz_kun: t ? Math.floor((bugun - new Date(t.sana).getTime()) / 86400000) : null,
    };
  }).sort((a, b) => b.qarz - a.qarz);

  const jami = rows.reduce((s, r) => {
    s.qarz += r.qarz; s.muddati_otgan += r.muddati_otgan;
    if (r.muddati_otgan > 0) s.muddati_otgan_soni++;
    if (r.limit_oshgan) s.limit_oshgan_soni++;
    s.vaznli_kun += r.qarz * r.eng_eski_kun;
    BOSQICH.forEach(x => { s[x.k] += r[x.k]; });
    return s;
  }, { qarz: 0, muddati_otgan: 0, muddati_otgan_soni: 0, limit_oshgan_soni: 0, vaznli_kun: 0, b7: 0, b30: 0, b60: 0, b61: 0 });

  yaqin.sort((a, b) => a.tolov_sana.localeCompare(b.tolov_sana) || b.summa - a.summa);
  return { rows, jami, yaqin, bosqichlar: BOSQICH.map(x => ({ k: x.k, nom: x.nom, summa: jami[x.k], soni: rows.filter(r => r[x.k] > 0).length })) };
}

/* ═══ CONTROLLER ═════════════════════════════════════════════════ */

class TahlilController {

  /* GET /tahlil/umumiy?dan&gacha — biznes bir qarashda */
  umumiy = async (req, res) => {
    const D = U.davr(req.query);
    const [J, O, kirim, kirimOld, narxHozir, qarz, yetk, kassa, kassaOld] = await Promise.all([
      sotuvTahlil(D.from, D.to), sotuvTahlil(D.pFrom, D.pTo),
      kirimJami(D.from, D.to), kirimJami(D.pFrom, D.pTo),
      U.tannarxXaritasi(new Date()), qarzTahlil(),
      Q(`SELECT COALESCE(SUM(CASE WHEN balans < 0 THEN -balans END), 0) AS qarzimiz, SUM(balans < 0) AS soni FROM yetkazuvchi`),
      kassaJami(D.from, D.to), kassaJami(D.pFrom, D.pTo),
    ]);
    const [qoldiq, sotuvReg] = await Promise.all([
      omborQoldiq(narxHozir),
      // Zaxira kuni Ombor hisobotidagi bilan bir xil: davrda ombordan sotuvga chiqqan tovar tannarxi
      Q(`SELECT tovar_id, SUM(ABS(donada)) AS dona FROM tovar_register
         WHERE manba_tur = 'sotuv' AND sana BETWEEN :from AND :to GROUP BY tovar_id`, { from: D.from, to: D.to }),
    ]);

    const keys = U.guruhKalitlari(D);
    const tm = Object.fromEntries(keys.map(k => [k, { k, tushum: 0, foyda: 0 }]));
    const tolov = {};
    for (const q of J.qatorlar) {
      const t = tm[kalit(q.sana, D.guruh)];
      if (t) { t.tushum += n(q.summa); t.foyda += n(q.summa) - J.tannarxOf(q); }
      const tk = U.tolovKalit(q.tolov_turi);
      tolov[tk] = (tolov[tk] || 0) + n(q.summa);
    }
    const omborTur = tur => yax(qoldiq.filter(r => r.tur === tur).reduce((s, r) => s + r.qiymat, 0));
    const sotuvTannarxKunlik = sotuvReg.reduce((a, r) => a + n(r.dona) * (narxHozir[r.tovar_id] || 0), 0) / D.kunlar;
    const omborQiymat = yax(qoldiq.filter(r => r.tur !== 'brak').reduce((s, r) => s + r.qiymat, 0));

    res.send({
      davr: davrJavob(D),
      sotuv: J.jami,
      oldingi: { ...O.jami, kirim: kirimOld.summa, kassa_sof: kassaOld.sof },
      tolov: ['naqd', 'plastik', 'qarz', 'nomalum'].map(k => ({ k, nom: U.TOLOV_NOM[k], summa: yax(tolov[k] || 0) })).filter(x => x.summa > 0),
      kirim,
      ombor: {
        qiymat: omborQiymat, asosiy: omborTur('asosiy'), mashinalar: omborTur('mashina'), brak: omborTur('brak'), xom_ashyo: omborTur('xom_ashyo'),
        dona: miq(qoldiq.filter(r => r.tur !== 'brak').reduce((s, r) => s + r.dona, 0)),
        tovar_turi: new Set(qoldiq.filter(r => r.tur !== 'brak').map(r => r.tovar_id)).size,
        zaxira_kun: sotuvTannarxKunlik > 0 ? Math.round(omborQiymat / sotuvTannarxKunlik) : null,
      },
      qarz: {
        mijozlar: yax(qarz.jami.qarz), qarzdor: qarz.rows.length,
        muddati_otgan: yax(qarz.jami.muddati_otgan), muddati_otgan_soni: qarz.jami.muddati_otgan_soni,
      },
      yetkazuvchi: { qarzimiz: yax(yetk[0]?.qarzimiz), soni: n(yetk[0]?.soni) },
      kassa,
      trend: keys.map(k => ({ k, tushum: yax(tm[k].tushum), foyda: yax(tm[k].foyda) })),
    });
  };

  /* GET /tahlil/sotuv?dan&gacha&agent_id — sotuv va foyda */
  sotuv = async (req, res) => {
    const D = U.davr(req.query);
    const agent_id = parseInt(req.query.agent_id, 10) || null;
    const [J, O, agentList] = await Promise.all([
      sotuvTahlil(D.from, D.to, { agent_id }), sotuvTahlil(D.pFrom, D.pTo, { agent_id }),
      Q(`SELECT id, fullname AS nomi FROM agent WHERE deletedAt IS NULL ORDER BY fullname`),
    ]);
    const keys = U.guruhKalitlari(D);
    const tm = Object.fromEntries(keys.map(k => [k, { k, tushum: 0, foyda: 0, b: new Set() }]));
    const ag = {}, tk = {}, mj = {}, tl = {};
    const hk = HAFTA.map(() => 0);
    const yig = (m, key, init, q, f) => {
      const x = m[key] = m[key] || { ...init, tushum: 0, foyda: 0, dona: 0, b: new Set(), mj: new Set() };
      x.tushum += n(q.summa); x.foyda += n(q.summa) - J.tannarxOf(q); x.dona += n(q.jami_dona);
      x.b.add(q.ariza_id); if (q.mijoz_id) x.mj.add(q.mijoz_id);
      if (f) f(x);
    };
    for (const q of J.qatorlar) {
      const t = tm[kalit(q.sana, D.guruh)];
      if (t) { t.tushum += n(q.summa); t.foyda += n(q.summa) - J.tannarxOf(q); t.b.add(q.ariza_id); }
      yig(ag, q.agent_id || 0, { id: q.agent_id, nomi: q.agent_nomi || 'Agentsiz (ofis)' }, q);
      yig(tk, q.turkum || 'Boshqa', { nomi: q.turkum || 'Boshqa' }, q);
      yig(mj, q.mijoz_id || 0, { id: q.mijoz_id, nomi: q.mijoz_nomi || '—', agent: q.agent_nomi || '—', oxirgi: q.sana }, q,
        x => { if (new Date(q.sana) > new Date(x.oxirgi)) x.oxirgi = q.sana; });
      const tolK = U.tolovKalit(q.tolov_turi);
      tl[tolK] = tl[tolK] || { k: tolK, nom: U.TOLOV_NOM[tolK], summa: 0, b: new Set() };
      tl[tolK].summa += n(q.summa); tl[tolK].b.add(q.ariza_id);
      hk[new Date(q.sana).getDay()] += n(q.summa);
    }
    // Hafta kunlari: davrda har kun necha marta uchragani — o'rtacha kunlik tushum uchun
    const kunSoni = HAFTA.map(() => 0);
    for (let d = new Date(D.from); d <= D.to; d.setDate(d.getDate() + 1)) kunSoni[d.getDay()]++;

    const tushum = J.jami.tushum || 1;
    const chiq = (x, extra = {}) => ({
      ...extra, tushum: yax(x.tushum), foyda: yax(x.foyda), marja: foiz(x.foyda, x.tushum),
      dona: miq(x.dona), buyurtma: x.b.size, mijoz: x.mj.size, ulush: foiz(x.tushum, tushum),
      ortacha_chek: x.b.size ? yax(x.tushum / x.b.size) : 0,
    });
    res.send({
      davr: davrJavob(D),
      jami: J.jami,
      oldingi: O.jami,
      trend: keys.map(k => ({ k, tushum: yax(tm[k].tushum), foyda: yax(tm[k].foyda), buyurtma: tm[k].b.size })),
      agentlar: Object.values(ag).map(x => chiq(x, { id: x.id, nomi: x.nomi })).sort((a, b) => b.tushum - a.tushum),
      turkumlar: Object.values(tk).map(x => chiq(x, { nomi: x.nomi })).sort((a, b) => b.tushum - a.tushum),
      mijozlar: Object.values(mj).map(x => chiq(x, { id: x.id, nomi: x.nomi, agent: x.agent, oxirgi: x.oxirgi }))
        .sort((a, b) => b.tushum - a.tushum).slice(0, 15),
      tolov: Object.values(tl).map(x => ({ k: x.k, nom: x.nom, summa: yax(x.summa), buyurtma: x.b.size, ulush: foiz(x.summa, tushum) }))
        .sort((a, b) => b.summa - a.summa),
      hafta_kunlari: [1, 2, 3, 4, 5, 6, 0].map(i => ({ kun: HAFTA[i], ortacha: kunSoni[i] ? yax(hk[i] / kunSoni[i]) : 0, jami: yax(hk[i]) })),
      agentlar_royxat: agentList,
    });
  };

  /* GET /tahlil/tovarlar?dan&gacha — ABC, foyda, zaxira */
  tovarlar = async (req, res) => {
    const D = U.davr(req.query);
    const [J, tovarList, qoldiqRows, oxirgi] = await Promise.all([
      sotuvTahlil(D.from, D.to),
      Q(`SELECT id, nomi, turkum, blokdagi_soni FROM tovar WHERE deletedAt IS NULL`),
      Q(`SELECT tovar_id, SUM(donada) AS q FROM tovar_register WHERE ombor <> :brak AND ombor NOT LIKE '% (brak)' GROUP BY tovar_id`, { brak: U.BRAK_OMBOR }),
      Q(`SELECT q.tovar_id, MAX(COALESCE(a.yetkazilgan_sana, a.createdAt)) AS s
         FROM ariza_qator q JOIN ariza a ON a.id = q.ariza_id
         WHERE a.turi = 'sotish' AND a.holat = 'yetkazildi' AND a.deletedAt IS NULL GROUP BY q.tovar_id`),
    ]);
    const qoldiqMap = Object.fromEntries(qoldiqRows.map(r => [r.tovar_id, n(r.q)]));
    const oxirgiMap = Object.fromEntries(oxirgi.map(r => [r.tovar_id, r.s]));
    const s = {};
    const tv = id => (s[id] = s[id] || { dona: 0, tushum: 0, tannarx: 0, b: new Set(), mj: new Set() });
    for (const q of J.qatorlar) {
      const x = tv(q.tovar_id);
      x.dona += n(q.jami_dona); x.tushum += n(q.summa); x.tannarx += J.tannarxOf(q);
      x.b.add(q.ariza_id); if (q.mijoz_id) x.mj.add(q.mijoz_id);
    }
    // Qaytarishlar tovar bo'yicha ayiriladi — jami Sotuv hisoboti bilan mos tushadi
    for (const q of J.qaytQ) {
      const x = tv(q.tovar_id);
      const ulush = n(q.asl_dona) ? n(q.jami_dona) / n(q.asl_dona) : 1;
      x.dona -= n(q.jami_dona); x.tushum -= n(q.summa) * ulush; x.tannarx -= J.tannarxOf(q);
    }
    const jamiTushum = Object.values(s).reduce((a, x) => a + x.tushum, 0) || 1;
    const bugun = Date.now();
    let rows = tovarList.map(t => {
      const x = s[t.id];
      const qoldiq = Math.max(0, qoldiqMap[t.id] || 0);
      if (!x && qoldiq <= 0) return null;
      const tannarx1 = J.narx[t.id] || 0;
      const kunlik = x ? x.dona / D.kunlar : 0;
      return {
        id: t.id, nomi: t.nomi, turkum: t.turkum || 'Boshqa',
        dona: miq(x?.dona), tushum: yax(x?.tushum), tannarx: yax(x?.tannarx), foyda: yax((x?.tushum || 0) - (x?.tannarx || 0)),
        marja: x ? foiz(x.tushum - x.tannarx, x.tushum) : 0, ulush: x ? +((x.tushum / jamiTushum) * 100).toFixed(2) : 0,
        buyurtma: x ? x.b.size : 0, mijoz: x ? x.mj.size : 0,
        ortacha_narx: x && x.dona ? yax(x.tushum / x.dona) : 0, kirim_narx: yax(tannarx1),
        qoldiq: miq(qoldiq), qoldiq_qiymat: miq(qoldiq * tannarx1),
        kunlik: +kunlik.toFixed(2), yetadi_kun: kunlik > 0 ? Math.round(qoldiq / kunlik) : null,
        oxirgi_sotuv: oxirgiMap[t.id] || null,
        sotilmagan_kun: oxirgiMap[t.id] ? Math.floor((bugun - new Date(oxirgiMap[t.id]).getTime()) / 86400000) : null,
        abc: null,
      };
    }).filter(Boolean);

    // ABC: tushum bo'yicha kamayish tartibida jamlanma ulush ≤80% — A, ≤95% — B, qolgani C
    let jam = 0;
    rows.filter(r => r.tushum > 0).sort((a, b) => b.tushum - a.tushum).forEach(r => {
      const oldin = jam; jam += r.tushum / jamiTushum * 100;
      r.abc = oldin < 80 ? 'A' : oldin < 95 ? 'B' : 'C';
    });
    const abc = ['A', 'B', 'C'].map(k => {
      const g = rows.filter(r => r.abc === k);
      return { k, soni: g.length, tushum: yax(g.reduce((a, r) => a + r.tushum, 0)), foyda: yax(g.reduce((a, r) => a + r.foyda, 0)),
        ulush: foiz(g.reduce((a, r) => a + r.tushum, 0), jamiTushum) };
    });
    const harakatsiz = rows.filter(r => !r.tushum && r.qoldiq > 0);
    const kam = rows.filter(r => r.yetadi_kun !== null && r.yetadi_kun < 7);
    const turkumlar = {};
    rows.forEach(r => {
      const t = turkumlar[r.turkum] = turkumlar[r.turkum] || { nomi: r.turkum, tushum: 0, foyda: 0, qoldiq_qiymat: 0, soni: 0 };
      t.tushum += r.tushum; t.foyda += r.foyda; t.qoldiq_qiymat += r.qoldiq_qiymat; t.soni++;
    });

    rows.sort((a, b) => b.tushum - a.tushum || b.qoldiq_qiymat - a.qoldiq_qiymat);
    res.send({
      davr: davrJavob(D),
      jami: {
        tushum: J.jami.sof_tushum, foyda: J.jami.foyda, marja: J.jami.marja, sotilgan_tur: rows.filter(r => r.tushum > 0).length,
        harakatsiz_soni: harakatsiz.length, harakatsiz_qiymat: yax(harakatsiz.reduce((a, r) => a + r.qoldiq_qiymat, 0)),
        kam_soni: kam.length, qoldiq_qiymat: miq(rows.reduce((a, r) => a + r.qoldiq_qiymat, 0)),
      },
      abc,
      turkumlar: Object.values(turkumlar).map(t => ({ ...t, marja: foiz(t.foyda, t.tushum) })).sort((a, b) => b.tushum - a.tushum),
      rows,
    });
  };

  /* GET /tahlil/qarzlar?agent_id — mijozlar qarzi (debitorka) */
  // ── MIJOZLAR REYTINGI (utils/reyting.utils.js) — bosh sahifa bloki va Hisobot → Mijozlar reytingi ──
  // Holat (hozirgi) davrdan qat'i nazar; hodisalar, dinamika, sabablar va harakat — tanlangan davr bo'yicha.
  // O'rtacha reyting dinamikasi tarixdan tiklanadi: o'rtacha(k) = hozirgi o'rtacha − (k dan keyingi ballar yig'indisi) / faol mijozlar.
  reyting = async (req, res) => {
    const R = require('../../utils/reyting.utils');
    const D = U.davr(req.query, 30);
    const agentId = Number(req.query.agent_id) || null;
    const aW = agentId ? ' AND m.agent_id = :agentId' : '';
    const bugun = U.kunKey(new Date());
    const rep = { from: D.from, to: D.to, pFrom: D.pFrom, pTo: D.pTo, agentId, tz: D.tz, bugun };
    const FAOL = `m.deletedAt IS NULL AND m.faol = 1${aW}`;
    const darajaSql = R.DARAJALAR.map((d, i) => `SUM(m.reyting BETWEEN ${d.min} AND ${i === 0 ? R.MAX : R.DARAJALAR[i - 1].min - 1}) \`${d.kod}\``).join(', ');
    const diqqatChegara = R.darajaChegara('past').gacha;   // Past va Kritik

    const hodisa = async (dan, gacha) => Object.fromEntries((await Q(`
      SELECT r.tur, COUNT(*) soni, COALESCE(SUM(r.ball), 0) ball, COUNT(DISTINCT r.mijoz_id) mijoz
      FROM mijoz_reyting r JOIN mijoz m ON m.id = r.mijoz_id
      WHERE r.sana BETWEEN :dan AND :gacha${aW} GROUP BY r.tur`, { ...rep, dan, gacha }))
      .map(x => [x.tur, { soni: Number(x.soni), ball: Number(x.ball), mijoz: Number(x.mijoz) }]));

    const [[holat], [dar], joriy, oldingi, trendRows, keyin, sabablar, agentlar, diqqat, vadalar, harakat, songgi, agentlarRoyxat] = await Promise.all([
      Q(`SELECT COUNT(*) jami, ROUND(AVG(m.reyting), 1) ortacha, SUM(m.reyting <= ${diqqatChegara}) diqqat,
           SUM(m.balans < 0) qarzdor,
           SUM(m.balans < 0 AND m.tolov_vada_sana = :bugun) vada_bugun,
           SUM(m.balans < 0 AND m.tolov_vada_sana < :bugun) vada_otgan,
           SUM(m.rad_ketma_ket >= 3) rad_seriya
         FROM mijoz m WHERE ${FAOL}`, rep),
      Q(`SELECT ${darajaSql} FROM mijoz m WHERE ${FAOL}`, rep),
      hodisa(D.from, D.to),
      hodisa(D.pFrom, D.pTo),
      Q(`SELECT ${U.guruhSql('r.sana', D.guruh)} k,
           SUM(CASE WHEN r.ball > 0 THEN r.ball ELSE 0 END) ijobiy, SUM(CASE WHEN r.ball < 0 THEN -r.ball ELSE 0 END) salbiy, COUNT(*) soni
         FROM mijoz_reyting r JOIN mijoz m ON m.id = r.mijoz_id WHERE r.sana BETWEEN :from AND :to${aW} GROUP BY k`, rep),
      Q(`SELECT r.sana, r.ball FROM mijoz_reyting r JOIN mijoz m ON m.id = r.mijoz_id WHERE r.sana >= :from AND ${FAOL}`, rep),
      Q(`SELECT COALESCE(r.sabab, 'Sabab ko''rsatilmagan') nom, MAX(r.sabab_id) sabab_id, COUNT(*) soni, COALESCE(SUM(r.ball), 0) ball, COUNT(DISTINCT r.mijoz_id) mijoz
         FROM mijoz_reyting r JOIN mijoz m ON m.id = r.mijoz_id
         WHERE r.tur = 'rad_etildi' AND r.sana BETWEEN :from AND :to${aW} GROUP BY nom ORDER BY soni DESC`, rep),
      Q(`SELECT a.id, a.fullname nomi, COUNT(m.id) mijozlar, ROUND(AVG(m.reyting), 1) ortacha, SUM(m.reyting <= ${diqqatChegara}) diqqat,
           SUM(m.tolov_vada_sana IS NOT NULL AND m.tolov_vada_sana < :bugun AND m.balans < 0) vada_otgan,
           (SELECT COUNT(*) FROM mijoz_reyting r JOIN mijoz m2 ON m2.id = r.mijoz_id WHERE m2.agent_id = a.id AND r.tur = 'rad_etildi' AND r.sana BETWEEN :from AND :to) rad,
           (SELECT COUNT(*) FROM mijoz_reyting r JOIN mijoz m2 ON m2.id = r.mijoz_id WHERE m2.agent_id = a.id AND r.tur = 'tolov_surildi' AND r.sana BETWEEN :from AND :to) surildi,
           (SELECT COUNT(*) FROM mijoz_reyting r JOIN mijoz m2 ON m2.id = r.mijoz_id WHERE m2.agent_id = a.id AND r.tur = 'buyurtma' AND r.ball > 0 AND r.sana BETWEEN :from AND :to) zakaz
         FROM agent a JOIN mijoz m ON m.agent_id = a.id AND m.deletedAt IS NULL AND m.faol = 1
         WHERE a.deletedAt IS NULL${agentId ? ' AND a.id = :agentId' : ''} GROUP BY a.id, a.fullname ORDER BY ortacha ASC`, rep),
      Q(`SELECT m.id, m.nomi, m.telefon, m.reyting, m.rad_ketma_ket, m.tolov_vada_sana vada, GREATEST(-m.balans, 0) qarz, a.fullname agent,
           (SELECT MAX(r.sana) FROM mijoz_reyting r WHERE r.mijoz_id = m.id) oxirgi
         FROM mijoz m LEFT JOIN agent a ON a.id = m.agent_id
         WHERE ${FAOL} AND m.reyting <= ${diqqatChegara} ORDER BY m.reyting ASC, qarz DESC LIMIT 200`, rep),
      Q(`SELECT m.id, m.nomi, m.telefon, m.tolov_vada_sana vada, -m.balans qarz, m.reyting, a.fullname agent,
           DATEDIFF(:bugun, m.tolov_vada_sana) otgan_kun
         FROM mijoz m LEFT JOIN agent a ON a.id = m.agent_id
         WHERE ${FAOL} AND m.balans < 0 AND m.tolov_vada_sana IS NOT NULL AND m.tolov_vada_sana <= DATE_ADD(:bugun, INTERVAL 7 DAY)
         ORDER BY m.tolov_vada_sana ASC, qarz DESC LIMIT 200`, rep),
      Q(`SELECT m.id, m.nomi, m.reyting, a.fullname agent, SUM(r.ball) ball, COUNT(*) soni
         FROM mijoz_reyting r JOIN mijoz m ON m.id = r.mijoz_id LEFT JOIN agent a ON a.id = m.agent_id
         WHERE r.sana BETWEEN :from AND :to${aW} GROUP BY m.id, m.nomi, m.reyting, a.fullname HAVING ball <> 0`, rep),
      Q(`SELECT r.id, r.tur, r.ball, r.reyting_keyin, r.sabab, r.sana, r.xodim_nomi, r.xodim_rol, m.id mijoz_id, m.nomi
         FROM mijoz_reyting r JOIN mijoz m ON m.id = r.mijoz_id WHERE 1 = 1${aW} ORDER BY r.sana DESC, r.id DESC LIMIT 15`, rep),
      Q(`SELECT id, fullname nomi FROM agent WHERE deletedAt IS NULL AND faol = 1 ORDER BY fullname`),
    ]);

    // O'rtacha reyting dinamikasi (har guruh oxiridagi holat)
    const jami = Number(holat.jami) || 0, ortachaHozir = Number(holat.ortacha) || R.BOSH;
    const oxiri = (k) => {
      if (D.guruh === 'oy') { const [y, mo] = k.split('-').map(Number); return new Date(y, mo, 0, 23, 59, 59, 999); }
      const d = new Date(`${k}T23:59:59.999`);
      if (D.guruh === 'hafta') d.setDate(d.getDate() + 6);
      return d;
    };
    const tm = Object.fromEntries(trendRows.map(r => [r.k, r]));
    const trend = U.guruhKalitlari(D).map(k => {
      const ox = oxiri(k);
      const keyinBall = keyin.reduce((s, e) => s + (new Date(e.sana) > ox ? Number(e.ball) : 0), 0);
      const t = tm[k] || {};
      return { k, ijobiy: Number(t.ijobiy) || 0, salbiy: Number(t.salbiy) || 0, soni: Number(t.soni) || 0,
        ortacha: jami ? +(ortachaHozir - keyinBall / jami).toFixed(1) : R.BOSH };
    });
    const davrBoshi = jami ? +(ortachaHozir - keyin.reduce((s, e) => s + Number(e.ball), 0) / jami).toFixed(1) : R.BOSH;

    const radJami = sabablar.reduce((s, x) => s + Number(x.soni), 0);
    const hr = harakat.map(h => ({ id: h.id, nomi: h.nomi, reyting: Number(h.reyting), agent: h.agent, ball: Number(h.ball), soni: Number(h.soni) }));
    res.send({
      davr: { dan: D.dan, gacha: D.gacha, kunlar: D.kunlar, guruh: D.guruh },
      holat: {
        jami, ortacha: ortachaHozir, davr_boshi: davrBoshi, diqqat: Number(holat.diqqat) || 0, qarzdor: Number(holat.qarzdor) || 0,
        vada_bugun: Number(holat.vada_bugun) || 0, vada_otgan: Number(holat.vada_otgan) || 0, rad_seriya: Number(holat.rad_seriya) || 0,
      },
      darajalar: R.DARAJALAR.map(d => ({ kod: d.kod, nom: d.nom, min: d.min, soni: Number(dar[d.kod]) || 0 })),
      hodisalar: joriy, oldingi,
      trend,
      sabablar: sabablar.map(x => ({ nom: x.nom, sabab_id: x.sabab_id, soni: Number(x.soni), mijoz: Number(x.mijoz), ball: Number(x.ball),
        ulush: radJami ? +((Number(x.soni) / radJami) * 100).toFixed(1) : 0, neytral: R.NEYTRAL_SABAB.has(String(x.sabab_id || '')) })),
      agentlar: agentlar.map(a => ({ id: a.id, nomi: a.nomi, mijozlar: Number(a.mijozlar), ortacha: Number(a.ortacha), diqqat: Number(a.diqqat) || 0,
        vada_otgan: Number(a.vada_otgan) || 0, rad: Number(a.rad) || 0, surildi: Number(a.surildi) || 0, zakaz: Number(a.zakaz) || 0 })),
      diqqat: diqqat.map(m => ({ ...m, reyting: Number(m.reyting), qarz: Number(m.qarz) || 0, rad_ketma_ket: Number(m.rad_ketma_ket) || 0 })),
      vadalar: vadalar.map(m => ({ ...m, qarz: Number(m.qarz) || 0, reyting: Number(m.reyting), otgan_kun: Number(m.otgan_kun) })),
      tushganlar: hr.filter(h => h.ball < 0).sort((a, b) => a.ball - b.ball).slice(0, 8),
      kotarilganlar: hr.filter(h => h.ball > 0).sort((a, b) => b.ball - a.ball).slice(0, 8),
      songgi: songgi.map(x => ({ ...x, ball: Number(x.ball), reyting_keyin: Number(x.reyting_keyin) })),
      agentlar_royxat: agentlarRoyxat,
    });
  };

  qarzlar = async (req, res) => {
    const agent_id = parseInt(req.query.agent_id, 10) || null;
    const d30 = new Date(Date.now() - 30 * 86400000);
    const [T, oqim, agentList] = await Promise.all([
      qarzTahlil({ agent_id }),
      // Qarz harakati (30 kun): mijoz balansi = to'lovlar − savdolar, demak
      // qarz o'zgarishi = shu davrdagi savdolar − shu davrdagi to'lovlar
      Q(`SELECT
           (SELECT COALESCE(SUM(a.jami_summa), 0) FROM ariza a ${agent_id ? 'JOIN mijoz m ON m.id = a.mijoz_id AND m.agent_id = :agent_id' : ''}
             WHERE a.turi = 'sotish' AND a.holat = 'yetkazildi' AND a.deletedAt IS NULL AND a.mijoz_id IS NOT NULL
               AND COALESCE(a.yetkazilgan_sana, a.createdAt) >= :d30) AS sotildi,
           (SELECT COALESCE(SUM(k.summa), 0) FROM kassa k ${agent_id ? 'JOIN mijoz m ON m.id = k.mijoz_id AND m.agent_id = :agent_id' : ''}
             WHERE k.tur = 'kirim' AND k.mijoz_id IS NOT NULL AND k.sana >= :d30) AS tolandi`,
        { d30, agent_id }),
      Q(`SELECT id, fullname AS nomi FROM agent WHERE deletedAt IS NULL ORDER BY fullname`),
    ]);
    const ag = {};
    T.rows.forEach(r => {
      const x = ag[r.agent_id || 0] = ag[r.agent_id || 0] || { id: r.agent_id, nomi: r.agent, qarz: 0, muddati_otgan: 0, soni: 0 };
      x.qarz += r.qarz; x.muddati_otgan += r.muddati_otgan; x.soni++;
    });
    res.send({
      jami: {
        qarz: yax(T.jami.qarz), qarzdor: T.rows.length, muddati_otgan: yax(T.jami.muddati_otgan),
        muddati_otgan_soni: T.jami.muddati_otgan_soni, limit_oshgan_soni: T.jami.limit_oshgan_soni,
        ortacha_kun: T.jami.qarz ? Math.round(T.jami.vaznli_kun / T.jami.qarz) : 0,
        muddati_otgan_ulush: foiz(T.jami.muddati_otgan, T.jami.qarz),
      },
      oqim30: { sotildi: yax(oqim[0]?.sotildi), tolandi: yax(oqim[0]?.tolandi), ozgarish: yax(n(oqim[0]?.sotildi) - n(oqim[0]?.tolandi)) },
      bosqichlar: T.bosqichlar.map(b => ({ ...b, summa: yax(b.summa), ulush: foiz(b.summa, T.jami.qarz) })),
      agentlar: Object.values(ag).map(x => ({ ...x, qarz: yax(x.qarz), muddati_otgan: yax(x.muddati_otgan) })).sort((a, b) => b.qarz - a.qarz),
      // Yaqin 7 kunda (bugun ham) to'lanishi kerak — agent belgilagan sana yoki sotuv + muddat
      yaqin: T.yaqin.slice(0, 40),
      yaqin_jami: yax(T.yaqin.reduce((a, x) => a + x.summa, 0)),
      rows: T.rows,
      agentlar_royxat: agentList,
    });
  };

  /* GET /tahlil/ombor?dan&gacha — zaxira qiymati, harakat, yotib qolgan va tugayotgan tovarlar */
  ombor = async (req, res) => {
    const D = U.davr(req.query);
    const narx = await U.tannarxXaritasi(new Date());
    const [qoldiq, harakat, oxirgiSotuv] = await Promise.all([
      omborQoldiq(narx),
      Q(`SELECT tur, manba_tur, tovar_id, ${U.guruhSql('sana', D.guruh)} AS k,
                SUM(donada) AS dona, SUM(summa) AS summa, COUNT(*) AS son
         FROM tovar_register WHERE sana BETWEEN :from AND :to
         GROUP BY tur, manba_tur, tovar_id, k`, { from: D.from, to: D.to, tz: D.tz }),
      Q(`SELECT tovar_id, MAX(sana) AS s FROM tovar_register WHERE manba_tur = 'sotuv' GROUP BY tovar_id`),
    ]);
    const keys = U.guruhKalitlari(D);
    const tm = Object.fromEntries(keys.map(k => [k, { k, kirim: 0, sotuv: 0 }]));
    const d = { kirim: 0, kirim_dona: 0, qaytgan: 0, sotuv: 0, sotuv_dona: 0, kochirish_dona: 0, kochirish_son: 0, inventar: 0,
      ishlab_kirim: 0, ishlab_kirim_dona: 0, ishlab_sarf: 0 };
    const sotilgan = {};
    for (const r of harakat) {
      const dona = Math.abs(n(r.dona));
      if (r.manba_tur === 'prixod' && r.tur === 'kirim') {
        d.kirim += n(r.summa); d.kirim_dona += dona; if (tm[r.k]) tm[r.k].kirim += n(r.summa);
      } else if (r.manba_tur === 'sotuv') {
        const c = dona * (narx[r.tovar_id] || 0);
        d.sotuv += c; d.sotuv_dona += dona; if (tm[r.k]) tm[r.k].sotuv += c;
        sotilgan[r.tovar_id] = (sotilgan[r.tovar_id] || 0) + dona;
      } else if (r.tur === 'qaytarma_kirim') {
        d.qaytgan += dona * (narx[r.tovar_id] || 0);
      } else if (U.KOCHIRISH_MANBA.includes(r.manba_tur) && r.tur === 'chiqim') {
        d.kochirish_dona += dona; d.kochirish_son += n(r.son);
      } else if (r.manba_tur === 'inventar') {
        d.inventar += n(r.dona) * (narx[r.tovar_id] || 0);
      } else if (r.manba_tur === 'ishlab_chiqarish') {
        // Ishlab chiqarish: xom ashyo sarfi (chiqim) va tayyor mahsulot (kirim) — ikkalasi tannarxda
        if (r.tur === 'kirim') { d.ishlab_kirim += n(r.summa); d.ishlab_kirim_dona += dona; }
        else if (r.tur === 'chiqim') d.ishlab_sarf += Math.abs(n(r.summa));
      }
    }

    const sotuvchi = qoldiq.filter(r => r.tur !== 'brak');
    const qiymat = sotuvchi.reduce((s, r) => s + r.qiymat, 0);
    const kunlikTannarx = d.sotuv / D.kunlar;

    // Ombor kesimi: asosiy, har mashina, brak
    const om = {};
    qoldiq.forEach(r => {
      const x = om[r.ombor] = om[r.ombor] || { nomi: r.ombor, tur: r.tur, qiymat: 0, dona: 0, tovar: new Set() };
      x.qiymat += r.qiymat; x.dona += r.dona; x.tovar.add(r.tovar_id);
    });
    // Tovar kesimi (brakdan tashqari)
    const tv = {};
    sotuvchi.forEach(r => {
      const x = tv[r.tovar_id] = tv[r.tovar_id] || { id: r.tovar_id, nomi: r.nomi, turkum: r.turkum, dona: 0, qiymat: 0 };
      x.dona += r.dona; x.qiymat += r.qiymat;
    });
    const tk = {};
    Object.values(tv).forEach(x => { tk[x.turkum] = (tk[x.turkum] || 0) + x.qiymat; });
    const oxirgiMap = Object.fromEntries(oxirgiSotuv.map(r => [r.tovar_id, r.s]));
    const bugun = Date.now();
    const tovarRows = Object.values(tv).map(x => {
      const kunlik = (sotilgan[x.id] || 0) / D.kunlar;
      return {
        ...x, dona: miq(x.dona), qiymat: yax(x.qiymat), kunlik: +kunlik.toFixed(2),
        yetadi_kun: kunlik > 0 ? Math.round(x.dona / kunlik) : null,
        oxirgi_sotuv: oxirgiMap[x.id] || null,
        sotilmagan_kun: oxirgiMap[x.id] ? Math.floor((bugun - new Date(oxirgiMap[x.id]).getTime()) / 86400000) : null,
      };
    });

    res.send({
      davr: davrJavob(D),
      jami: {
        qiymat: yax(qiymat), dona: miq(sotuvchi.reduce((s, r) => s + r.dona, 0)), tovar_turi: Object.keys(tv).length,
        zaxira_kun: kunlikTannarx > 0 ? Math.round(qiymat / kunlikTannarx) : null,
        brak_qiymat: yax(qoldiq.filter(r => r.tur === 'brak').reduce((s, r) => s + r.qiymat, 0)),
        mashina_qiymat: yax(qoldiq.filter(r => r.tur === 'mashina').reduce((s, r) => s + r.qiymat, 0)),
      },
      harakat: {
        kirim: yax(d.kirim), kirim_dona: miq(d.kirim_dona), qaytgan: yax(d.qaytgan),
        sotuv_tannarx: yax(d.sotuv), sotuv_dona: miq(d.sotuv_dona),
        kochirish_dona: miq(d.kochirish_dona), kochirish_son: d.kochirish_son, inventar: yax(d.inventar),
      },
      trend: keys.map(k => ({ k, kirim: yax(tm[k].kirim), sotuv: yax(tm[k].sotuv) })),
      omborlar: Object.values(om).map(x => ({ nomi: x.nomi, tur: x.tur, qiymat: yax(x.qiymat), dona: miq(x.dona), tovar_turi: x.tovar.size, ulush: foiz(x.qiymat, qiymat) }))
        .sort((a, b) => (a.tur === 'asosiy' ? -1 : 0) - (b.tur === 'asosiy' ? -1 : 0) || b.qiymat - a.qiymat),
      turkumlar: Object.entries(tk).map(([nomi, q]) => ({ nomi, qiymat: yax(q), ulush: foiz(q, qiymat) })).sort((a, b) => b.qiymat - a.qiymat),
      harakatsiz: tovarRows.filter(r => !sotilgan[r.id]).sort((a, b) => b.qiymat - a.qiymat).slice(0, 15),
      tugayapti: tovarRows.filter(r => r.yetadi_kun !== null && r.yetadi_kun <= 14).sort((a, b) => a.yetadi_kun - b.yetadi_kun).slice(0, 15),
    });
  };

  /* GET /tahlil/kirim?dan&gacha — xaridlar */
  kirim = async (req, res) => {
    const D = U.davr(req.query);
    const yil = new Date(D.to); yil.setMonth(yil.getMonth() - 11); yil.setDate(1); yil.setHours(0, 0, 0, 0);
    const [hujjatlar, old, tovarlar, oylik] = await Promise.all([
      Q(`SELECT p.id, p.hujjat_raqam, p.sana, p.yetkazuvchi_id, COALESCE(y.ism, p.yetkazuvchi, 'Nomaʼlum') AS yetkazuvchi,
                p.jami_summa, p.tolov_turi, p.tolangan_summa, p.ombor, ${U.guruhSql('p.sana', D.guruh)} AS k
         FROM prixod p LEFT JOIN yetkazuvchi y ON y.id = p.yetkazuvchi_id
         WHERE p.holat = 'tasdiqlangan' AND p.deletedAt IS NULL AND p.sana BETWEEN :from AND :to
         ORDER BY p.sana DESC`, { from: D.from, to: D.to, tz: D.tz }),
      kirimJami(D.pFrom, D.pTo),
      Q(`SELECT pq.tovar_id, MAX(COALESCE(t.nomi, pq.tovar_nomi)) AS nomi, MAX(COALESCE(t.turkum, pq.turkum)) AS turkum,
                SUM(pq.donada) AS dona, SUM(pq.summa) AS summa
         FROM prixod_qator pq JOIN prixod p ON p.id = pq.prixod_id LEFT JOIN tovar t ON t.id = pq.tovar_id
         WHERE p.holat = 'tasdiqlangan' AND p.deletedAt IS NULL AND p.sana BETWEEN :from AND :to
         GROUP BY pq.tovar_id`, { from: D.from, to: D.to }),
      Q(`SELECT DATE_FORMAT(CONVERT_TZ(sana, '+00:00', :tz), '%Y-%m') AS oy, SUM(jami_summa) AS summa, COUNT(*) AS hujjat
         FROM prixod WHERE holat = 'tasdiqlangan' AND deletedAt IS NULL AND sana BETWEEN :yil AND :to
         GROUP BY oy ORDER BY oy`, { yil, to: D.to, tz: D.tz }),
    ]);
    const jamiSumma = hujjatlar.reduce((s, h) => s + n(h.jami_summa), 0);
    const keys = U.guruhKalitlari(D);
    const tm = Object.fromEntries(keys.map(k => [k, { k, summa: 0, hujjat: 0 }]));
    const ye = {};
    hujjatlar.forEach(h => {
      if (tm[h.k]) { tm[h.k].summa += n(h.jami_summa); tm[h.k].hujjat++; }
      const key = h.yetkazuvchi_id || h.yetkazuvchi;
      const x = ye[key] = ye[key] || { id: h.yetkazuvchi_id, nomi: h.yetkazuvchi, summa: 0, hujjat: 0, oxirgi: h.sana };
      x.summa += n(h.jami_summa); x.hujjat++; if (new Date(h.sana) > new Date(x.oxirgi)) x.oxirgi = h.sana;
    });
    const tk = {};
    tovarlar.forEach(t => { const k = t.turkum || 'Boshqa'; tk[k] = (tk[k] || 0) + n(t.summa); });
    const oyMap = Object.fromEntries(oylik.map(o => [o.oy, o]));
    const oylar = [];
    for (let d = new Date(yil); d <= D.to; d.setMonth(d.getMonth() + 1)) {
      const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      oylar.push({ k, summa: yax(oyMap[k]?.summa), hujjat: n(oyMap[k]?.hujjat) });
    }
    res.send({
      davr: davrJavob(D),
      jami: {
        summa: yax(jamiSumma), hujjat: hujjatlar.length, yetkazuvchi: Object.keys(ye).length,
        tovar_turi: tovarlar.length, dona: miq(tovarlar.reduce((s, t) => s + n(t.dona), 0)),
        tolanmagan: yax(hujjatlar.reduce((s, h) => s + Math.max(0, n(h.jami_summa) - n(h.tolangan_summa)), 0)),
      },
      oldingi: old,
      trend: keys.map(k => ({ k, summa: yax(tm[k].summa), hujjat: tm[k].hujjat })),
      oylik: oylar,
      yetkazuvchilar: Object.values(ye).map(x => ({ ...x, summa: yax(x.summa), ulush: foiz(x.summa, jamiSumma) })).sort((a, b) => b.summa - a.summa),
      turkumlar: Object.entries(tk).map(([nomi, s]) => ({ nomi, summa: yax(s), ulush: foiz(s, jamiSumma) })).sort((a, b) => b.summa - a.summa),
      tovarlar: tovarlar.map(t => ({ id: t.tovar_id, nomi: t.nomi, turkum: t.turkum || 'Boshqa', dona: miq(t.dona), summa: yax(t.summa),
        ortacha_narx: n(t.dona) ? yax(n(t.summa) / n(t.dona)) : 0 })).sort((a, b) => b.summa - a.summa).slice(0, 15),
      hujjatlar: hujjatlar.slice(0, 30).map(h => ({ id: h.id, raqam: h.hujjat_raqam || `#${h.id}`, sana: h.sana, yetkazuvchi: h.yetkazuvchi,
        summa: yax(h.jami_summa), tolangan: yax(h.tolangan_summa), ombor: h.ombor })),
    });
  };

  /* GET /tahlil/yetkazuvchilar — kreditorka */
  yetkazuvchilar = async (req, res) => {
    const olti = new Date(); olti.setMonth(olti.getMonth() - 5); olti.setDate(1); olti.setHours(0, 0, 0, 0);
    const tz = U.tzOffset();
    const [rows, oylik] = await Promise.all([
      Q(`SELECT y.id, y.ism AS nomi, y.telefon, y.balans,
           COALESCE(SUM(CASE WHEN h.tur = 'qarz'  THEN h.summa END), 0) AS olindi,
           COALESCE(SUM(CASE WHEN h.tur = 'tolov' THEN h.summa END), 0) AS tolandi,
           MAX(CASE WHEN h.tur = 'qarz'  THEN h.sana END) AS oxirgi_kirim,
           MAX(CASE WHEN h.tur = 'tolov' THEN h.sana END) AS oxirgi_tolov,
           SUM(h.tur = 'qarz') AS hujjat
         FROM yetkazuvchi y LEFT JOIN yetkazuvchi_harakatlar h ON h.yetkazuvchi_id = y.id
         GROUP BY y.id, y.ism, y.telefon, y.balans`),
      Q(`SELECT DATE_FORMAT(CONVERT_TZ(sana, '+00:00', :tz), '%Y-%m') AS oy,
           SUM(CASE WHEN tur = 'qarz' THEN summa ELSE 0 END) AS olindi,
           SUM(CASE WHEN tur = 'tolov' THEN summa ELSE 0 END) AS tolandi
         FROM yetkazuvchi_harakatlar WHERE sana >= :olti GROUP BY oy ORDER BY oy`, { olti, tz }),
    ]);
    const bugun = Date.now();
    const list = rows.map(r => {
      const balans = n(r.balans);
      return {
        id: r.id, nomi: r.nomi, telefon: r.telefon,
        olindi: yax(r.olindi), tolandi: yax(r.tolandi), balans: yax(balans),
        qarzimiz: yax(Math.max(0, -balans)), avans: yax(Math.max(0, balans)),
        tolangan_foiz: foiz(r.tolandi, r.olindi), hujjat: n(r.hujjat),
        oxirgi_kirim: r.oxirgi_kirim, oxirgi_tolov: r.oxirgi_tolov,
        tolovsiz_kun: r.oxirgi_tolov ? Math.floor((bugun - new Date(r.oxirgi_tolov).getTime()) / 86400000) : null,
      };
    }).sort((a, b) => b.qarzimiz - a.qarzimiz || b.olindi - a.olindi);
    const oyMap = Object.fromEntries(oylik.map(o => [o.oy, o]));
    const oylar = [];
    for (let d = new Date(olti); d <= new Date(); d.setMonth(d.getMonth() + 1)) {
      const k = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
      oylar.push({ k, olindi: yax(oyMap[k]?.olindi), tolandi: yax(oyMap[k]?.tolandi) });
    }
    res.send({
      jami: {
        qarzimiz: yax(list.reduce((s, r) => s + r.qarzimiz, 0)), avans: yax(list.reduce((s, r) => s + r.avans, 0)),
        olindi: yax(list.reduce((s, r) => s + r.olindi, 0)), tolandi: yax(list.reduce((s, r) => s + r.tolandi, 0)),
        qarzdor_soni: list.filter(r => r.qarzimiz > 0).length, soni: list.length,
      },
      oylik: oylar,
      rows: list,
    });
  };

  /* GET /tahlil/jurnal?dan&gacha&ombor&harakat&search&page — ombor jurnali (register) */
  jurnal = async (req, res) => {
    const D = U.davr(req.query, 7);
    const { ombor, harakat, search } = req.query;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(10, parseInt(req.query.limit, 10) || 50));
    const HARAKAT_SQL = {
      xarid: "r.manba_tur = 'prixod'", sotuv: "r.manba_tur = 'sotuv'", qaytarish: "r.manba_tur = 'qaytarma'",
      kochirish: "r.manba_tur IN ('yuklash', 'qabul', 'kochirish', 'agent_kochirish')", inventar: "r.manba_tur = 'inventar'",
      ishlab: "r.manba_tur = 'ishlab_chiqarish'",
    };
    const shart = ['r.sana BETWEEN :from AND :to'];
    if (ombor) shart.push('r.ombor = :ombor');
    if (search) shart.push('r.tovar_nomi LIKE :search');
    const asos = shart.join(' AND ');
    // Faqat ma'lum kalitlar (prototip kalitlari — "constructor" va h.k. — SQL'ga tushmaydi);
    // bo'sh yoki "hammasi" — filtrsiz, boshqa noma'lum qiymat → 400
    const harakatBor = harakat !== undefined && harakat !== null && harakat !== '' && !['hammasi', 'barchasi', 'all'].includes(harakat);
    if (harakatBor && (typeof harakat !== 'string' || !Object.hasOwn(HARAKAT_SQL, harakat))) {
      throw new HttpException(400, `harakat noto'g'ri — ${Object.keys(HARAKAT_SQL).join(', ')} bo'lishi mumkin`);
    }
    const toliq = harakatBor ? `${asos} AND ${HARAKAT_SQL[harakat]}` : asos;
    const rep = { from: D.from, to: D.to, ombor, search: `%${search || ''}%`, limit, offset: (page - 1) * limit };

    const [rows, [{ jami }], kpi, omborlar] = await Promise.all([
      Q(`SELECT r.id, r.sana, r.tur, r.manba_tur, r.manba_id, r.tovar_id, r.tovar_nomi, r.ombor, r.donada,
                r.kirim_narx, r.sotuv_narx, r.summa
         FROM tovar_register r WHERE ${toliq} ORDER BY r.sana DESC, r.id DESC LIMIT :limit OFFSET :offset`, rep),
      Q(`SELECT COUNT(*) AS jami FROM tovar_register r WHERE ${toliq}`, rep),
      Q(`SELECT r.tur, r.manba_tur, COUNT(*) AS son, SUM(ABS(r.donada)) AS dona, SUM(ABS(r.summa)) AS summa
         FROM tovar_register r WHERE ${asos} GROUP BY r.tur, r.manba_tur`, rep),
      Q(`SELECT DISTINCT ombor FROM tovar_register WHERE ombor IS NOT NULL ORDER BY ombor`),
    ]);

    // Hujjatlar: prixod / ariza / avtolavka hujjati
    const ids = t => [...new Set(rows.filter(r => t.includes(r.manba_tur)).map(r => r.manba_id))];
    const [px, az, al, ic, ak] = await Promise.all([
      ids(['prixod']).length ? Q(`SELECT p.id, p.hujjat_raqam AS raqam, COALESCE(y.ism, p.yetkazuvchi) AS izoh FROM prixod p LEFT JOIN yetkazuvchi y ON y.id = p.yetkazuvchi_id WHERE p.id IN (:ids)`, { ids: ids(['prixod']) }) : [],
      ids(['sotuv', 'qaytarma']).length ? Q(`SELECT id, raqam, mijoz_nomi AS izoh FROM ariza WHERE id IN (:ids)`, { ids: ids(['sotuv', 'qaytarma']) }) : [],
      ids(U.ICHKI).length ? Q(`SELECT h.id, h.raqam, h.sana, h.agent_id, ag.fullname AS izoh FROM avtolavka_hujjat h LEFT JOIN agent ag ON ag.id = h.agent_id WHERE h.id IN (:ids)`, { ids: ids(U.ICHKI) }) : [],
      ids(['ishlab_chiqarish']).length ? Q(`SELECT id, raqam, izoh FROM ishlab_chiqarish WHERE id IN (:ids)`, { ids: ids(['ishlab_chiqarish']) }) : [],
      ids(['agent_kochirish']).length ? Q(`SELECT id, raqam, dan_agent_nomi, ga_agent_nomi, holat FROM agent_kochirish WHERE id IN (:ids)`, { ids: ids(['agent_kochirish']) }) : [],
    ]);
    const mp = a => Object.fromEntries(a.map(x => [x.id, x]));
    const pxM = mp(px), azM = mp(az), alM = mp(al), icM = mp(ic), akM = mp(ak);

    const turi = r => {
      if (r.manba_tur === 'prixod') return 'xarid';
      if (r.manba_tur === 'sotuv') return 'sotuv';
      if (r.manba_tur === 'qaytarma') return 'qaytarish';
      if (U.KOCHIRISH_MANBA.includes(r.manba_tur)) return 'kochirish';
      if (r.manba_tur === 'inventar') return 'inventar';
      if (r.manba_tur === 'ishlab_chiqarish') return 'ishlab';
      return 'boshqa';
    };
    const NOM = {
      xarid: 'Xarid (kirim)', sotuv: 'Sotuv', qaytarish: 'Qaytarish', inventar: 'Inventarizatsiya', boshqa: 'Boshqa',
      ishlab: 'Ishlab chiqarish',
      yuklash: 'Mashinaga yuklash', qabul: 'Mashinadan qabul', kochirish: 'Ombordan omborga',
      agent_kochirish: 'Agentdan agentga',
    };
    const data = rows.map(r => {
      const h = turi(r);
      let hujjat = null;
      if (r.manba_tur === 'prixod') { const p = pxM[r.manba_id]; hujjat = { raqam: p?.raqam || `Prixod #${r.manba_id}`, izoh: p?.izoh || null, yol: `/ombor/prixod/${r.manba_id}` }; }
      else if (['sotuv', 'qaytarma'].includes(r.manba_tur)) { const a = azM[r.manba_id]; hujjat = { raqam: a?.raqam || `Ariza #${r.manba_id}`, izoh: a?.izoh || null, yol: `/sotuvlar/arizalar?doc=${r.manba_id}` }; }
      else if (U.ICHKI.includes(r.manba_tur)) {
        const a = alM[r.manba_id];
        const sana = a?.sana ? String(a.sana).slice(0, 10) : '';
        hujjat = { raqam: a?.raqam || `#${r.manba_id}`, izoh: a?.izoh || null, yol: a ? `/avtolavka?sana=${sana}&agent=${a.agent_id}` : '/avtolavka' };
      } else if (r.manba_tur === 'kochirish') {
        // Yo'nalish: Xom ashyo omboriga kirgan yoki asosiy skladdan chiqqan yozuv — "skladdan xom ashyo omboriga"
        const xomga = (r.ombor === XOM_ASHYO_OMBOR) === (n(r.donada) > 0);
        hujjat = { raqam: 'Tovar turi o\'zgardi', izoh: xomga ? 'Asosiy sklad → Xom ashyo ombori' : 'Xom ashyo ombori → Asosiy sklad', yol: null };
      } else if (r.manba_tur === 'agent_kochirish') {
        const x = akM[r.manba_id];
        hujjat = { raqam: x?.raqam || `KO #${r.manba_id}`, izoh: x ? `${x.dan_agent_nomi} → ${x.ga_agent_nomi}${x.holat === 'bekor' ? ' (bekor qilingan)' : ''}` : null, yol: `/avtolavka/kochirish/${r.manba_id}` };
      } else if (r.manba_tur === 'ishlab_chiqarish') {
        const x = icM[r.manba_id];
        hujjat = { raqam: x?.raqam || `IC #${r.manba_id}`, izoh: r.tur === 'chiqim' ? 'xom ashyo sarfi' : r.tur === 'kirim' ? 'tayyor mahsulot' : 'bekor qilindi', yol: `/ishlab/${r.manba_id}` };
      } else hujjat = { raqam: `#${r.manba_id}`, izoh: null, yol: null };
      const dona = n(r.donada);
      return {
        id: r.id, sana: r.sana, harakat: h, nom: NOM[(U.ICHKI.includes(r.manba_tur) || r.manba_tur === 'agent_kochirish') ? r.manba_tur : h] || NOM[h],
        yonalish: dona >= 0 ? 'kirdi' : 'chiqdi', tovar_id: r.tovar_id, tovar_nomi: r.tovar_nomi, ombor: r.ombor,
        dona, narx: yax(h === 'sotuv' ? r.sotuv_narx : r.kirim_narx), summa: yax(Math.abs(n(r.summa))), hujjat,
      };
    });

    const k = { xarid: { son: 0, dona: 0, summa: 0 }, sotuv: { son: 0, dona: 0, summa: 0 }, qaytarish: { son: 0, dona: 0, summa: 0 },
      kochirish: { son: 0, dona: 0, summa: 0 }, inventar: { son: 0, dona: 0, summa: 0 }, ishlab: { son: 0, dona: 0, summa: 0 } };
    for (const r of kpi) {
      const h = turi(r);
      if (!k[h]) continue;
      // Ko'chirish ikki yozuvdan iborat (chiqdi + kirdi) — bir marta sanaladi
      if (h === 'kochirish' && r.tur !== 'chiqim') continue;
      if (h === 'qaytarish' && r.tur !== 'qaytarma_kirim') continue;
      k[h].son += n(r.son); k[h].dona += n(r.dona); k[h].summa += n(r.summa);
    }
    Object.values(k).forEach(x => { x.dona = miq(x.dona); x.summa = yax(x.summa); });

    res.send({
      davr: davrJavob(D), data, jami: n(jami), page, pages: Math.max(1, Math.ceil(n(jami) / limit)),
      kpi: k, omborlar: omborlar.map(o => o.ombor),
    });
  };

  /* GET /tahlil/xodim?agent_id&dan&gacha — bitta xodim bo'yicha to'liq hisobot.
     Sotuv va foyda boshqa hisobotlar bilan bir xil qoida (sotuvTahlil) bilan hisoblanadi. */
  xodim = async (req, res) => {
    const D = U.davr(req.query);
    const royxat = await Q(`SELECT id, fullname AS nomi, avtolavka FROM agent WHERE deletedAt IS NULL ORDER BY avtolavka DESC, fullname`);
    const agent_id = parseInt(req.query.agent_id, 10) || (royxat[0] && royxat[0].id) || null;
    if (!agent_id) return res.send({ davr: davrJavob(D), agentlar_royxat: royxat, agent: null });
    const [ag] = await Q(`
      SELECT a.id, a.fullname, a.telefon, a.avtolavka, a.mashina_raqam, a.transport, a.plan_summa, a.bonus_foiz, a.ish_boshlagan,
             t.nomi AS hudud,
             (SELECT COUNT(*) FROM mijoz m WHERE m.agent_id = a.id AND m.deletedAt IS NULL AND m.faol = 1) AS mijoz_soni
      FROM agent a LEFT JOIN territoriya t ON t.id = a.territoriya_id
      WHERE a.id = :id AND a.deletedAt IS NULL`, { id: agent_id });
    if (!ag) return res.status(404).send({ message: 'Agent topilmadi' });

    const { dan, gacha, from, to } = D;
    const oyBosh = `${gacha.slice(0, 7)}-01`;
    const [J, O, arizalar, tashriflar, sotmaslik, kassa, inkas, reja, bonus, oyFakt, qarz, mijozlar] = await Promise.all([
      sotuvTahlil(from, to, { agent_id }),
      sotuvTahlil(D.pFrom, D.pTo, { agent_id }),
      Q(`SELECT id, raqam, mijoz_id, mijoz_nomi, jami_summa, tolov_turi, tolangan_summa, masofa_m, oflayn,
                COALESCE(yetkazilgan_sana, createdAt) AS sana
         FROM ariza WHERE agent_id = :agent_id AND turi = 'sotish' AND holat = 'yetkazildi' AND deletedAt IS NULL
           AND COALESCE(yetkazilgan_sana, createdAt) BETWEEN :from AND :to ORDER BY sana`, { agent_id, from, to }),
      Q(`SELECT id, mijoz_id, mijoz_nomi, sana, natija, checkin_vaqt, checkout_vaqt, davomiylik_sek, checkin_masofa, ariza_id
         FROM tashrif WHERE agent_id = :agent_id AND sana BETWEEN :dan AND :gacha ORDER BY checkin_vaqt`, { agent_id, dan, gacha }),
      Q(`SELECT sabab_id, sabab_nomi, mijoz_nomi, sana FROM sotmaslik
         WHERE agent_id = :agent_id AND sana BETWEEN :from AND :to`, { agent_id, from, to }),
      Q(`SELECT manba_tur, COALESCE(SUM(summa), 0) AS summa, COUNT(*) AS soni FROM kassa
         WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND user_id = :agent_id AND manba_tur IN ('avtolavka', 'mijoz')
           AND sana BETWEEN :from AND :to GROUP BY manba_tur`, { agent_id, from, to }),
      Q(`SELECT sana, yigilgan_summa, topshirilgan_summa, farq, holat FROM inkassatsiya
         WHERE agent_id = :agent_id AND sana BETWEEN :dan AND :gacha ORDER BY sana DESC`, { agent_id, dan, gacha }),
      Q(`SELECT COUNT(*) AS soni, COUNT(DISTINCT mijoz_id) AS mijoz FROM marshrut_reja
         WHERE agent_id = :agent_id AND sana BETWEEN :dan AND :gacha`, { agent_id, dan, gacha }),
      Q(`SELECT COALESCE(SUM(bonus_summa), 0) AS bonus FROM agent_register
         WHERE agent_id = :agent_id AND tur = 'savdo' AND sana BETWEEN :from AND :to`, { agent_id, from, to }),
      Q(`SELECT COALESCE(SUM(summa), 0) AS fakt FROM agent_register
         WHERE agent_id = :agent_id AND tur = 'savdo' AND sana BETWEEN :oyFrom AND :to`, { agent_id, oyFrom: new Date(`${oyBosh}T00:00:00`), to }),
      qarzTahlil({ agent_id }),
      Q(`SELECT id, nomi, tashrif_kunlari FROM mijoz WHERE agent_id = :agent_id AND deletedAt IS NULL AND faol = 1`, { agent_id }),
    ]);

    /* ── Sotuv: naqd / qarzga, uzoqdan, oflayn; mijozlar kesimi ── */
    let naqd = 0, uzoq = 0, oflayn = 0;
    const mj = {};
    const mijozYoz = (id, nomi) => (mj[id || 0] = mj[id || 0] || { id, nomi: nomi || '—', tushum: 0, naqd: 0, buyurtma: 0, tashrif: 0, oxirgi: null });
    for (const a of arizalar) {
      const s = n(a.jami_summa);
      const nq = n(a.tolangan_summa) > 0 ? Math.min(s, n(a.tolangan_summa)) : (['naqt', 'naqd'].includes(a.tolov_turi) ? s : 0);
      naqd += nq;
      if (a.masofa_m != null && n(a.masofa_m) > SOTUV_RADIUS_M) uzoq++;
      if (Number(a.oflayn)) oflayn++;
      const x = mijozYoz(a.mijoz_id, a.mijoz_nomi);
      x.tushum += s; x.naqd += nq; x.buyurtma++;
      if (!x.oxirgi || new Date(a.sana) > new Date(x.oxirgi)) x.oxirgi = a.sana;
    }
    const sotuvJami = arizalar.reduce((t, a) => t + n(a.jami_summa), 0);
    tashriflar.forEach(t => { mijozYoz(t.mijoz_id, t.mijoz_nomi).tashrif++; });
    const qarzMap = Object.fromEntries((qarz.rows || []).map(r => [r.id, r]));
    const mijozRoyxat = Object.values(mj).map(x => ({
      ...x, tushum: yax(x.tushum), naqd: yax(x.naqd), qarzga: yax(x.tushum - x.naqd),
      qarz: yax(qarzMap[x.id]?.qarz || 0), muddati_otgan: yax(qarzMap[x.id]?.muddati_otgan || 0),
    })).sort((a, b) => b.tushum - a.tushum || b.tashrif - a.tashrif);
    const xaridQilgan = new Set(arizalar.map(a => a.mijoz_id));
    const tashrifQilingan = new Set(tashriflar.map(t => t.mijoz_id));

    /* ── Dinamika va tovarlar ── */
    const keys = U.guruhKalitlari(D);
    const tm = Object.fromEntries(keys.map(k => [k, { k, tushum: 0, foyda: 0, b: new Set() }]));
    const tv = {};
    for (const q of J.qatorlar) {
      const t = tm[kalit(q.sana, D.guruh)];
      const f = n(q.summa) - J.tannarxOf(q);
      if (t) { t.tushum += n(q.summa); t.foyda += f; t.b.add(q.ariza_id); }
      const x = tv[q.tovar_id || q.tovar_nomi] = tv[q.tovar_id || q.tovar_nomi] || { id: q.tovar_id, nomi: q.tovar_nomi || '—', turkum: q.turkum || 'Boshqa', tushum: 0, foyda: 0, dona: 0 };
      x.tushum += n(q.summa); x.foyda += f; x.dona += n(q.jami_dona);
    }

    /* ── Tashriflar va sotmaslik sabablari ── */
    const yopiq = tashriflar.filter(t => t.checkout_vaqt);
    const savdoT = tashriflar.filter(t => t.natija === 'savdo').length;
    const sotmaslikT = tashriflar.filter(t => t.natija === 'sotmaslik').length;
    const sabab = {};
    sotmaslik.forEach(s => {
      const nom = s.sabab_nomi || sababNomi(s.sabab_id) || "Sabab ko'rsatilmagan";
      sabab[nom] = (sabab[nom] || 0) + 1;
    });

    /* ── Naqd: yig'ildi → topshirildi ── */
    const kassaM = Object.fromEntries(kassa.map(k => [k.manba_tur, n(k.summa)]));
    const yigildi = (kassaM.avtolavka || 0) + (kassaM.mijoz || 0);
    const topshirildi = inkas.reduce((t, r) => t + n(r.topshirilgan_summa), 0);
    const kamomad = inkas.reduce((t, r) => t + Math.max(0, n(r.farq)), 0);
    const ortiqcha = inkas.reduce((t, r) => t + Math.max(0, -n(r.farq)), 0);

    /* ── Avtolavka: mashina kunlari (yuklash → savdo → topshirish) ── */
    const HOLAT = { bosh: 'Yuklanmagan', ochiq: 'Savdoda', topshirilmoqda: 'Topshirish kutilmoqda', yopiq: 'Yopildi', kamomad: 'Kamomad bilan yopildi' };
    const agentObj = { id: ag.id, fullname: ag.fullname, mashina_raqam: ag.mashina_raqam, avtolavka: ag.avtolavka };
    let avtolavka = null, kun = null;
    if (Number(ag.avtolavka)) {
      const ombor = agentOmbori(ag.fullname);
      const kunlarRows = await Q(`
        SELECT DISTINCT DATE_FORMAT(d, '%Y-%m-%d') AS d FROM (
          SELECT sana AS d FROM avtolavka_hujjat WHERE agent_id = :agent_id AND sana BETWEEN :dan AND :gacha
          UNION SELECT sana FROM avtolavka_kun WHERE agent_id = :agent_id AND sana BETWEEN :dan AND :gacha
          UNION SELECT DATE(CONVERT_TZ(sana, '+00:00', :tz)) FROM agent_kochirish
            WHERE (dan_agent_id = :agent_id OR ga_agent_id = :agent_id) AND sana BETWEEN :from AND :to
          UNION SELECT DATE(CONVERT_TZ(yetkazilgan_sana, '+00:00', :tz)) FROM ariza
            WHERE agent_id = :agent_id AND ombor = :ombor AND turi = 'sotish' AND holat = 'yetkazildi' AND deletedAt IS NULL
              AND yetkazilgan_sana BETWEEN :from AND :to
        ) x ORDER BY d DESC LIMIT 31`, { agent_id, dan, gacha, ombor, from, to, tz: D.tz });
      const kunlar = await Promise.all(kunlarRows.map(r => kunHisobla(agentObj, r.d)));
      avtolavka = {
        ombor,
        kunlar: kunlar.map(r => ({
          sana: r.sana, holat: r.holat, holat_nomi: HOLAT[r.holat] || r.holat, bosqich: r.bosqich,
          yuklandi: n(r.tovar.berildi.dona), yuklandi_summa: n(r.tovar.berildi.summa),
          sotildi: n(r.tovar.sotildi.dona), sotuv: n(r.pul.sotuv_jami), naqd_sotuv: n(r.pul.naqd_sotuv), qarzga: n(r.pul.qarzga_sotuv),
          qaytdi: n(r.tovar.topshirildi.dona), brak: n(r.tovar.brak.dona), tovar_farq: n(r.tovar.farq.dona),
          naqd_kerak: n(r.pul.kerak), naqd_topshirildi: n(r.pul.topshirildi), naqd_farq: n(r.pul.farq),
          tashrif: n(r.kun.tashrif), savdo: n(r.kun.savdo),
          yuklash_vaqt: r.kun.yuklash_vaqt, qaytish_vaqt: r.kun.qaytish_vaqt,
        })),
      };
      if (dan === gacha) {
        const t = await kunHisobla(agentObj, dan, { tafsilot: true });
        kun = { sana: dan, holat_nomi: HOLAT[t.holat] || t.holat, voqealar: t.voqealar || [], tovarlar: t.tovarlar || [] };
      }
    } else if (dan === gacha) {
      // Oddiy agent: tashrif va sotuvlardan kun yo'li
      const v = [];
      tashriflar.forEach(t => v.push({ tur: t.natija === 'sotmaslik' ? 'sotmaslik' : 'tashrif', vaqt: t.checkin_vaqt, mijoz: t.mijoz_nomi, ochiq: !t.checkout_vaqt }));
      arizalar.forEach(a => v.push({ tur: 'sotuv', vaqt: a.sana, raqam: a.raqam, mijoz: a.mijoz_nomi, summa: n(a.jami_summa),
        naqd: ['naqt', 'naqd'].includes(a.tolov_turi), uzoq: a.masofa_m != null && n(a.masofa_m) > SOTUV_RADIUS_M, masofa: a.masofa_m }));
      kun = { sana: dan, holat_nomi: null, voqealar: v.sort((a, b) => new Date(a.vaqt) - new Date(b.vaqt)), tovarlar: [] };
    }

    const plan = n(ag.plan_summa);
    res.send({
      davr: davrJavob(D),
      agentlar_royxat: royxat,
      agent: {
        id: ag.id, nomi: ag.fullname, telefon: ag.telefon || '', avtolavka: !!Number(ag.avtolavka), mashina_raqam: ag.mashina_raqam || '',
        transport: ag.transport || '', hudud: ag.hudud || '', ish_boshlagan: ag.ish_boshlagan, mijoz_soni: n(ag.mijoz_soni),
        plan_summa: plan, bonus_foiz: n(ag.bonus_foiz),
      },
      sotuv: {
        jami: J.jami, oldingi: O.jami,
        naqd: yax(naqd), qarzga: yax(Math.max(0, sotuvJami - naqd)), hujjat: arizalar.length,
        uzoq, oflayn, radius: SOTUV_RADIUS_M,
      },
      plan: {
        oy: oyBosh.slice(0, 7), plan, fakt: yax(oyFakt[0]?.fakt), foiz: plan ? foiz(oyFakt[0]?.fakt, plan) : null,
        qolgan: plan ? yax(Math.max(0, plan - n(oyFakt[0]?.fakt))) : null, bonus: yax(bonus[0]?.bonus),
      },
      trend: keys.map(k => ({ k, tushum: yax(tm[k].tushum), foyda: yax(tm[k].foyda), buyurtma: tm[k].b.size })),
      tovarlar: Object.values(tv).map(x => ({ ...x, tushum: yax(x.tushum), foyda: yax(x.foyda), dona: miq(x.dona), marja: foiz(x.foyda, x.tushum) }))
        .sort((a, b) => b.tushum - a.tushum).slice(0, 12),
      tashrif: {
        jami: tashriflar.length, savdo: savdoT, sotmaslik: sotmaslikT, ochiq: tashriflar.length - yopiq.length,
        konversiya: tashriflar.length ? foiz(savdoT, tashriflar.length) : 0,
        ort_daqiqa: yopiq.length ? yax(yopiq.reduce((t, x) => t + n(x.davomiylik_sek), 0) / yopiq.length / 60) : 0,
        uzoq: tashriflar.filter(t => t.checkin_masofa != null && n(t.checkin_masofa) > SOTUV_RADIUS_M).length,
        mijoz: tashrifQilingan.size, reja: n(reja[0]?.soni), reja_mijoz: n(reja[0]?.mijoz),
      },
      sabablar: Object.entries(sabab).map(([nom, soni]) => ({ nom, soni })).sort((a, b) => b.soni - a.soni),
      pul: {
        yigildi: yax(yigildi), sotuvdan: yax(kassaM.avtolavka || 0), qarz_undirish: yax(kassaM.mijoz || 0),
        topshirildi: yax(topshirildi), kamomad: yax(kamomad), ortiqcha: yax(ortiqcha),
        kunlar: inkas.map(r => ({ sana: r.sana, yigildi: n(r.yigilgan_summa), topshirildi: n(r.topshirilgan_summa), farq: n(r.farq), holat: r.holat })),
      },
      qarz: {
        jami: yax(qarz.jami.qarz), qarzdor: (qarz.rows || []).filter(r => r.qarz > 0).length, muddati_otgan: yax(qarz.jami.muddati_otgan || 0),
        bosqichlar: qarz.bosqichlar,
        rows: (qarz.rows || []).sort((a, b) => b.qarz - a.qarz).slice(0, 10),
      },
      qamrov: {
        jami: mijozlar.length,
        xarid_qilgan: mijozlar.filter(m => xaridQilgan.has(m.id)).length,
        tashrif_qilingan: mijozlar.filter(m => tashrifQilingan.has(m.id)).length,
        xarid_qilmagan: mijozlar.filter(m => !xaridQilgan.has(m.id)).map(m => ({ id: m.id, nomi: m.nomi, kunlar: m.tashrif_kunlari || '' })).slice(0, 30),
      },
      mijozlar: mijozRoyxat,
      avtolavka,
      kun,
    });
  };


  /* GET /tahlil/biznes?dan&gacha — BIZNES HOLATI:
     1) balans (hozir): biznesda nima bor va kimga qancha qarzmiz → sof qiymat;
     2) foyda-zarar (davr): yalpi foyda − operatsion xarajatlar = sof foyda;
     3) salomatlik ko'rsatkichlari: qarz yig'ish, zaxira, to'lov muddatlari, likvidlik — har biri baho bilan;
     4) so'nggi 6 oy dinamikasi. */
  biznes = async (req, res) => {
    const D = U.davr(req.query);
    const d30 = new Date(Date.now() - 30 * 86400000);
    const [J, O, narx, qarz, yetk, kassaD, kassaO, kassaQoldiq, kirimD, agentNaqd, uchinchi] = await Promise.all([
      sotuvTahlil(D.from, D.to), sotuvTahlil(D.pFrom, D.pTo),
      U.tannarxXaritasi(new Date()), qarzTahlil(),
      Q(`SELECT COALESCE(SUM(CASE WHEN balans < 0 THEN -balans END), 0) AS qarzimiz,
                COALESCE(SUM(CASE WHEN balans > 0 THEN balans END), 0) AS avans, SUM(balans < 0) AS soni FROM yetkazuvchi`),
      kassaJami(D.from, D.to), kassaJami(D.pFrom, D.pTo),
      Q(`SELECT COALESCE(SUM(CASE WHEN tur = 'kirim' THEN summa ELSE -summa END), 0) AS qoldiq FROM kassa`),
      kirimJami(D.from, D.to),
      // Agentlar yig'gan, lekin kassirga hali topshirilmagan naqd (so'nggi 30 kun) — kassa qoldig'ining bir qismi
      Q(`SELECT COALESCE(SUM(k.s), 0) AS summa, COUNT(DISTINCT k.user_id) AS agent FROM (
           SELECT user_id, DATE(CONVERT_TZ(sana, '+00:00', :tz)) AS d, SUM(summa) AS s FROM kassa
           WHERE tur = 'kirim' AND tolov_usul = 'naqt' AND manba_tur IN ('mijoz', 'avtolavka') AND user_id IS NOT NULL AND sana >= :d30
           GROUP BY user_id, d) k
         WHERE NOT EXISTS (SELECT 1 FROM inkassatsiya i WHERE i.agent_id = k.user_id AND i.sana = k.d)`, { d30, tz: D.tz }),
      // Uchinchi shaxslar bilan qarz oldi-berdi: har shaxs bo'yicha sof qoldiq (musbat — bizga qarzdor)
      Q(`SELECT COALESCE(SUM(CASE WHEN q > 0 THEN q END), 0) AS berilgan, COALESCE(SUM(CASE WHEN q < 0 THEN -q END), 0) AS olingan,
                SUM(q > 0.5) AS berilgan_soni, SUM(q < -0.5) AS olingan_soni FROM (
           SELECT h.shaxs_id, SUM(CASE h.tur WHEN 'qarz_berdik' THEN 1 WHEN 'qaytardik' THEN 1 WHEN 'bosh_qarzdor' THEN 1 ELSE -1 END * h.summa) AS q
           FROM uchinchi_shaxs_harakat h JOIN uchinchi_shaxs s ON s.id = h.shaxs_id AND s.deletedAt IS NULL GROUP BY h.shaxs_id) x`).catch(() => [{}]),
    ]);
    const qoldiq = await omborQoldiq(narx);
    const omborTur = tur => qoldiq.filter(r => r.tur === tur).reduce((a, r) => a + r.qiymat, 0);

    /* ── Foyda-zarar ── */
    // Tovar uchun to'lov va ishlab chiqarish xarajati — mahsulot tannarxida (sotilganda), operatsion xarajat emas
    // Uchinchi shaxslarga berilgan qarz va qaytarilgan qarz — pul aktivga/majburiyatga o'tadi, xarajat emas
    const XARAJAT_EMAS = ["Yetkazuvchilarga to'lov", 'Ishlab chiqarish xarajati', 'Qarz berildi', 'Olingan qarz qaytarildi', 'Qaytarish (naqd qaytarildi)'];   // qaytarish: sotuv summasi o'zi kamaygan
    const DAROMAD = ['Boshqa daromad'];                           // savdodan tashqari daromad
    const pnl = (S, K) => {
      const xarajatlar = K.toifalar.filter(t => t.tur === 'chiqim' && !XARAJAT_EMAS.includes(t.nom)).map(t => ({ nom: t.nom, summa: t.summa, son: t.son }));
      const xarajat = xarajatlar.reduce((a, t) => a + t.summa, 0);
      const boshqa = K.toifalar.filter(t => t.tur === 'kirim' && DAROMAD.includes(t.nom)).reduce((a, t) => a + t.summa, 0);
      const sof = S.foyda - xarajat + boshqa;
      return { tushum: S.sof_tushum, tannarx: S.tannarx, yalpi: S.foyda, yalpi_marja: S.marja, xarajat: yax(xarajat), xarajatlar,
        boshqa_daromad: yax(boshqa), sof_foyda: yax(sof), sof_marja: foiz(sof, S.sof_tushum) };
    };
    const P = pnl(J.jami, kassaD), PO = pnl(O.jami, kassaO);

    /* ── Balans (hozir) ── */
    const kassa = yax(kassaQoldiq[0]?.qoldiq);
    const ombor = yax(omborTur('asosiy')), mashina = yax(omborTur('mashina'));
    const debitorka = yax(qarz.jami.qarz), kreditorka = yax(yetk[0]?.qarzimiz), avans = yax(yetk[0]?.avans);
    const berilganQarz = yax(uchinchi[0]?.berilgan), olinganQarz = yax(uchinchi[0]?.olingan);
    const aktiv = kassa + ombor + mashina + debitorka + avans + berilganQarz;
    const majburiyat = yax(kreditorka + olinganQarz);
    const balans = {
      aktivlar: [
        { k: 'kassa', nom: 'Kassadagi pul', summa: kassa, izoh: n(agentNaqd[0]?.summa) > 0 ? `shundan ${Math.round(n(agentNaqd[0].summa)).toLocaleString('ru-RU')} so'm hali ${n(agentNaqd[0].agent)} ta agent qo'lida` : 'kassaga kirgan − chiqqan, butun davr' },
        { k: 'ombor', nom: 'Ombordagi tovar', summa: ombor, izoh: 'tannarx bo\'yicha' },
        { k: 'mashina', nom: 'Won Sell mashinalarida', summa: mashina, izoh: 'agentlar qo\'lidagi tovar' },
        { k: 'debitorka', nom: 'Mijozlar qarzi', summa: debitorka, izoh: qarz.jami.muddati_otgan > 0 ? `shundan ${Math.round(qarz.jami.muddati_otgan).toLocaleString('ru-RU')} so'm muddati o'tgan` : 'muddati o\'tgani yo\'q' },
        ...(avans ? [{ k: 'avans', nom: 'Yetkazuvchilardagi avans', summa: avans, izoh: 'oldindan to\'langan' }] : []),
        ...(berilganQarz ? [{ k: 'berilgan_qarz', nom: 'Berilgan qarzlar', summa: berilganQarz, izoh: `${n(uchinchi[0]?.berilgan_soni)} ta shaxs bizga qarzdor` }] : []),
      ],
      majburiyatlar: [
        { k: 'kreditorka', nom: 'Yetkazuvchilarga qarzimiz', summa: kreditorka, izoh: `${n(yetk[0]?.soni)} ta yetkazuvchiga` },
        ...(olinganQarz ? [{ k: 'olingan_qarz', nom: 'Olingan qarzlar', summa: olinganQarz, izoh: `${n(uchinchi[0]?.olingan_soni)} ta shaxsga qarzimiz` }] : []),
      ],
      aktiv: yax(aktiv), majburiyat, sof_qiymat: yax(aktiv - majburiyat),
      agent_naqd: yax(agentNaqd[0]?.summa),
    };

    /* ── Salomatlik ko'rsatkichlari ── */
    const kunlikSotuv = J.jami.sof_tushum / D.kunlar, kunlikTannarx = J.jami.tannarx / D.kunlar, kunlikXarid = kirimD.summa / D.kunlar;
    const kun = (a, b) => (b > 0 ? Math.round(a / b) : null);
    const dso = kun(debitorka, kunlikSotuv), dio = kun(ombor + mashina, kunlikTannarx), dpo = kun(kreditorka, kunlikXarid);
    const ccc = dso !== null && dio !== null ? dso + dio - (dpo || 0) : null;
    const likvid = kreditorka > 0 ? +((kassa + debitorka) / kreditorka).toFixed(2) : null;
    const otganUlush = foiz(qarz.jami.muddati_otgan, qarz.jami.qarz);
    const baho = (v, yaxshi, orta) => (v === null ? 'nomalum' : yaxshi(v) ? 'yaxshi' : orta(v) ? 'orta' : 'xavf');
    const korsatkich = [
      { k: 'yalpi_marja', nom: 'Yalpi marja', qiymat: P.yalpi_marja, birlik: '%', baho: baho(P.yalpi_marja, v => v >= 15, v => v >= 8),
        izoh: 'Har 100 so\'m savdodan tannarxdan keyin qoladigan pul', tavsiya: 'Past bo\'lsa: narxlarni, chegirmalarni va qimmat xaridlarni ko\'rib chiqing' },
      { k: 'sof_marja', nom: 'Sof foyda marjasi', qiymat: P.sof_marja, birlik: '%', baho: baho(P.sof_marja, v => v >= 5, v => v >= 0),
        izoh: 'Barcha xarajatlardan keyin har 100 so\'mdan qoladigan foyda', tavsiya: 'Manfiy bo\'lsa: xarajatlar yalpi foydadan ko\'p — eng katta xarajat toifasidan boshlang' },
      { k: 'dso', nom: 'Qarz qaytish muddati', qiymat: dso, birlik: 'kun', baho: baho(dso, v => v <= 14, v => v <= 30),
        izoh: 'Mijozlar qarzi necha kunlik savdoga teng — pul mijozda o\'rtacha shuncha kun turadi', tavsiya: 'Uzun bo\'lsa: muddati o\'tganlarni undiring, yangi qarzga limit qo\'ying' },
      { k: 'dio', nom: 'Zaxira yetadi', qiymat: dio, birlik: 'kun', baho: baho(dio, v => v >= 7 && v <= 45, v => v >= 4 && v <= 75),
        izoh: 'Hozirgi sotuv sur\'atida ombordagi tovar necha kunga yetadi', tavsiya: 'Ko\'p bo\'lsa pul tovarda muzlagan, kam bo\'lsa — tovar tugab savdo yo\'qotiladi' },
      { k: 'dpo', nom: 'Yetkazuvchiga to\'lash muddati', qiymat: dpo, birlik: 'kun', baho: dpo === null ? 'nomalum' : 'info',
        izoh: 'Yetkazuvchilarga qarzimiz necha kunlik xaridga teng', tavsiya: 'Yetkazuvchi kreditidan foydalanish pulni bo\'shatadi, lekin muddatni buzmang' },
      { k: 'ccc', nom: 'Pul aylanish sikli', qiymat: ccc, birlik: 'kun', baho: baho(ccc, v => v <= 30, v => v <= 60),
        izoh: 'Tovarga sarflangan pul savdo va qarz orqali necha kunda qaytadi (zaxira + qarz − yetkazuvchi krediti)', tavsiya: 'Qisqartirish: zaxirani kamaytiring, qarzni tezroq yig\'ing' },
      { k: 'likvid', nom: 'To\'lov qobiliyati', qiymat: likvid, birlik: 'x', baho: likvid === null ? 'yaxshi' : baho(likvid, v => v >= 1.5, v => v >= 1),
        izoh: '(Kassa + mijozlar qarzi) ÷ yetkazuvchilarga qarz. 1 dan kam — qarzlarni yopishga pul yetmaydi', tavsiya: 'Past bo\'lsa: yangi xaridni sekinlashtiring, qarz undirishni tezlashtiring' },
      { k: 'otgan', nom: 'Muddati o\'tgan qarz', qiymat: otganUlush, birlik: '%', baho: baho(otganUlush, v => v <= 5, v => v <= 15),
        izoh: 'Mijozlar qarzining qancha qismi to\'lov sanasidan o\'tgan', tavsiya: 'Yuqori bo\'lsa: shu mijozlarga qarzga sotuv to\'xtatiladi — undirish rejasini tuzing' },
    ];
    const baholar = korsatkich.filter(x => ['yaxshi', 'orta', 'xavf'].includes(x.baho));
    const ball = baholar.length ? Math.round(baholar.reduce((a, x) => a + (x.baho === 'yaxshi' ? 100 : x.baho === 'orta' ? 55 : 15), 0) / baholar.length) : null;
    const xulosa = ball === null ? 'nomalum' : ball >= 75 ? 'yaxshi' : ball >= 50 ? 'orta' : 'xavf';

    /* ── So'nggi 6 oy ── */
    const oylar = [];
    const b0 = new Date(D.to); b0.setDate(1); b0.setHours(0, 0, 0, 0);
    for (let i = 5; i >= 0; i--) {
      const f = new Date(b0); f.setMonth(f.getMonth() - i);
      const t = new Date(f); t.setMonth(t.getMonth() + 1); t.setMilliseconds(-1);
      oylar.push({ f, t: t > D.to ? D.to : t, k: `${f.getFullYear()}-${pad(f.getMonth() + 1)}` });
    }
    const oylik = await Promise.all(oylar.map(async o => {
      const [S, K] = await Promise.all([sotuvTahlil(o.f, o.t), kassaJami(o.f, o.t)]);
      const x = pnl(S.jami, K);
      return { k: o.k, tushum: x.tushum, yalpi: x.yalpi, xarajat: x.xarajat, sof_foyda: x.sof_foyda };
    }));

    res.send({
      davr: davrJavob(D),
      xulosa: { holat: xulosa, ball, xavf: korsatkich.filter(x => x.baho === 'xavf').map(x => x.nom), orta: korsatkich.filter(x => x.baho === 'orta').map(x => x.nom) },
      pnl: P, oldingi: PO,
      balans, korsatkich, oylik,
      pul: { kirim: kassaD.kirim, chiqim: kassaD.chiqim, sof: kassaD.sof, xarid: kirimD.summa },
    });
  };
}

module.exports = new TahlilController();
