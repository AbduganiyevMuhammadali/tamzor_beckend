// Ariza'ni hujjat 9.1 (DocumentDeliveryModel) formatiga aylantirish.
// Confirm, Delivery, History — barchasi shu formatdan foydalanadi.

const STATUS_NAME = {
  yangi: 'Готовлена',
  tasdiqlangan: 'Готовлена',
  yigilmoqda: 'Готовлена',
  yolda: 'Отправлено',
  yetkazildi: 'Доставлено',
  bekor: 'Доставлено',
};
const STATUS_ID = {
  yangi: '1', tasdiqlangan: '1', yigilmoqda: '1',
  yolda: '2', yetkazildi: '3', bekor: '3',
};

function shapeQator(q) {
  return {
    filialId: '1',
    tovar: q.tovar_nomi || '',
    tovarId: String(q.tovar_id || ''),
    countType: 'kg',
    currencyTovar: 'Сум',
    sht: parseFloat(q.dona) || 0,
    kolbo: parseFloat(q.jami_dona) || 0,
    pachka: parseFloat(q.blok) || 0,
    eskiNarx: parseFloat(q.narx) || 0,
    eskisumma: parseFloat(q.summa) || 0,
    narx: parseFloat(q.narx) || 0,
    summa: parseFloat(q.summa) || 0,
    vozvratKolbo: 0.0,
    vozvratPachka: 0.0,
    vozvratSumma: 0.0,
    brutto: 0.0,
    netto: 0.0,
    productName: q.tovar_nomi || '',
    isAksiya: false,
  };
}

function shapeDoc(a) {
  const mijoz = a.mijoz || {};
  const agent = a.agent || {};
  const qatorlar = a.qatorlar || [];
  const holat = a.holat || 'yangi';
  return {
    docNumber: a.raqam || String(a.id),
    docId: String(a.id),
    tipDokument: a.turi === 'qaytarish' ? 'Vozvrat' : 'Sotuv',
    qrCode: '',
    agent: a.agent_nomi || agent.fullname || '',
    agentId: String(a.agent_id || ''),
    agentTel: agent.telefon || '',
    klient: a.mijoz_nomi || mijoz.nomi || '',
    klientId: String(a.mijoz_id || ''),
    klientTel: mijoz.telefon || '',
    klientAdres: mijoz.manzil || '',
    klientLat: mijoz.lat != null ? String(mijoz.lat) : '',
    klientLong: mijoz.lng != null ? String(mijoz.lng) : '',
    tovarSummaSum: parseFloat(a.jami_summa) || 0,
    tovarSummaDollar: 0.0,
    skidkaSum: parseFloat(a.chegirma_summa) || 0,
    skidkaDollar: 0.0,
    vozvratSum: 0.0,
    vozvratDollar: 0.0,
    qoldiqSum: parseFloat(a.jami_summa) || 0,
    qoldiqDollar: 0.0,
    clientResSum: 0.0,
    clientResDollar: 0.0,
    komment: a.izoh || '',
    srok: '',
    docData: a.createdAt ? a.createdAt.toISOString().slice(0, 10).replace(/-/g, '.') : '',
    currency: a.tolov_turi || 'Сум',
    aralashSavdo: 'false',
    logo: '',
    status: { id: STATUS_ID[holat] || '1', name: STATUS_NAME[holat] || 'Готовлена', count: 0, tip: '' },
    products: qatorlar.map(shapeQator),
  };
}

module.exports = { shapeDoc, STATUS_ID, STATUS_NAME };
