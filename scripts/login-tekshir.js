/**
 * LOGIN TASHXISI — serverga kira olmasangiz shuni ishga tushiring.
 *
 *   node scripts/login-tekshir.js                    # holatni ko'rsatadi
 *   node scripts/login-tekshir.js --tikla YangiParol # Admin/Programmer parolini o'rnatadi
 *
 * --tikla uchun parol MAJBURIY argument (kamida 8 belgi). Standart (123456 kabi)
 * parol ishlatilmaydi — zaif parol bilan qayta tiklash xavfsizlik teshigi edi.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const sequelize = require('../src/db/db-sequelize');
sequelize.options.logging = false;

const SINOV = ['123456', 'admin', 'admin123', '12345678', 'password', '1234'];

(async () => {
  try {
    await sequelize.authenticate();
    console.log('');
    console.log('  Baza :', process.env.DB_DATABASE, '@', process.env.HOST + ':' + process.env.DB_PORT);
    console.log('  JWT  :', process.env.SECRET_JWT ? 'belgilangan' : '*** YO\'Q — login ishlamaydi ***');
    console.log('');

    const [users] = await sequelize.query(
      'SELECT id, username, fullname, role, password, deletedAt FROM user ORDER BY id');

    if (!users.length) {
      console.log('  user jadvali BO\'SH.');
      console.log('  Yechim: npm run migrate:up  (yoki npm run db:bootstrap)');
      console.log('');
      process.exit(0);
    }

    console.log(`  ${users.length} ta foydalanuvchi:`);
    console.log('');
    for (const u of users) {
      const hashOk = typeof u.password === 'string' && /^\$2[aby]\$/.test(u.password);
      let topilgan = null;
      if (hashOk) {
        for (const p of SINOV) {
          if (await bcrypt.compare(p, u.password)) { topilgan = p; break; }
        }
      }
      console.log(`   #${u.id} ${String(u.username).padEnd(12)} ${String(u.role).padEnd(11)}` +
        (u.deletedAt ? ' [O\'CHIRILGAN]' : '') +
        (!hashOk ? '  ← parol hash EMAS (ochiq matn?)' :
          topilgan ? `  parol: ${topilgan}` : '  parol: ro\'yxatda yo\'q'));
    }
    console.log('');

    const tiklaIdx = process.argv.indexOf('--tikla');
    if (tiklaIdx !== -1) {
      const yangi = process.argv[tiklaIdx + 1] && !process.argv[tiklaIdx + 1].startsWith('--')
        ? process.argv[tiklaIdx + 1] : null;
      if (!yangi) {
        console.error('  XATO: yangi parolni ko\'rsating: node scripts/login-tekshir.js --tikla <YangiParol>');
        process.exit(1);
      }
      if (yangi.length < 8 || SINOV.includes(yangi)) {
        console.error('  XATO: parol kamida 8 belgi bo\'lishi va oddiy (123456, admin...) bo\'lmasligi kerak');
        process.exit(1);
      }
      const hash = await bcrypt.hash(yangi, 8);
      await sequelize.query(
        'UPDATE user SET password = ?, deletedAt = NULL WHERE username IN (?, ?)',
        { replacements: [hash, 'Admin', 'Programmer'] });
      console.log('  Admin va Programmer paroli yangilandi.');
      console.log('');
    } else {
      console.log('  Parolni tiklash: node scripts/login-tekshir.js --tikla <YangiParol>');
      console.log('');
    }
    process.exit(0);
  } catch (e) {
    console.error('  XATO:', e.message);
    process.exit(1);
  }
})();
