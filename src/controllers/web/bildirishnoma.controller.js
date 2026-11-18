/**
 * Bildirishnomalar — ofis uchun jonli voqealar oqimi (web har 15 s so'raydi).
 *
 *   yuklash_sorov    — avtolavka agenti ilovadan mashinaga yuklash so'radi (omborchi tasdiqlashi kerak)
 *   yuk_qabul        — agent yuklangan tovarni sanab qabul qildi
 *   kun_yopildi      — agent kunni yopdi: qolgan tovar va naqdni topshirishga keladi
 *   reys_yakunlandi  — dostavchik reysni yakunladi: kassaga naqd topshiradi
 *
 * GET /bildirishnoma?keyin=<ISO>   — shu vaqtdan keyingi voqealar (berilmasa — oxirgi 24 soat)
 * Javob: { serverVaqt, items: [{ kalit, tur, modul, rang, vaqt, sarlavha, matn, havola, hal }] }
 * `serverVaqt` keyingi so'rovning `keyin` qiymati bo'ladi — telefon/brauzer soatiga bog'liq emas.
 */
const { Op } = require('sequelize');
const { AvtolavkaHujjatModel, AvtolavkaKunModel } = require('../../models/avtolavka.model');
const { TripSheetModel } = require('../../models/tripSheet.model');
const AgentModel = require('../../models/agent.model');

const n = (v) => parseFloat(v) || 0;
const fmt = (v) => Math.round(n(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const pad2 = (x) => String(x).padStart(2, '0');
const bugun = () => { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };
const avtoHavola = (agentId, sana) => `/avtolavka?agent=${agentId}${sana && sana !== bugun() ? `&sana=${sana}` : ''}`;

class BildirishnomaController {
  royxat = async (req, res) => {
    const serverVaqt = new Date();
    let keyin = req.query.keyin ? new Date(req.query.keyin) : null;
    if (!keyin || isNaN(keyin.getTime())) keyin = new Date(Date.now() - 24 * 3600 * 1000);
    // Bazada vaqt soniyagacha yaxlitlanadi — chegaradagi voqea tushib qolmasin (web kalit bo'yicha takrorni tashlaydi)
    else keyin = new Date(keyin.getTime() - 3000);
    // Juda eski kursor kelsa ham 3 kundan ortiq tarix qaytarilmaydi
    const chegara = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    if (keyin < chegara) keyin = chegara;
    const yangi = { [Op.gt]: keyin };

    const [sorovlar, qabullar, kunlar, reyslar] = await Promise.all([
      AvtolavkaHujjatModel.findAll({
        where: { tur: 'yuklash', manba: 'mobil', createdAt: yangi },
        attributes: ['id', 'raqam', 'agent_id', 'agent_nomi', 'sana', 'holat', 'jami_dona', 'jami_summa', 'izoh', 'createdAt'],
        order: [['id', 'DESC']], limit: 50, raw: true,
      }),
      AvtolavkaHujjatModel.findAll({
        where: { tur: 'yuklash', agent_qabul_vaqt: yangi },
        attributes: ['id', 'raqam', 'agent_id', 'agent_nomi', 'sana', 'jami_dona', 'agent_qabul_vaqt'],
        order: [['id', 'DESC']], limit: 50, raw: true,
      }),
      AvtolavkaKunModel.findAll({
        where: { yopish_vaqt: yangi },
        attributes: ['id', 'agent_id', 'sana', 'yopish_vaqt', 'naqd_elon'],
        order: [['id', 'DESC']], limit: 50, raw: true,
      }),
      TripSheetModel.findAll({
        where: { holat: 'yakunlandi', tugagan_vaqt: yangi },
        attributes: ['id', 'raqam', 'dostavchi_id', 'dostavchi_nomi', 'sana', 'tugagan_vaqt', 'naqd_elon'],
        order: [['id', 'DESC']], limit: 50, raw: true,
      }).catch(() => []),
    ]);

    const agentIds = [...new Set(kunlar.map(k => k.agent_id))];
    const agentlar = agentIds.length ? await AgentModel.findAll({ where: { id: agentIds }, attributes: ['id', 'fullname'], raw: true }) : [];
    const agentNomi = Object.fromEntries(agentlar.map(a => [a.id, a.fullname]));

    const items = [
      ...sorovlar.map(h => ({
        kalit: `sorov:${h.id}`, tur: 'yuklash_sorov', modul: 'avtolavka', rang: 'amber', vaqt: h.createdAt,
        sarlavha: `Yuklash so'rovi — ${h.agent_nomi || 'agent'}`,
        matn: `${h.raqam} · ${fmt(h.jami_dona)} kg · ${fmt(h.jami_summa)} so'm${h.izoh ? ` · ${h.izoh}` : ''}. ${h.holat === 'qoralama' ? 'Tasdiqlash kutilmoqda' : h.holat === 'tasdiqlangan' ? 'Tasdiqlangan' : 'Bekor qilingan'}`,
        havola: avtoHavola(h.agent_id, h.sana),
        hal: h.holat !== 'qoralama',
      })),
      ...qabullar.map(h => ({
        kalit: `qabul:${h.id}`, tur: 'yuk_qabul', modul: 'avtolavka', rang: 'green', vaqt: h.agent_qabul_vaqt,
        sarlavha: `Yuk qabul qilindi — ${h.agent_nomi || 'agent'}`,
        matn: `${h.raqam} · ${fmt(h.jami_dona)} kg. Agent tovarni sanab qabul qildi, savdo boshlandi`,
        havola: avtoHavola(h.agent_id, h.sana),
        hal: true,
      })),
      ...kunlar.map(k => ({
        kalit: `kun:${k.id}:${new Date(k.yopish_vaqt).getTime()}`, tur: 'kun_yopildi', modul: 'avtolavka', rang: 'indigo', vaqt: k.yopish_vaqt,
        sarlavha: `Kun yopildi — ${agentNomi[k.agent_id] || 'agent'}`,
        matn: `Qolgan tovar va naqdni topshirishga keladi${k.naqd_elon != null ? ` · o'zi sanagan naqd ${fmt(k.naqd_elon)} so'm` : ''}`,
        havola: avtoHavola(k.agent_id, k.sana),
        hal: false,
      })),
      ...reyslar.map(t => ({
        kalit: `reys:${t.id}`, tur: 'reys_yakunlandi', modul: 'sotuvlar', rang: 'indigo', vaqt: t.tugagan_vaqt,
        sarlavha: `Reys yakunlandi — ${t.dostavchi_nomi || 'dostavchik'}`,
        matn: `${t.raqam}${t.naqd_elon != null ? ` · o'zi sanagan naqd ${fmt(t.naqd_elon)} so'm` : ''}. Kassaga naqdni qabul qiling`,
        havola: '/sotuvlar/dostavchilar',
        hal: false,
      })),
    ].sort((a, b) => new Date(b.vaqt) - new Date(a.vaqt)).slice(0, 60);

    res.send({ serverVaqt, items });
  };
}

module.exports = new BildirishnomaController();
