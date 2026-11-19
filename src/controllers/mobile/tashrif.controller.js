const { MarshrutRejaModel, TashrifModel } = require('../../models/marshrut.model');
const { MijozModel } = require('../../models/mijoz.model');
const { ArizaModel } = require('../../models/ariza.model');
const HttpException = require('../../utils/HttpException.utils');
const { ok, requireRole, mobilVaqt } = require('./shared');
const { masofaMetr, koordinata, SOTUV_RADIUS_M } = require('../../utils/geo.utils');

/* ── Check-in / Check-out (yangi maxsus endpoint — asl API hujjatida yo'q) ── */
class MobileTashrifController {
  // POST checkIn/ — agent do'konga keldi. Body: { klientId, lat, long }
  checkIn = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const { klientId, lat, long } = req.body;
    if (!klientId) throw new HttpException(400, 'klientId majburiy');

    const agent = req.currentAgent || {};
    const mijoz = await MijozModel.findByPk(klientId);
    if (!mijoz) throw new HttpException(404, req.mf('Not found'));

    const vaqt = mobilVaqt(req.body.vaqt);   // oflayn bo'lsa — haqiqiy kelgan vaqti
    const bugun = vaqt.toISOString().slice(0, 10);
    const reja = await MarshrutRejaModel.findOne({ where: { agent_id: agent.id, mijoz_id: klientId, sana: bugun } });

    // Shu kun uchun ochiq (checkout qilinmagan) tashrif bo'lsa — qayta ochilmasin
    const ochiq = await TashrifModel.findOne({
      where: { agent_id: agent.id, mijoz_id: klientId, sana: bugun, checkout_vaqt: null },
    });
    if (ochiq) { ok(res, { tashrifId: ochiq.id, davomEtyapti: true }); return; }

