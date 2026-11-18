/* Biznes rejimi — har bir o'rnatish (server) uchun .env da beriladi:
 *   BIZNES_REJIM=distributsiya   (sukut) — agent, dostavchik, Won Sell, buyurtma zanjiri
 *   BIZNES_REJIM=optom           — mijoz omborga keladi, sotuv shu zahoti skladdan;
 *                                  agent / dostavchik / mashina bo'limlari yashiriladi
 * Noma'lum yoki bo'sh qiymat distributsiya deb olinadi, shuning uchun mavjud
 * o'rnatishlar hech narsani sozlamasdan avvalgidek ishlaydi. */
const REJIMLAR = ['distributsiya', 'optom'];

const biznesRejim = () => {
    const r = String(process.env.BIZNES_REJIM || '').trim().toLowerCase();
    return REJIMLAR.includes(r) ? r : 'distributsiya';
};

const isOptom = () => biznesRejim() === 'optom';

module.exports = { REJIMLAR, biznesRejim, isOptom };
