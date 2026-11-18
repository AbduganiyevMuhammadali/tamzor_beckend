const TerritoriyaModel = require('../../models/territoriya.model');
const { ok } = require('./shared');

/* ── Regions & Locations (hujjat 3.8–3.11) ────────────────────────────────── */
// Tizimda viloyat/shahar ierarxiyasi yo'q — yagona "territoriya" jadvali.
class MobileRegionController {
  // 3.8 region/ → [{ id, name }]
  region = async (req, res, next) => {
    const list = await TerritoriyaModel.findAll({ order: [['nomi', 'ASC']] });
    ok(res, list.map(t => ({ id: String(t.id), name: t.nomi })));
  };

  // 3.9 getXudud/ → [{ id, name }]
  getXudud = async (req, res, next) => {
    const list = await TerritoriyaModel.findAll({ order: [['nomi', 'ASC']] });
    ok(res, list.map(t => ({ id: String(t.id), name: t.nomi })));
  };

  // 3.10 city/ → [{ id, name }]
  city = async (req, res, next) => {
    const list = await TerritoriyaModel.findAll({ order: [['nomi', 'ASC']] });
    ok(res, list.map(t => ({ id: String(t.id), name: t.nomi })));
  };

  // 3.11 getBronFiltr/ → hujjat status turlari (asl server: "Типи Статус")
  // Ariza holatlariga mos: yangi→Заявка, tasdiqlangan→Принять, yigilmoqda→Готовлена,
  // yolda→Отправлено, yetkazildi→Доставлено, bekor→Отмена
  getBronFiltr = async (req, res, next) => {
    ok(res, [
      { id: '0', name: 'Заявка' },
      { id: '1', name: 'Принять' },
      { id: '2', name: 'Готовлена' },
      { id: '3', name: 'Отправлено' },
      { id: '4', name: 'Доставлено' },
      { id: '5', name: 'Отмена' },
    ]);
  };
}

module.exports = new MobileRegionController();
