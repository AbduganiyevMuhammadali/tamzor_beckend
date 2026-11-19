/* Mobil ilovada qaysi rollar ochiladi — har bir o'rnatish (server) uchun .env da:
 *   MOBIL_ROLLAR=agent,avtolavka,dostavchik
 * Kalitlar:
 *   agent      — distributsiya agenti (zakaz oladi)
 *   avtolavka  — ko'chma savdo agenti (mashinadan o'zi sotadi)
 *   dostavchik — tayinlangan buyurtmani yetkazadi
 *   tasdiq     — hujjatni tasdiqlash oynasi (getConfirms / postConfirm)
 *   audit      — audit oynasi (chekUp)
 * Bo'sh yoki berilmagan bo'lsa — hamma rol yoqilgan (mavjud o'rnatishlar avvalgidek ishlaydi).
 * Noma'lum kalitlar e'tiborsiz qoldiriladi. */
const ROLLAR = ['agent', 'avtolavka', 'dostavchik', 'tasdiq', 'audit'];

const ROL_NOMI = {
  agent: 'Distributsiya agenti',
  avtolavka: 'Avtolavka (ko\'chma savdo)',
  dostavchik: 'Dostavchik',
  tasdiq: 'Tasdiqlash',
  audit: 'Audit',
};

function mobilRollar() {
  const raw = String(process.env.MOBIL_ROLLAR || '').trim();
  if (!raw) return [...ROLLAR];
  const set = new Set(raw.toLowerCase().split(/[\s,;]+/).filter(r => ROLLAR.includes(r)));
  return ROLLAR.filter(r => set.has(r));
}

const rolYoqilgan = (rol) => mobilRollar().includes(rol);

/* Foydalanuvchining asosiy roli — u faqat shu rolda ishlay oladi.
 * rol: mobileAuth / login dagi 'agent' | 'dostavchi' (jadval nomi). */
function asosiyRol(user, rol) {
  if (rol === 'dostavchi') return 'dostavchik';
  return user && user.avtolavka ? 'avtolavka' : 'agent';
}

/* Foydalanuvchida bor rollar (jadval flaglari bo'yicha, .env hisobga olinmagan) */
function foydalanuvchiRollari(user, rol) {
  const r = [asosiyRol(user, rol)];
  if (rol === 'agent') {
    // Won Sell jufti bor distributsiya agenti — ikkala savdo rejimi ham
    if (user && !user.avtolavka && user.juft_agent_id) r.push('avtolavka');
    if (user && user.dual_role) r.push('dostavchik');
    r.push('tasdiq'); // agentga tasdiqlash oynasi (login: isConfirmation = isAgent)
  }
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
