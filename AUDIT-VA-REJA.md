# Backend audit: nima qilindi va nima rejada

> Oxirgi yangilanish: 2026-11-22. Bu fayl keyingi sessiyalar (va dasturchilar) uchun:
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

**Ataylab qilinmagan:** `savePayment`, `clientNotSell` va `tolovSurildi` da mijoz egaligi tekshirilmaydi. Ilova agentga barcha mijozlarni ko'rsatadi, `saveSell` ham egalikni tekshirmaydi. Shu sababli tekshiruv qo'yilsa, haqiqiy oflayn to'lovlar rad etilardi. *(2026-11-24: `saveSell` endi tekshiradi — §5g; qolganlari o'zgarmadi.)*

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

## 5d. Agent va super agent modeli (2026-11-21)

Egasining qarori: mobil ilovada faqat **agent** va **super agent**. Batafsil (web uchun) — `FRONTEND-UCHUN.md` 16-bo'lim.

- **Migratsiyalar:** `20261121000001-agent-super-agent` (`agent.super_agent`, `agent.super_agent_id`; barcha agentlar `avtolavka=1`, standart true), `20261121000002-savdo-qaytarish` (`savdo_qaytarish`, `savdo_qaytarish_qator`, `mobil_id` UNIQUE).
- **Rollar** (`mobilRollar.utils.js`, `auth.controller.js`): agent → `asosiyRol:'agent'`, `rollar:['agent'(, 'super_agent')]`, `superAgent`, `viloyat`. `MOBIL_ROLLAR` da `agent` (yoki eski `avtolavka`) bo'lsa `super_agent` ham ochiq. Dostavchik login → 403.
- **Kuzatuv** (`mobileAuth`): `x-kuzat-agent: <id>` — faqat super agent, faqat o'ziga biriktirilgan faol agent, faqat GET; aks holda 403. `req.currentAgent` = kuzatilgan agent, `req.kuzatuv`, `req.superAgent`.
- **Mobil:** `avtolavkaSinxron` — faqat o'z mijozlari, `keyingiQadam` doim `savdo`, `naqdQolda` = bugungi naqd − bugungi naqd qaytarish (inkassatsiyaga bog'liq emas), yangi `brak`, `savdolar` (30 kun), `kuzatuv`, `agent.viloyat`. Yangi `GET agentlarim`, `POST savdoQaytarish`. `mijozCheklar` qaytarish yozuvlarini ham beradi. `mijozRuxsat` dan "avtolavka agentiga hamma mijoz" istisnosi olib tashlandi.
- **Qaytarish qoidasi:** ariza → qatorlar → tovar → mijoz qulf tartibi; sotuv summasi, qatorlar, `tolangan_summa`, `agent_register` kamayadi; naqd → kassa chiqimi `sotuv_qaytarish` (user_id=agent), qarz → `mijoz.balans += summa`. Qaytarishli sotuvni `sotuvBekor` rad etadi.
- **Brak:** agent brak ombori `"Agent: <ism> (brak)"` (`ombor.utils agentBrakOmbori/brakOmboriMi`); tahlil va dashboard qoldig'idan chiqarildi.
- **Sinov (lokal tz_yangi, 2026-11-21):** 55/55 HTTP tekshiruv (rollar, sinxron shakli, sotuv, yaroqli/yaroqsiz qaytarish ikkala to'lov turi bilan, ortiqcha → 400, takror va 3× parallel → 1 yozuv, begona → 403, super agent `agentlarim` va kuzatuv GET/POST/begona) + 14 ta web GET smoke (200).
- **Ochiq:** — (2026-11-24 da yopildi, §5g: qaytarishlar tarixi API'si, `saveSell` mijoz egaligi; chegirmali qaytarish qoidasi egasi tomonidan tasdiqlandi; `hisobot/inkassatsiya` — eski, tegilmaydi).

---

## 5e. Kassalar, plastik tasdig'i, agent naqd topshiruvi (2026-11-22)

Batafsil (web uchun) — `FRONTEND-UCHUN.md` 17-bo'lim; validatsiya — `API-VALIDATSIYA.md` 3.x "Kassalar".

- **Migratsiyalar:** `20261122000001-kassalar` (`kassalar`, `kassa_viloyat`; `kassa.kassa_id`, `kassa.agent_id` + indekslar), `20261122000002-plastik-topshiruv` (`plastik_tolov`, `pul_topshiruv`, `pul_audit`; `mobil_id` UNIQUE, `plastik_tolov.ariza_id` UNIQUE). Ikkalasi idempotent, `down()` + qayta `up()` sinalgan.
- **Model:** `kassa` jadvali — jurnal; `kassalar` — pul turadigan joy (naqd kassa / plastik karta, plastik ↔ viloyat ko'p-ko'p). Agent majburiyati = Σ naqd(kirim−chiqim | `agent_id`, `kassa_id` NULL) − Σ tasdiqlangan topshiruv. Kassa balansi = Σ jurnal(`kassa_id`) + Σ tasdiqlangan topshiruv. Topshiruv jurnalga yozilmaydi (ichki ko'chirish — dostavchik inkassatsiyasi qoidasi).
- **Plastik:** `plastik_tolov` 'kutilmoqda' → web tasdig'i: jurnal kirimi (`tolov_usul='karta'`, `manba_tur='plastik_tolov'`, `kassa_id`), mijoz balansi, sotuv bo'lsa `ariza.tolangan_summa`; rad/tahrir — sabab majburiy, `pul_audit`. Plastik sotuv: `ariza.tolov_turi='plastik'`, tasdiqgacha `tolangan_summa=0`. Qulf: ariza → plastik_tolov → mijoz; topshiruv: agent → topshiruv.
- **Eski ma'lumot:** eski jurnal yozuvlarida `agent_id`/`kassa_id` NULL — majburiyat migratsiyadan keyingi yozuvlardan sanaladi; eski agent `inkassatsiya` (kunlik) faqat tarix uchun qoladi, yangi yo'l — `pulTopshirish`.
- **Sotuv bekor (`sotuvBekor`):** kutilayotgan plastik avtomatik rad; tasdiqlangan plastik kirimi o'chirilmaydi (pul kartaga tushgan → mijoz haqi).
- **Sinov (lokal tz_kassa, 2026-11-22):** 89/89 HTTP tekshiruv (CRUD/validatsiya, viloyat bo'yicha kassalar, plastik qarz to'lovi/sotuv: kutilmoqda → tasdiq/rad/tahrir+audit, 3× parallel tasdiq → 1, takrorlar, aralash to'lov, naqd qaytarish chegarasi, topshiruv: ortiqcha 400, 3× parallel → 1, tasdiq/rad, kassa balansi, kuzatuv) + eski agent testi 55/55, 0 ta 5xx.
- **Ochiq:** — (2026-11-24 da yopildi, §5g. Boshlang'ich qoldiq kiritish — egasi bekor qildi; manfiy `qolda` — ataylab ruxsat).

## 5f. Chek rasmi va karta topshiruvi (2026-11-23)

Batafsil — `FRONTEND-UCHUN.md` §18, validatsiya — `API-VALIDATSIYA.md` §3.22.

- **Migratsiya:** `20261123000001-topshiruv-karta` — `pul_topshiruv.usul` ENUM(`naqd`,`karta`) default `naqd`, `pul_topshiruv.chek_rasm` (idempotent, `describeTable` tekshiruvi).
- **Mobil:** yangi `POST chekYuklash/` (multipart `chek`, `uploadKassa`) → `{chekRasm}`. Plastik to'lovda (`savePayment` qismi, `saveSell` to'langan qismi) `chekRasm` majburiy; yo'l `utils/agentPul.utils.chekRasmOl` da tekshiriladi (faqat `/uploads/kassa/`, `..` yo'q, fayl diskda bor). `savePayment` multipart `chek` fayli fallback sifatida qoladi. `pulTopshirish` `usul:'karta'` — agent viloyatidagi plastik kassa + chek.
- **Hisob:** karta topshiruvi naqd topshiruv bilan bir xil — tasdiqda majburiyat −summa, kassa balansi (`pul_topshiruv` orqali) +summa, jurnalga yozuv yo'q. Tasdiqda kassa tanlanmaydi (`kassa_id` e'tiborsiz).
- **Rasm saqlanishi:** rad/bekor/o'chirishda rasm o'chirilmaydi; yetim (ishlatilmagan) yuklangan rasmlarni tozalash yo'q (talab qilinmagan).
- **Sinov (lokal, 2026-11-23):** yangi `test-chek` 63/63 (yuklash ok/faylsiz/rasm emas/maydon/tokensiz, `..`/boshqa papka/yo'q fayl, savePayment va saveSell chek bilan/siz, multipart fallback, karta: kassasiz/cheksiz/naqd kassa/boshqa viloyat/enum, takror, web ro'yxat/filtr/detail, karta tasdiq → `qolda` −, plastik kassa +, rad — yozuv va rasm qoladi, naqd o'zgarmagan, `/uploads` GET 200); kassalar testi 91/91 (chekRasm qo'shildi), agent testi 55/55.
- **Ochiq:** — (2026-11-24 da yopildi, §5g).

## 5g. Egasi javoblari: fayl auth, web plastik sotuv, ruxsatlar, qaytarishlar tarixi (2026-11-24)

Batafsil — `FRONTEND-UCHUN.md` §19, validatsiya — `API-VALIDATSIYA.md` §3.23. Migratsiya yo'q.

- **Fayllar:** `/uploads/*` (kassa va audit) — faqat tizimga kirganlarga: web Bearer JWT yoki mobil `token` sarlavhasi (`middleware/faylAuth.middleware.js`, `auth()`/`mobileAuth()` qayta ishlatiladi), aks holda 401; `?token=` query qabul qilinmaydi. `cookieParser` + `i18n.init` `/uploads` dan oldinga ko'chirildi (xato xabari uchun `req.mf`). Web faylni blob qilib oladi, **barcha** fayllar havola sifatida ko'rsatiladi (inline rasm yo'q).
- **Chek turlari:** to'lov cheki (mobil `chekYuklash`, `savePayment` multipart, web `kassalar/chek-yuklash`) — oq ro'yxat: jpeg/png/webp/gif/heic/heif + pdf/doc/docx/xls/xlsx; 10 MB, 1 fayl; kengaytma MIME'dan (`octet-stream` — nom kengaytmasi oq ro'yxatda bo'lsa). `chekRasmOl` regex shu kengaytmalarni talab qiladi. Audit va xarajat cheki — faqat rasm (o'zgarmadi; xarajat `uploadKassa.rasm`).
- **Ruxsatlar:** `middleware/ruxsat.middleware.js` — `ruxsat(modul, ...amal)`, Admin/Programmer doim, aks holda `user.perms[modul]` (frontend `hasPerm` bilan bir xil), yo'q → 403 `Ruxsat yo'q`. `/api/v1/kassalar`: o'qish — `moliya.view`, kassa CRUD — `moliya.create`, plastik/topshiruv tasdiq-rad-tahrir — `moliya.approve`; `GET /agents/:id/pul` — `moliya.view`; `GET /avtolavka/qaytarishlar*` — `avtolavka.view`. `kassalar/chek-yuklash` — faqat auth. Boshqa routelar o'zgarmadi (6-bo'lim: umumiy rol tekshiruvi hali yo'q).
- **Web plastik sotuv:** `POST /avtolavka/sotuv` `tolov_usuli:'plastik'` + `kassa_id` (agent viloyati) + `chek_rasm` (yoki multipart `chek`) → `createAriza` orqali mobil `saveSell` bilan aynan bir yo'l (`plastik_tolov` 'kutilmoqda', tasdiq oqimi o'zgarmagan). `sotuv/tayyor` — `plastik_kassalar`. Javobda `tolov_usuli`, `plastik`.
- **Qaytarishlar tarixi:** `GET /avtolavka/qaytarishlar` (dan/gacha/agent/mijoz/viloyat, sahifa, jami naqd/balansga) va `/:id` (qatorlar, yaroqli/yaroqsiz).
- **Qaytarish narxi (tekshirildi, o'zgartirilmadi):** summa = sotuv qatorining narxi × miqdor (oxirgi dona — qatorning qolgan summasi, yaxlitlash qolmasin); sotuv chegirmasi taqsimlanmaydi; sotuv jami 0 dan pastga tushmaydi (summa qolgan jamiga qisqaradi).
- **`saveSell` mijoz egaligi:** `shared.mijozRuxsat` (o'z mijozi, marshrut rejasi, shu agentning avvalgi hujjati) + super agent — biriktirilgan agentlarining mijozlari. Aks holda 403 `Bu mijoz sizga biriktirilmagan`. Takror `mobilId` tekshiruvdan oldin qaytadi. 2026-11-20 da `savePayment` tekshiruvi qaytarilgan edi, chunki o'shanda ilova agentga **barcha** mijozlarni ko'rsatardi (avtolavka istisnosi, 2026-11-21 da olib tashlangan) — oflayn to'lovlar rad etilardi. `savePayment` ga hozir ham qo'yilmadi. `savdoQaytarish` — sotuv agentniki ekanligi tekshiriladi, alohida mijoz tekshiruvi ortiqcha.
- **`mijozCheklar`:** `tur:'plastik'` yozuvlari (`holat`/`tolovHolat` `kutilmoqda|tasdiqlangan|rad_etildi`, `summa`, `jami`, `kassaNomi`, `kassaId`, `chekRasm`, `radSababi`, `sabab`, `plastikTur`, `savdoId`, `savdoRaqam`, `tasdiqVaqt`, `qatorlar:[]`); plastik sotuv chekida `tolovHolat`, `plastikId`, `sabab`; tasdiqlangan plastik endi `tolov` sifatida takrorlanmaydi, `jami.tolovSumma` uni sanaydi; yangi `jami.kutilmoqdaPlastik`.
- **Saqlangan qoidalar (egasi tasdiqladi):** topshiruv tasdig'i `qolda` dan oshsa rad; web plastik tahririda viloyat tekshirilmaydi; `qolda` manfiy bo'lishi mumkin; distributsiya zakazi agentga biriktirilmaydi.
- **Bekor qilindi:** agent boshlang'ich qoldig'i (egasi qarori) — kod va migratsiya yo'q.
- **Eski inkassatsiya:** `hisobot/inkassatsiya` (kunlik) — legacy, tegilmadi: kunlik topshiruv endi yo'q, agent istalgan vaqtda `pulTopshirish` qiladi. Ochiq masala yopildi.
- **Sinov (lokal, 2026-11-24):** yangi `test-javoblar` 94/94 (fayl auth: tokensiz/yaroqsiz/query 401, web va mobil 200, `..`, audit; web chek-yuklash rasm/PDF/html/tokensiz; plastik web sotuv: kassasiz/cheksiz/boshqa viloyat/naqd kassa/`..`/qarz/sklad/enum, JSON va multipart, takror, tasdiq; ruxsatlar: ruxsatsiz/view/create/approve foydalanuvchilar bilan har amal; topshiruv ortiqcha → 400, manfiy `qolda`; chegirmali qaytarish narxi va 0 chegarasi; saveSell begona/o'z/marshrut/super agent/o'tkazilgan mijoz, savePayment tekshiruvsiz; qaytarishlar tarixi filtr/sahifa/detail/ruxsat; mijozCheklar plastik), `test-chek` 72/72 (PDF/xlsx/octet-stream qabul, html/exe/svg rad, `/uploads` auth), `test-kassa` 91/91, `test-agent` 55/55; 0 ta 5xx.

---

## 5h. Viloyat narxlari (2026-11-25)

Batafsil — `FRONTEND-UCHUN.md` §20, validatsiya — `API-VALIDATSIYA.md` §3.24. Migratsiya `20261125000001-tovar-viloyat-narx.js`.

- **Jadval** `tovar_viloyat_narx` (tovar × viloyat: `chakana_narx`, `optom_narx`, `user_id`, `user_nomi`), UNIQUE, FK CASCADE. `agent.narx_ozgartirish` (standart 0) → mobil `editPrice` (avval har agentga `true`).
- **Ustunlik** (`utils/narx.utils.js` `agentNarxXaritasi`): agentning viloyati bo'lsa toifa ro'yxati → agent viloyati narxi (`narx_turi`) → sotilmaydi. Viloyatsiz agent va sklad — eski `narxXaritasi` (toifa → standart → eski), o'zgarmagan.
- **Web xodim nomidan sotuv:** server narxi ustun, so'rovdagi `narx` e'tiborsiz; narx yo'q → 400. `sotuv/tayyor` — `viloyat`, `viloyat_qoida`, `sotiladi`.
- **Mobil:** `avtolavkaSinxron`/`agentSinxron` `narx.viloyat`, `viloyatId`, `viloyatQoida`; `mijozNarxlari` agent viloyati bilan. `saveSell` — oflayn narx qabul qilinadi (o'zgarmagan, qayta hisoblanmaydi).
- **Demo:** `scripts/demo/seed-demo.js` — demo viloyatida hamma tovarga chakana = sotuv narxi, optom ≈ 95%.
- **Diqqat (joriy bazalar):** migratsiyadan keyin viloyati bor agentlar narx kiritilmaguncha web'da xodim nomidan sota olmaydi, ilova (yangi versiya) ham sotmaydi — ishga tushirishdan oldin viloyat narxlarini kiritish kerak. `editPrice` hamma agentda `false` bo'lib qoladi — kerakli agentlarga `narx_ozgartirish` qo'yilsin.
- **Sinov (lokal):** yangi `test-narx`; `test-javoblar` viloyat narxlari bilan to'ldirildi (aks holda web plastik sotuv 400).

## 5i. Agentdan agentga ko'chirish (2026-11-26)

Batafsil — `FRONTEND-UCHUN.md` §21, validatsiya — `API-VALIDATSIYA.md` §3.25. Migratsiya `20261126000001-agent-kochirish.js`.

- **Jadvallar** `agent_kochirish` (KO-000001, kimdan/kimga, holat faol|bekor, `sorov_id` UNIQUE), `agent_kochirish_qator` (dona, tannarx), `agent_kochirish_audit` (yaratildi/tahrirlandi/bekor_qilindi, eski→yangi JSON, sabab, kim, vaqt). `tovar_register.manba_tur` ga `'agent_kochirish'` (manba_id = hujjat id) — eski `'kochirish'` (tur o'zgarishi, manba_id = tovar id) bilan aralashmaydi.
- **Qoida:** operator web'da, istalgan ikki agent, faqat sotiladigan ombor ↔ sotiladigan ombor (brak, asosiy sklad emas), darhol. Yuboruvchi nofaol bo'lishi mumkin, qabul qiluvchi faol. Tahrir — delta (ikki tomonda qoldiq tekshiriladi), bekor — teskari yozuv (qabul qiluvchida yetishi shart). Yozuvlar o'chirilmaydi.
- **Ruxsat:** yangi `ruxsat.biri([[modul, amal], …])` (`middleware/ruxsat.middleware.js`) — bir nechta moduldan biri yetarli; eski `ruxsat(modul, …amallar)` o'zgarmagan. ✅ 2026-11-27 (egasi qarori B): yozish ruxsati o'qishni ham beradi — ro'yxat/tafsilot/`agent-qoldiq` uchun `avtolavka` view|create yoki `ombor` view|edit.
- **Savdo emas:** agent_register, kassa, KPI, plan-fakt, tahlil sotuv/kirim — tegilmaydi (testda tekshirildi). `tahlil.utils.KOCHIRISH_MANBA` (yuklash, qabul, kochirish, agent_kochirish) — tahlil/ombor va jurnal ichki harakat sifatida ko'radi. `kunHisobla` — `tovar.kochirish {kirim, chiqim}` balansga kiradi (solishtirma kamomad ko'rsatmaydi), voqealarda `kochirish`.
- **Mobil:** `avtolavkaSinxron.kochirishlar` (30 kun, ikki yo'nalish), kuzatuvda ham.
- **Ochiq savol:** oflayn mobil sotuv — agent oflayn sotgan tovar shu orada boshqa agentga ko'chirilgan bo'lsa, `saveSell` (avtolavka) qoldiqni har doim tekshiradi va 400 `"<tovar>" mashinada yetarli emas` bilan **rad etadi** (oflayn ham) — tovar mijozga topshirilgan bo'lsa ham sotuv yozilmaydi. Hozircha o'zgartirilmadi; operatorga ko'chirishdan oldin agent bilan kelishish tavsiya etiladi.
- ✅ **`hisobot/*` va ichki harakatlar (2026-11-27, egasi qarori A):** kompaniya bo'yicha kirim/chiqim aylanmasi endi `KOCHIRISH_MANBA` (yuklash, qabul, kochirish, agent_kochirish — tahlil.utils, yagona manba) yozuvlarisiz: `ombor-kpi` (davr kirim/chiqim, aylanish, harakatsiz), `ombor-trend`, `ombor` (davr chiqimi; yangi `ichki_kirim_dona/ichki_chiqim_dona`), `ombor-aylanish` (tez sotiladigan/harakatsiz), `register-kpi` (ombor filtrisiz; `ombor` berilsa ichki qo'shiladi — ombor balansi; yangi `ichki`, `ichki_hisobda`), `tovar-hisobot` va `sotuv-hisobot` (o'rtacha kirim narxi). Ombor qoldiqlari (`qoldiqlar`, `ombor.qoldiq_*`, `ombor-kpi.qoldiq_*`, FIFO) — barcha harakat bilan, o'zgarmagan. `partiya-qoldiqlar` — ichki kirim (masalan qabul) shu ombor chiqimidan ayriladi (avval qaytgan tovar partiya qoldig'idan tushib qolardi). O'zgarmagan: `umumiy`/`oylik-trend`/`turkum`/`top-tovarlar` (faqat prixod), `register`, `ombor-jurnal`, `qoldiqlar/:id/detail` (ro'yxatlar). Batafsil — `FRONTEND-UCHUN.md` §11.
- **Sinov (lokal):** `test-kochirish` (149 tekshiruv: ruxsat B, hisobot A — yuklash+ko'chirish+qabul kompaniya kirim/chiqimini o'zgartirmaydi, prixod/sotuv o'zgartiradi, ombor balanslari register bilan mos).

## 5j. Xarajat limiti (2026-11-27)

Batafsil — `FRONTEND-UCHUN.md` §22, validatsiya — `API-VALIDATSIYA.md` §3.26. Migratsiya `20261127000001-xarajat-limit.js`.

- **Model:** `user.xarajat_limit` (NULL — cheksiz, 0 — hammasi tasdiqqa; faqat role `User`); jadval `xarajat_sorov` (kutilmoqda → tasdiqlangan | rad_etildi | bekor, `kassa_yozuv_id`, `sorov_id` UNIQUE). Audit — `pul_audit`.
- **Qoida:** bitta xarajat summasi limiti, toifa/usuldan qat'i nazar. Oshsa — so'rov (jurnalga yozilmaydi). Har yangi xarajat `kassa_id` bilan (faol), balansdan oshmasin (yaratishda ham, tasdiqda hal qiluvchi). Tasdiqlovchi — Admin/Programmer yoki `moliya.approve`; User o'zinikini tasdiqlay olmaydi. Limitni faqat Admin qo'yadi (Programmer — role/perms kabi, yo'q). Kassa sahifasidagi qo'lda chiqim ham limit bilan cheklangan.
- **Eski ma'lumot:** kassa_id siz eski xarajatlar o'zgarishsiz ishlaydi (tahrirda kassa majburiy emas).
- **Yopilgan savollar (egasi qarori, FRONTEND-UCHUN §22.14):**
  - ✅ (1) Tasdiqlangan so'rovning jurnal yozuvini o'chirish **taqiqlandi** — `DELETE /xarajatlar/:id` va `DELETE /kassa/:id` → 400 `Bu xarajat tasdiqlangan so'rov orqali yozilgan — o'chirib bo'lmaydi`. Tahrir avvalgidek ruxsat (limit qoidalari bilan). Boshqa o'chirish yo'llari xarajat yozuviga tegmaydi (sotuv bekor, prixod bekor, ishlab, qarz oldi-berdi — faqat o'z `manba_tur` yozuvlari).
  - ✅ (2) Kassadan chiqim oqimlari kassa balansini tekshiradi (`kassa_id` bilan yozilganda): `POST /kassa` chiqim, `POST /yetkazuvchilar/:id/tolov`, `PATCH /prixod/:id/tasdiq` (oldindan to'lov), `POST /uchinchi-shaxslar/:id/harakat` (`qarz_berdik`, `qaytardik`). Oxirgi uchtasiga **ixtiyoriy** `kassa_id` qo'shildi (majburiy emas — yuborilmasa avvalgidek kassasiz `naqt`). Yagona yordamchi `agentPul.utils` `ixtiyoriyKassa` / `kassaQulfla` / `kassaBalansTekshir` (xarajat controller'dagi nusxa olib tashlandi), kassalar qatori `FOR UPDATE` — tranzaksiyadagi birinchi o'qish.
  - **Ataylab tekshirilmaydi** (tizim oqimlari, bloklanmasin): mobil `savdoQaytarish` / avtolavka qaytarish naqd chiqimi (agent qo'lidagi pul, `kassa_id` NULL, majburiyat), sotuv bekor (`sotuvBekor` — jurnal yozuvlarini o'chiradi), dostavchik inkassatsiya/kassa-qabul (`kassa_id` siz), ishlab chiqarish yakuni (`ishlab_chiqarish` chiqimi `kassa_id` siz; kassalar tanlovi yo'q — kerak bo'lsa alohida ish), plastik tasdiq / topshiruv (kirim).
  - ✅ (3) Egalik — egasi qarori: o'zgarishsiz (har kassir boshqaning xarajatini tahrirlay/o'chira oladi; tasdiqlangan so'rov yozuvi bundan mustasno — o'chirilmaydi).
  - ✅ (2026-11-28, egasi qarori 25) Kirim yozuvini o'chirish (`DELETE /kassa/:id` kassali kirim, qarz oldi-berdi `qaytardi`/`qarz_oldik` harakatini o'chirish) kassa balansini minusga tushira olmaydi — 400 `Kassa balansi manfiy bo'lib qoladi (balans X, o'chiriladigan Y)`, kassa qatori qulflanadi (`agentPul.utils.kassaKirimKamayTekshir`). Kirimni tahrirlash/ko'chirish endpointi yo'q; sotuv bekor yozuvlari `kassa_id` siz. FRONTEND-UCHUN §22.15. Sinov: `test-balans` C bo'limi (80 tekshiruv jami).
- **Sinov (lokal):** `test-xarajat` (87 tekshiruv), `test-balans` (61: har oqim — balansdan oshsa 400, ichida 200/201, `kassa_id` siz — avvalgidek; 11 juft parallel chiqim — faqat bittasi o'tadi; tahrir; o'chirish taqiqi).

## 5k. Buyumlar — sotilmaydigan jihozlar (2026-11-28)

Batafsil — `FRONTEND-UCHUN.md` §23, validatsiya — `API-VALIDATSIYA.md` §3.27. Migratsiya `20261128000001-buyumlar.js`.

- **Model:** `buyum` (katalog), `buyum_harakat` (o'zgarmas jurnal, `BH-000001`, `mobil_id`/`sorov_id` UNIQUE), `buyum_harakat_qator` (butun `dona > 0`). Qoldiq jadvali yo'q — kompaniya/agent/mijoz qoldig'i jurnaldan SQL bilan.
- **Qarorlar (egasi + koordinator):** faqat soni; narx/holat/hisobdan chiqarish yo'q; harakat tahrirlanmaydi/bekor qilinmaydi (teskari harakat); qoldiq manfiy bo'lmaydi (buyum qatorlari `FOR UPDATE`); mijozga — faqat ruxsatli mijozga (`shared.sotuvMijozRuxsat`, saveSell bilan bir xil); mijozdan — mijozda bo'lsa (kim bergani muhim emas); ruxsatlar — yozish `avtolavka.create|ombor.edit`, o'qish `avtolavka.view|create, ombor.view|edit`, katalog `ombor.edit`.
- **Shu ish doirasidagi qarorlar:** `agentga` oluvchisi ham faol bo'lishi shart; faol emas buyum mobil `mijozdan` bilan ham qaytarilishi mumkin; faol emas mijozga berib bo'lmaydi; mobil `mobilId` majburiy; sinxron `katalog` ga `faol` maydoni qo'shildi; `agentSinxron` ham `buyumlar` oladi; javobdagi id'lar son.
- **Sinov (lokal):** `test-buyum` (103 tekshiruv).

## 5l. Dillerlar (2026-11-29)

Batafsil — `FRONTEND-UCHUN.md` §24, validatsiya — `API-VALIDATSIYA.md` §3.28. Migratsiya `20261129000001-diller.js` (idempotent).

- **Model:** diller = agent (`agent.diller`). Ombori `"Diller: <ism>"` (+ `" (brak)"`) — `ombor.utils.sotuvOmbori/brakOmbori`. `diller_hujjat` (DL-000001: berish | tolov | qaytarish, tahrirlanmaydi), `diller_hujjat_qator`, `diller_narx` (mobil narx ro'yxati), `diller_pul` (dillerning o'z pul daftari — kontraktga qo'shimcha jadval). Qarz = Σ berish(jami − tolangan) − Σ tolov − Σ qaytarish.
- **Kompaniya zaxirasidan chiqarish:** `TovarRegisterModel` **defaultScope** (`ombor NOT LIKE 'Diller: %'`, `whereMergeStrategy: 'and'`) — barcha Sequelize so'rovlari; xom SQL'da qo'lda (tahlil ombor/sotuv/jurnal, dashboard qoldiq/ogohlantirish/sparkline, ariza spravochnik qoldig'i, mobil `getProductSell` umumiy qoldig'i). Diller kodi xom SQL / `unscoped()` (`avtolavka.utils.omborQoldiq` endi unscoped).
- **Berish = kompaniya sotuvi:** ariza `turi='sotish'`, `kanal='diller'`, mijozsiz/agentsiz (`mijoz_nomi "Diller: <ism>"`), asosiy ombordan register `sotuv` (manba_id = ariza). Diller omboriga `diller_berish`. To'lov — kassa kirimi `diller_tolov` (tizim kategoriyasi). Bekor qilish taqiqlangan (`sotuvBekor.utils`).
- **Diller sotuvi:** ariza `turi='diller_sotuv'` — kompaniya hisobotlari `turi='sotish'` bo'yicha bo'lgani uchun avtomatik chiqadi; `arizaYetkazildiEffektlari` chaqirilmaydi (kassa/agent_register yo'q), reyting/plastik navbati yo'q, lat/lng yozilmaydi. Mijoz qarzi `mijoz.balans`; kompaniya debitorligidan `DILLER_MIJOZ_EMAS` bilan chiqarilgan.
- **Chiqarilgan joylar:** dashboard (debitorlik, muddati o'tgan, top qarzdorlar, mijozlar soni/yangi/holat/qayta jalb, faol agentlar, reja, top agentlar, ombor qoldig'i/salomatlik/kam qoldiq/sparkline), tahlil (ombor qoldig'i, zaxira kuni, tovarlar qoldig'i, ombor harakati, jurnal va omborlar ro'yxati, qarzlar, reyting, xodim/sotuv/qarzlar agent ro'yxatlari), hisobot (register asosidagi hammasi — scope; agent-savdo, agentlar, agent-online, agent-marshrut, monitoring), `agents/statistika`, `kassalar/agentlar`, navbat agent soni, arizalar ro'yxati/statistikasi, Won Sell agentlar/doska/kalendar, `mijozlar?qarzdor=1`, `mijozlar/reyting/xulosa`.
- **Qarorlar (koordinator/egasi):** to'lov qarzdan oshmaydi (diller qatori qulfi bilan); qaytarish narxi — oxirgi berish qatori narxi; berish qator narxini operator tahrirlay oladi; bayroq yoqish/olish uchun izlar tozalangan bo'lishi kerak; diller faqat o'z mijozi bilan ishlaydi, boshqa agent diller mijozi bilan ishlamaydi.
- **Ochiq:** dillerdan qaytarish kompaniya sotuv hisobotidagi berish summasini kamaytirmaydi; diller qarzi kompaniya debitorligiga qo'shilmagan; diller brak omboridagi tovarni kompaniyaga qaytarish oqimi yo'q. Ochiq hisobli mijozni kompaniya ↔ diller o'rtasida o'tkazish (`PATCH /mijozlar/:id agent_id`) → 400 (shu ish doirasidagi qaror).
- **Sinov (lokal):** `test-diller` (164 tekshiruv), qolgan barcha skriptlar yashil.

## 6. Ataylab qoldirilganlar
| Masala | Sabab |
|---|---|
| **Rol va `perms` server tomonda tekshirilmaydi** (2026-11-24 dan istisno: `/kassalar`, `/agents/:id/pul`, `/avtolavka/qaytarishlar` — §5g). Har qanday User kassa jurnalini o'chira oladi, prixodni tasdiqlaydi va bekor qiladi, narxni o'zgartiradi | Egasi "hozircha tegmaslik" deb qaror qildi (2026-11-18). `perms` kalitlari formati faqat frontendda ma'lum |
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
