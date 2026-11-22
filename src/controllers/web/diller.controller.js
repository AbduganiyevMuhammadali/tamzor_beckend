/* DILLERLAR (2026-11-29) — web: ro'yxat, karta, berish / to'lov / qaytarish, diller sotuvlari (faqat o'qish).
   Mantiq — utils/diller.utils.js, hujjat — FRONTEND-UCHUN.md §24 */
const D = require('../../utils/diller.utils');

class DillerController {
  royxat = async (req, res) => { res.send(await D.royxat(req.query)); };
  karta = async (req, res) => { res.send(await D.karta(req.params.id)); };
  hujjatlar = async (req, res) => {
    const d = await D.dillerOl(req.params.id, { paranoid: false });
    res.send(await D.hujjatlarRoyxat(d.id, req.query));
  };
  hujjat = async (req, res) => { res.send(await D.hujjatBitta(req.params.hid)); };
  sotuvlar = async (req, res) => { res.send(await D.sotuvlar(req.params.id, req.query)); };
  mijozlar = async (req, res) => { res.send(await D.mijozlar(req.params.id)); };
  berish = async (req, res) => { const r = await D.berish(req.params.id, req.body || {}, req.currentUser); res.status(r.status).send(r.body); };
  tolov = async (req, res) => { const r = await D.tolov(req.params.id, req.body || {}, req.currentUser); res.status(r.status).send(r.body); };
  qaytarish = async (req, res) => { const r = await D.qaytarish(req.params.id, req.body || {}, req.currentUser); res.status(r.status).send(r.body); };
}

module.exports = new DillerController();
