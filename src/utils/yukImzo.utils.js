'use strict';
/* YUK DALOLATNOMASI VA AGENT IMZOSI (2026-11-27)

   Oqim: omborchi yuklashni tasdiqlaydi (tovar agent omboriga o'tadi) → sozlama 'yuk_imzo_majburiy' = '1'
   bo'lsa hujjat imzo_holat = 'kutilmoqda'. Agent ilovada dalolatnomani ko'radi:
     • soni to'g'ri — ekranga barmoq bilan imzo chizadi (rasm chekYuklash orqali) → 'imzolangan';
     • mos emas — sabab bilan rad etadi → 'rad_etildi'; omborchi web'da sonlarni tuzatadi
       (farq tovar sifatida asosiy ombor ↔ agent ombori o'rtasida ko'chadi) → yana 'kutilmoqda'.
   Imzolanmagan (kutilmoqda | rad_etildi) yuklash bor ekan agent sota olmaydi (mobil saveSell va web agent nomidan sotuv).
   Sozlama o'chiq bo'lsa yangi yuklashlar imzo talab qilmaydi (imzo_holat NULL) va blok yo'q. Qaytarishda (qabul) akt yo'q. */
const sequelize = require('../db/db-sequelize');
const HttpException = require('./HttpException.utils');
const SozlamaModel = require('../models/sozlama.model');
const { AvtolavkaHujjatModel, AvtolavkaQatorModel } = require('../models/avtolavka.model');
const TovarRegisterModel = require('../models/tovar_register.model');
const { qulflabOl, tovarlarniQulfla } = require('./qulf.utils');

const KALIT = 'yuk_imzo_majburiy';
const n = (v) => parseFloat(v) || 0;
const r3 = (v) => Math.round(n(v) * 1000) / 1000;
const EPS = 0.001;

async function imzoMajburiy(t) {
  const s = await SozlamaModel.findByPk(KALIT, t ? { transaction: t } : {});
  return !!s && String(s.qiymat) === '1';
}

async function imzoMajburiyYoz(qiymat) {
  await SozlamaModel.upsert({ kalit: KALIT, qiymat: qiymat ? '1' : '0', izoh: "Agent yuk dalolatnomasini imzolamaguncha sota olmaydi" });
  return { yuk_imzo_majburiy: !!qiymat };
}

/** Agentning imzolanmagan yuklashlari (kutilmoqda | rad_etildi), eng eskisi birinchi */
function imzolanmaganlar(agentId, t, { include = false } = {}) {
  return AvtolavkaHujjatModel.findAll({
    where: { agent_id: agentId, tur: 'yuklash', holat: 'tasdiqlangan', imzo_holat: ['kutilmoqda', 'rad_etildi'] },
    order: [['id', 'ASC']],
    ...(include ? { include: [{ model: AvtolavkaQatorModel, as: 'qatorlar' }] } : {}),
    ...(t ? { transaction: t } : {}),
  });
}

/** Sotuvdan oldin: sozlama yoqilgan va imzolanmagan yuklash bor bo'lsa — 400 (diller va sklad — tekshirilmaydi) */
async function sotuvBlokTekshir(agent, t) {
  if (!agent || agent.diller) return;
  const bor = await AvtolavkaHujjatModel.findOne({
    where: { agent_id: agent.id, tur: 'yuklash', holat: 'tasdiqlangan', imzo_holat: ['kutilmoqda', 'rad_etildi'] },
    attributes: ['id', 'raqam', 'imzo_holat'], order: [['id', 'ASC']], ...(t ? { transaction: t } : {}),
  });
  if (!bor) return;
  throw new HttpException(400, bor.imzo_holat === 'rad_etildi'
    ? `${bor.raqam || 'Yuklash'} rad etilgan — omborchi tuzatib, siz imzolamaguncha sotib bo'lmaydi`
    : `Avval ${bor.raqam || 'yuklash'} dalolatnomasini imzolang — imzolamaguncha sotib bo'lmaydi`);
}

/** Tasdiqlash paytida (yuklashniTasdiqla ichida) — sozlama yoqilgan bo'lsa imzo kutiladi */
async function tasdiqdaBelgila(hujjat, t) {
  if (await imzoMajburiy(t)) await hujjat.update({ imzo_holat: 'kutilmoqda' }, { transaction: t });
}

