# Backend o'zgarishlari — web frontendni moslashtirish uchun

> Kimga: web panel (frontend) dasturchisi va uning AI agenti.
> Sana: 2026-11-19. Backend commit: `271f0f8` (`main`). Solishtirilgan versiya: `6f077de`.
> To'liq API hujjati: `BACKEND_API_DOC.md`. Xatolar auditi: `AUDIT-VA-REJA.md`.

## Agent uchun ko'rsatma

Frontend kodida quyidagi har bir bandni toping va moslang. Har bir bandda: **endpoint → nima o'zgardi → frontendda nima qilish kerak**.

- Javob formatlari (`count/rows/page/pages`, `data/total/page/pages`) **o'zgarmagan**, agar bandda boshqacha yozilmagan bo'lsa.
- O'zgarishlarning aksariyati qat'iyroq tekshiruv. Avval jim o'tib ketgan yoki 500 bergan so'rov endi **400/403/409** qaytaradi. Frontend bu xabarni foydalanuvchiga ko'rsatishi kerak.
- Ish tugagach, oxirdagi "Tekshirish ro'yxati" bo'yicha qo'lda sinang.

---

## 1. Server manzili (yangi)

Backend serverga joylandi:

```
API:  http://201.51.11.98:3022/api/v1
```

- Frontend `.env` / config'dagi API manzilini shunga moslang.
- CORS barcha origin'lar uchun ochiq.
- HTTPS va domen hali sozlanmagan. Ular sozlangach, manzil o'zgaradi.
- Login ma'lumotlarini loyiha egasidan oling. `Admin` standart paroli almashtiriladi.

---

## 2. Umumiy: xato javoblari va status kodlar (hamma sahifaga ta'sir qiladi)

Web xato javobi formati:

```json
{ "type": "error", "status": 400, "message": "…", "errors": [ { "msg": "…", "param": "maydon", "location": "body" } ] }
```

`errors` faqat validatsiya xatolarida keladi.

