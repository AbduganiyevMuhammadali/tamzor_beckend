/**
 * Yetkazuvchilar va boshlang'ich qarz — Excel ro'yxatidan kiritish.
 *
 *   node scripts/yetkazuvchilar-import.js <royxat.json> [--sana 2026-10-20] [--tozala]
 *
 * JSON: [{ ism, telefon, qarz, eski_savdo, izoh }, ...]
 *   ism       — yetkazuvchi nomi (takrorlanmas; mavjudi shu bo'yicha topiladi, telefon yangilanadi)
 *   qarz      — bizning unga qarzimiz (so'm). 0 bo'lsa faqat karta ochiladi
 *   eski_savdo — eski tizimdagi umumiy xarid summasi (faqat izohga yoziladi, hisobga kirmaydi)
 *
 * Qarz web'dagi prixod tasdig'i bilan bir xil yo'ldan kiradi: `yetkazuvchi_harakatlar`
 * ga tur='qarz' (prixod_id=null, izoh=BELGI) yozuvi + `balans` shunchaga kamayadi
 * (manfiy balans = biz qarzmiz). Shu sababli Yetkazuvchilar sahifasi, karta tarixi,
 * Hisobot → Yetkazuvchilar (Olindi / Qarzimiz), Umumiy KPI va Biznes (kreditorka)
 * uni oddiy qarz deb ko'radi; to'lov /yetkazuvchilar/:id/tolov bilan yopiladi.
 * Qayta ishga tushirilsa, BELGI'li yozuvi bor yetkazuvchiga qarz ikkinchi marta yozilmaydi.
 * `--tozala` — BELGI'li qarz yozuvlarini (balansni qaytarib) va boshqa harakati
 * bo'lmagan yetkazuvchi kartalarini o'chiradi.
 */
process.chdir(require('path').join(__dirname, '..'));
require('dotenv').config();
const fs = require('fs');
const sequelize = require('../src/db/db-sequelize');
require('../src/models/index.js');
const { YetkazuvchiModel, YetkazuvchiHarakatlarModel } = require('../src/models/yetkazuvchi.model');
const { PrixodModel } = require('../src/models/prixod.model');

const BELGI = "Boshlang'ich qarz — tizimga o'tishdagi qoldiq (Excel)";
const argv = process.argv.slice(2);
const fayl = argv.find(a => !a.startsWith('--'));
const sanaArg = argv[argv.indexOf('--sana') + 1];
const sana = argv.includes('--sana') && /^\d{4}-\d{2}-\d{2}$/.test(sanaArg || '') ? sanaArg : new Date().toISOString().slice(0, 10);
const n = (v) => { const x = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(x) ? 0 : x; };
const fmt = (v) => Math.round(v).toLocaleString('ru-RU');
const royxat = () => JSON.parse(fs.readFileSync(fayl, 'utf8'));

async function tozala() {
  for (const q of royxat()) {
    const y = await YetkazuvchiModel.findOne({ where: { ism: String(q.ism).trim() } });
    if (!y) continue;
    const t = await sequelize.transaction();
    try {
      const boshlangich = await YetkazuvchiHarakatlarModel.findAll({ where: { yetkazuvchi_id: y.id, tur: 'qarz', prixod_id: null, izoh: BELGI }, transaction: t });
      for (const h of boshlangich) { await y.increment('balans', { by: Number(h.summa), transaction: t }); await h.destroy({ transaction: t }); }
      const boshqa = await YetkazuvchiHarakatlarModel.count({ where: { yetkazuvchi_id: y.id }, transaction: t })
                   + await PrixodModel.count({ where: { yetkazuvchi_id: y.id }, transaction: t });
      if (boshqa) console.log(`  ${y.ism}: boshqa harakati bor — karta qoldirildi (boshlang'ich qarz ${boshlangich.length ? 'o\'chirildi' : 'yo\'q edi'})`);
      else { await y.destroy({ transaction: t }); console.log(`  ${y.ism}: o'chirildi`); }
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
  }
}

async function kiritish() {
  const list = royxat();
  if (!Array.isArray(list) || !list.length) throw new Error("Ro'yxat bo'sh");
  const takror = list.map(q => String(q.ism).trim()).filter((s, i, a) => a.indexOf(s) !== i);
  if (takror.length) throw new Error(`Ism takrorlangan: ${takror.join(', ')}`);

  let yangi = 0, qarzYozildi = 0, qarzJami = 0;
  for (const q of list) {
    const ism = String(q.ism).trim();
    const izohQism = [q.izoh, q.eski_savdo ? `Eski tizimda umumiy xarid: ${fmt(n(q.eski_savdo))} so'm` : ''].filter(Boolean).join(' · ');
    const t = await sequelize.transaction();
    try {
      let y = await YetkazuvchiModel.findOne({ where: { ism }, transaction: t });
      if (y) await y.update({ telefon: q.telefon ? String(q.telefon).trim() : y.telefon, izoh: y.izoh || izohQism || null }, { transaction: t });
      else { y = await YetkazuvchiModel.create({ ism, telefon: q.telefon ? String(q.telefon).trim() : null, izoh: izohQism || null, balans: 0 }, { transaction: t }); yangi++; }

      const qarz = n(q.qarz);
      if (qarz > 0) {
        const bor = await YetkazuvchiHarakatlarModel.findOne({ where: { yetkazuvchi_id: y.id, tur: 'qarz', prixod_id: null, izoh: BELGI }, transaction: t });
        if (bor) console.log(`  ${ism}: boshlang'ich qarz allaqachon yozilgan (${fmt(Number(bor.summa))}) — o'tkazib yuborildi`);
        else {
          await y.decrement('balans', { by: qarz, transaction: t });
          await YetkazuvchiHarakatlarModel.create({
            yetkazuvchi_id: y.id, prixod_id: null, tur: 'qarz', summa: qarz, tolov_turi: null, izoh: BELGI, sana: new Date(`${sana}T08:00:00`),
          }, { transaction: t });
          qarzYozildi++; qarzJami += qarz;
          console.log(`  ${ism.padEnd(32)} qarz ${fmt(qarz).padStart(14)} so'm`);
        }
      }
      await t.commit();
    } catch (e) { await t.rollback(); throw e; }
  }
  console.log(`Yetkazuvchi: ${list.length} ta (${yangi} yangi, ${list.length - yangi} mavjud). Boshlang'ich qarz: ${qarzYozildi} ta, jami ${fmt(qarzJami)} so'm (${sana})`);
}

(async () => {
  if (!fayl) throw new Error("JSON fayl ko'rsating");
  if (argv.includes('--tozala')) await tozala(); else await kiritish();
  await sequelize.close();
})().catch(e => { console.error('XATO:', e.message); process.exit(1); });