async function hujjatQulfla(agent, docId, t) {
  const id = Number(docId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpException(400, "docId noto'g'ri");
  const h = await qulflabOl(AvtolavkaHujjatModel, id, t);
  if (!h || h.tur !== 'yuklash' || Number(h.agent_id) !== Number(agent.id)) throw new HttpException(404, 'Yuklash hujjati topilmadi');
  if (h.holat !== 'tasdiqlangan') throw new HttpException(400, 'Hujjat hali omborchi tomonidan tasdiqlanmagan');
  return h;
}

/** Agent imzosi. imzo — chekRasmOl dan o'tgan rasm yo'li. Takror (shu mobilId yoki allaqachon imzolangan) — jim OK */
async function imzola(agent, { docId, imzo, mobilId }) {
  return sequelize.transaction(async (t) => {
    const h = await hujjatQulfla(agent, docId, t);
    if (h.imzo_holat === 'imzolangan') return { hujjat: h, takror: true };
    if (h.imzo_holat === 'rad_etildi') throw new HttpException(400, 'Siz bu yuklashni rad etgansiz — omborchi tuzatishini kuting');
    if (!imzo) throw new HttpException(400, 'Imzo majburiy');
    await h.update({
      imzo_holat: 'imzolangan', agent_imzo: imzo, imzo_vaqt: new Date(), imzo_mobil_id: mobilId || null,
      agent_qabul_vaqt: h.agent_qabul_vaqt || new Date(), agent_rad_sababi: null,
    }, { transaction: t });
    return { hujjat: h, takror: false };
  });
}

/** Agent rad etadi (soni mos emas) */
async function radEt(agent, { docId, sabab }) {
  const s = String(sabab || '').trim();
  if (s.length < 3) throw new HttpException(400, 'Rad etish sababini yozing (kamida 3 ta belgi)');
  return sequelize.transaction(async (t) => {
    const h = await hujjatQulfla(agent, docId, t);
    if (h.imzo_holat === 'imzolangan') throw new HttpException(400, 'Imzolangan dalolatnomani rad etib bo\'lmaydi');
    if (h.imzo_holat === 'rad_etildi') return { hujjat: h, takror: true };
    if (h.imzo_holat !== 'kutilmoqda') throw new HttpException(400, 'Bu yuklash imzo talab qilmaydi');
    await h.update({ imzo_holat: 'rad_etildi', agent_rad_sababi: s.slice(0, 255) }, { transaction: t });
    return { hujjat: h, takror: false };
  });
}

/** Omborchi tuzatadi (faqat rad etilgan yoki imzo kutayotgan): qatorlar [{tovar_id, dona}] — yangi to'liq ro'yxat.
    Farq: ko'paysa asosiy → agent, kamaysa agent → asosiy (agent omborida yetarli bo'lishi shart). */
async function tuzat(hujjatId, qatorlarRaw, user) {
  const { ASOSIY_OMBOR } = require('./ombor.utils');
  const { mavjudQoldiq } = require('./zaxira.utils');
  const { narxMap, omborQoldiq, regYozuv } = require('./avtolavka.utils');
  const kerak = new Map();
  for (const q of Array.isArray(qatorlarRaw) ? qatorlarRaw : []) {
    const id = Number(q && q.tovar_id), dona = r3(q && q.dona);
    if (!Number.isInteger(id) || id <= 0 || !(dona >= 0)) throw new HttpException(400, "Qator noto'g'ri (tovar_id, dona ≥ 0)");
    kerak.set(id, r3((kerak.get(id) || 0) + dona));
  }
  if (!kerak.size) throw new HttpException(400, "qatorlar bo'sh");
  return sequelize.transaction(async (t) => {
    const h = await qulflabOl(AvtolavkaHujjatModel, hujjatId, t);
    if (!h || h.tur !== 'yuklash') throw new HttpException(404, 'Yuklash hujjati topilmadi');
    if (h.holat !== 'tasdiqlangan') throw new HttpException(400, 'Faqat tasdiqlangan yuklash tuzatiladi');
    if (!['rad_etildi', 'kutilmoqda'].includes(h.imzo_holat)) throw new HttpException(400, h.imzo_holat === 'imzolangan' ? 'Agent imzolagan — tuzatib bo\'lmaydi' : 'Bu yuklash imzo talab qilmaydi');
    const eski = await AvtolavkaQatorModel.findAll({ where: { hujjat_id: h.id }, transaction: t });
    const eskiBy = new Map();
    for (const q of eski) eskiBy.set(q.tovar_id, (eskiBy.get(q.tovar_id) || []).concat(q));
    const barchasi = [...new Set([...kerak.keys(), ...eskiBy.keys()])];
    for (const id of kerak.keys()) if (!eskiBy.has(id)) throw new HttpException(400, `Tovar #${id} bu yuklashda yo'q — yangi tovar uchun alohida yuklash qiling`);
    await tovarlarniQulfla(barchasi, t);
    const asosiy = await mavjudQoldiq({ tovarIds: barchasi, ombor: ASOSIY_OMBOR, transaction: t });
    const agentQ = await omborQoldiq(h.ombor, t, { qulfla: true });
    const narx = await narxMap(barchasi);
    const sana = new Date(), yozuvlar = [];
    let ozgardi = false;
    for (const id of barchasi) {
      const qatorlar = eskiBy.get(id);
      const eskiDona = r3(qatorlar.reduce((s, q) => s + n(q.dona), 0));
      const yangi = kerak.has(id) ? kerak.get(id) : eskiDona;
      const farq = r3(yangi - eskiDona);
      if (Math.abs(farq) < EPS) continue;
      ozgardi = true;
      const q0 = qatorlar[0];
      if (farq > 0) {
        const bor = (asosiy.get(id) || { mavjud: 0 }).mavjud;
        if (farq > bor + EPS) throw new HttpException(400, `"${q0.tovar_nomi}": asosiy omborda yetarli emas (kerak ${farq}, mavjud ${bor})`);
      } else {
        const bor = n(agentQ[id] && agentQ[id].qoldiq);
        if (-farq > bor + EPS) throw new HttpException(400, `"${q0.tovar_nomi}": agent omborida ${bor} qolgan — ${-farq} kamaytirib bo'lmaydi`);
      }
      const nx = narx[id] || { kirim_narx: q0.kirim_narx, optom_narx: 0, chakana_narx: q0.narx };
      const qq = { tovar_id: id, tovar_nomi: q0.tovar_nomi, turkum: q0.turkum, blok: 0, narx: q0.narx };
      const [dan, ga] = farq > 0 ? [ASOSIY_OMBOR, h.ombor] : [h.ombor, ASOSIY_OMBOR];
      yozuvlar.push(regYozuv({ q: qq, ombor: dan, tur: 'chiqim', manba_tur: 'yuklash', manba_id: h.id, dona: Math.abs(farq), narx: nx, sana }));
      yozuvlar.push(regYozuv({ q: qq, ombor: ga, tur: 'kirim', manba_tur: 'yuklash', manba_id: h.id, dona: Math.abs(farq), narx: nx, sana }));
      // Qatorlar: birinchisiga yangi jami, qolganlari 0 (bir tovar bir nechta qatorda bo'lsa)
      for (const [i, q] of qatorlar.entries()) {
        const d = i === 0 ? yangi : 0;
        await q.update({ dona: d, blok: i === 0 ? q.blok : 0, summa: Math.round(d * n(q.narx) * 100) / 100 }, { transaction: t });
      }
    }
    if (!ozgardi && h.imzo_holat === 'kutilmoqda') throw new HttpException(400, "Hech narsa o'zgarmadi");
    if (yozuvlar.length) await TovarRegisterModel.bulkCreate(yozuvlar, { transaction: t });
    const yangiQ = await AvtolavkaQatorModel.findAll({ where: { hujjat_id: h.id }, transaction: t });
    const nomi = user ? (user.fullname || user.username || '') : '';
    await h.update({
      jami_dona: r3(yangiQ.reduce((s, q) => s + n(q.dona), 0)),
      jami_summa: Math.round(yangiQ.reduce((s, q) => s + n(q.summa), 0) * 100) / 100,
      imzo_holat: 'kutilmoqda',
      izoh: `${h.izoh ? h.izoh + ' | ' : ''}Tuzatildi${nomi ? ' (' + nomi + ')' : ''}${h.agent_rad_sababi ? ': agent — ' + h.agent_rad_sababi : ''}`.slice(0, 2000),
    }, { transaction: t });
    return h;
  });
}

/** Dalolatnoma (web ko'rish / chop etish, mobil) */
function dalolatnoma(h, { firma = null } = {}) {
  const qatorlar = (h.qatorlar || []).filter(q => n(q.dona) > EPS).map((q, i) => ({
    tartib: i + 1, tovar_id: q.tovar_id, tovar_nomi: q.tovar_nomi, turkum: q.turkum || null,
    dona: r3(q.dona), blok: r3(q.blok), narx: n(q.narx), summa: n(q.summa),
  }));
  return {
    id: h.id, raqam: h.raqam || String(h.id), sana: h.sana, ombor: h.ombor,
    agent_id: h.agent_id, agent_nomi: h.agent_nomi,
    tasdiqlagan_sana: h.tasdiqlagan_sana,
    imzo_holat: h.imzo_holat || null,
    agent_imzo: h.agent_imzo || null, imzo_vaqt: h.imzo_vaqt || null,
    agent_rad_sababi: h.agent_rad_sababi || null,
    izoh: h.izoh || null,
    jami_dona: r3(h.jami_dona), jami_summa: n(h.jami_summa),
    qatorlar, firma,
  };
}

module.exports = { imzoMajburiy, imzoMajburiyYoz, imzolanmaganlar, sotuvBlokTekshir, tasdiqdaBelgila, imzola, radEt, tuzat, dalolatnoma, KALIT };
