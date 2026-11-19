# Backend audit: nima qilindi va nima rejada

> Oxirgi yangilanish: 2026-11-19. Bu fayl keyingi sessiyalar (va dasturchilar) uchun:
> loyihada qanday xatolar topilgani, qaysilari tuzatilgani, qanday sinalgani va
> hali nima qilinishi kerakligi.
>
> **Holat:** barcha o'zgarishlar ishchi papkada, **commit qilinmagan**
> (`payload.ini` `git rm` bilan stage qilingan). Commit qilishdan oldin frontend va APK
> bilan qo'lda tekshirish kerak (pastdagi "Keyingi qadamlar").

---

## 1. Qisqacha xulosa

1. **Audit.** 2026-11-18 da butun loyiha (~25 ming qator) o'qib chiqildi. Ishlab turgan serverga real so'rovlar yuborib sinaldi.
2. **Topilmalar.** ~70 ta xato topildi, ularning ichida 5 ta kritik:
   - tokensiz Admin yaratish mumkin edi;
   - oddiy foydalanuvchi o'zini Admin qila olardi;
   - SQL injection bor edi;
   - mobil API'da boshqa foydalanuvchining yozuvlariga kirish mumkin edi (IDOR);
   - seed skriptlar real ma'lumotni o'chirardi.
