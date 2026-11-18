/**
 * ISHLAB CHIQARISH TANNARXI — yagona qoida (front/src/pages/ishlab/hisob.ts bilan bir xil).
 *
 *   Xom ashyo qiymati  X = Σ (sarflangan miqdor × ombordagi o'rtacha tannarx)
 *   Xarajatlar         E = Σ (ish haqi, elektr, qadoq, transport …)
 *   Qo'shimcha mahsulot Q = Σ (miqdor × baho)  — kepak, yog' kunjarasi kabi sotiladigan qoldiq
 *   Partiya tannarxi   C = X + E − Q
 *
 *   Asosiy mahsulot bitta bo'lsa:  birlik tannarxi = C / chiqqan miqdor.
 *   Bir nechta bo'lsa (1-nav, 2-nav): C ulushlarga bo'linadi —
 *     "qiymat": miqdor × chakana narx bo'yicha (qimmat nav ko'proq tannarx oladi; hammasida narx bo'lsa),
 *     "miqdor": faqat miqdor bo'yicha (har kg bir xil).
 *
 *   Yo'qotish (chiqindi, bug'lanish) = xom ashyo miqdori − (mahsulot + qo'shimcha) miqdori.
 *   Uning narxi alohida yozilmaydi — u sof mahsulot tannarxiga singib ketadi:
 *   1 t × 5 000 = 5 mln, 900 kg chiqsa → 5 555,56 so'm/kg (yo'qotish har kg ga 555,56 qo'shdi).
 *   Chiqish foizi faqat birliklar bir xil bo'lsa (kg → kg) hisoblanadi.
 */
const n = (v) => parseFloat(v) || 0;
const yax = (v, d = 2) => Math.round(n(v) * 10 ** d) / 10 ** d;

/**
 * @param qatorlar [{ tur: 'xom_ashyo'|'mahsulot'|'qoshimcha', miqdor, narx, chakana_narx, olchov }]
 *   xom_ashyo.narx — birlik tannarxi (ombordan), qoshimcha.narx — birlik bahosi
 * @param xarajatlar [{ summa }]
 * @param taqsimlash 'qiymat' | 'miqdor'
 * @returns { X, E, Q, C, xomMiqdor, mahsulotMiqdor, qoshimchaMiqdor, yoqotish, chiqishFoiz, birlikBir,
 *            usul, mahsulotlar: [{ i, ulush, summa, narx }], xato }
 */
function tannarxHisobla(qatorlar, xarajatlar, taqsimlash = 'qiymat') {
  const xom = qatorlar.filter(q => q.tur === 'xom_ashyo');
  const mah = qatorlar.map((q, i) => ({ ...q, i })).filter(q => q.tur === 'mahsulot');
  const qsh = qatorlar.filter(q => q.tur === 'qoshimcha');

  const X = yax(xom.reduce((s, q) => s + n(q.miqdor) * n(q.narx), 0));
  const E = yax((xarajatlar || []).reduce((s, x) => s + n(x.summa), 0));
  const Q = yax(qsh.reduce((s, q) => s + n(q.miqdor) * n(q.narx), 0));
  const C = yax(X + E - Q);

  const xomMiqdor = xom.reduce((s, q) => s + n(q.miqdor), 0);
  const mahsulotMiqdor = mah.reduce((s, q) => s + n(q.miqdor), 0);
  const qoshimchaMiqdor = qsh.reduce((s, q) => s + n(q.miqdor), 0);
  const birliklar = new Set(qatorlar.filter(q => n(q.miqdor) > 0).map(q => String(q.olchov || 'kg').toLowerCase()));
  const birlikBir = birliklar.size <= 1;
  const yoqotish = birlikBir ? +(xomMiqdor - mahsulotMiqdor - qoshimchaMiqdor).toFixed(3) : null;
  const chiqishFoiz = birlikBir && xomMiqdor > 0 ? yax((mahsulotMiqdor / xomMiqdor) * 100) : null;

  let xato = null;
  if (!xom.length || xomMiqdor <= 0) xato = "Xom ashyo kiritilmagan";
  else if (!mah.length || mahsulotMiqdor <= 0) xato = 'Chiqqan mahsulot miqdori kiritilmagan';
  else if (C <= 0) xato = "Qo'shimcha mahsulot bahosi xom ashyo va xarajatlardan oshib ketdi — bahoni tekshiring";
  else if (birlikBir && yoqotish < -0.0005) xato = `Chiqqan mahsulot xom ashyodan ko'p (${yax(-yoqotish, 3)} ga) — miqdorlarni tekshiring`;

  // Ulush: hamma asosiy mahsulotda chakana narx bo'lsa va "qiymat" tanlangan bo'lsa — sotuv qiymati bo'yicha
  const qiymatBilan = taqsimlash === 'qiymat' && mah.length > 1 && mah.every(q => n(q.chakana_narx) > 0);
  const usul = mah.length <= 1 ? 'yagona' : qiymatBilan ? 'qiymat' : 'miqdor';
  const vazn = mah.map(q => (qiymatBilan ? n(q.miqdor) * n(q.chakana_narx) : n(q.miqdor)));
  const jamiVazn = vazn.reduce((s, v) => s + v, 0);
  let qolgan = C;
  const mahsulotlar = mah.map((q, k) => {
    const ulush = jamiVazn > 0 ? vazn[k] / jamiVazn : 0;
    // Oxirgi qatorga qoldiq — yaxlitlashdan keyin ham Σ summa = C aniq
    const summa = k === mah.length - 1 ? yax(qolgan) : yax(C * ulush);
    qolgan -= summa;
    return { i: q.i, ulush: +ulush.toFixed(6), summa, narx: n(q.miqdor) > 0 ? yax(summa / n(q.miqdor)) : 0 };
  });

  return { X, E, Q, C, xomMiqdor, mahsulotMiqdor, qoshimchaMiqdor, yoqotish, chiqishFoiz, birlikBir, usul, mahsulotlar, xato };
}

module.exports = { tannarxHisobla, yax, n };
