const { qarzQismlari } = require('./qarz.utils');

/**
 * Mijozning kredit holatini tekshiradi. Web va mobil savdo yaratishdan oldin
 * shu funksiyani chaqiradi — natija bloklashga sabab bo'lsa, chaqiruvchi
 * o'zining xato formatida (web: HttpException, mobil: error_code) foydalanadi.
 *
 * Qoida: kredit_limit=0 bo'lsa cheklov yo'q (eski xatti-harakat saqlanadi).
 * Aks holda: joriy qarz (balans<0 => -balans) + yangi zakaz summasi > limit => blok.
 * Muddati o'tgan qarz: qarzning to'lanmagan qismi to'lov sanasidan o'tgan bo'lsa => blok
 * (to'lov sanasi — agent belgilagan ariza.tolov_sana yoki sotuv sanasi + tolov_muddati_kun).
 */
async function kreditTekshir(mijoz, yangiSumma = 0) {
  if (!mijoz) return { bloklangan: false };

  const limit = parseFloat(mijoz.kredit_limit) || 0;
  const joriyQarz = Math.max(0, -(parseFloat(mijoz.balans) || 0));

  // Muddati o'tgan qarz tekshiruvi — qarzning hali to'lanmagan qismlari (FIFO) va
  // ularning to'lov sanasi: agent kalendardan belgilagan sana yoki sotuv + muddat.
  // To'langan eski savdolar hisobga olinmaydi (utils/qarz.utils.js — hisobotlar bilan bir xil).
  if (joriyQarz > 0) {
    const qismlar = (await qarzQismlari([mijoz])).get(mijoz.id) || [];
    const otgan = qismlar.filter(q => q.tolov_sana && q.kechikkan_kun > 0);
    if (otgan.length) {
      const kun = Math.max(...otgan.map(q => q.kechikkan_kun));
      const summa = otgan.reduce((a, q) => a + q.summa, 0);
      return {
        bloklangan: true,
        sabab: 'muddat',
        xabar: `Mijozning to'lov sanasidan ${kun} kun o'tgan qarzi bor (${summa.toLocaleString('uz-UZ')} so'm). Avval qarzni yopish kerak.`,
      };
    }
  }

  // Limit tekshiruvi (0 = cheklovsiz)
  if (limit > 0 && (joriyQarz + parseFloat(yangiSumma || 0)) > limit) {
    return {
      bloklangan: true,
      sabab: 'limit',
      xabar: `Mijozning kredit limiti ${limit.toLocaleString('uz-UZ')} so'm. Joriy qarz: ${joriyQarz.toLocaleString('uz-UZ')} so'm. Bu zakaz limitdan oshiradi.`,
    };
  }

  return { bloklangan: false, joriyQarz, limit };
}

module.exports = { kreditTekshir };
