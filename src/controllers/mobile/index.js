// Mobil controller — bo'limlarni bitta obyektga birlashtiradi.
// Route fayli shu yagona obyektni import qiladi: mobileController.<metod>
const config = require('./config.controller');
const auth = require('./auth.controller');
const pricing = require('./pricing.controller');
const klient = require('./klient.controller');
const tovar = require('./tovar.controller');
const savdo = require('./savdo.controller');
const delivery = require('./delivery.controller');
const offline = require('./offline.controller');
const audit = require('./audit.controller');
const region = require('./region.controller');
const confirm = require('./confirm.controller');
const history = require('./history.controller');
const hisobot = require('./hisobot.controller');
const tashrif = require('./tashrif.controller');
const avtolavka = require('./avtolavka.controller');
const dostavchik = require('./dostavchik.controller');
const buyum = require('./buyum.controller');

module.exports = {
  // 14. Bootstrap config
  url1c: config.url1c,
  loadConfig: config.loadConfig,
  mobilSozlama: config.mobilSozlama,

  // 1. Auth & User
  login: auth.login,
  getUser: auth.getUser,
  getFilial: auth.getFilial,

  // 2. Location (klient controller'da)
  sendLocation: klient.sendLocation,
  saveLocation: klient.saveLocation,

  // 3. Pricing & Currency
  getKurs: pricing.getKurs,
  getValyuta: pricing.getValyuta,
  getPriceType: pricing.getPriceType,
  getPaymentType: pricing.getPaymentType,

  // 4. Clients
  getKlient: klient.getKlient,
  getAllKlient: klient.getAllKlient,
  getAllKlientAudit: klient.getAllKlientAudit,
  info: klient.info,
  saveKlient: klient.saveKlient,
  updateClient: klient.updateClient,

  // 5. Products
  getProductSell: tovar.getProductSell,
  getProductsVozvrat: tovar.getProductsVozvrat,
  getProductSellOffline: tovar.getProductSellOffline,
  getProductsVozvratOffline: tovar.getProductsVozvratOffline,
  checkProduct: tovar.checkProduct,
  getCategories: tovar.getCategories,
  getBrends: audit.getBrends,

  // 6. Orders & Sales
  saveSell: savdo.saveSell,
  saveVozvrat: savdo.saveVozvrat,
  editSell: savdo.editSell,
  clientNotSell: klient.clientNotSell,
  tolovSurildi: klient.tolovSurildi,     // mijoz reytingi: to'lov vaqti surildi
  savePayment: savdo.savePayment,
  chekYuklash: savdo.chekYuklash,

  // 7. Delivery
  getDokDelivery: delivery.getDokDelivery,
  getDokDeliveryLocation: delivery.getDokDeliveryLocation,
  orderDelivery: delivery.orderDelivery,
  returnDeliveryProducts: delivery.returnDeliveryProducts,
  getReturnDocDelivery: delivery.getReturnDocDelivery,
  getTripSheet: delivery.getTripSheet,
  startTrip: delivery.startTrip,
  finishTrip: delivery.finishTrip,

  // 8. Offline (Weekly Clients)
  getKlientOfflineMonday: offline.getKlientOfflineMonday,
  getKlientOfflineTuesday: offline.getKlientOfflineTuesday,
  getKlientOfflineWednesday: offline.getKlientOfflineWednesday,
  getKlientOfflineThursday: offline.getKlientOfflineThursday,
  getKlientOfflineFriday: offline.getKlientOfflineFriday,
  getKlientOfflineSaturday: offline.getKlientOfflineSaturday,
  getKlientOfflineSunday: offline.getKlientOfflineSunday,
  getKlientOfflineAllWeek: offline.getKlientOfflineAllWeek,

  // 9. Audit
  getReason: audit.getReason,
  sendMedia: audit.sendMedia,
  chekUp: audit.chekUp,

  // 10. Regions & Locations
  region: region.region,
  getXudud: region.getXudud,
  city: region.city,

  // 11. Confirmations & Filters
  getConfirms: confirm.getConfirms,
  postConfirm: confirm.postConfirm,
  getBronFiltr: region.getBronFiltr,

  // 12. History
  getAgentDocHistory: history.getAgentDocHistory,
  getClientDocHistory: history.getClientDocHistory,
  mijozCheklar: history.mijozCheklar,

  // 13. Reports
  getSellsReport: hisobot.getSellsReport,
  getSellsReportMonth: hisobot.getSellsReportMonth,
  agentKpi: hisobot.agentKpi,   // 2026-11-27
  getBranches: hisobot.getBranches,
  getCircleReports: hisobot.getCircleReports,
  getLinearReports: hisobot.getLinearReports,
  getSections: hisobot.getSections,
  table: hisobot.table,

  // 15. Tashrif (Check-in / Check-out) — yangi maxsus endpoint
  checkIn: tashrif.checkIn,
  checkOut: tashrif.checkOut,
  bugungiTashriflar: tashrif.bugungiTashriflar,
  marshrutReja: tashrif.marshrutReja,

  // 17. Avtolavka (ko'chma savdo) — agentning yuklash → savdo → topshirish kuni
  avtolavkaHolat: avtolavka.avtolavkaHolat,
  mashinaQoldiq: avtolavka.mashinaQoldiq,
  mijozNarxlari: avtolavka.mijozNarxlari,
  avtolavkaSinxron: avtolavka.avtolavkaSinxron,
  agentlarim: avtolavka.agentlarim,
  savdoQaytarish: avtolavka.savdoQaytarish,
  pulTopshirish: avtolavka.pulTopshirish,
  dillerNarxlari: avtolavka.dillerNarxlari,
  agentSinxron: avtolavka.agentSinxron,
  buyumHarakat: buyum.buyumHarakat,   // 2026-11-28: buyumlar (mijozga / mijozdan)
  yuklashTavsiya: avtolavka.yuklashTavsiya,
  yuklashTovarlar: avtolavka.yuklashTovarlar,
  yuklashSorov: avtolavka.yuklashSorov,
  yuklashlar: avtolavka.yuklashlar,
  yuklashQabul: avtolavka.yuklashQabul,
  yuklashBekor: avtolavka.yuklashBekor,
  kunYakuni: avtolavka.kunYakuni,
  kunniYopish: avtolavka.kunniYopish,

  // 18. Dostavchik (pre-sale yetkazish) — reys → yetkazish → kassa
  dostavchikHolat: dostavchik.dostavchikHolat,
  dostavchikSinxron: dostavchik.dostavchikSinxron,
  marshrut: dostavchik.marshrut,
  buyurtma: dostavchik.buyurtma,
  reysBoshla: dostavchik.reysBoshla,
  yetkazdim: dostavchik.yetkazdim,
  yetkazilmadi: dostavchik.yetkazilmadi,
  qarzTolov: dostavchik.qarzTolov,
  dKunYakuni: dostavchik.kunYakuni,
  reysYakunla: dostavchik.reysYakunla,
};
