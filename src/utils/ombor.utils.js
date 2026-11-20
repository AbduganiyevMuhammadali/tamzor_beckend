/**
 * Ombor nomlari bilan ishlash.
 *
 * Qaytarish ikki bosqichli:
 *   1) agent qaytaradi     → "Agent: <ism>" omboriga kiradi
 *   2) skladchi qabul qiladi → asosiy omborga o'tadi
 *
 * Agent ombori alohida bo'lgani uchun kim nima qaytargani aniq
 * ko'rinadi va asosiy ombor qoldig'i tasdiqlanmagan tovar bilan
 * aralashib ketmaydi.
 */

const ASOSIY_OMBOR = 'Основной склад';
const AGENT_PREFIKS = 'Agent: ';
/* Xom ashyo savdo tovarlaridan alohida turadi: kirimda shu yerga tushadi,
   ishlab chiqarishga shu yerdan beriladi; tayyor mahsulot esa asosiy skladga kiradi. */
const XOM_ASHYO_OMBOR = 'Xom ashyo ombori';

/** Tovar turi bo'yicha uning ombori: xom ashyo → Xom ashyo ombori, savdo tovari → asosiy sklad */
function turOmbori(turi) {
  return turi === 'xom_ashyo' ? XOM_ASHYO_OMBOR : ASOSIY_OMBOR;
}

/** Foydalanuvchiga ko'rinadigan nom: "Основной склад" → "Asosiy sklad" */
function omborNomi(ombor) {
  return ombor === ASOSIY_OMBOR ? 'Asosiy sklad' : String(ombor || '');
}

/** Agent nomidan uning shaxsiy ombori nomini yasaydi */
function agentOmbori(agentNomi) {
  const nom = String(agentNomi || '').trim();
  if (!nom) return `${AGENT_PREFIKS}noma'lum`;
  // Ombor ustuni VARCHAR(80) — uzun ismni qisqartiramiz
  return (AGENT_PREFIKS + nom).slice(0, 80);
}

/* Agentning brak ombori: qaytarilgan yaroqsiz tovar shu yerga tushadi — sotuvga yaroqsiz,
   agentning sotiladigan qoldig'iga (agentOmbori) ham, umumiy sotuv zaxirasiga ham kirmaydi. */
const BRAK_SUFFIKS = ' (brak)';
function agentBrakOmbori(agentNomi) {
  const nom = String(agentNomi || '').trim() || "noma'lum";
  return (AGENT_PREFIKS + nom).slice(0, 80 - BRAK_SUFFIKS.length) + BRAK_SUFFIKS;
}

/** Brak ombori (umumiy "Brak ombori" yoki agentning "(brak)" ombori) — sotiladigan qoldiq emas */
function brakOmboriMi(ombor) {
  const s = String(ombor || '');
  return s === 'Brak ombori' || s.endsWith(BRAK_SUFFIKS);
}

/** Berilgan ombor agentnikimi */
function agentOmboriMi(ombor) {
  return String(ombor || '').startsWith(AGENT_PREFIKS);
}

/** "Agent: Sherzod Karimov" → "Sherzod Karimov" */
function agentNomi(ombor) {
  const s = String(ombor || '');
  return s.startsWith(AGENT_PREFIKS) ? s.slice(AGENT_PREFIKS.length) : null;
}

module.exports = {
  ASOSIY_OMBOR, XOM_ASHYO_OMBOR, AGENT_PREFIKS, BRAK_SUFFIKS, turOmbori, omborNomi, agentOmbori, agentBrakOmbori,
  brakOmboriMi, agentOmboriMi, agentNomi,
};