| Holat | Avval | Endi | Frontendda |
|---|---|---|---|
| Joi validatsiya xatosi (formada noto'g'ri maydon) | **500** | **400**, `message` + `errors[]` | 400 da `errors[].msg` ni tegishli maydon (`param`) yonida, aks holda `message` ni ko'rsating |
| Buzuq JSON body | 500 | 400 | — |
| Token yo'q / yaroqsiz / muddati o'tgan | 401 | 401 (o'zgarmadi) | Logout — avvalgidek |
| Token to'g'ri, lekin **rol yetarli emas** | **401** | **403** | **403 da logout QILMANG.** "Bu amal uchun ruxsat yo'q" xabarini ko'rsating. Agar interceptor hamma 401/403 da logout qilsa — ajrating |
| Bir vaqtda ikki kishi bir hujjatni o'zgartirdi | — | **409** (prixod) | "Hujjat o'zgardi — sahifani yangilang" xabari, ma'lumotni qayta yuklash |
| Server ichki xatosi (production) | SQL matni bilan | Faqat `"Something went wrong"` (tarjima qilingan) | 500 xabar matniga tayanmang |
| Unique to'qnashuv (masalan login band) | 500 | 400, `errors[].param` = maydon | Maydon yonida ko'rsating |

**Ikki marta bosish:** pul yoki tovarni o'zgartiruvchi amallar endi serverda qulf bilan himoyalangan. Takroriy so'rov ikkinchi marta qo'llanmaydi, 400 yoki 404 qaytaradi. Shunday amallar:
- kassa o'chirish;
- ariza holati;
- prixod tasdiq/bekor;
- avtolavka yuklash/qabul;
- sotuvni bekor qilish.

Shunga qaramay, so'rov ketayotganda bu tugmalarni `disabled` qiling.

---

## 3. Foydalanuvchilar — `/api/v1/users`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `POST /users` | Endi **faqat Admin** (Bearer token majburiy). Avval auth'siz edi | "Foydalanuvchi qo'shish" so'rovi token bilan ketsin. Tugma/sahifa faqat `role === 'Admin'` ga ko'rinsin |
| `PATCH /users/id/:id` | Admin — istalgan foydalanuvchini tahrirlaydi. Boshqa rol — **faqat o'zini**, boshqa id → **403** | Profil sahifasi faqat joriy foydalanuvchi id'si bilan |
| ↑ (Admin bo'lmagan) | `role` ni o'zgartirish yoki **`perms` maydonini yuborish (o'zgarmagan bo'lsa ham) → 403** | Admin bo'lmagan foydalanuvchining o'z profilini saqlashda body'dan `role` va `perms` ni **olib tashlang** |
| ↑ (hamma) | `perms` yuborilmasa — **o'zgarmaydi**. Avval `null` bo'lib ketardi | Faqat ruxsatlar tahrirlanganda `perms` yuboring |

---

## 4. Arizalar (buyurtmalar) — `/api/v1/arizalar`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `PATCH /arizalar/:id` | Faqat holat `yangi`, `tasdiqlangan`, `yigilmoqda` bo'lsa tahrirlanadi. `yolda`, `yetkazildi`, `bekor` → 400 | Shu holatlarda "Tahrirlash" tugmasini yashiring/bloklang |
| ↑ | `turi` (sotish/qaytarish/almashtirish) o'zgartirilsa → 400 | Tahrir formasida turi maydoni faqat o'qish uchun |
| ↑ | Yuborilmagan maydon endi **o'zgarmaydi**. Avval `turi` → `sotish`, chegirma → 0 bo'lib qolardi | Qisman PATCH xavfsiz. Faqat o'zgargan maydonlarni yuborish mumkin |
| ↑ | Ruxsat etilgan maydonlar: `turi, mijoz_id, mijoz_nomi, agent_id, agent_nomi, chegirma_foiz, chegirma_summa, bonus_summa, tolov_turi, ombor, ekspeditor, jonatish_sana, izoh, qatorlar`. Boshqa maydon → **400** | Body'ga boshqa maydon (`id`, `holat`, `jami_summa`, `createdAt`...) qo'shmang |
| `POST` va `PATCH` | Qatorda **blok=0 va dona=0** → 400. Manfiy narx/miqdor → 400. Chegirma buyurtma summasidan katta → 400 | Formada: miqdor > 0, narx ≥ 0, chegirma ≤ jami (oldindan tekshiring) |
| ↑ | `tolangan_summa`, `dostavchi_id`, `yetkazilgan_sana`, `trip_sheet_id` va boshqa ichki maydonlarni klient yozolmaydi — **jim e'tiborsiz qoldiriladi** | Dostavchini tayinlash — holat o'zgartirish oqimi orqali (avvalgidek). Bu maydonlarni create/update formasidan olib tashlang |
| ↑ | Tahrirda summa oshsa, mijoz o'zgarsa yoki naqddan qarzga o'tilsa — kredit limiti qayta tekshiriladi (400 + xabar) | Xabarni ko'rsating |
| `PATCH /arizalar/:id/holat` | `qaytarish` turidagi ariza sotuv jarayonidan (`yolda`/`yetkazildi`) o'tmaydi → 400 | Qaytarish arizasida holat tugmalari o'rniga **"Qabul qilish"** (`PATCH /arizalar/:id/qabul`) |
| `GET /arizalar` | `limit` max **500**. `all=true` → eng yangi **5000** ta | Katta eksport kerak bo'lsa sahifalab oling |

---

## 5. Mijozlar — `/api/v1/mijozlar`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `PATCH /mijozlar/:id` | Faqat shu maydonlar yoziladi: `nomi, yuridik_nomi, telefon, telefon2, manzil, mo_ljal, territoriya_id, kategoriya_id, agent_id, sinf, narx_turi, inn, shartnoma_raqam, shartnoma_sana, hisob_raqam, bank, mfo, tashrif_kunlari, tashrif_chastota, lat, lng, kredit_limit, tolov_muddati_kun, izoh, faol, boshlangich_balans, boshlangich_sana, boshlangich_izoh`. **`balans`, `reyting*` va boshqa tizim maydonlari e'tiborsiz qoldiriladi** | Formada `balans` ni tahrirlash maydoni bo'lsa — olib tashlang (qarz faqat to'lov/savdo orqali o'zgaradi) |
| ↑ | Tahrirda standart qiymat yo'q: `narx_turi` va `faol` yuborilmasa o'zgarmaydi. Avval `chakana`/`true` ga qaytardi | Qisman PATCH xavfsiz |
| `GET /mijozlar/:id/oldi-berdi` | `dan`, `gacha` faqat `YYYY-MM-DD` formatida, aks holda 400 | Sana tanlagich qiymatini `YYYY-MM-DD` ko'rinishida yuboring |
| `GET /mijozlar` | `limit` max **1000** | — |
| `POST /mijozlar/import` (Excel) | `"1.250.000"` → 1250000 (avval 1.25 edi). Nom bo'yicha moslash faqat telefon bo'lmaganda | O'zgartirish kerak emas — import natijasini qayta tekshiring |

---

## 6. Kassa — `/api/v1/kassa`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `POST /kassa` | **Tizim kategoriyalari qo'lda kiritilmaydi → 400:** `sotuv, dostavchik_inkassatsiya, yetkazuvchi_tolov, ishlab_chiqarish, qarz_berildi, qarz_qaytdi, qarz_olindi, qarz_qaytarildi` | Kassa formasidagi kategoriya ro'yxatidan shularni **olib tashlang**. Ular o'z bo'limlarida yaratiladi (yetkazuvchiga to'lov, inkassatsiya, qarz oldi-berdi, ishlab chiqarish) |
| ↑ | Kategoriya va `tur` mos bo'lishi shart. Masalan `mijoz_tolov` faqat `kirim`, `xarajat` faqat `chiqim` | Kategoriya tanlanganda `tur` ni avtomatik qo'ying va bloklang |
| ↑ | `mijoz_tolov` da `mijoz_id` majburiy | Mijoz tanlanmasa saqlashga yo'l qo'ymang |
| ↑ | Foydalanuvchi qo'shgan xarajat toifasi — faqat `chiqim` | — |
| ↑ | `summa` > 0 va raqam. Sana noto'g'ri → 400 | — |
| `DELETE /kassa/:id` | Parallel o'chirish himoyalangan. Ikkinchi so'rov 404 | Tugmani so'rov vaqtida bloklang, 404 da ro'yxatni yangilang |

---

## 7. Tovarlar — `/api/v1/tovar`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `DELETE /tovar/:id`, `DELETE /tovar/bulk` | **Tarixi bor** tovar (kirim/sotuv bo'lgan) **yumshoq o'chiriladi**: ro'yxatdan yo'qoladi, hisobotlardagi tarix saqlanadi. Tarixsiz tovar butunlay o'chadi | Tasdiqlash oynasi matni: "Tovar ro'yxatdan olib tashlanadi, tarixi saqlanadi" |
| `DELETE /tovar/bulk` | `ids` noto'g'ri/bo'sh → 400 | — |
| `GET /tovar` | `limit` max **1000** | — |

---

## 8. Prixod (kirim) — `/api/v1/prixod`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `PATCH /prixod/:id` | Tasdiqlangan hujjat → 400. Shu payt boshqa kishi tasdiqlagan bo'lsa → **409** | 409 da: "Hujjat hozirgina tasdiqlandi — sahifani yangilang" va qayta yuklash |
| `POST`, `PATCH` | Manfiy narx/miqdor → 400. **Qator `summa` si serverda `narx × donada` qilib qayta hisoblanadi** — klient yuborgani ishlatilmaydi | Ekrandagi summa serverdagi bilan bir xil hisoblansin |
| `PATCH /prixod/:id/tasdiq` | Javobga `qatorlar` qo'shildi | Javobdan qatorlarni ham yangilash mumkin |
| `PATCH /prixod/:id/bekor` | Hujjat tovari allaqachon sotilgan bo'lsa → 400 va qaysi tovar yetmasligi xabarda | Xabarni to'liq ko'rsating |
| `GET /prixod` | `limit` max **500** | — |

---

## 9. Trip sheet — `/api/v1/trip-sheet`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `POST /trip-sheet`, `POST /trip-sheet/:id/arizalar` | `ariza_idlar` majburiy, musbat butun sonlar. Topilmagan id → 404. Holati mos emas yoki boshqa faol trip sheet'da → 400 (xabarda ariza nomlari). Sana `YYYY-MM-DD` | Ariza tanlash ro'yxatida faqat mos holatdagi, boshqa trip'ga biriktirilmaganlarni ko'rsating |
| `POST /trip-sheet/:id/arizalar` | Yakunlangan trip sheet'ga qo'shib bo'lmaydi → 400 | Yakunlangan trip'da "Ariza qo'shish" tugmasini yashiring |

---

## 10. Yetkazuvchilar — `/api/v1/yetkazuvchilar`

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `POST /yetkazuvchilar/:id/tolov` | `summa` > 0. `sana` ISO (`YYYY-MM-DD`) yoki bo'sh, noto'g'ri bo'lsa 400 | Sana formatini tekshiring |
| `GET …/harakatlar` | `limit` max 500 | — |

---

## 11. Hisobotlar — `/api/v1/hisobot`

**Kunlar endi Toshkent vaqti (UTC+5) bo'yicha ajratiladi.** Avval UTC edi, shuning uchun 00:00–05:00 oralig'idagi yozuvlar oldingi kunga tushardi. Ba'zi kunlik raqamlar avvalgidan biroz farq qilishi mumkin; bu tuzatish.

| Endpoint | O'zgarish | Frontendda |
|---|---|---|
| `GET /hisobot/sotuv-hisobot` | Sana berilmasa — **oxirgi 90 kun**. Davr max **366 kun** (oshsa 400) | Standart davrni UI'da ko'rsating. Katta davrni bo'lib so'rang |
| `GET /hisobot/ombor-trend` | `date_from`/`date_to` `YYYY-MM-DD`. Standart — oxirgi 30 kun. Max 366. `date_from > date_to` → 400 | — |
| `POST /hisobot/marshrut-reja/generate` | `from`/`to` `YYYY-MM-DD`. Bir martada max **62 kun** | Sana oralig'ini 62 kun bilan cheklang |
| `POST /hisobot/marshrut-reja` | Bir kunga max 1000 mijoz. `sana` `YYYY-MM-DD` | — |
| `GET /hisobot/agent-monitoring` | Sana parametrlari faqat `YYYY-MM-DD` (avval SQL injection bor edi) | Sana formatini tekshiring |
| `POST /hisobot/inkassatsiya` | `summa` ≥ 0 raqam. `sana` `YYYY-MM-DD` | — |
| Qoldiq/harakat ro'yxatlari | `limit` max 500 | — |

---

## 12. Agentlar va boshqa

- **`PATCH /api/v1/agents/:id`:** faqat formadagi maydonlar yoziladi. `token`, `dual_role`, `linked_dostavchi_id` so'rovdan yozilmaydi. `faol` yuborilmasa o'zgarmaydi (avval `true` ga qaytardi).
- **Yuklangan fayllar (`/uploads/...`):**
  - endi `Content-Security-Policy: sandbox` va `nosniff` bilan beriladi;
  - `<img src>` da rasm avvalgidek ko'rinadi;
  - faylni `<iframe>` ichida ochish yoki skript sifatida ishlatish ishlamaydi;
  - faqat rasm turlari qabul qilinadi.

---

## 13. Mobil ilova bilan bog'liq (web panelga yangi imkoniyatlar)

Yangi Flutter mobil ilova (agent, avtolavka, dostavchik) shu backendga ulanadi. Web panelga ta'siri:

1. **Chek rekvizitlari mobil chekda chiqadi.**
   - `GET/PATCH /api/v1/sozlama/chek`: `{ nomi, telefon, manzil, izoh }`. PATCH faqat Admin. Endpoint avvaldan bor.
   - Mobil ilova ularni sotuv, yetkazish va to'lov cheki boshida chiqaradi.
   - **Yangi serverda ular bo'sh.** Sozlamalar sahifasida "Chek rekvizitlari" bo'limi borligini tekshiring. Yo'q bo'lsa — 4 maydonli forma qo'shing.
   - Admin uchun eslatma: "Mobil chekda firma nomi chiqishi uchun to'ldiring".
2. **Mobil rollar serverdagi `.env` dan boshqariladi** (`MOBIL_ROLLAR=agent,avtolavka,dostavchik,tasdiq,audit`).
   - O'chirilgan roldagi foydalanuvchi mobil ilovaga kira olmaydi: login 403 bilan "… roli bu serverda mobil ilova uchun yoqilmagan" xabarini oladi.
   - Web'da rolni o'zgartirish API'si **yo'q** (`.env` + server restart).
   - Ixtiyoriy: agent/dostavchi sahifasida qaysi mobil rollar yoqilganini ko'rsatish. Uning uchun `GET /api/mobile/mobilSozlama` (auth'siz) → `data.rollar`, `data.rollarNomi`.
3. **Dostavchik faqat `yolda` holatidagi, unga tayinlangan buyurtmani ko'radi.**
   - Web'da dostavchini tanlab, "Yo'lda" qilish — avvalgi oqim, o'zgarmagan.
   - Mobil yetkazish natijalari web'da ko'rinadi:
     - `ariza.yetkazish_urinish`, `yetkazish_izoh` ("1 urinish · Do'kon yopiq");
     - `oflayn` belgisi;
     - qaytarma/brak;
     - trip sheet'da `naqd_elon` (dostavchik o'zi sanagan naqd).

   Bu maydonlar avvaldan bor. Ular arizalar va dostavchi kartasida ko'rsatilayotganini tekshiring.

