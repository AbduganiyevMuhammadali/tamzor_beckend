/* Mobil ilovada qaysi rollar ochiladi — har bir o'rnatish (server) uchun .env da:
 *   MOBIL_ROLLAR=agent,avtolavka,dostavchik
 * Kalitlar:
 *   agent      — distributsiya agenti (zakaz oladi)
 *   avtolavka  — ko'chma savdo agenti (mashinadan o'zi sotadi)
 *   dostavchik — tayinlangan buyurtmani yetkazadi
 *   tasdiq     — hujjatni tasdiqlash oynasi (getConfirms / postConfirm)
 *   audit      — audit oynasi (chekUp)
 *   super_agent — agentning qo'shimcha roli (biriktirilgan agentlarni ko'rish). 'agent' yoqilgan
 *                bo'lsa MOBIL_ROLLAR da alohida yozilmasa ham ochiq (yangi kalit eski .env'larni buzmasin)
 * 2026-11-21: mobil ilovada faqat 2 rol — agent va super agent. Agent jadvalidagi har bir xodim
 * asosiy roli 'agent' (avtolavka bayrog'i endi hammada). Dostavchik mobil ilovaga kira olmaydi.
 * Bo'sh yoki berilmagan bo'lsa — hamma rol yoqilgan (mavjud o'rnatishlar avvalgidek ishlaydi).
 * Noma'lum kalitlar e'tiborsiz qoldiriladi. */
const ROLLAR = ['agent', 'super_agent', 'avtolavka', 'dostavchik', 'tasdiq', 'audit'];

const ROL_NOMI = {
  agent: 'Agent',
  super_agent: 'Super agent',
  avtolavka: 'Avtolavka (ko\'chma savdo)',
  dostavchik: 'Dostavchik',
  tasdiq: 'Tasdiqlash',
  audit: 'Audit',
};

function mobilRollar() {
  const raw = String(process.env.MOBIL_ROLLAR || '').trim();
  if (!raw) return [...ROLLAR];
  const set = new Set(raw.toLowerCase().split(/[\s,;]+/).filter(r => ROLLAR.includes(r)));
  // Eski .env: faqat 'avtolavka' yozilgan bo'lsa ham agentlar kira olsin (endi hamma agent shu rejimda)
  if (set.has('avtolavka')) set.add('agent');
  if (set.has('agent')) set.add('super_agent');
  return ROLLAR.filter(r => set.has(r));
}

const rolYoqilgan = (rol) => mobilRollar().includes(rol);

/* Foydalanuvchining asosiy roli — u faqat shu rolda ishlay oladi.
 * rol: mobileAuth / login dagi 'agent' | 'dostavchi' (jadval nomi). */
function asosiyRol(user, rol) {
  if (rol === 'dostavchi') return 'dostavchik';
  return 'agent';
}

/* Foydalanuvchida bor rollar (jadval flaglari bo'yicha, .env hisobga olinmagan) */
function foydalanuvchiRollari(user, rol) {
  const r = [asosiyRol(user, rol)];
  if (rol === 'agent' && user && user.super_agent) r.push('super_agent');
  return r;
}

/* Foydalanuvchiga ochiq rollar = .env dagi rollar ∩ foydalanuvchi rollari */
function ochiqRollar(user, rol) {
  const yoqilgan = mobilRollar();
  return foydalanuvchiRollari(user, rol).filter(r => yoqilgan.includes(r));
}

const asosiyRolYoqilgan = (user, rol) => rolYoqilgan(asosiyRol(user, rol));

const rolOchiqEmasXabari = (rol) =>
  `"${ROL_NOMI[rol] || rol}" roli bu serverda mobil ilova uchun yoqilmagan. Administratorga murojaat qiling.`;

module.exports = {
  ROLLAR, ROL_NOMI, mobilRollar, rolYoqilgan,
  asosiyRol, foydalanuvchiRollari, ochiqRollar, asosiyRolYoqilgan, rolOchiqEmasXabari,
};
