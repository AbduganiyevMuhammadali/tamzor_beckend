/**
 * Boshlang'ich qoldiq — Excel ro'yxatidan tovarlar va ombor qoldig'ini kiritish.
 *
 *   node scripts/boshlangich-qoldiq.js <royxat.json> [--sana 2026-10-20] [--narxsiz] [--tozala]
 *
 * JSON: [{ sku, nomi, olchov, turkum, qoldiq, tannarx, chakana, optom }, ...]
 *   sku     — tovar shtrix kodi (takrorlanmas; mavjud tovar shu bo'yicha topiladi, nomi yangilanadi)
 *   olchov  — 'kg' | 'dona'
 *   qoldiq  — ombordagi miqdor; 0 bo'lsa faqat tovar kartasi ochiladi
 *   tannarx — 1 birlik kirim narxi (so'm). Hisobotlardagi tovar qiymati va foyda shundan
 *   chakana / optom — sotuv narxlari (ixtiyoriy; narx ro'yxatida keyin ham qo'yish mumkin)
 *
 * Qoldiq web'dagi prixod bilan bir xil yo'ldan kiradi (prixod.controller create → tasdiqla):
 * bitta "BOSHLANGICH" hujjat, yetkazuvchisiz (qarz hosil bo'lmaydi), asosiy omborga
 * `manba_tur='prixod'` kirimi — shuning uchun Qoldiqlar, Ombor, Kirim hisobotlari va
 * tannarx (tahlil.utils tannarxXaritasi) hammasi uni oddiy kirim deb ko'radi.
 * Qayta ishga tushirilsa, mavjud BOSHLANGICH hujjatni o'chirmaydi — xato bilan to'xtaydi.
 * `--narxsiz` — tannarxi yo'q qoldiqni ham kiritadi (ombor qiymati 0 chiqadi; keyin Ombor →
 *   Prixod'da BOSHLANGICH hujjatni bekor qilib, narxlarni yozib qayta tasdiqlash mumkin).
 * `--tozala` — shu skript yaratgan hujjat va tovarlarni (boshqa harakati bo'lmasa) o'chiradi.
 */
process.chdir(require('path').join(__dirname, '..'));
require('dotenv').config();
const fs = require('fs');
const sequelize = require('../src/db/db-sequelize');
require('../src/models/index.js');
const TovarModel = require('../src/models/tovar.model');
const { PrixodModel, PrixodQatorModel } = require('../src/models/prixod.model');
const TovarRegisterModel = require('../src/models/tovar_register.model');
const prixodController = require('../src/controllers/web/prixod.controller');
const { ASOSIY_OMBOR } = require('../src/utils/ombor.utils');

const HUJJAT = 'BOSHLANGICH';
const argv = process.argv.slice(2);
const fayl = argv.find(a => !a.startsWith('--'));
const sanaArg = argv[argv.indexOf('--sana') + 1];
const sana = argv.includes('--sana') && /^\d{4}-\d{2}-\d{2}$/.test(sanaArg || '') ? sanaArg : new Date().toISOString().slice(0, 10);
const n = (v) => { const x = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return isNaN(x) ? 0 : x; };

// Controller'ni HTTP'siz chaqirish uchun soxta req/res
const fakeRes = () => { const r = { body: null, status() { return r; }, send(b) { r.body = b; return r; } }; return r; };
const fakeReq = (extra) => ({ body: {}, params: {}, query: {}, mf: (s) => s, currentUser: { id: 1 }, ...extra });

async function tozala() {
  const hujjatlar = await PrixodModel.findAll({ where: { hujjat_raqam: HUJJAT } });
  for (const p of hujjatlar) {
    const r = fakeRes();
    if (p.holat === 'tasdiqlangan') await prixodController.bekorqilish(fakeReq({ params: { id: p.id } }), r);
    await PrixodQatorModel.destroy({ where: { prixod_id: p.id } });
    await TovarRegisterModel.destroy({ where: { manba_tur: 'prixod', manba_id: p.id } });
    await p.destroy({ force: true });
    console.log(`Hujjat #${p.id} (${HUJJAT}) o'chirildi`);
  }
  // Skript ochgan tovar kartalari — faqat boshqa harakati bo'lmaganlari
  const royxat = JSON.parse(fs.readFileSync(fayl, 'utf8'));
  for (const q of royxat) {
    const t = await TovarModel.findOne({ where: { shtrix_kod: String(q.sku) } });
    if (!t) continue;
    const harakat = await TovarRegisterModel.count({ where: { tovar_id: t.id } });
    if (harakat) { console.log(`  ${t.nomi}: ombor harakati bor — qoldirildi`); continue; }
    await t.destroy({ force: true });
  }
}