    const masofa = masofaMetr(mijoz.lat, mijoz.lng, lat, long);
    // Mijoz nuqtasi hali yo'q — agent do'kon oldida turibdi, shu nuqta mijoz manzili bo'ladi
    const nuqta = koordinata(req.body);
    // Koordinata faqat O'Z mijoziga yoziladi — begona mijozning manzilini boshqa agent o'zgartirmasin
    const ozMijozi = Number(mijoz.agent_id) === Number(agent.id);
    if (nuqta && ozMijozi && (mijoz.lat == null || mijoz.lng == null)) {
      await mijoz.update({ lat: nuqta.lat, lng: nuqta.lng });
    }
    const tashrif = await TashrifModel.create({
      reja_id: reja ? reja.id : null,
      agent_id: agent.id,
      agent_nomi: agent.fullname,
      mijoz_id: klientId,
      mijoz_nomi: mijoz.nomi,
      checkin_vaqt: vaqt,
      checkin_lat: lat ?? null,
      checkin_lng: long ?? null,
      checkin_masofa: masofa,
      sana: bugun,
    });
    ok(res, {
      tashrifId: tashrif.id, masofa,
      uzoqda: masofa != null && masofa > SOTUV_RADIUS_M,
      mijozNuqtasiBelgilandi: masofa == null && !!nuqta && ozMijozi,
    }, 'Check-in qayd qilindi');
  };

  // POST checkOut/ — agent do'kondan chiqdi.
  // Body: { tashrifId, lat, long, natija: 'savdo'|'sotmaslik', vaqt? }
  // Oflayn ilova tashrifId ni bilmaydi — o'rniga { klientId }: shu mijozdagi oxirgi ochiq tashrif yopiladi.
  checkOut = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const { tashrifId, klientId, lat, long, natija, arizaId } = req.body;
    if (!tashrifId && !klientId) throw new HttpException(400, 'tashrifId yoki klientId majburiy');

    const agentId = (req.currentAgent || {}).id;
    // Faqat O'Z tashrifi (boshqa agentning tashrifini yopib bo'lmaydi)
    const tashrif = tashrifId
      ? await TashrifModel.findOne({ where: { id: tashrifId, agent_id: agentId } })
      : await TashrifModel.findOne({ where: { agent_id: agentId, mijoz_id: klientId, checkout_vaqt: null }, order: [['id', 'DESC']] });
    if (!tashrif) {
      if (tashrifId) throw new HttpException(404, req.mf('Not found'));
      ok(res, { tashrifId: null }, "Ochiq tashrif yo'q"); return;
    }
    if (tashrif.checkout_vaqt) { ok(res, { tashrifId: tashrif.id }, 'Allaqachon yopilgan'); return; }

    const checkoutVaqt = mobilVaqt(req.body.vaqt);
    const davomiylik = Math.round((checkoutVaqt.getTime() - new Date(tashrif.checkin_vaqt).getTime()) / 1000);

    // Ilova natija/arizaId yubormasa — mavjud qiymat saqlanadi (masalan createAriza tashrifga
    // yozgan natija='savdo' va ariza_id null/'ochiq' bilan ustidan yozilmaydi).
    // arizaId faqat shu agentning hujjati bo'lsa qabul qilinadi.
    let arizaIdYangi = tashrif.ariza_id || null;
    if (arizaId) {
      const a = await ArizaModel.findOne({ where: { id: arizaId, agent_id: agentId }, attributes: ['id'] });
      if (a) arizaIdYangi = a.id;
    }
    await tashrif.update({
      checkout_vaqt: checkoutVaqt,
      checkout_lat: lat ?? null,
      checkout_lng: long ?? null,
      davomiylik_sek: davomiylik,
      natija: natija === 'savdo' || natija === 'sotmaslik' ? natija : (tashrif.natija || 'ochiq'),
      ariza_id: arizaIdYangi,
    });
    ok(res, { tashrifId: tashrif.id, davomiylik_sek: davomiylik }, 'Check-out qayd qilindi');
  };

  // GET marshrutReja/ — agentga tayinlangan bugungi (yoki so'ralgan sana) reja ro'yxati
  marshrutReja = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const agent = req.currentAgent || {};
    const sana = /^\d{4}-\d{2}-\d{2}$/.test(req.query.sana || '') ? req.query.sana : new Date().toISOString().slice(0, 10);

    const rejalar = await MarshrutRejaModel.findAll({
      where: { agent_id: agent.id, sana },
      order: [['tartib', 'ASC'], ['id', 'ASC']],
    });
    const mijozIds = rejalar.map(r => r.mijoz_id);
    const mijozlar = mijozIds.length ? await MijozModel.findAll({ where: { id: mijozIds } }) : [];
    const mijozMap = {};
    mijozlar.forEach(m => { mijozMap[m.id] = m; });

    // Shu kun uchun tashriflar (checkin qilinganlarni belgilash uchun)
    const tashriflar = await TashrifModel.findAll({ where: { agent_id: agent.id, sana } });
    const tashrifMap = {};
    tashriflar.forEach(t => { tashrifMap[t.mijoz_id] = t; });

    ok(res, rejalar.map(r => {
      const m = mijozMap[r.mijoz_id];
      const t = tashrifMap[r.mijoz_id];
      return {
        rejaId: r.id,
        klientId: r.mijoz_id,
        klientName: m ? m.nomi : '',
        klientAdress: m ? m.manzil : '',
        klientLat: m && m.lat != null ? String(m.lat) : '',
        klientLong: m && m.lng != null ? String(m.lng) : '',
        tartib: r.tartib,
        izoh: r.izoh || '',
        bajarildi: !!(t && t.checkout_vaqt),
        checkinQilingan: !!(t && t.checkin_vaqt),
        tashrifId: t ? t.id : null,
      };
    }));
  };

  // GET bugungiTashriflar/ — agentning bugungi barcha tashriflari (mobil UI uchun)
  bugungiTashriflar = async (req, res, next) => {
    if (!requireRole(req, res, 'agent')) return;
    const agent = req.currentAgent || {};
    const bugun = new Date().toISOString().slice(0, 10);
    const rows = await TashrifModel.findAll({
      where: { agent_id: agent.id, sana: bugun },
      order: [['checkin_vaqt', 'ASC']],
    });
    ok(res, rows.map(r => ({
      tashrifId: r.id,
      klientId: r.mijoz_id,
      klientName: r.mijoz_nomi,
      checkinVaqt: r.checkin_vaqt,
      checkoutVaqt: r.checkout_vaqt,
      natija: r.natija,
      davomEtyapti: !r.checkout_vaqt,
    })));
  };
}

module.exports = new MobileTashrifController();