---

## 14. Tekshirish ro'yxati (qo'lda)

- [ ] Admin bo'lmagan foydalanuvchi: boshqa sahifadagi 403 logout qilmaydi, xabar chiqadi
- [ ] Foydalanuvchi qo'shish (Admin) ishlaydi; oddiy foydalanuvchi o'z profilini (parol/ism) saqlay oladi
- [ ] Har qanday formada noto'g'ri qiymat → maydon yonida 400 xabari (500 emas)
- [ ] Ariza: `yolda` da tahrir tugmasi yo'q; 0 miqdorli qator saqlanmaydi; qisman tahrir turi/chegirmani buzmaydi
- [ ] Qaytarish arizasi: "Qabul qilish" ishlaydi
- [ ] Mijoz tahriri: qarz (balans) o'zgarmaydi
- [ ] Kassa: tizim kategoriyalari ro'yxatda yo'q; `mijoz_tolov` mijozsiz saqlanmaydi
- [ ] Prixod: tasdiq/bekor, tasdiqlangan hujjat tahriri bloklangan
- [ ] Tovar o'chirish (tarixi bor/yo'q)
- [ ] Trip sheet: ariza qo'shish/olib tashlash
- [ ] Hisobotlar: sotuv hisobot standart davri, katta davr xabari, marshrut reja generatsiyasi
- [ ] Sozlamalar → Chek rekvizitlari saqlanadi