3. **Tuzatish.** Ataylab qoldirilgan bandlardan tashqari (6-bo'lim) hammasi tuzatildi: 64 ta fayl o'zgardi, 5 ta yangi fayl qo'shildi.
4. **Sinov.** Hammasi alohida, vaqtinchalik MySQL 9.6 bazada sinaldi. Foydalanuvchi bazasiga tegilmagan.

---

## 2. Topilgan va tuzatilgan xatolar

✅ belgisi — xato avval real serverda takrorlanib ko'rilgan, tuzatishdan keyin esa testdan o'tgan.

### Kritik
| # | Muammo | Tuzatish | Fayllar |
|---|---|---|---|
| 1 ✅ | `POST /api/v1/users` auth'siz edi va `role:"Admin"` qabul qilardi | `auth(Role.Admin)` | `src/routes/user.route.js` |
| 2 ✅ | `auth.middleware`: `req.params.id == user.id` bo'lsa rol tekshiruvi o'tkazib yuborilardi, shu yo'l bilan User o'zini Admin qila olardi | "Owner bypass" olib tashlandi, rad etilganda 403 qaytadi. User faqat o'z profilini (rol va `perms`siz) tahrirlay oladi | `auth.middleware.js`, `user.controller.js` |
| 3 ✅ | SQL injection: `mijoz oldi-berdi` va `hisobot agentMonitoring` (`dan`/`gacha` to'g'ridan-to'g'ri SQL matniga qo'shilardi) | Sana `YYYY-MM-DD` formatda tekshiriladi, qiymatlar replacements orqali uzatiladi. `multipleStatements: false` qilindi | `mijoz.controller.js`, `hisobot.controller.js`, `db-sequelize.js` |
| 4 ✅ | Mobil IDOR: istalgan agent istalgan buyurtmani tasdiqlay yoki bekor qila, yetkazildi deb belgilay, mijozini tahrirlay olardi | Ega va holat tekshiruvi qo'shildi, amallar tranzaksiya ichida qulf bilan bajariladi | `src/controllers/mobile/*` |
| 5 | `seed-agent-nazorat` `tozala()` real tashrif, reja va GPS yozuvlarini o'chirardi | Skript o'zi yozgan qatorlar ro'yxatini `demo_yozuv` jadvaliga yozadi va faqat shularni o'chiradi. Production himoyasi qo'shildi | `scripts/*`, `scripts/lib/demo-utils.js` |

### Yuqori
- ✅ **Race condition (parallel so'rovlar).** Holat tekshiruvi tranzaksiyadan tashqarida bajarilardi, shuning uchun ikki marta bosish yoki oflayn qayta yuborish pul/tovar effektini ikki marta qo'llardi. Ta'sirlangan joylar:
  - kassa yozuvini o'chirish (testda 5 marta parallel o'chirish qarzni 5 baravar oshirgan);
  - ariza holatini `yolda` yoki `yetkazildi` ga o'tkazish;
  - sotuvni bekor qilish;
  - prixodni tasdiqlash va bekor qilish;
  - avtolavka yuklash va qabul;
  - mobil `yetkazdim` va `savePayment`;
  - inkassatsiya.

  **Tuzatish:** `src/utils/qulf.utils.js`. Hujjat tranzaksiya ichida `qulflabOl()` (`SELECT … FOR UPDATE`) bilan qayta o'qiladi va holat shu yerda qayta tekshiriladi. Tovar qatorlari `tovarlarniQulfla()` bilan id tartibida qulflanadi, shu sababli zaxiradan ortiq sotib bo'lmaydi.
- ✅ **Hujjat raqamlari takrorlanardi.** Raqam `COUNT(*)+1` bilan berilardi. Endi `hujjat_raqam` jadvalidagi hisoblagich tranzaksiya ichida oshiriladi (`keyingiTartib()`): AR, avtolavka, IC, TS hujjatlari.
- **Mobil ilova narx va summani o'zi yuborardi.** Endi summa serverda hisoblanadi, manfiy miqdor rad etiladi. `oflayn:true` bayrog'i endi zaxira tekshiruvini o'chirib qo'ymaydi; kredit tekshiruvini faqat avtolavka uchun o'tkazib yuboradi.
- **Mass assignment.** `PATCH /mijozlar {balans:0}` qarzni o'chirib yuborardi, ariza yaratishda esa `tolangan_summa` va `dostavchi_id` ni yuborib bo'lardi. Endi har ikkala joyda faqat ruxsat etilgan maydonlar qabul qilinadi (whitelist).
- **Fayl yuklash.** `x.html` faylini `image/png` deb yuborib, serverga skript joylash mumkin edi. Endi fayl kengaytmasi tekshirilgan MIME turidan olinadi, `/uploads` javoblariga `nosniff` va CSP (`sandbox`) sarlavhalari qo'shildi (`rasmYuklash.utils.js`).
- ✅ **Mobil parol va token logga yozilardi.** Endi ular log'da yashiriladi (`startup/routes.js`).
- **JWT.** `jsonwebtoken` 9 ga yangilandi, `algorithms: ['HS256']` qo'shildi. `SECRET_JWT` 16 belgidan qisqa bo'lsa server ishga tushmaydi.

### O'rta va past
- ✅ Joi validatsiya xatosi 500 o'rniga 400 qaytaradi. Xabardagi ortiqcha `0` xatosi tuzatildi. Production rejimida 500 xatolarda SQL matni mijozga ko'rsatilmaydi.
- `unhandledRejection` endi serverni yiqitmaydi, faqat logga yoziladi. Server avval migratsiyalarni bajaradi, keyin so'rov qabul qiladi; migratsiya muvaffaqiyatsiz bo'lsa ishga tushmaydi.
- Vaqt zonasi: UTC sana (`toISOString`) va `DATE(col)` o'rniga lokal kun ishlatiladi (`CONVERT_TZ`, `kunKey`) — avtolavka va hisobotlarda.
- Excel import:
  - `"1.250.000"` endi 1250000 deb o'qiladi (avval 1.25 edi);
  - oxirida vergul bor katak (`"Du,"`) importni yiqitmaydi;
  - mijozni nom bo'yicha topish faqat telefon bo'lmaganda ishlatiladi.
- Validatorlar: tahrirlashda standart qiymatlar (`narx_turi`, `faol`) yozib yuborilmaydi.
- Tovar o'chirish: tarixi bor tovar soft-delete qilinadi, tarixi yo'q tovar butunlay o'chiriladi.
- Ro'yxatlardagi `limit` chegaralandi (500–5000), `NaN` qiymatdan himoya qo'shildi.
- Migratsiyalarning `down()` qismi tuzatildi. ✅ `undo:all` ma'lumot bor bazada ham oxirigacha ishlaydi.
- Kassa: `chiqim` + `mijoz_tolov` kombinatsiyasi va tizim kategoriyalarini qo'lda kiritish taqiqlandi.
- Bog'liqliklar: `mysql2` 3, `jsonwebtoken` 9, `multer` 2 va `umzug` 3.8 ga yangilandi. Ishlatilmaydigan `axios`, `redis`, `ini`, `node-cron` va `mysqldump` olib tashlandi. `npm audit` natijasi: critical 1 → 0, high 9 → 4.

### Testlar paytida topilib, tuzatilgan qo'shimcha xatolar
- **`kreditTekshir` tranzaksiyadan tashqarida so'rov yuborardi.** Parallel yuklamada pool to'lib, so'rovlar 50 soniya qotib qolardi (lock wait timeout). Endi `transaction` uzatiladi (`kreditLimit.utils.js` va uni chaqiruvchilar).
- **`demo:all` dan keyin `demo:prezentatsiya` yiqilardi** (`marshrut_reja` unique to'qnashuvi; asl kodda ham bor edi). Endi mavjud reja qayta ishlatiladi.
- **Mobil `GET /buyurtma`** `docId` yuborilmasa 500 qaytarardi. Endi 400 qaytaradi.

---

## 3. Yangi fayllar
| Fayl | Vazifasi |
|---|---|
| `src/utils/qulf.utils.js` | `qulflabOl`, `tovarlarniQulfla`, `keyingiTartib`, `maksRaqam` |
| `src/middleware/rasmYuklash.utils.js` | Ruxsat etilgan rasm turlari va tasodifiy fayl nomi |
| `migrations/20261118000001-hujjat-raqam.js` | Hujjat raqamlari hisoblagichi jadvali |
| `migrations/20261118000002-ariza-ombor-default.js` | `ariza.ombor` standart qiymati: 'Asosiy sklad' → 'Основной склад' |
| `scripts/lib/demo-utils.js` | Production himoyasi va `demo_yozuv` jurnali (demo qatorlarni aniq o'chirish uchun) |

**Kod qoidasi (yangi kod uchun ham amal qiladi):** pul yoki tovar holatini o'zgartiruvchi amal hujjatni **tranzaksiya ichida** `qulflabOl` bilan o'qiydi va holatni shu yerda qayta tekshiradi. Tranzaksiya ichidagi **har bir** so'rovga `{ transaction: t }` uzatiladi. Aks holda pool to'lganda server qotib qoladi.

Qulf tartibi (deadlock bo'lmasligi uchun):
- yangi hujjat yaratishda: avval `tovarlarniQulfla`, keyin boshqa o'qishlar;
- mavjud hujjat ustida amalda: avval `qulflabOl(ariza)`, keyin `tovarlarniQulfla`.

---

## 4. Sinov natijalari (2026-11-18/19)
| Test | Natija |
|---|---|
| Barcha JS fayllar `node --check` | ✅ |
| 343 ta route yuklanadi; auth'siz faqat `rejim`, login va mobil `LoadConfig`/`Login`/`getFilial`/`url1c` | ✅ |
| Toza bazada 61 ta migratsiya; ma'lumot bor bazada `undo:all` va qayta `migrate` | ✅ |
| Bootstrap va 5 ta demo skript; `--tozala` faqat demo qatorlarni o'chiradi (real kassa yozuvi va balans o'zgarishi saqlandi) | ✅ |
| Xavfsizlik va race-condition testlari (pool=3, lock_wait=5s sharoitida) | ✅ 30/31 (yagona "fail" — test artefakti: qolib ketgan `kassir1`) |
| Mobil oqim: savdo, takroriy yuborish, manfiy miqdor, `oflayn` bayrog'i, 3× parallel to'lov, begona dostavchi, 3× parallel `yetkazdim` | ✅ 9/9 |
| 245 ta GET chaqiruvi (admin, agent va dostavchi tokenlari bilan) | ✅ 0 ta 5xx |

Test skriptlari vaqtinchalik scratchpad papkasida turibdi (`tests/integration.js`, `tests/mobile-flow.js`, `tests/get-smoke.js`, `tests/routes-harness.js`). Bu papka tozalanib ketishi mumkin. Kerak bo'lsa, ularni loyihaga `tests/` papkasi sifatida ko'chirish rejada (7-bo'lim).

---

## 5. Frontend yoki APK sezishi mumkin bo'lgan o'zgarishlar
- **Foydalanuvchilar:** yangi foydalanuvchini faqat Admin yaratadi. User faqat o'z profilini tahrirlay oladi.
- **Arizalar:**
  - `yolda` holatidagi arizani tahrirlab bo'lmaydi (400);
  - tahrirda `turi` ni o'zgartirib bo'lmaydi;
  - `tolangan_summa` va `dostavchi_id` kabi ichki maydonlar indamay e'tiborsiz qoldiriladi.
- **Mobil:**
  - summani server hisoblaydi;
  - chegirma agentning `max_chegirma` qiymatidan oshsa rad etiladi;
  - oflayn oddiy buyurtmalar ham zaxira va kredit tekshiruvidan o'tadi;
  - agent faqat o'z mijozlari bilan ishlaydi (403), yetkazishni faqat tayinlangan dostavchi qiladi.
- **Mobil ro'yxat va ruxsatlar nomuvofiqligi.** `getAllKlient` / `getAllKlientAudit` hali barcha mijozlarni ko'rsatadi, lekin dostavchiga `info` va `history` faqat o'ziga buyurtma tayinlangan mijozlar uchun ochiq. Natijada dostavchi ro'yxatda mijozni ko'radi, uni ochsa 403 oladi. Qaror kerak.
- **Hisobotlar:** `sotuvHisobot` sana berilmasa oxirgi 90 kunni qaytaradi (max 366 kun). `marshrutRejaGenerate` bir martada max 62 kun.
- **Server ishga tushishi:** migratsiya xatosi bo'lsa yoki `SECRET_JWT` 16 belgidan qisqa bo'lsa, server ishga tushmaydi. Electron ilova bunda jim yopiladi.
- **Skriptlar:**
  - demo skriptlar `NODE_ENV=production` da faqat `--majburiy` bayrog'i bilan ishlaydi;
  - `bootstrap` agent va dostavchilarga tasodifiy parol beradi (yoki `--parol X` / `BOOTSTRAP_PAROL`);
  - `login-tekshir --tikla <YangiParol>` da parol argumenti majburiy.

---

## 5b. Ikkinchi audit: validatsiya va tranzaksiyalar (2026-11-20)

Barcha endpoint'lar (mobil, web pul/ombor, asosiy ma'lumotlar, hisobotlar) validatsiya va tranzaksiya bo'yicha qayta ko'rib chiqildi. 36 ta fayl o'zgardi, yangi fayl bitta: `src/middleware/rateLimit.middleware.js`. Migratsiya kerak emas.

**Yuqori xavf (pul yoki ombor buzilishi):**
- **Avtolavka sotuvi:** bitta tovar bir nechta qatorda kelsa, endi tovar bo'yicha jamlanib tekshiriladi.
- **`reysBoshla`:**
  - butun amal bitta tranzaksiyada, dostavchi qatori va bugungi reys qulflanadi;
  - reys raqami web bilan bir xil hisoblagichdan olinadi;
  - web'dagi trip sheet yaratish ham dostavchi qatorini qulflaydi.
- **`returnDeliveryProducts` (eski APK):**
  - qator, buyurtma summasi va yetkazilgan buyurtmada mijoz balansi ham kamayadi;
  - `yetkazdim` bilan birga qayta qaytarish oshib ketmaydi.
- **Prixod narxlari:** qulf hammasidan oldin olinadi, hujjat va qatorlar qulflangan nusxadan o'qiladi.
- **Ishlab chiqarish (`boshla`, `yakunla`, `create`):**
  - xom ashyo qulfi birinchi o'qishdan oldin olinadi (REPEATABLE READ snapshot);
  - `bekor` endi `mavjudQoldiq` dan foydalanadi.
- **Kamomad (dostavchi):** limit va izoh `dostavchiTopshir` ichida, qulfdan keyin tekshiriladi. Yangi parametrlar: `maxQoshish`, `izohQosh`, `kutilganTopshirilgan`.
- **Yetkazuvchi, mijoz, tovar, dostavchini o'chirish:** tarixi, balansi yoki qoldig'i bo'lsa rad etiladi (tekshiruv qulf ostida).

**O'rta xavf:**
- **Mijoz:** boshlang'ich balans qulf ostida hisoblanadi.
- **Kassa:** `mijoz_id` faqat `mijoz_tolov` kategoriyasida saqlanadi.
- **Ariza:** qaytarish arizasini `qabul_*` holatida o'chirib bo'lmaydi.
- **Web idempotentlik (ixtiyoriy maydonlar):**
  - `sorov_id`: kassa va avtolavka sotuvi;
  - `kutilgan_topshirilgan`: dostavchi kassa qabuli.
- **Import:** `GET_LOCK` bilan navbatma-navbat bajariladi.
- **Mobil:**
  - `checkIn` qulf ostida va idempotent;
  - `orderDelivery` kassaga dostavchi nomidan yoziladi;
  - kun kalitlari endi Toshkent kuni bo'yicha olinadi.
- **Hisobotlar:**
  - sana tekshiruvi va 366 kunlik chegara;
  - xom SQL'da mahalliy kun chegaralari;
  - limit oshganda `kesildi` bayrog'i;
  - dashboard va inkassatsiya mahalliy kun bo'yicha.

**Past xavf:**
- `Infinity`, `NaN` va juda katta summalar rad etiladi.
- Noto'g'ri `mobilId` → 400.
- `saveKlient` va `tolovSurildi` parallel takrorda 500 o'rniga `takror: true` qaytaradi.
- GPS: bir so'rovda ≤ 2000 nuqta; noto'g'ri koordinata yozilmaydi.
- `limit=abc` 500 bermaydi.
- `harakat=constructor` → 400.
- `marshrut-reja/generate` `bulkCreate` bilan ishlaydi.
- Sozlama va reyting kalitlari bitta tranzaksiyada yoziladi.
- Turkum va agent yozuvlari tranzaksiya ichida.
- Login: 15 daqiqada 10 ta xato urinishdan keyin 429.

**Ataylab qilinmagan:** `savePayment`, `clientNotSell` va `tolovSurildi` da mijoz egaligi tekshirilmaydi. Ilova agentga barcha mijozlarni ko'rsatadi, `saveSell` ham egalikni tekshirmaydi. Shu sababli tekshiruv qo'yilsa, haqiqiy oflayn to'lovlar rad etilardi.

**Ma'lum cheklov:** login cheklovi IP+login bo'yicha ishlaydi. Server nginx ortida bo'lsa, `trust proxy` sozlanmagan, shuning uchun amalda faqat login bo'yicha cheklanadi.

**Sinov (test bazasi, 2026-11-20):**
- Flutter testlari: 92/92 (shu jumladan e2e).
- Jonli skript: 28 ta tekshiruv o'tdi.
- Parallel holatlar sinaldi:
  - `reysBoshla` ×5 → 1 reys;
  - `checkIn` ×3 → 1 tashrif;
  - kassa `sorov_id` ×3 → 1 yozuv;
  - mijoz balansi ×2 → bir marta;
  - ikki partiya parallel `boshla` → ikkinchisi 400, qoldiq minusga tushmadi.
- Eski APK qaytarishi: summa va qarz to'g'ri kamayadi.

---

## 5c. Validatsiya kamchiliklari (API-VALIDATSIYA katalogidan, 2026-11-20)

- **Ro'yxat filtrlari:** sana parametrlari tekshiriladi (`src/utils/sana.utils.js`: `kunParam`, `kunOraligi`). Noto'g'ri sana yoki `from > to` → 400. Bu prixod, arizalar, trip-sheet (va `/qaytarish`), avtolavka `/hujjatlar`, mijozlar `/xarita` uchun amal qiladi. DATE ustunlarda kun chegarasi Toshkent kuni bo'yicha olinadi.
- **Prixod:** `qatorlar` ko'pi bilan 500 ta.
- **Turkum `kod`:** 30 belgiga kesiladi (ustun `STRING(30)`; avval 80 edi va DB xatosi berardi).
- **Ishlab chiqarish:** noma'lum `tur` qatori jim tashlab yuborilmaydi → 400.
- **Fayl yuklash (multer):** hajm yoki son chegarasi → 400 "Fayl hajmi juda katta" (avval 500).
- **Foydalanuvchi:** band login (o'chirilganlar ham hisobga olinadi) → 400 "Bu login band".
- **Mijoz:** mavjud bo'lmagan `territoriya_id` / `kategoriya_id` / `agent_id` → 400 (avval FK xatosi, 500).
- **Mobil `avtolavkaSinxron`:** mashina qatorlarida `countType` (o'lchov birligi).
- **Ataylab o'zgartirilmadi:** `arizalar` va `agents` PATCH'da `.unknown(false)` (ortiqcha maydon → 400). Bu mass-assignment himoyasi.

---

## 6. Ataylab qoldirilganlar
| Masala | Sabab |
|---|---|
| **Rol va `perms` server tomonda tekshirilmaydi.** Har qanday User kassani o'chira oladi, prixodni tasdiqlaydi va bekor qiladi, narxni o'zgartiradi | Egasi "hozircha tegmaslik" deb qaror qildi (2026-11-18). `perms` kalitlari formati faqat frontendda ma'lum |
| Electron 12 (eskirgan, Chromium CVE'lari bor) | Katta yangilanish, alohida ish talab qiladi |
| `webpack` `.env.pack` dagi sirlarni (`SECRET_JWT`, DB paroli) Electron paketiga joylaydi | Paketlash arxitekturasiga oid masala |
| Mobil `LoadConfig` javobi `mobile_password` qiymatini auth'siz qaytaradi | APK bilan moslik |
| Agent ombori kaliti agentning to'liq ismi (`agentOmbori(fullname)`); ism o'zgarsa qoldiq "yo'qoladi" | Ma'lumot migratsiyasini talab qiladi |
| ~~Mobil `qarzTolov`, `checkIn`, `chekUp` da ega tekshiruvi yo'q~~ | ✅ 2026-11-19 tuzatildi: `qarzTolov` — faqat dostavchiga buyurtmasi tayinlangan mijoz (aks holda 403); `checkIn` — begona mijozga tashrif yoziladi, lekin uning koordinatasi o'zgartirilmaydi; `chekUp` — audit roli ochiq bo'lmasa 403 (hozir hech kimda yo'q) |
| Mobilda narx serverdagi narx ro'yxatidan majburan olinmaydi (faqat summa izchilligi tekshiriladi) | Agent optom yoki chakana narxni tanlaydi, dollar narxi bor — majburlash to'g'ri sotuvlarni buzadi |
| `inkassatsiya (agent_id/dostavchi_id, sana)` da UNIQUE indeks yo'q (kodda qulf bilan himoyalangan) | Mavjud dublikat yozuvlar bo'lishi mumkin, migratsiya oldidan tekshirish kerak |
| `npm audit`: `picomatch` (high) va `uuid` (moderate) | Faqat sequelize va umzug ichida; `picomatch` faqat doimiy shablon bilan ishlaydi |
| `.gitignore` ichida `package-lock.json` | Build'lar takrorlanuvchan emas — egasi hal qilsin |

---

## 7. Keyingi qadamlar (reja)
1. **`npm install`.** Loyihadagi `node_modules` boshqa kompyuterdagi papkaga ishora qiladi (`/Users/muhammadali/...`), `package.json` esa o'zgardi.
2. **`.env` ni tuzatish.** Undagi `root` login/paroli bu kompyuterdagi MySQL'ga ulanmadi (`Access denied`). `SECRET_JWT` va `DB_PASS` ni almashtirish tavsiya etiladi: audit paytida ular lokal terminal chiqishida ko'rinib qolgan.
3. **Frontend va APK bilan qo'lda tekshirish:** savdo, to'lov, yetkazish, avtolavka kuni, prixod, Excel import.
4. **Commit.** Hozircha hech narsa commit qilinmagan. Alohida branch'da, mantiqiy qismlarga bo'lib commit qilish tavsiya etiladi.
5. **Production'ga chiqarish:** Admin va Programmer parolini almashtirish (migratsiya ularni `123456` bilan yaratadi), bazaning zaxira nusxasini olish, so'ng serverni ishga tushirish (2 ta yangi migratsiya avtomatik qo'llanadi).
6. **Ochiq qarorlar** (egasidan javob kerak):
   - rol va `perms` ni serverda tekshirish (frontend `perms` kalitlari kerak);
   - dostavchiga mijozlar ro'yxatini cheklash yoki `info`/`history` ruxsatini kengaytirish;
   - web'da `qaytarish` turidagi arizalar oqimi.
7. **Ixtiyoriy:** test skriptlarini loyihaga `tests/` sifatida qo'shish; Electron yangilash; webpack sirlari; agent omborini id bo'yicha kalitlash; `inkassatsiya` UNIQUE indeksi.
