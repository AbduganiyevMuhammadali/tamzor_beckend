/**
 * YETKAZILGAN SOTUVNI BEKOR QILISH (faqat Admin / Programmer).
 *
 * Qachon: xodim bitta mijozga bir sotuvni ikki marta yozib yuborgan (takror chek), xato mijoz
 * yoki xato summa — tovar aslida bir marta berilgan. Oddiy "qaytarish" bu yerga to'g'ri kelmaydi:
 * qaytarish mijoz tovarni qaytargan holat, bu esa umuman bo'lmagan sotuv.
 *
 * Nima qilinadi (bitta tranzaksiya, hammasi yoki hech narsa):
 *   1. tovar_register'dagi shu sotuvning chiqim qatorlari O'CHIRILADI — tovar o'z omboriga
 *      (Won Sell: "Agent: <ism>", sklad/distributsiya: asosiy ombor) qaytadi. Teskari (kirim) qator
 *      yozilmaydi: kun paneli (kunHisobla) "sotildi"ni register'dan sana bo'yicha sanaydi — qator
 *      qolsa o'sha kunning sotuvi va farqi noto'g'ri qolaverardi. Hujjatning o'zi (ariza + qatorlari)
 *      `holat='bekor'` bilan saqlanadi — tarix shu yerda.
 *   2. kassa'dagi shu sotuvning naqd kirimi (kategoriya='sotuv', manba_id=ariza) o'chiriladi.
 *   3. Mijoz balansiga qarz qismi qaytariladi: qarz = jami − kassadagi naqd. Naqd aynan kassa
 *      qatoridan olinadi (ariza.tolangan_summa emas): dostavchik "0 olindi" deb yetkazgan naqt
 *      buyurtmada tolangan_summa=0 bo'lib, formula bilan farqlab bo'lmaydi.
 *   4. agent_register'dagi savdo/bonus yozuvi o'chiriladi (plan-fakt va bonus to'g'rilanadi).
 *   5. Sotuvga bog'langan tashrif (check-in) natijasi 'ochiq'ga qaytadi.
 *   6. ariza: holat='bekor', bekor_sababi = sabab + kim + qachon.
 * Hisobotlar sotuvni `holat='yetkazildi'` bilan sanaydi — bekor bo'lgan chek hamma joydan o'zi chiqib ketadi.
 *
 * Ogohlantirishlar (bajariladi, lekin admin bilishi kerak):
 *   - shu kun inkassatsiyasi allaqachon qilingan — topshirilgan summa endi yig'ilgandan ko'p bo'lishi mumkin;
 *   - kun yopilgan (qabul tasdiqlangan) — tovar mashina omboriga qaytdi, qabul hujjati bilan skladga o'tkazish kerak;
 *   - mijoz haqdor bo'lib qoldi (takror chekni to'lab yuborgan).
 */
const sequelize = require('../db/db-sequelize');
const { Op } = require('sequelize');
const { ArizaModel } = require('../models/ariza.model');
const { MijozModel } = require('../models/mijoz.model');
const KassaModel = require('../models/kassa.model');
const TovarRegisterModel = require('../models/tovar_register.model');
const AgentRegisterModel = require('../models/agent_register.model');
const { TashrifModel } = require('../models/marshrut.model');
const { InkassatsiyaModel } = require('../models/inkassatsiya.model');
const { AvtolavkaHujjatModel } = require('../models/avtolavka.model');
const HttpException = require('./HttpException.utils');
const { qulflabOl } = require('./qulf.utils');

const SOTUV_KASSA_MANBALAR = ['ariza', 'avtolavka', 'sklad', 'dostavchik'];
const ADMIN_ROLLAR = ['Admin', 'Programmer'];
const n = (v) => parseFloat(v) || 0;

function adminMi(user) { return !!user && ADMIN_ROLLAR.includes(user.role); }
function adminTekshir(user) {
  if (!adminMi(user)) throw new HttpException(403, 'Yetkazilgan sotuvni faqat Admin bekor qila oladi');
}

const kunKey = (d) => {
  const x = new Date(d);
  const p = (v) => String(v).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};

/**
 * @param {ArizaModel} ariza  — holat='yetkazildi', turi='sotish'
 * @param {{ sabab: string, user: object, transaction?: Transaction }} opts
 * @returns {{ ariza, tovar: [{ombor, dona, qator_soni}], naqd, qarz, bonus, mijoz_balans, ogohlantirishlar: string[] }}
 */