async function kiritish() {
  const royxat = JSON.parse(fs.readFileSync(fayl, 'utf8'));
  if (!Array.isArray(royxat) || !royxat.length) throw new Error("Ro'yxat bo'sh");
  const takror = royxat.map(q => String(q.sku)).filter((s, i, a) => a.indexOf(s) !== i);
  if (takror.length) throw new Error(`SKU takrorlangan: ${takror.join(', ')}`);
  if (await PrixodModel.findOne({ where: { hujjat_raqam: HUJJAT } }))
    throw new Error(`"${HUJJAT}" hujjati allaqachon bor — avval --tozala bilan o'chiring`);
  const narxsiz = royxat.filter(q => n(q.qoldiq) > 0 && !(n(q.tannarx) > 0));
  if (narxsiz.length && !argv.includes('--narxsiz')) throw new Error(`Qoldig'i bor, tannarxi yo'q: ${narxsiz.map(q => q.nomi).join(', ')} (--narxsiz bilan baribir kiritish mumkin)`);
  if (narxsiz.length) console.log(`DIQQAT: ${narxsiz.length} ta tovar tannarxsiz kiritilmoqda — ombor qiymati va foyda hisobotlari to'liq bo'lmaydi`);

  // 1. Tovar kartalari (SKU = shtrix kod bo'yicha; bor bo'lsa yangilanadi)
  const tovarlar = {};
  let yangi = 0;
  for (const q of royxat) {
    const sku = String(q.sku).trim();
    const maydonlar = {
      nomi: String(q.nomi).trim(), turkum: q.turkum ? String(q.turkum).trim() : null,
      olchov_birligi: (q.olchov || 'kg').toLowerCase().startsWith('k') ? 'kg' : 'dona',
      blokdagi_soni: 1, qutidagi_bloklar: 1, faol: true, turi: 'tovar',
    };
    let t = await TovarModel.findOne({ where: { shtrix_kod: sku }, paranoid: false });
    if (t) { await t.restore(); await t.update(maydonlar); }
    else { t = await TovarModel.create({ ...maydonlar, shtrix_kod: sku }); yangi++; }
    tovarlar[sku] = t;
  }

  // 2. Bitta prixod hujjati — faqat qoldig'i borlar
  const qatorlar = royxat.filter(q => n(q.qoldiq) > 0).map(q => {
    const t = tovarlar[String(q.sku).trim()];
    const dona = n(q.qoldiq), narx = n(q.tannarx);
    return {
      tovar_id: t.id, tovar_nomi: t.nomi, tovar_kodi: t.shtrix_kod, shtrix_kod: t.shtrix_kod, turkum: t.turkum,
      narx, chakana_narx: n(q.chakana), optom_narx: n(q.optom), sotuv_narx: n(q.chakana),
      donada: dona, bloklarda: 0, qutilarda: 0, hajm: 0, summa: +(dona * narx).toFixed(2),
    };
  });
  let prixod = null;
  if (qatorlar.length) {
    const r1 = fakeRes();
    await prixodController.create(fakeReq({ body: {
      hujjat_raqam: HUJJAT, sana: `${sana}T08:00:00`, ombor: ASOSIY_OMBOR,
      izoh: "Boshlang'ich qoldiq — tizimga o'tishdagi ombor sanog'i (Excel)", qatorlar,
    } }), r1);
    prixod = r1.body;
    const r2 = fakeRes();
    await prixodController.tasdiqla(fakeReq({ params: { id: prixod.id } }), r2);
  }

  console.log(`Tovar: ${royxat.length} ta (${yangi} yangi, ${royxat.length - yangi} yangilandi)`);
  if (prixod) {
    const jami = qatorlar.reduce((s, q) => s + q.summa, 0);
    console.log(`Prixod #${prixod.id} ${HUJJAT} (${sana}) tasdiqlandi: ${qatorlar.length} qator, ${qatorlar.reduce((s, q) => s + q.donada, 0).toFixed(2)} birlik, ${jami.toLocaleString('ru-RU')} so'm`);
    for (const q of qatorlar) console.log(`  ${q.tovar_nomi.padEnd(22)} ${String(q.donada).padStart(9)} × ${q.narx.toLocaleString('ru-RU').padStart(9)} = ${q.summa.toLocaleString('ru-RU')}`);
  } else console.log('Qoldiq yo\'q — prixod yaratilmadi');
}

(async () => {
  if (!fayl) throw new Error('JSON fayl ko\'rsating');
  if (argv.includes('--tozala')) await tozala(); else await kiritish();
  await sequelize.close();
})().catch(e => { console.error('XATO:', e.message); process.exit(1); });