async function yetkazilganSotuvniBekorQil(ariza, { sabab, user, transaction = null } = {}) {
  adminTekshir(user);
  if (!ariza) throw new HttpException(404, 'Ariza topilmadi');
  if (ariza.turi !== 'sotish') throw new HttpException(400, 'Faqat sotuv hujjati bekor qilinadi');
  // 2026-11-29: dillerga berish — diller hujjati (DL-…) bilan bog'liq, bekor qilinmaydi (tuzatish — dillerdan qaytarish)
  if (ariza.kanal === 'diller') throw new HttpException(400, "Dillerga berish hujjati bekor qilinmaydi — tuzatish uchun Dillerlar → Qaytarish ishlating");
  if (ariza.holat !== 'yetkazildi') throw new HttpException(400, `Hujjat "${ariza.holat}" holatida — bu amal faqat yetkazilgan sotuv uchun`);
  const sababMatn = String(sabab || '').trim();
  if (sababMatn.length < 3) throw new HttpException(400, 'Bekor qilish sababini yozing (kamida 3 ta belgi)');

  const ish = async (t) => {
    /* Hujjat tranzaksiya ichida QULFLAB qayta o'qiladi: chaqiruvchi uni tranzaksiyadan
       tashqarida yuklagan bo'lishi mumkin. Ikki parallel "bekor" so'rovidan ikkinchisi
       birinchisi commit bo'lguncha kutadi, so'ng holat='bekor'ni ko'rib rad etiladi —
       aks holda kassa qatorlari allaqachon o'chgani uchun qarz=jami deb mijozga ikkinchi
       marta pul qaytarilardi. */
    const tashqi = ariza;
    ariza = await qulflabOl(ArizaModel, tashqi.id, t);
    if (!ariza) throw new HttpException(404, 'Ariza topilmadi');
    if (ariza.turi !== 'sotish') throw new HttpException(400, 'Faqat sotuv hujjati bekor qilinadi');
  // 2026-11-29: dillerga berish — diller hujjati (DL-…) bilan bog'liq, bekor qilinmaydi (tuzatish — dillerdan qaytarish)
  if (ariza.kanal === 'diller') throw new HttpException(400, "Dillerga berish hujjati bekor qilinmaydi — tuzatish uchun Dillerlar → Qaytarish ishlating");
    if (ariza.holat !== 'yetkazildi') throw new HttpException(400, `Hujjat "${ariza.holat}" holatida — bu amal faqat yetkazilgan sotuv uchun`);
    // Sotuvga bog'langan qaytarish (mobil savdoQaytarish) bo'lsa — bekor qilish tovar va pulni ikki marta
    // qaytarib yuboradi (qaytarma kirimi va naqd chiqimi alohida yozilgan). Rad etiladi.
    const { SavdoQaytarishModel } = require('../models/savdoQaytarish.model');
    const qaytSoni = await SavdoQaytarishModel.count({ where: { ariza_id: ariza.id }, transaction: t });
    if (qaytSoni) throw new HttpException(400, `Bu sotuvga ${qaytSoni} ta qaytarish qilingan — uni bekor qilib bo'lmaydi`);

    const jami = n(ariza.jami_summa);
    const kim = user.fullname || user.username || `user#${user.id}`;

    /* 1. Ombor: chiqim qatorlarini o'chiramiz — tovar o'z omboriga qaytadi */
    const chiqimlar = await TovarRegisterModel.findAll({
      where: { manba_tur: 'sotuv', manba_id: ariza.id, tur: 'chiqim' }, transaction: t,
    });
    const omborlar = {};
    for (const c of chiqimlar) {
      const o = omborlar[c.ombor] || (omborlar[c.ombor] = { ombor: c.ombor, dona: 0, qator_soni: 0 });
      o.dona += Math.abs(n(c.donada)); o.qator_soni += 1;
    }
    if (chiqimlar.length) {
      await TovarRegisterModel.destroy({ where: { id: { [Op.in]: chiqimlar.map(c => c.id) } }, transaction: t });
    }

    /* 2. Kassa: shu sotuvning naqd kirimi */
    const kassalar = await KassaModel.findAll({
      where: { kategoriya: 'sotuv', manba_id: ariza.id, manba_tur: { [Op.in]: SOTUV_KASSA_MANBALAR }, tur: 'kirim' },
      transaction: t,
    });
    const naqd = kassalar.reduce((s, k) => s + n(k.summa), 0);
    if (kassalar.length) {
      await KassaModel.destroy({ where: { id: { [Op.in]: kassalar.map(k => k.id) } }, transaction: t });
    }

    /* 3. Mijoz qarzi: yetkazilganda balansdan ayrilgan qism qaytadi */
    const qarz = +Math.max(0, jami - naqd).toFixed(2);
    let mijozBalans = null;
    if (ariza.mijoz_id) {
      if (qarz > 0.005) await MijozModel.increment('balans', { by: qarz, where: { id: ariza.mijoz_id }, transaction: t });
      const m = await MijozModel.findByPk(ariza.mijoz_id, { attributes: ['balans'], transaction: t });
      mijozBalans = m ? n(m.balans) : null;
    }

    /* 4. Agent plan-fakt / bonus */
    let bonus = 0;
    if (ariza.agent_id) {
      const regs = await AgentRegisterModel.findAll({ where: { ariza_id: ariza.id, tur: 'savdo' }, transaction: t });
      bonus = regs.reduce((s, r) => s + n(r.bonus_summa), 0);
      if (regs.length) await AgentRegisterModel.destroy({ where: { id: { [Op.in]: regs.map(r => r.id) } }, transaction: t });
    }

    /* 4b. Kutilayotgan plastik to'lovi — avtomatik rad (tasdiqlangan plastik kirimi o'chirilmaydi:
           pul haqiqatan kartaga tushgan, u mijoz haqiga aylanadi — yuqoridagi qarz hisobida naqd emas) */
    const { sotuvPlastikRad } = require('./agentPul.utils');
    await sotuvPlastikRad(ariza.id, user, t);

    /* 5. Tashrif natijasi */
    await TashrifModel.update({ natija: 'ochiq', ariza_id: null }, { where: { ariza_id: ariza.id }, transaction: t });

    /* 6. Hujjat */
    const vaqt = new Date();
    const p = (v) => String(v).padStart(2, '0');
    const muhr = `${sababMatn} · bekor qildi: ${kim}, ${p(vaqt.getDate())}.${p(vaqt.getMonth() + 1)}.${vaqt.getFullYear()} ${p(vaqt.getHours())}:${p(vaqt.getMinutes())}`;
    await ariza.update({ holat: 'bekor', bekor_sababi: muhr.slice(0, 255) }, { transaction: t });
    // Chaqiruvchining (tranzaksiyadan tashqarida yuklangan) nusxasi ham yangi holatni ko'rsin
    if (tashqi !== ariza && typeof tashqi.setDataValue === 'function') {
      tashqi.setDataValue('holat', ariza.holat);
      tashqi.setDataValue('bekor_sababi', ariza.bekor_sababi);
    }
    // Mijoz reytingi: shu sotuv uchun berilgan ball qaytadi
    await require('./reyting.utils').reytingQaytar({ manba_tur: 'ariza', manba_id: ariza.id }, t);

    /* Ogohlantirishlar */
    const ogohlantirishlar = [];
    const sana = ariza.yetkazilgan_sana ? kunKey(ariza.yetkazilgan_sana) : null;
    if (ariza.agent_id && sana) {
      const ink = await InkassatsiyaModel.findOne({ where: { agent_id: ariza.agent_id, sana }, transaction: t });
      if (ink && n(ink.topshirilgan_summa) > 0 && naqd > 0) {
        ogohlantirishlar.push(`${sana} kuni inkassatsiya allaqachon qilingan (${Math.round(n(ink.topshirilgan_summa)).toLocaleString('ru-RU')} so'm topshirilgan) — ${Math.round(naqd).toLocaleString('ru-RU')} so'm naqd kassadan olib tashlandi, Inkassatsiya hisobotida farqni tekshiring.`);
      }
      if (ariza.kanal === 'avtolavka') {
        const qabul = await AvtolavkaHujjatModel.findOne({ where: { agent_id: ariza.agent_id, sana, tur: 'qabul', holat: 'tasdiqlangan' }, transaction: t });
        const dona = Object.values(omborlar).reduce((s, o) => s + o.dona, 0);
        if (qabul && dona > 0) {
          ogohlantirishlar.push(`Kun yopilgan edi: ${dona.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} kg tovar "${ariza.ombor}" omboriga qaytdi — qabul hujjati bilan skladga o'tkazing (Won Sell → mashina kuni).`);
        }
      }
    }
    if (mijozBalans !== null && mijozBalans > 0.5) {
      ogohlantirishlar.push(`Mijoz endi haqdor: ${Math.round(mijozBalans).toLocaleString('ru-RU')} so'm ortiqcha to'lagan — keyingi savdoda hisobga olinadi yoki kassadan qaytariladi.`);
    }

    return {
      ariza, tovar: Object.values(omborlar).map(o => ({ ...o, dona: +o.dona.toFixed(3) })),
      naqd: +naqd.toFixed(2), qarz, bonus: +bonus.toFixed(2), mijoz_balans: mijozBalans, ogohlantirishlar,
    };
  };

  return transaction ? ish(transaction) : sequelize.transaction(ish);
}

module.exports = { yetkazilganSotuvniBekorQil, adminMi, adminTekshir, ADMIN_ROLLAR };
