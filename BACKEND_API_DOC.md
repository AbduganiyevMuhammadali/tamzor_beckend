# RashMilk / Disrubitsa — Backend API Shpargalka

> Flutter ilovasi tayyor, backend yo'q. Bu hujjat ilovadagi **barcha API chaqiruvlarini** (path, method, header, query, request body, response) mock JSON bilan to'liq yig'adi. Backend shu hujjatga qarab shakllantiriladi.

Manba fayllar:
- `lib/api/dio_client.dart` — asosiy Dio (header, interceptor, base envelope)
- `lib/api/api.dart` — agent/sotuv/report API'lari
- `lib/future/data/data_source/remote_data_source.dart` — audit/client/product API'lari
- bootstrap moduli — server manzilini olish API'lari

---

## 0. Umumiy qoidalar

### 0.1 Javob konverti (envelope)
Hamma endpoint shu strukturada qaytadi (`BaseResponse`):

```json
{
  "error": false,
  "message": "",
  "error_code": 200,
  "data": { }
}
```

| Maydon | Tip | Izoh |
|--------|-----|------|
| `error` | bool | `true` bo'lsa xatolik. **Hech qachon `null` bo'lmasin** — `dio_client.get` `data["error"] == null` bo'lsa javobni butunlay rad etadi |
| `message` | string | Xatolik matni (UI'da toast bo'lib chiqadi). Muvaffaqiyatda `""` |
| `error_code` | int | `200` — ok. **`405` — token eskirgan/yaroqsiz → ilova avtomatik logout qiladi**. Boshqa kodlar xatolik |
| `data` | object \| array \| null | Asosiy yuk. Har endpointga qarab obyekt yoki massiv |

> ⚠️ `data` massiv qaytaradigan endpointlarda ham konvert bir xil: `data` ichida `[...]` bo'ladi.

### 0.2 Base URL — 3 bosqichli bootstrap
Ilova ishga tushganda server manzilini 3 qadamda topadi:

1. **`url1c`** (bootstrap server: `/server/url1c`) → 1C server ip/port → `configIp = http://{ip}:{port}/{BILLING}/hs/load_config/`
2. **`LoadConfig`** (`{configIp}LoadConfig?secret_name=RashMilkNew`) → mijoz konfiguratsiyasi (asosiy server manzili + login/parol)
3. **Asosiy API** — `LoadConfig`'dan kelgan `baseUrl` ustida ishlaydi.

### 0.3 Asosiy API headerlari (`dio_client.dart`)
Har bir asosiy API so'rovida yuboriladi:

| Header | Qiymat | Manba |
|--------|--------|-------|
| `Authorization` | `Basic base64(mobile_username:mobile_password)` | LoadConfig'dan |
| `token` | login token'i | login javobidan, har so'rovda interceptor qo'shadi |
| `oneSell` | `"true"`/`"false"` | userdan |
| `device` | `android` / `ios` | qurilma |
| `version` | ilova versiyasi, masalan `"1.0.3"` | package info |
| `buildNumber` | masalan `"42"` | package info |
| `Accept-Language` | `ru` | qattiq |
| `Content-type` | `application/json` | |
| `Accept` | `application/json` | |

Timeoutlar: connect 10s, receive 15s, send 30s.

---

## 1. BOOTSTRAP API'lari

### 1.1 `GET url1c` — 1C server ip/portini olish
- **Base:** bootstrap server (`/server/`)
- **Header:** `Authorization: Basic base64(mobiles:123)`, `device`, `token`
- **Query:** yo'q
- **Response** (konvertsiz, to'g'ridan-to'g'ri obyekt):

```json
{
  "ip": "84.54.118.39",
  "port": "8080"
}
```

### 1.2 `GET LoadConfig` — mijoz konfiguratsiyasi
- **Base:** `http://{ip}:{port}/{BILLING}/hs/load_config/`
- **Header:** `Authorization: Basic QWRtaW46MTIz` (ya'ni `Admin:123`), `Connection: close`
- **Query:** `secret_name=RashMilkNew`
- **Response** (`data` = konfiguratsiya obyekti):

```json
{
  "error": false,
  "message": "",
  "data": {
    "id": 1,
    "secret_name": "RashMilkNew",
    "ipaddress": "84.54.118.39",
    "ipport": "8081",
    "href_address": "RashMilk/hs/mobile",
    "mobile_username": "mobiles",
    "mobile_password": "123"
  }
}
```
> Ilova bundan `baseUrl = http://{ipaddress}:{ipport}/{href_address}/` ni quradi va keyingi barcha asosiy API shu manzilda ishlaydi.

---

## 2. AUTENTIFIKATSIYA

### 2.1 `POST Login/` — tizimga kirish
- **Query:** yo'q
- **Body:**
```json
{ "login": "agent1", "password": "12345" }
```
- **Response** (`data` = login obyekt):
```json
{
  "error": false,
  "message": "",
  "error_code": 200,
  "data": {
    "filial": "Farg'ona",
    "filialId": 1,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "password": "",
    "name": "Test Agent",
    "tel": "+998901234567",
    "adress": "Farg'ona sh.",
    "isAgent": true,
    "isAvtolavka": false,
    "isDeliver": false,
    "isAudit": false,
    "isConfirmation": false,
    "add_client": true,
    "oneSell": false,
    "tipPechat": 0,
    "serverVersion": 1,
    "returnView": true
  }
}
```

| Maydon | Tip | Izoh |
|--------|-----|------|
| `filialId` | int \| string | Filial ID. Ilova ham int, ham stringni qabul qiladi |
| `token` | string | keyingi barcha so'rovlarda `token` headerida ketadi |
| `isAgent`/`isDeliver`/`isAudit`/`isConfirmation` | bool | foydalanuvchi rollari (qaysi modul ochiladi) |
| `isAvtolavka` | bool | ko'chma savdo agenti — 15-bo'lim ekranlari ochiladi |
| `add_client` | bool | yangi mijoz qo'sha oladimi |
| `oneSell` | bool | bitta sotuv rejimi |
| `tipPechat` | int | chek chop etish turi |
| `serverVersion` | int/double | server versiyasi |
| `returnView` | bool | vozvrat (qaytarish) ko'rinadimi |

### 2.2 `GET getFilial/` — filiallar ro'yxati
- **Query:** yo'q
- **Response:** `data` = filiallar massivi
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [ { "filialId": 1, "filial": "Farg'ona" }, { "filialId": 2, "filial": "Toshkent" } ] }
```

### 2.3 `GET getUser/` — foydalanuvchi ma'lumoti
- **Query:** `filialId`
- **Response:** login bilan bir xil `data` obyekt (2.1 ga qarang).

---

## 3. MA'LUMOTNOMALAR (reference data)

### 3.1 `GET getKurs/` — valyuta kursi
- **Query:** `filialId`
- **Response:**
```json
{ "error": false, "message": "", "error_code": 200, "data": { "kurs": 12650.0 } }
```

### 3.2 `GET getValyuta/` — valyutalar
- **Query:** `filialId`
- **Response** (`data` massiv, `CurrencyModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [ { "valyuta": "Сум" }, { "valyuta": "Доллар" } ] }
```

### 3.3 `GET getPriceType/` — narx turlari
- **Query:** `filialId`
- **Response:**
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [ { "priceTypeId": "1", "priceType": "Optom" }, { "priceTypeId": "2", "priceType": "Roznichniy" } ] }
```

### 3.4 `GET getPaymentType/` — to'lov turlari
- **Query:** `filialId`
- **Response** (`PaymentTypeModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    { "paymentTypeId": "1", "paymentTypeName": "Naqd", "valyuta": "Сум" },
    { "paymentTypeId": "2", "paymentTypeName": "Plastik", "valyuta": "Сум" }
  ] }
```

### 3.5 `GET getCategories` / `getCategories/` — kategoriyalar
- **Query:** `filialId` (offline holatda) yoki bo'sh (audit holatda)
- **Response** (`CategoryModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    { "categoryId": "10", "categoryName": "Sut mahsulotlari", "supCategoryId": "", "supCategoryName": "", "image": "cat_10.jpg" }
  ] }
```

### 3.6 `GET getBrends/` — brendlar (audit)
- **Query:** yo'q
- **Response** (`IdNameModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [ { "id": "1", "name": "RashMilk", "count": 0, "tip": "" } ] }
```

### 3.7 `GET getReason/` — sabablar (sotmaslik/audit)
- **Query:** `filialId`
- **Response** (`UniversalModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [ { "id": "1", "name": "Tovar yo'q", "reasonId": "", "value": null } ] }
```

### 3.8 `GET region/` — viloyatlar (audit)
- **Query:** yo'q
- **Response:** `data` = `[ { "id": "1", "name": "Farg'ona" } ]`

### 3.9 `GET getXudud/` — hududlar (mijoz qo'shish)
- **Query:** `filialId`
- **Response:** `data` = `[ { "id": "1", "name": "Markaziy hudud" } ]`

### 3.10 `GET city/` — shaharlar
- **Query:** `province_id`
- **Response:** `data` = `[ { "id": "11", "name": "Marg'ilon" } ]`

### 3.11 `GET getBronFiltr/` — agent filtri
- **Query:** `filialId`
- **Response** (`data` = `IdNameModel` massivi):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    { "id": "1", "name": "Bugun", "count": 0, "tip": "" },
    { "id": "2", "name": "Kecha", "count": 0, "tip": "" },
    { "id": "3", "name": "Bu hafta", "count": 0, "tip": "" }
  ] }
```

---

## 4. MIJOZLAR (clients)

### 4.1 `GET getKlient` — mijozlar (agent, hafta bo'yicha)
- **Query:** `filialId`, `keyWeek` (int), `code` (int — paginatsiya/oxirgi kod), `searchKey` (string), `searchQr` (string)
- **Response** (`ClientModel` massivi):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    {
      "klientId": "1001",
      "klientName": "Anvar do'koni",
      "klientTel": "+998901112233",
      "klientAdress": "Farg'ona, Mustaqillik 12",
      "klientLat": "40.3864",
      "klientLong": "71.7864",
      "klientOstatkasum": 250000.0,
      "klientOstatkaDollar": 0.0,
      "isOpen": true,
      "klientcode": 5,
      "subKlient": false,
      "notSell": false,
      "image": "client_1001.jpg",
      "subClientName": "",
      "subClientId": "",
      "regionId": "1",
      "yuridikNomi": "Anvar Savdo MChJ",
      "chekcDiapazon": false,
      "metrDiapazon": 100.0,
      "klientQrCode": "QR1001",
      "green": true,
      "client_id_mobile": ""
    }
  ] }
```

### 4.2 `GET getAllKlient/` — yetkazib beruvchi (delivery) mijozlari
- **Query:** `filialId`, `code` (int), `searchKey`, `searchQr`
- **Response:** 4.1 bilan bir xil `ClientModel` massivi.

### 4.3 `GET getAllKlientAudit/` — audit mijozlari
- **Query:** `filialId`, `code` (int), `searchKey`
- **Response:** 4.1 bilan bir xil `ClientModel` massivi.

### 4.4 `GET info/` — mijoz tafsiloti
- **Query:** `filialId`, `client_id`
- **Response** (`ClientInfoModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": {
    "name": "Anvar do'koni", "phone": "+998901112233", "inn": "302445566",
    "address": "Farg'ona, Mustaqillik 12", "birth": "25.09.1990",
    "region": "Farg'ona", "price_type": "Optom", "yuridikNomi": "Anvar Savdo MChJ"
  } }
```

### 4.5 `POST saveKlient/` — yangi mijoz qo'shish
- **Query (hamma maydon query'da):** `filialId`, `xudud`, `name`, `tel`, `address`, `dateBirth` (25.09.1999), `lat`, `lon`, `date`, `subKlient`, `yuridikNomi`, `client_id_mobile`
- **Body:** `multipart/form-data`, fayl maydoni `img` (mijoz rasmi, ixtiyoriy)
- **⚠️ Response (offline kontrakt — eng muhim):** `data.klientId` (string) — serverda yaratilgan **yangi mijoz ID'si**. Offline yaratilgan mijozda `client_id_mobile` yuborilgan bo'lsa, ilova bu `klientId` ni shu mijozning barcha kutilayotgan **zakaz / lokatsiya / media / to'lov / notSell** yozuvlariga avtomatik bog'laydi va lokal vaqtinchalik mijozni o'chiradi.
```json
{ "error": false, "message": "Mijoz saqlandi", "error_code": 200,
  "data": { "klientId": "1050" } }
```

### 4.6 `POST updateClient/` — mijozni tahrirlash
- **Query:** `filialId`, `klientId`, `xudud`, `name`, `tel`, `address`, `dateBirth`, `lat`, `lon`, `date`, `subKlient`, `yuridikNomi`
- **Body:** `multipart/form-data`, `img` (ixtiyoriy)
- **Response:** `data` = yangilangan mijoz (kamida `klientId`). Offline `UPDATE_` yozuvi shundan keyin o'chiriladi.
```json
{ "error": false, "message": "Yangilandi", "error_code": 200,
  "data": { "klientId": "1001" } }
```

### 4.7 `POST saveLocation/` — mijoz lokatsiyasini saqlash
- **Body:**
```json
{ "klientId": "1001", "lat": "40.3864", "long": "71.7864", "isAudit": false, "client_id_mobile": "" }
```
- **⚠️ Response (offline kontrakt):** `data.klientId` (string) — ilova shu bo'yicha lokal lokatsiya yozuvini o'chiradi (`db.deleteLocationById(data.klientId)`).
```json
{ "error": false, "message": "", "error_code": 200,
  "data": { "klientId": "1001" } }
```

### 4.8 `GET clientNotSell` — sotilmagan mijoz (sabab bilan)
- **Query:** `filialId`, `clientId`, `reasonId`, `date`
- **⚠️ Response (offline kontrakt):** `data.date` (string) — ilova shu sana bo'yicha lokal "sotilmagan" yozuvini o'chiradi (`db.deleteNotSellByDate(data.date)`).
```json
{ "error": false, "message": "Saqlandi", "error_code": 200,
  "data": { "date": "2026.06.22" } }
```

### 4.9 `POST sendLocation/` — agent yo'nalish lokatsiyasi (batch)
- **Body:**
```json
{
  "userToken": "<token>", "filialId": 1,
  "location": [ { "lat": 40.38, "long": 71.78, "date": "22/06/2026//10:15:00", "battery": 87 } ]
}
```
- **Response:** faqat `error` tekshiriladi, `data` o'qilmaydi → `data: null` bo'lishi mumkin.
```json
{ "error": false, "message": "", "error_code": 200, "data": null }
```

---

## 5. TOVARLAR (products)

### 5.1 `GET getProductSell/` — sotuv tovarlari
- **Query:** `filialId`, `code` (double), `categoryId`, `searchKey`
- **Response** (`ProductModel` massivi):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    {
      "tovar": "Sut 1L", "tovarId": "2001", "image": "p_2001.jpg",
      "countType": "dona", "sht": 12.0, "qoldiq": 340.0, "tovarCode": 2001.0,
      "Сум": [
        { "priceType": "Optom", "priceTypeId": "1", "minNarx": 9000.0, "maxNarx": 12000.0, "narx": 10000.0, "currencyTovar": "Сум" }
      ],
      "Доллар": [
        { "priceType": "Optom", "priceTypeId": "1", "minNarx": 0.7, "maxNarx": 1.0, "narx": 0.8, "currencyTovar": "Доллар" }
      ],
      "cartCount": 0.0, "cartPackCount": 0.0,
      "link": "", "info": "Yog'liligi 3.2%",
      "brutto": 1.05, "netto": 1.0,
      "categoryId": "10", "categoryName": "Sut mahsulotlari"
    }
  ] }
```
> `Сум` (so'm narxlari) va `Доллар` (dollar narxlari) — kalit nomlari **kirillcha**, aynan shunday yuborilishi shart.

> **Qoldiq (2026-10-17 dan):** oddiy agent (zakaz) uchun `qoldiq` — skladdagi **MAVJUD** miqdor: asosiy ombordagi jismoniy qoldiq − hali ombordan chiqmagan (yangi / tasdiqlangan / yig'ilmoqda) buyurtmalarga band qilingani. Avtolavka mashinalari va brak ombori kirmaydi. Ro'yxatda **faqat `qoldiq > 0`** tovarlar keladi — zakazga skladda yo'q tovar qo'shib bo'lmaydi. Avtolavka agenti uchun avvalgidek mashinasidagi qoldiq. Qaytarish ro'yxatlari (5.3, 5.4) o'zgarmagan.

### 5.2 `GET getProductSellOffline` — offline tovarlar
- **Query:** `filialId`
- **Response:** 5.1 bilan bir xil.

### 5.3 `GET getProductsVozvrat/` — qaytarish (vozvrat) tovarlari
- **Query:** `filialId`, `code` (double), `categoryId`, `searchKey`
- **Response:** 5.1 bilan bir xil `ProductModel` massivi.

### 5.4 `GET getProductsVozvratOffline/` — offline vozvrat tovarlari
- **Query:** `filialId`
- **Response:** 5.1 bilan bir xil.

### 5.5 `GET checkProduct/` — tovar qoldig'ini tekshirish
- **Query:** `filialId`, `tovarId`
- **Response:** `{ "error": false, "message": "", "error_code": 200, "data": { "qoldiq": 340.0 } }`
- Oddiy agent uchun `qoldiq` — 5.1 dagi kabi mavjud (band qilinganlari ayirilgan) miqdor.

---

## 6. SOTUV / ZAKAZ

### 6.1 `POST saveSell/` — sotuvni saqlash (`MakeOrderModel`)
- **Body:**
```json
{
  "filialId": "1", "kurs": 12650.0, "currency": "Сум",
  "klientId": "1001", "narxTuri": "1", "srok": "30", "aralashSavdo": false,
  "itogSummaSumEski": 120000.0, "itogSummaDollarEski": 0.0,
  "ItogskidkaTovarSum": 0.0, "ItogskidkaTovarDollar": 0.0,
  "itogSummaSumYangi": 120000.0, "itogSummaDollarYangi": 0.0,
  "skidkaSum": 0.0, "skidkaDollar": 0.0,
  "ostatkaSum": 0.0, "ostatkaDollar": 0.0,
  "komment": "", "date": "2026.06.22",
  "androidId": 0, "deliveryDate": "2026.06.23", "client_id_mobile": "",
  "products": [
    {
      "filialId": "1", "tovarId": "2001", "productName": "Sut 1L", "tovarCurrency": "Сум",
      "kolbo": 12.0, "pachka": 0, "eskiNarx": 10000.0, "eskisumma": 120000.0,
      "yangiNarx": 10000.0, "yangisumma": 120000.0, "sht": 12.0, "qoldiq": 340.0,
      "countType": "dona", "brutto": 1.05, "netto": 1.0
    }
  ]
}
```
> `kolbo` = blok×sht + dona (umumiy dona soni), `pachka` har doim `0` yuboriladi.
- **Joylashuv (ixtiyoriy, lekin har doim yuborish tavsiya etiladi):** body'ga sotuv qilingan paytdagi GPS nuqta qo'shiladi — `"lat": 40.3864, "long": 71.7864`. Agar sotuv `checkIn` qilingan tashrif ichida bo'lsa, `"tashrifId": 13045` ham yuboriladi (yuborilmasa server shu mijozdagi ochiq tashrifni o'zi topadi). Server mijoz nuqtasigacha masofani hisoblaydi va web'da **"uzoqdan sotuv"** (> 300 m) deb belgilaydi. Sotuv **bloklanmaydi** — offline yuborilgan zakazlar ham qabul qilinadi. Mijozning koordinatasi hali yo'q bo'lsa va sotuv avtolavkada yoki tashrif ichida bo'lsa, shu nuqta mijoz manzili sifatida saqlanadi.
- **⚠️ Response (offline kontrakt):** javobdagi **`data.androidId`** ilova tomonidan yuborilgan `androidId` bilan bir xil bo'lib qaytishi shart — ilova shu qiymat bo'yicha lokal (offline) DB'dagi zakazni o'chiradi (`db.deleteOrderById(data.androidId)`).
```json
{ "error": false, "message": "Sotuv saqlandi", "error_code": 200,
  "data": { "androidId": 17, "docId": "5001", "docNumber": "F-5001", "masofa": 33, "uzoqda": false } }
```
> `masofa` — mijoz nuqtasigacha metr (`null`: GPS yoki mijoz koordinatasi yo'q). `uzoqda: true` bo'lsa ilova agentga ogohlantirish ko'rsatishi mumkin.
> **Avtolavka agentida** (`isAvtolavka`) sotuv darhol "yetkazildi" bo'ladi va tovar **mashinadan** chiqadi: mashinada yetmasa `error: true`, `message: "\"Sut 1L\" mashinada yetarli emas. Kerak: 12, bor: 8"`.

### 6.2 `POST saveVozvrat/` — qaytarishni saqlash (`SendReturnModel`)
- **Body:**
```json
{
  "filialId": "1", "kurs": 12650.0, "komment": "", "klientId": "1001",
  "currency": "Сум", "narxTuri": "1",
  "itogSummaSumEski": 20000.0, "itogSummaDollarEski": 0.0,
  "ItogskidkaTovarSum": 0.0, "ItogskidkaTovarDollar": 0.0,
  "itogSummaSumYangi": 20000.0, "itogSummaDollarYangi": 0.0,
  "skidkaSum": 0.0, "skidkaDollar": 0.0, "ostatkaSum": 0.0, "ostatkaDollar": 0.0,
  "aralashSavdo": false, "date": "2026.06.22",
  "products": [
    { "filialId": "1", "tovar": "Sut 1L", "tovarId": "2001", "tovarCurrency": "Сум",
      "sht": 12.0, "kolbo": 2.0, "pachka": 0.0, "eskiNarx": 10000.0, "eskisumma": 20000.0,
      "yangiNarx": 10000.0, "yangisumma": 20000.0, "countType": "dona" }
  ]
}
```
- **⚠️ Response (offline kontrakt):** javobdagi **`data.date`** — bu yuborilgan zakazning lokal `androidId` (int) qiymati. Ilova shu bo'yicha offline vozvratni o'chiradi (`db.deleteReturnOrderById(data.date)`). Ya'ni `date` bu yerda **sana emas, balki lokal id (int)**.
```json
{ "error": false, "message": "Vozvrat saqlandi", "error_code": 200,
  "data": { "date": 23, "docId": "6001" } }
```

### 6.3 `POST savePayment/` — to'lovni saqlash
- **Body:**
```json
{
  "filialId": "1", "kurs": 12650.0, "klientId": "1001", "data": "2026.06.22",
  "course": 12650.0,
  "paymentSum": [ { "paymentTypeId": "1", "summa": 100000.0 } ],
  "paymentDollar": [ ],
  "komment": "Naqd to'lov"
}
```
- **⚠️ Response (offline kontrakt):** javobdagi **`data.date`** (string) — ilova shu sana bo'yicha lokal saqlangan to'lovni o'chiradi (`db.deleteSavedPaymentByDate(data.date)`).
```json
{ "error": false, "message": "To'lov qabul qilindi", "error_code": 200,
  "data": { "date": "2026.06.22" } }
```

### 6.4 `POST editSell/` — sotuvni tahrirlash (`UpdateModel`)
- **Body:**
```json
{
  "docId": "5001", "androidId": 0,
  "products": [
    { "filialId": "1", "tovarId": "2001", "productName": "Sut 1L", "tovarCurrency": "Сум",
      "kolbo": 10.0, "pachka": 0.0, "eskiNarx": 10000.0, "eskisumma": 100000.0,
      "yangiNarx": 10000.0, "yangisumma": 100000.0, "sht": 12.0, "countType": "dona",
      "brutto": 1.05, "netto": 1.0 }
  ]
}
```
- **⚠️ Response (offline kontrakt):** `data.androidId` (int) — ilova shu bo'yicha tahrirlangan offline yozuvni tasdiqlaydi/o'chiradi.
```json
{ "error": false, "message": "Yangilandi", "error_code": 200,
  "data": { "androidId": 17 } }
```

---

> **Offline sinxronizatsiya kontrakti (qisqacha).** Ilova POST'larni avval lokal SQLite/Hive DB'ga yozadi, internet paydo bo'lganda navbatma-navbat serverga yuboradi. **Server javobi muvaffaqiyatli bo'lsa (`error: false`), shu javobdagi identifikator bo'yicha lokal yozuv o'chiriladi.** Shuning uchun quyidagi POST'lar `data` ichida albatta identifikatorni qaytarishi shart:
>
> | Endpoint | Javobdagi kalit | Lokal o'chirish / amal |
> |----------|-----------------|------------------|
> | `saveSell/` | `data.androidId` (int) | zakaz o'chiriladi |
> | `saveVozvrat/` | `data.date` (int — lokal id) | vozvrat o'chiriladi |
> | `savePayment/` | `data.date` (string sana) | to'lov o'chiriladi |
> | `orderDelivery/` | `data` = {docId,date1,date2} | yetkazish hujjati o'chiriladi |
> | `returnDeliveryProducts/` | `data.data` (string sana) + `data.products` | qaytarish o'chiriladi |
> | `editSell/` | `data.androidId` (int) | tahrir tasdiqlanadi |
> | `saveKlient/` | `data.klientId` (string) | yangi mijoz ID barcha kutilayotgan yozuvlarga bog'lanadi, vaqtinchalik mijoz o'chiriladi |
> | `updateClient/` | `data.klientId` (string) | offline `UPDATE_` yozuvi o'chiriladi |
> | `saveLocation/` | `data.klientId` (string) | lokatsiya o'chiriladi |
> | `clientNotSell` | `data.date` (string sana) | "sotilmagan" yozuvi o'chiriladi |
> | `chekUp/` | `data.date` (string sana) | audit yozuvi o'chiriladi |
> | `SendMedia/` | `data.date` (string sana) | media yozuvi o'chiriladi |
> | `postConfirm/` | `data.docId` (string) | hujjat ro'yxatdan o'chiriladi |
>
> **Yagona istisno:** `sendLocation/` (batch GPS) — faqat `error` tekshiriladi, `data` o'qilmaydi → `data: null` bo'lishi mumkin.

---

## 7. TASDIQLASH (confirmation) — `isConfirmation` roli

### 7.1 `GET getConfirms/` — tasdiqlanadigan hujjatlar
- **Query:** `filialId`
- **Response** (`data` = `DocumentDeliveryModel` massivi — 9.1 bilan **bir xil** tuzilma):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    {
      "docNumber": "F-5001", "docId": "5001", "tipDokument": "Sotuv", "qrCode": "QR5001",
      "agent": "Test Agent", "agentId": "3", "agentTel": "+998901234567",
      "klient": "Anvar do'koni", "klientId": "1001", "klientTel": "+998901112233",
      "klientAdres": "Farg'ona, Mustaqillik 12", "klientLat": "40.3864", "klientLong": "71.7864",
      "tovarSummaSum": 120000.0, "tovarSummaDollar": 0.0, "skidkaSum": 0.0, "skidkaDollar": 0.0,
      "vozvratSum": 0.0, "vozvratDollar": 0.0, "qoldiqSum": 120000.0, "qoldiqDollar": 0.0,
      "clientResSum": 0.0, "clientResDollar": 0.0,
      "komment": "", "srok": "30", "docData": "2026.06.22",
      "currency": "Сум", "aralashSavdo": "false", "logo": "logo.png",
      "status": { "id": "1", "name": "Готовлена", "count": 0, "tip": "" },
      "products": [
        { "filialId": "1", "tovar": "Sut 1L", "tovarId": "2001", "countType": "dona",
          "currencyTovar": "Сум", "sht": 12.0, "kolbo": 12.0, "pachka": 0.0,
          "eskiNarx": 10000.0, "eskisumma": 120000.0, "narx": 10000.0, "summa": 120000.0,
          "vozvratKolbo": 0.0, "vozvratPachka": 0.0, "vozvratSumma": 0.0,
          "brutto": 1.05, "netto": 1.0, "productName": "Sut 1L", "isAksiya": false }
      ]
    }
  ] }
```

### 7.2 `POST postConfirm/` — hujjatni tasdiqlash/rad etish
- **Body:** `{ "docId": "5001", "success": true }`
- **⚠️ Response (offline kontrakt):** `data.docId` (string) — ilova shu hujjatni ro'yxatdan/lokal bazadan o'chiradi.
```json
{ "error": false, "message": "", "error_code": 200,
  "data": { "docId": "5001" } }
```

---

## 8. AUDIT — `isAudit` roli

### 8.1 `POST chekUp/` — audit natijasini yuborish
- **Body:**
```json
{
  "filial_id": "1", "client_id": "1001",
  "area": 50.0, "stend": 2.0, "shopWithUs": 30.0, "showWithoutUs": 20.0,
  "reason": "1", "date": "2026.06.22",
  "goods": [ { "brand_id": "1", "cat_id": "10", "count": 5.0 } ],
  "complaint": "Narx baland", "offer": "Aksiya kerak",
  "enterTime": "10:00", "exitTime": "10:20",
  "lat": "40.3864", "long": "71.7864"
}
```
- **⚠️ Response (offline kontrakt):** `data.date` (string) — ilova shu sana bo'yicha lokal audit yozuvini o'chiradi.
```json
{ "error": false, "message": "Audit saqlandi", "error_code": 200,
  "data": { "date": "2026.06.22" } }
```

### 8.2 `POST SendMedia/` — audit/agent media (rasm) yuborish
- **Query:** `agent_id` (=token), `filialId`, `klient_id`, `reason_id`, `date`, `comment`
- **Body:** `multipart/form-data` — `img` (bir nechta rasm), audit holatda qo'shimcha `items` (goods massivi)
- **⚠️ Response (offline kontrakt):** `data.date` (string) — ilova shu sana bo'yicha lokal media yozuvini o'chiradi.
```json
{ "error": false, "message": "Yuklandi", "error_code": 200,
  "data": { "date": "2026.06.22" } }
```

---

## 9. YETKAZIB BERISH (delivery) — `isDeliver` roli

### 9.1 `GET getDokDelivery/` — yetkazish hujjatlari
- **Query:** `filialId`, `docType` (int, default 1)
- **Response** (`DocumentDeliveryModel` massivi):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    {
      "docNumber": "F-5001", "docId": "5001", "tipDokument": "Sotuv", "qrCode": "QR5001",
      "agent": "Test Agent", "agentId": "3", "agentTel": "+998901234567",
      "klient": "Anvar do'koni", "klientId": "1001", "klientTel": "+998901112233",
      "klientAdres": "Farg'ona, Mustaqillik 12", "klientLat": "40.3864", "klientLong": "71.7864",
      "tovarSummaSum": 120000.0, "tovarSummaDollar": 0.0,
      "skidkaSum": 0.0, "skidkaDollar": 0.0,
      "vozvratSum": 0.0, "vozvratDollar": 0.0,
      "qoldiqSum": 120000.0, "qoldiqDollar": 0.0,
      "clientResSum": 0.0, "clientResDollar": 0.0,
      "komment": "", "srok": "30", "docData": "2026.06.22",
      "currency": "Сум", "aralashSavdo": "false", "logo": "logo.png",
      "status": { "id": "1", "name": "Готовлена", "count": 0, "tip": "" },
      "products": [
        { "filialId": "1", "tovar": "Sut 1L", "tovarId": "2001", "countType": "dona",
          "currencyTovar": "Сум", "sht": 12.0, "kolbo": 12.0, "pachka": 0.0,
          "eskiNarx": 10000.0, "eskisumma": 120000.0, "narx": 10000.0, "summa": 120000.0,
          "vozvratKolbo": 0.0, "vozvratPachka": 0.0, "vozvratSumma": 0.0,
          "brutto": 1.05, "netto": 1.0, "productName": "Sut 1L", "isAksiya": false }
      ]
    }
  ] }
```
> `status.name` quyidagilardan biri: `"Готовлена"`, `"Отправлено"`, `"Доставлено"`.

### 9.2 `GET getDokDeliveryLocation/` — yetkazish mijozlari lokatsiyasi
- **Query:** `filialId`
- **Response:** `data` = `[ { "klientId": "1001", "klientLat": "40.38", "klientLong": "71.78", "klient": "Anvar do'koni" } ]`

### 9.3 `POST orderDelivery/` — zakazni yetkazib berish
- **Body:** `{ "filialId": "1", "docId": "5001", "date1": "2026.06.22", "date2": "2026.06.22" }`
- **⚠️ Response (offline kontrakt):** `data` = `OrderDeliveryModel` (`docId`, `date1`, `date2`). Ilova javobdagi shu obyektni lokal DB'ga yozadi va hujjatni o'chiradi.
```json
{ "error": false, "message": "Yetkazildi", "error_code": 200,
  "data": { "docId": "5001", "date1": "2026.06.22", "date2": "2026.06.22" } }
```

### 9.4 `POST returnDeliveryProducts/` — yetkazishda qaytarish
- **Body:**
```json
{ "filialId": "1", "docId": "5001", "data": "2026.06.22",
  "products": [ { "id": "2001", "name": "Sut 1L", "reasonId": "1", "value": 2.0 } ] }
```
- **⚠️ Response (offline kontrakt):** `data.products` = qaytarilgan tovarlar (`UniversalModel`) massivi; `data.data` (string sana) — ilova shu sana bo'yicha lokal qaytarish yozuvini o'chiradi (`db.deleteReturnProductsByDate(data.data)`).
```json
{ "error": false, "message": "", "error_code": 200,
  "data": {
    "data": "2026.06.22",
    "products": [ { "id": "2001", "name": "Sut 1L", "reasonId": "1", "value": 2.0 } ]
  } }
```

### 9.5 `GET getReturnDocDelivery/` — qaytarish hujjatlari
- **Query:** `filialId`
- **Response:** `data` = `DocumentDeliveryModel` massivi — **9.1 bilan aynan bir xil tuzilma** (status `name` odatda `"Доставлено"`).

---

## 10. OFFLINE yuklab olish (kunlik mijozlar)

Quyidagilarning hammasi **`GET`**, **query:** `filialId`, **response:** 4.1 dagi `ClientModel` massivi:

| Endpoint | Izoh |
|----------|------|
| `getKlientOfflineMonday` | Dushanba mijozlari |
| `getKlientOfflineTuesday` | Seshanba |
| `getKlientOfflineWednesday` | Chorshanba |
| `getKlientOfflineThursday` | Payshanba |
| `getKlientOfflineFriday` | Juma |
| `getKlientOfflineSaturday` | Shanba |
| `getKlientOfflineSunday` | Yakshanba |
| `getKlientOfflineAllWeek` | Butun hafta |

---

## 11. TARIX (history)

### 11.1 `GET getAgentDocHistory/` — agent hujjatlari tarixi
- **Query:** `statusId`, `filialId`
- **Response:** `data` = `DocumentDeliveryModel` massivi — **9.1 bilan aynan bir xil tuzilma**. `statusId` orqali filtrlanadi (`status.id`).

### 11.2 `GET getClientDocHistory/` — mijoz hujjatlari tarixi
- **Query:** `statusId`, `clientId`, `filialId`
- **Response:** `data` = `DocumentDeliveryModel` massivi — **9.1 bilan aynan bir xil tuzilma**, faqat berilgan `clientId` bo'yicha.

### 11.3 `GET mijozCheklar/` — mijoz chek tarixi (batafsil)
Batafsil bo'lim — **20.1**.

---

## 12. HISOBOTLAR (reports / dashboard)

> Bu guruh `wrapResponse` orqali ishlaydi, lekin konvert bir xil (`error`, `message`, `error_code`, `data`).

### 12.1 `GET getBranches` — filiallar (hisobot)
- **Query:** yo'q
- **Response** (`BranchModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [ { "id": 1, "name": "Farg'ona", "active": true }, { "id": 2, "name": "Toshkent", "active": false } ] }
```

### 12.2 `GET getCircleReports` — doiraviy (pie) diagramma
- **Query:** `branch_id` (int)
- **Response** (`CircleChartModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    { "id": 1, "title": "Sotuv turlari",
      "values": [ { "id": 1, "title": "Naqd", "value": 65.0 }, { "id": 2, "title": "Nasiya", "value": 35.0 } ] }
  ] }
```

### 12.3 `GET getSections` — bo'limlar (dashboard kartalari)
- **Query:** `branch_id` (int), `token`
- **Response** (`SectionModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    { "link": "sales", "title": "Bugungi sotuv", "value": "12 500 000", "subTitle": "so'm" }
  ] }
```

### 12.4 `GET getLinearReports` — chiziqli (line) diagramma
- **Query:** `branch_id` (int)
- **Response** (`LineReportModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    { "title": "Haftalik sotuv",
      "values": [ { "title": "Naqd", "points": [10.0, 12.5, 9.0, 15.0, 11.0, 14.0, 13.0] } ] }
  ] }
```

### 12.5 `GET getSellsReport` — kunlik sotuv hisoboti
- **Query:** `filialId`, `userToken`, `date` (yyyy.MM.dd)
- **Response:** ⚠️ `data` = **massiv**, ilova uning **birinchi elementini** oladi (`DailyReportModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": [
    {
      "visited": "12",
      "along_route": "8",
      "remaining_places": "4",
      "no_along_route": "2",
      "Order_quantity": "9",
      "total_Number_Order": "9",
      "total_Count_Products": "320",
      "data_Category": [
        { "tovar": "Sut mahsulotlari", "id": "10", "count": "120", "summa": "1200000" }
      ],
      "data_sells": [
        { "tovar": "Sut 1L", "id": "2001", "id_Category": "10", "count": "120", "price": "10000", "summa": "1200000" }
      ],
      "data_Client": [
        { "name": "Anvar do'koni", "id": "1001", "summa": "1200000", "count": "5" }
      ]
    }
  ] }
```

### 12.6 `GET getSellsReportMonth` — oylik sotuv hisoboti
- **Query:** `filialId`, `userToken`, `date1` (yyyy.MM.dd), `date2` (yyyy.MM.dd)
- **Response:** ⚠️ `data` = **obyekt** (massiv emas!) — `MonthlyReportModel`:
```json
{ "error": false, "message": "", "error_code": 200,
  "data": {
    "summa": "32500000",
    "count": "210",
    "shop": "45",
    "month": "Iyun",
    "data_Category": [
      { "tovar": "Sut mahsulotlari", "id": "10", "count": "1500", "summa": "15000000" }
    ],
    "data_sells": [
      { "tovar": "Sut 1L", "id": "2001", "id_Category": "10", "count": "1500", "price": "10000", "summa": "15000000" }
    ]
  } }
```

### 12.7 `POST table` — universal jadval hisoboti
- **Query:** `link`, `branch_id`, `token`
- **Body:** filtr massivi — `[ { "key": "date", "value": "2026.06.22" } ]`
- **Response** (`TableModel`):
```json
{ "error": false, "message": "", "error_code": 200,
  "data": {
    "orientation": "vertical",
    "header": { "columns": [ { "value": "Tovar", "weight": 2.0, "type": "single", "vertical": [], "horizontal": [] } ] },
    "items": [ { "columns": [ { "value": "Sut 1L", "weight": 2.0, "type": "single", "vertical": [], "horizontal": [] } ] } ],
    "filter": [],
    "selectedFilters": [ { "key": "date", "value": "2026.06.22" } ]
  } }
```
> `TableColumnType`: `single` | `vertical` | `horizontal`. `orientation`: `vertical` | `horizontal`.

---

## 13. Endpoint qisqacha jadval

| # | Method | Path | Query | Body | Roli |
|---|--------|------|-------|------|------|
| Login | POST | `Login/` | — | login,password | hammasi |
| getFilial | GET | `getFilial/` | — | — | |
| getUser | GET | `getUser/` | filialId | — | |
| getKurs | GET | `getKurs/` | filialId | — | |
| getValyuta | GET | `getValyuta/` | filialId | — | |
| getPriceType | GET | `getPriceType/` | filialId | — | |
| getPaymentType | GET | `getPaymentType/` | filialId | — | |
| getCategories | GET | `getCategories` | filialId | — | |
| getBrends | GET | `getBrends/` | — | — | audit |
| getReason | GET | `getReason/` | filialId | — | |
| region | GET | `region/` | — | — | audit |
| getXudud | GET | `getXudud/` | filialId | — | |
| mijozCheklar | GET | `mijozCheklar/` | klientId, page | — | agent |
| city | GET | `city/` | province_id | — | |
| getBronFiltr | GET | `getBronFiltr/` | filialId | — | agent |
| getKlient | GET | `getKlient` | filialId,keyWeek,code,searchKey,searchQr | — | agent |
| getAllKlient | GET | `getAllKlient/` | filialId,code,searchKey,searchQr | — | deliver |
| getAllKlientAudit | GET | `getAllKlientAudit/` | filialId,code,searchKey | — | audit |
| info | GET | `info/` | filialId,client_id | — | |
| saveKlient | POST | `saveKlient/` | (many) | img(file) | |
| updateClient | POST | `updateClient/` | (many) | img(file) | |
| saveLocation | POST | `saveLocation/` | — | klientId,lat,long,isAudit | |
| clientNotSell | GET | `clientNotSell` | filialId,clientId,reasonId,date | — | |
| sendLocation | POST | `sendLocation/` | — | userToken,filialId,location[] | |
| getProductSell | GET | `getProductSell/` | filialId,code,categoryId,searchKey | — | |
| getProductSellOffline | GET | `getProductSellOffline` | filialId | — | |
| getProductsVozvrat | GET | `getProductsVozvrat/` | filialId,code,categoryId,searchKey | — | |
| getProductsVozvratOffline | GET | `getProductsVozvratOffline/` | filialId | — | |
| checkProduct | GET | `checkProduct/` | filialId,tovarId | — | |
| saveSell | POST | `saveSell/` | — | MakeOrderModel | agent |
| saveVozvrat | POST | `saveVozvrat/` | — | SendReturnModel | |
| savePayment | POST | `savePayment/` | — | (payment) | |
| editSell | POST | `editSell/` | — | UpdateModel | |
| getConfirms | GET | `getConfirms/` | filialId | — | confirm |
| postConfirm | POST | `postConfirm/` | — | docId,success | confirm |
| chekUp | POST | `chekUp/` | — | (audit) | audit |
| SendMedia | POST | `SendMedia/` | agent_id,filialId,klient_id,reason_id,date,comment | img(file)[] | audit/agent |
| getDokDelivery | GET | `getDokDelivery/` | filialId,docType | — | deliver |
| getDokDeliveryLocation | GET | `getDokDeliveryLocation/` | filialId | — | deliver |
| orderDelivery | POST | `orderDelivery/` | — | filialId,docId,date1,date2 | deliver |
| returnDeliveryProducts | POST | `returnDeliveryProducts/` | — | filialId,docId,data,products | deliver |
| getReturnDocDelivery | GET | `getReturnDocDelivery/` | filialId | — | deliver |
| getKlientOffline* | GET | `getKlientOffline{Day}` | filialId | — | |
| getAgentDocHistory | GET | `getAgentDocHistory/` | statusId,filialId | — | |
| getClientDocHistory | GET | `getClientDocHistory/` | statusId,clientId,filialId | — | |
| getBranches | GET | `getBranches` | — | — | report |
| getCircleReports | GET | `getCircleReports` | branch_id | — | report |
| getSections | GET | `getSections` | branch_id,token | — | report |
| getLinearReports | GET | `getLinearReports` | branch_id | — | report |
| getSellsReport | GET | `getSellsReport` | filialId,userToken,date | — | report |
| getSellsReportMonth | GET | `getSellsReportMonth` | filialId,userToken,date1,date2 | — | report |
| table | POST | `table` | link,branch_id,token | KeyValue[] | report |
| checkIn | POST | `checkIn/` | — | klientId,lat,long | agent |
| checkOut | POST | `checkOut/` | — | tashrifId,lat,long,natija,arizaId | agent |
| marshrutReja | GET | `marshrutReja/` | sana | — | agent |
| bugungiTashriflar | GET | `bugungiTashriflar/` | — | — | agent |
| avtolavkaHolat | GET | `avtolavkaHolat/` | sana | — | avtolavka |
| mashinaQoldiq | GET | `mashinaQoldiq/` | — | — | avtolavka |
| yuklashTavsiya | GET | `yuklashTavsiya/` | — | — | avtolavka |
| yuklashTovarlar | GET | `yuklashTovarlar/` | searchKey,categoryId | — | avtolavka |
| yuklashSorov | POST | `yuklashSorov/` | — | androidId,izoh,products[] | avtolavka |
| yuklashlar | GET | `yuklashlar/` | sana | — | avtolavka |
| yuklashQabul | POST | `yuklashQabul/` | — | docId,izoh | avtolavka |
| yuklashBekor | POST | `yuklashBekor/` | — | docId | avtolavka |
| kunYakuni | GET | `kunYakuni/` | sana | — | avtolavka |
| kunniYopish | POST | `kunniYopish/` | — | naqdSumma,izoh \| bekor | avtolavka |
| dostavchikHolat | GET | `dostavchikHolat/` | sana,lat,long | — | dostavchik |
| marshrut | GET | `marshrut/` | sana,lat,long | — | dostavchik |
| buyurtma | GET | `buyurtma/` | docId,lat,long | — | dostavchik |
| reysBoshla | POST | `reysBoshla/` | — | lat,long | dostavchik |
| yetkazdim | POST | `yetkazdim/` | — | docId,naqd,qaytarish[],izoh,lat,long | dostavchik |
| yetkazilmadi | POST | `yetkazilmadi/` | — | docId,sabab,izoh,lat,long | dostavchik |
| qarzTolov | POST | `qarzTolov/` | — | klientId,summa,izoh | dostavchik |
| dostavchikKunYakuni | GET | `dostavchikKunYakuni/` | sana | — | dostavchik |
| reysYakunla | POST | `reysYakunla/` | — | naqdSumma,izoh,lat,long | dostavchik |
| url1c (bootstrap) | GET | `url1c` | — | — | start |
| LoadConfig (bootstrap) | GET | `LoadConfig` | secret_name | — | start |

---

## 14. Backend uchun muhim eslatmalar

1. **`error` maydoni hech qachon `null` bo'lmasin** — aks holda `GET` so'rovlar javobni `null` deb tashlab yuboradi.
2. **`error_code: 405`** = token yaroqsiz → ilova foydalanuvchini avtomatik chiqaradi. Token muddati tugaganda shu kodni qaytaring.
3. **`filialId`** — int ham, string ham bo'lishi mumkin; ilova ikkalasini ham qabul qiladi (login fix'idan keyin).
4. **Tovar narxlari kalitlari kirillcha:** `"Сум"` (so'm) va `"Доллар"` (dollar).
5. **Delivery status** matnlari rus tilida: `Готовлена`, `Отправлено`, `Доставлено`.
6. **Sana formatlari:** sotuv/hujjatlarda `yyyy.MM.dd` (`2026.06.22`); lokatsiyada `dd/MM/yyyy//HH:mm:ss`; tug'ilgan sana `dd.MM.yyyy`.
7. **Rasm yuklash** (`saveKlient`, `updateClient`, `SendMedia`) — `multipart/form-data`, fayl maydoni nomi `img`, contentType `image/jpg`.
8. **Authorization** — Basic auth: asosiy API `mobile_username:mobile_password` (LoadConfig'dan), bootstrap `Admin:123`.
9. **Bo'sh massiv** kerak bo'lsa `data: []`, bo'sh obyekt kerak bo'lsa `data: {}` qaytaring — `data: null` faqat "ma'lumot yo'q" holatlarda.

---

## 15. AVTOLAVKA (ko'chma savdo) — `avtolavka` agent

Agent tovarni mashinaga yuklab, mijozlarga **o'zi sotadi**. Avtolavka rejimi web'da agent kartasida yoqiladi ("Avtolavka (ko'chma savdo)"). Login (`2.1`) va `getUser` javobida **`"isAvtolavka": true`** keladi — ilova shunga qarab quyidagi ekranlarni ochadi. Bunday agentda:
- `getProductSell`, `getProductSellOffline`, `checkProduct` — faqat **mashinadagi** qoldiqni qaytaradi;
- `saveSell` — darhol "yetkazildi", tovar mashinadan chiqadi (6.1 ga qarang);
- `saveVozvrat` — mijozdan qaytgan tovar mashinaga kiradi.

Quyidagi endpoint'lar **faqat avtolavka agenti** uchun. Oddiy agent chaqirsa:
```json
{ "error": true, "error_code": 403, "data": null,
  "message": "Siz avtolavka (ko'chma savdo) rejimida emassiz. Administrator agent kartasida belgilashi kerak." }
```

### 15.0 Agentning kuni — ekranlar ketma-ketligi

| # | Agent (mobil) | Ombor/kassa (web → Avtolavka markazi) |
|---|---------------|----------------------------------------|
| 1 | `yuklashTavsiya` / `yuklashTovarlar` → **`yuklashSorov`** — mashinaga nima kerakligini so'raydi | So'rov "So'rov · N dona" bo'lib ko'rinadi |
| 2 | `avtolavkaHolat.keyingiQadam = yuklash_kutilmoqda` | Omborchi miqdorni tuzatishi mumkin → **Tasdiqlash va yuklash** (yoki **Rad etish** sabab bilan) |
| 3 | `keyingiQadam = yuklash_qabul` → tovarni sanab **`yuklashQabul`** | "Agent qabul qildi ✓" |
| 4 | Mijozlarga boradi: `checkIn` → `saveSell` (+ `lat/long`) → `checkOut` | Kun chizig'ida har sotuv; uzoqdan sotuv qizil halqa bilan |
| 5 | **`kunYakuni`** — nima topshirishini ko'radi → **`kunniYopish`** (o'zi sanagan naqd bilan) | "Topshirishga keldi" + agent sanagan naqd va farq |
| 6 | `keyingiQadam = topshirish` → omborga keladi | Omborchi qoldiqni **qabul** qiladi, kassir **naqdni** oladi → kun yopiladi |

> Barcha javoblar odatiy konvertda (`error`, `message`, `error_code`, `data`). Xato holatlarda `error: true` va `message` — ilova toast qilib ko'rsatadi. ID'lar string (`"166"`), miqdor/summalar raqam.

### 15.1 `GET avtolavkaHolat/` — "Mening kunim" (bosh ekran)
- **Query:** `sana` (ixtiyoriy, `YYYY-MM-DD`; standart — bugun)
- **Response `data`:**
```json
{
  "sana": "2026-10-13",
  "bosqich": 1,
  "holat": "ochiq",
  "holatNomi": "Savdoda",
  "keyingiQadam": "savdo",
  "keyingiQadamMatn": "Mijozlarga boring va soting",
  "mashina": { "tovarSoni": 6, "dona": 322, "summa": 7686600 },
  "bugun": {
    "yuklandiDona": 96, "yuklandiSumma": 3242400,
    "sotuvSoni": 4, "sotuvDona": 12, "sotuvSumma": 492000,
    "naqdSotuv": 246000, "qarzgaSotuv": 246000, "naqdQolda": 246000,
    "tashrif": 5, "reja": 12, "uzoqSotuv": 1
  },
  "sorovlar":        [ { "docId": "168", "docNumber": "YK-2026-0038", "dona": 48, "summa": 1621200, "vaqt": "2026-10-13T09:44:23Z" } ],
  "qabulKutilmoqda": [ { "docId": "166", "docNumber": "YK-2026-0036", "dona": 48, "summa": 1621200, "vaqt": "2026-10-13T09:50:00Z" } ],
  "kunYopish": null
}
```
| `keyingiQadam` | Ilova nima ko'rsatadi |
|---|---|
| `yuklash_sorov` | Mashina bo'sh — "Yuklash so'rash" tugmasi (15.3 → 15.5) |
| `yuklash_kutilmoqda` | So'rov omborchida — kutish; so'rovni tahrirlash/bekor qilish mumkin |
| `yuklash_qabul` | `qabulKutilmoqda` dagi hujjatni ochib, sanab, "Qabul qildim" (15.7) |
| `savdo` | Odatiy savdo ekrani |
| `topshirish` | Agent kunni yopgan — "Omborga qayting" ekrani (15.9) |
| `yopiq` | Kun yopildi |

`bosqich`: 0 — yuklanmagan, 1 — savdoda, 2 — topshirilmoqda, 3 — yopiq. `holat`: `bosh` · `ochiq` · `topshirilmoqda` · `yopiq` · `kamomad`.

### 15.2 `GET mashinaQoldiq/` — mashinadagi tovarlar
```json
{ "qatorlar": [ { "tovarId": "10", "tovar": "Makaron 500g", "turkum": "Boshqa oziq-ovqat",
                  "blokdagiSoni": 10, "qoldiq": 24, "narx": 33700, "summa": 808800 } ],
  "jami": { "tovarSoni": 6, "dona": 322, "summa": 7686600 } }
```

### 15.3 `GET yuklashTavsiya/` — ertalabki yuklash taklifi
Oxirgi 14 ish kunidagi o'rtacha kunlik sotuv + 20% zaxira − mashinadagi qoldiq, blokka yaxlitlangan, ombordagi qoldiq bilan cheklangan. Ilova buni "Tavsiya bo'yicha to'ldirish" tugmasi bilan so'rov formasiga qo'yadi.
```json
{ "manba": "ortacha", "ishKunlari": 9,
  "qatorlar": [ { "tovarId": "6", "tovar": "Suv 1.5L", "turkum": "Ichimliklar", "blokdagiSoni": 12,
                  "ortacha": 45, "mashinada": 0, "omborda": 157, "tavsiya": 60, "narx": 21400 } ],
  "jami": { "dona": 292, "summa": 7579100 } }
```
`manba`: `ortacha` (sotuv tarixidan) · `oxirgi` (tarix yo'q — oxirgi yuklash asosida) · `yoq` (bo'sh ro'yxat).

### 15.4 `GET yuklashTovarlar/` — so'rov formasi uchun ombordagi tovarlar
- **Query:** `searchKey` (nom yoki shtrix-kod), `categoryId` — ikkalasi ixtiyoriy
- **Response:** faqat omborda bor tovarlar
```json
[ { "tovarId": "1", "tovar": "Sut 1L", "turkum": "Sut mahsulotlari", "countType": "dona",
    "blokdagiSoni": 12, "omborda": 23, "mashinada": 0, "narx": 18700 } ]
```

### 15.5 `POST yuklashSorov/` — mashinaga yuklash so'rovi
- **Body:**
```json
{ "androidId": 77, "izoh": "Bugun Chilonzor marshruti",
  "products": [ { "tovarId": "1", "kolbo": 24 }, { "tovarId": "6", "kolbo": 60 } ] }
```
> `kolbo` — umumiy dona soni (saveSell bilan bir xil kalit; `dona` ham qabul qilinadi).
> Bugun uchun omborchi hali tasdiqlamagan so'rov bo'lsa — **yangisi yaratilmaydi**, o'sha so'rovning qatorlari almashtiriladi (bitta so'rov tahrirlanadi, `docId` o'zgarmaydi).
- **Response:**
```json
{ "error": false, "message": "So'rov omborga yuborildi", "error_code": 200,
  "data": { "androidId": 77, "docId": "166", "docNumber": "YK-2026-0036", "holat": "kutilmoqda", "dona": 84, "summa": 2010000 } }
```
- **Xatolar** (`error: true`): omborda yetmasa — `"Omborda yetarli emas — Sut 1L: so'raldi 24, omborda 23"`; kun yopilgan bo'lsa — `"Siz kunni yopgansiz. Yana yuklash kerak bo'lsa, avval kunni qayta oching"`.

### 15.6 `GET yuklashlar/` — shu kungi yuklash hujjatlari
- **Query:** `sana` (ixtiyoriy)
```json
[ { "docId": "166", "docNumber": "YK-2026-0036", "sana": "2026-10-13", "manba": "mobil",
    "holat": "yuklandi", "vaqt": "2026-10-13T09:44:23Z", "tasdiqVaqt": "2026-10-13T09:50:00Z",
    "agentQabulVaqt": null, "radSababi": "", "izoh": "", "dona": 48, "summa": 1621200,
    "products": [ { "tovarId": "1", "tovar": "Sut 1L", "turkum": "Sut mahsulotlari", "dona": 36, "blok": 3, "narx": 18700, "summa": 673200 } ] } ]
```
| `holat` | Ma'nosi |
|---|---|
| `kutilmoqda` | So'rov omborchida |
| `yuklandi` | Omborchi tasdiqladi, tovar mashinaga o'tdi — agent qabul qilishi kerak |
| `qabul_qilindi` | Agent ilovada qabul qildi |
| `rad_etildi` | Omborchi rad etdi — sabab `radSababi` da |
| `bekor_qilindi` | Agent o'zi bekor qildi yoki kun yopilgani uchun bekor bo'ldi |

### 15.7 `POST yuklashQabul/` — "yukni sanab qabul qildim"
- **Body:** `{ "docId": "166", "izoh": "1 blok sut yo'q edi" }` (`izoh` ixtiyoriy — farq bo'lsa yoziladi, omborchi ko'radi)
- **Response `data`:** 15.6 dagi bitta hujjat (`holat: "qabul_qilindi"`). Takror chaqirilsa xato bermaydi.

### 15.8 `POST yuklashBekor/` — so'rovni qaytarib olish
- **Body:** `{ "docId": "168" }` — faqat `kutilmoqda` holatidagi o'z so'rovi. **Response `data`:** hujjat (`holat: "bekor_qilindi"`).

### 15.9 `GET kunYakuni/` — omborga nima topshiriladi
- **Query:** `sana` (ixtiyoriy)
```json
{
  "sana": "2026-10-13", "holat": "ochiq", "holatNomi": "Savdoda",
  "tovar": { "kunBoshi": 274, "berildi": 96, "sotildi": 8, "qaytdi": 1, "qolishiKerak": 363, "mashinadaHozir": 363 },
  "topshiriladiganTovarlar": [ { "tovarId": "7", "tovar": "Non", "turkum": "Non mahsulotlari", "blokdagiSoni": 20, "qoldiq": 120, "narx": 20400, "summa": 2448000 } ],
  "pul": { "sotuvJami": 270400, "naqdSotuv": 202800, "qarzgaSotuv": 67600,
           "naqdOlindi": 202800, "topshirildi": 0, "topshirishKerak": 202800 },
  "mijozlar": [ { "klientId": "1001", "klient": "Farrux savdo markazi", "sotuv": 123000, "naqd": 123000 } ],
  "kunYopish": null
}
```
> `naqdOlindi` = naqd sotuvlar + mijozlardan undirilgan qarz (`savePayment`). Agent kassaga aynan `topshirishKerak` summani olib keladi.

### 15.10 `POST kunniYopish/` — "savdo tugadi, topshirishga tayyorman"
- **Body:** `{ "naqdSumma": 197800, "izoh": "Test" }` — `naqdSumma` agentning o'zi sanagan naqd (ixtiyoriy, lekin so'rash tavsiya etiladi)
- **Response:**
```json
{ "error": false, "message": "Kun yopildi — omborga tovar va naqdni topshiring", "error_code": 200,
  "data": { "sana": "2026-10-13", "kutilganNaqd": 202800, "elonNaqd": 197800, "farq": -5000, "topshiriladiganDona": 363 } }
```
> `farq` ≠ 0 bo'lsa ilova agentga **omborga kelishdan oldin** ko'rsatsin ("Tizimda 202 800, siz 197 800 sanadingiz — 5 000 kam").
> Kun yopilgach tasdiqlanmagan so'rovlar avtomatik bekor bo'ladi va yangi so'rov yuborib bo'lmaydi.
- **Qayta ochish** (xato bosilgan bo'lsa): body `{ "bekor": true }` → `data: { "sana": "...", "ochildi": true }`. Ombor qabulni boshlagan bo'lsa ruxsat berilmaydi.
- **Xatolar:** bugun yuklash ham, savdo ham bo'lmagan; kun allaqachon yopilgan.

---

## 16. TASHRIF va JOYLASHUV — `agent`

Agent mijozga borganda **check-in**, ketganda **check-out** qiladi. Ikkalasida ham GPS nuqta yuboriladi — server mijoz nuqtasigacha masofani hisoblaydi.

### 16.1 `POST checkIn/` — mijozga keldi
- **Body:** `{ "klientId": "1001", "lat": 40.3757, "long": 71.8587 }`
- **Response `data`:**
```json
{ "tashrifId": 13045, "masofa": 33, "uzoqda": false, "mijozNuqtasiBelgilandi": false }
```
> Shu kunda shu mijozda ochiq tashrif bo'lsa yangisi ochilmaydi: `{ "tashrifId": 13045, "davomEtyapti": true }`.
> Mijozning koordinatasi hali bo'lmasa, check-in nuqtasi mijoz manzili sifatida saqlanadi (`mijozNuqtasiBelgilandi: true`).

### 16.2 `POST checkOut/` — mijozdan ketdi
- **Body:** `{ "tashrifId": 13045, "lat": 40.3757, "long": 71.8587, "natija": "savdo", "arizaId": "9878" }` — `natija`: `savdo` | `sotmaslik`
- **Response `data`:** `{ "tashrifId": 13045, "davomiylik_sek": 540 }`
> Tashrif ichida `saveSell` qilinsa, server tashrifni o'zi `natija: "savdo"` qilib sotuvga bog'laydi.

### 16.3 `GET marshrutReja/` — bugungi marshrut (rejalashtirilgan mijozlar)
- **Query:** `sana` (ixtiyoriy)
```json
[ { "rejaId": 1, "klientId": 1001, "klientName": "Farrux savdo", "klientAdress": "...", "klientLat": "40.37", "klientLong": "71.85",
    "tartib": 1, "izoh": "", "bajarildi": false, "checkinQilingan": false, "tashrifId": null } ]
```

### 16.4 `GET bugungiTashriflar/` — bugungi tashriflar
```json
[ { "tashrifId": 13045, "klientId": 1001, "klientName": "Farrux savdo", "checkinVaqt": "...", "checkoutVaqt": null, "natija": "ochiq", "davomEtyapti": true } ]
```

### 16.5 Joylashuv qoidalari (ilova uchun)
1. `sendLocation` (4.9) — agent ish vaqtida har 1–2 daqiqada fon rejimida yuboradi (batch). Web'da "Agentlar → Online" va Avtolavka markazidagi "GPS N daq oldin" shundan.
2. `checkIn`, `checkOut`, `saveSell`, `saveVozvrat` — har birida o'sha paytdagi `lat`/`long` yuborilsin.
3. "Uzoqda" chegarasi serverda — standart **300 m** (`.env`: `SOTUV_RADIUS_M`). Savdo bloklanmaydi, faqat belgilanadi.

---

## 17. DOSTAVCHIK (pre-sale yetkazish) — `isDeliver`

Agent buyurtma yozadi, ombor yig'adi, **dostavchik** ertalab mashinaga ortib yetkazadi, pul oladi, kechqurun kassaga topshiradi. Login (`2.1`) `dostavchi` jadvalidan (`isDeliver: true, isAgent: false`); `mashina` va `transport` maydonlari ham keladi.

Eski `getDokDelivery` / `orderDelivery` (9-bo'lim) ishlashda davom etadi, lekin yangi ilova quyidagi endpoint'lardan foydalanadi — ular **kim yetkazganini, qayerda, qancha naqd olganini** yozadi.

### 17.0 Dostavchikning kuni

| # | Dostavchik (mobil) | Ofis (web) |
|---|---|---|
| 1 | Ertalab: `dostavchikHolat` — bugungi marshrut, nechta manzil, jami summa | Ombor buyurtmalarni yig'ib, "Yo'lda"ga o'tkazib, dostavchikka tayinlaydi (trip sheet ixtiyoriy) |
| 2 | **`reysBoshla`** — mashina chiqdi (GPS). Trip sheet bo'lmasa — o'zi yaratiladi | Dostavchi kartasida reys "yo'lda" |
| 3 | `marshrut` — tartiblangan manzillar, har biriga masofa, mijoz qarzi, tovar ro'yxati | — |
| 4 | Mijozda: **`yetkazdim`** (qisman qaytarish/brak + olingan naqd + GPS, bitta so'rov) yoki **`yetkazilmadi`** (sabab) | Buyurtma "yetkazildi"; naqd kassada *dostavchik qo'lida*; qolgani mijoz qarziga; qaytarma omborga, brak brak omboriga |
| 5 | Mijozdan eski qarzni ham undirish — `qarzTolov` | Mijoz qarzi kamayadi |
| 6 | **`dostavchikKunYakuni`** → **`reysYakunla`** (o'zi sanagan naqd bilan) | Dostavchi kartasi → **Kassa** tabi: yig'ilgan, o'zi sanagan, farq → "Qabul qilish" |

### 17.1 `GET dostavchikHolat/` — "Mening kunim"
- **Query:** `sana` (ixtiyoriy), `lat`, `long` (ixtiyoriy — `keyingi` ga masofa uchun)
```json
{ "sana": "2026-10-15", "bosqich": 1, "holat": "yolda", "holatNomi": "Yo'lda",
  "trip": { "tripId": 1360, "raqam": "TS-2026-10-15-001", "holat": "yolda", "boshlanganVaqt": "…", "tugaganVaqt": null },
  "jami": { "buyurtma": 5, "yetkazildi": 2, "qoldi": 3, "urinilgan": 1, "summa": 3036200, "yetkazildiSumma": 891600, "dona": 120 },
  "pul": { "naqdQolda": 814200, "yigildi": 814200, "topshirildi": 0, "tolovSoni": 3 },
  "keyingi": { …17.2 dagi buyurtma… },
  "naqdElon": null }
```
`bosqich`: 0 — reys boshlanmagan (`tayyor` / `bosh`), 1 — `yolda`, 2 — hammasi yetkazildi (`topshirish`), 3 — `yopiq`.

### 17.2 `GET marshrut/` — bugungi buyurtmalar
- **Query:** `sana`, `lat`, `long` (masofa shu nuqtadan hisoblanadi)
```json
{ "trip": { "tripId": 1360, "raqam": "TS-2026-10-15-001", "holat": "yolda" },
  "sabablar": [ { "id": "yopiq", "nom": "Do'kon yopiq" }, { "id": "mijoz_yoq", "nom": "Mijoz joyida yo‘q" }, … ],
  "buyurtmalar": [ {
    "docId": "9472", "docNumber": "AR-2026-1163", "tartib": 1, "holat": "yolda",
    "klientId": "8", "klient": "Baraka baza", "klientTel": "+998…", "klientTel2": "", "klientAdres": "…", "moljal": "",
    "klientLat": 40.4542, "klientLong": 71.7953, "masofa": 7258, "klientQarz": 0,
    "agent": "Sherzod Karimov", "summa": 659400, "tolovTuri": "naqt", "naqdKutiladi": true, "tolangan": 0,
    "izoh": "", "urinish": 0, "urinishIzoh": "", "yetkazilganVaqt": null,
    "products": [ { "tovarId": "6", "tovar": "Suv 1.5L", "turkum": "Ichimliklar", "dona": 60, "blok": 5, "narx": 21400, "summa": 1284000 } ]
  } ] }
```
`holat`: `yolda` — yetkaziladi; `yetkazildi` — bajarildi (ro'yxatda qoladi). **2026-10-20 dan:** dostavchik faqat web Buyurtmalar'da unga tayinlanib **yo'lga chiqarilgan** (`yolda`) buyurtmani ko'radi — `tasdiqlangan` / `yigilmoqda` buyurtma trip sheet'da unga biriktirilgan bo'lsa ham kelmaydi (tovar hali omborda), 17.5/17.6 ham faqat `yolda` ni qabul qiladi. Ro'yxat trip sheet'ga emas, `dostavchi_id` ga qaraydi: reys boshlangandan keyin jo'natilgan zakaz ham tushadi (reys tartibida, reysga hali qo'shilmaganlari oxirida). Eski `getDokDelivery` (9.1) ham dostavchik uchun faqat `yolda`.

### 17.3 `GET buyurtma/` — bitta buyurtma (urinishlar tarixi bilan)
- **Query:** `docId`, `lat`, `long`. **Response:** 17.2 dagi obyekt + `urinishlar: [{ sabab, sababNomi, izoh, vaqt }]`.

### 17.4 `POST reysBoshla/` — mashina chiqdi
- **Body:** `{ "lat": 40.39, "long": 71.78 }`
- **Response `data`:** `{ "tripId", "raqam", "holat": "yolda", "boshlanganVaqt" }`. Takror chaqirilsa xato bermaydi — har chaqiriqda reysda hali yo'q yo'ldagi buyurtmalar reys oxiriga qo'shiladi. Buyurtma tayinlanmagan bo'lsa `error:true`.

### 17.5 `POST yetkazdim/` — mijozga topshirildi
- **Body:**
```json
{ "docId": "9473", "lat": 40.39, "long": 71.78,
  "naqd": 134800,
  "qaytarish": [ { "tovarId": "587", "dona": 1, "tur": "qaytarma", "sabab": "Ortiqcha" },
                 { "tovarId": "587", "dona": 1, "tur": "brak", "sabab": "Siniq" } ],
  "izoh": "" }
```
> `naqd` — joyida olingan naqd. Yuborilmasa: `tolovTuri` naqd bo'lsa to'liq summa, aks holda 0 (hammasi qarzga). `qaytarish` — mijoz olmagan tovar: `qaytarma` omborga sotuvga qaytadi, `brak` brak omboriga; buyurtma summasi shunga mos kamayadi.
- **Response:**
```json
{ "error": false, "message": "Yetkazildi · 97 400 so'm qarzga yozildi", "error_code": 200,
  "data": { "docId": "9473", "docNumber": "AR-2026-1164", "summa": 232200, "naqd": 134800, "qarzgaYozildi": 97400,
            "qaytarildi": 2, "masofa": 3336, "uzoqda": true } }
```
Allaqachon yetkazilgan bo'lsa `data.allaqachon: true` (xato emas — offline navbat uchun). Boshqa dostavchiga tayinlangan bo'lsa `403`.

### 17.6 `POST yetkazilmadi/` — yetkazib bo'lmadi, buyurtma navbatda qoladi
- **Body:** `{ "docId": "9873", "sabab": "yopiq", "izoh": "Soat 3 da ochiladi", "lat": …, "long": … }` — `sabab` 17.2 dagi `sabablar` ro'yxatidan
- **Response `data`:** `{ "docId", "urinish": 1 }`. Buyurtma holati o'zgarmaydi; webda "1 urinish · Do'kon yopiq" ko'rinadi.

### 17.7 `POST qarzTolov/` — mijozdan eski qarzni undirish
- **Body:** `{ "klientId": "356", "summa": 20000, "izoh": "" }`
- **Response `data`:** `{ "klientId", "summa", "yangiQarz": 77400 }`. Naqd dostavchik qo'lida (kassada `user_id` = dostavchik).

### 17.8 `GET dostavchikKunYakuni/` — omborga nima qaytadi, kassaga nima topshiriladi
```json
{ "sana": "2026-10-15", "holat": "yolda",
  "buyurtma": { "jami": 5, "yetkazildi": 2, "yetkazilmadi": 3, "summa": 891600 },
  "pul": { "yigildi": 814200, "topshirildi": 0, "topshirishKerak": 814200, "tolovSoni": 3, "qarzgaYozildi": 97400 },
  "omborgaQaytadi": [ { "tovarId": "587", "tovar": "Sprite 1.5L", "yetkazilmagan": 12, "qaytarma": 1, "brak": 1, "jami": 14 } ],
  "yetkazilmaganlar": [ { "docId": "9873", "docNumber": "AR-2026-1327", "klient": "Chashma minimarket", "summa": 1369200, "urinishIzoh": "Do'kon yopiq — Soat 3 da ochiladi" } ],
  "naqdElon": null, "yopishVaqt": null }
```

### 17.9 `POST reysYakunla/` — kun yopildi
- **Body:** `{ "naqdSumma": 807200, "izoh": "", "lat": …, "long": … }` — `naqdSumma` dostavchik o'zi sanagan naqd (ixtiyoriy)
- **Response `data`:** `{ "tripId", "kutilganNaqd": 814200, "elonNaqd": 807200, "farq": -7000 }`. Yetkazilmagan buyurtmalar `yolda` holatida qoladi — ertaga yana marshrutga tushadi (yoki ofis bekor qiladi).

### 17.10 `GET dostavchikSinxron/` — oflayn ilova uchun bitta so'rovda hammasi
React Native ilovaning dostavchik rejimi (`mobile-rn/`) shu nusxani telefonda saqlaydi va internetsiz ishlaydi.
- **Response `data`:** `{ serverVaqt, sana, dostavchi: { id, ism, mashina, transport }, holat: { bosqich, holat, holatNomi, trip, jami, pul, naqdElon }, sabablar: [...], buyurtmalar: [ 17.2 dagi buyurtma + "urinishlar": [ { sabab, sababNomi, izoh, vaqt } ] ], qaytarishlar: [ { docId, tovarId, tovar, dona, summa, tur: "qaytarma"|"brak" } ] }` — `qaytarishlar` faqat bugungi.

**Oflayn yuborish (17.4–17.9):** telefondagi navbatdan keyin yuborilgan so'rovlarga ilova qo'shadi:
- `vaqt` — amal haqiqatda bajarilgan vaqt (ISO); server sanani shundan oladi.
- `oflayn: true` — internetsiz qilingan (`yetkazdim` da `ariza.oflayn` belgilanadi).
- `mobilId` — takrorlanmas kalit (`yetkazilmadi` → `yetkazish_urinish.mobil_id`, `qarzTolov` → `kassa.mobil_id`).

Qayta yuborilsa, ikki marta yozilmaydi:
- `yetkazdim` — `allaqachon: true` qaytaradi;
- `reysBoshla` va `reysYakunla` — joriy holatni qaytaradi;
- `yetkazilmadi` va `qarzTolov` — `mobilId` bo'yicha `takror: true` qaytaradi.

Ilova birinchi yetkazishdan oldin reysni o'zi boshlaydi: trip bo'lmasa `reysYakunla` rad etiladi.

---

## 18. NARX RO'YXATLARI VA MIJOZ TOIFALARI

Har bir **narx ro'yxati** — tovarlar bo'yicha narx to'plami (masalan "Supermarket VIP", "Optom 2026"). **Mijoz toifasi** (Do'kon, Supermarket, Optom baza, Kafe/Restoran) shu ro'yxatlardan biriga biriktiriladi. Mijozning narxi quyidagi ustunlik bilan aniqlanadi (har tovar uchun alohida):

| # | Manba | Qachon |
|---|---|---|
| 1 | `ruyxat` | Mijozning toifasiga biriktirilgan ro'yxatda tovar narxi bor |
| 2 | `standart` | Ro'yxatda yo'q — mijozning narx turiga (`optom`/`chakana`) mos standart ro'yxatda bor |
| 3 | `eski` | Ikkalasida ham yo'q — `tovar_register` dagi oxirgi optom/chakana narx |
| 4 | `yoq` | Hech qayerda narx yo'q (narx 0) |

Migratsiya (`20261016000001-narx-ruyxat`) mavjud narxlardan ikkita standart ro'yxat yaratadi: "Chakana (standart)" va "Optom (standart)". Shuning uchun mavjud sotuvlar narxi o'zgarmaydi.

### 18.1 Ma'lumot modeli
- `narx_ruyxat`: `id, nomi, tur (optom|chakana|maxsus), standart (bool), faol, izoh`. Har tur uchun bitta `standart` bo'ladi.
- `narx_ruyxat_qator`: `narx_ruyxat_id, tovar_id, narx` (`narx_ruyxat_id`+`tovar_id` yagona). Narx 0 bo'lsa qator yo'q.
- `mijoz_kategoriya.narx_ruyxat_id`: toifaga biriktirilgan ro'yxat (bo'sh bo'lsa standart ishlaydi).

### 18.2 Web (Admin/Programmer yozadi; o'qish — barcha login qilganlar)
Baza: `/api/v1/narx-ruyxatlar`

| Metod | Yo'l | Tavsif |
|---|---|---|
| GET | `/` | Barcha ro'yxatlar, `tovar_soni` va `kategoriya_soni` bilan |
| GET | `/:id` | Ro'yxat + barcha faol tovarlar: `narx` (ro'yxatda, 0 — yo'q), `eski_chakana`, `eski_optom` |
| POST | `/` | `{ nomi, tur, standart?, faol?, izoh? }` — `standart: true` bo'lsa shu turdagi eski standart bekor qilinadi |
| PATCH | `/:id` | Xuddi shu maydonlar, qisman. `standart: true` — boshqasini almashtiradi |
| DELETE | `/:id` | Standart ro'yxatni o'chirib bo'lmaydi (400). Javob: `{ toifalardan_uzildi }` |
| PUT | `/:id/narxlar` | `{ qatorlar: [{ tovar_id, narx }] }` — **to'liq almashtirish**. Narx 0 yoki yo'q tovar qatori o'chadi. Mavjud bo'lmagan tovar — 400 |
| GET | `/mijoz/:mijozId` | Mijoz uchun amaldagi narxlar: `{ ruyxat, narxlar: [{ tovar_id, narx, manba }] }` |

Toifa: `PATCH /mijozlar/kategoriya/:id` va `POST /mijozlar/kategoriya` ga `narx_ruyxat_id` (raqam yoki `null`) yuboriladi.

### 18.3 Mobil (avtolavka agenti)
**GET `mijozNarxlari/?klientId=`** — sotuv ekrani shu mijoz uchun tovar narxini oladi.
```json
{ "error": false, "data": {
    "ruyxat": { "id": 3, "nomi": "Do'kon VIP", "tur": "maxsus" },
    "narxlar": [
      { "tovarId": "1", "narx": 17000, "manba": "ruyxat" },
      { "tovarId": "4", "narx": 19200, "manba": "standart" }
  ] } }
```
- `ruyxat` — mijozning asosiy ro'yxati (toifa yoki standart), bo'lmasa `null`.
- Agent narxni qo'lda o'zgartirishi mumkin — bu `yangiNarx` sifatida `saveSell` ga boradi (ro'yxat narxi — taklif, majburiy emas).
- `klientId` yo'q bo'lsa `error: true, "klientId kerak"`.
- Internet yo'q bo'lsa ilova oxirgi javobni keshdan oladi.

### 18.4 Qayerda ishlatiladi
- Web: Sozlamalar → Narx (ro'yxatlar va tovar narxlari), Sozlamalar → Mijoz kategoriyasi (ro'yxat biriktirish), Sotuvlar → yangi sotuv (mijoz tanlanganda shu narxlar).
- Mobil: Sotuv ekrani (sarlavhada ro'yxat nomi, narx ro'yxatdan olinadi).
- Dostavchik buyurtmalari (17-bo'lim) narxni `ariza` dan oladi, o'zgartirmaydi.

---

## 19. AVTOLAVKA OFLAYN (React Native ilova, `mobile-rn/`)

Ilova internetsiz ham sotadi: barcha amallar avval telefondagi SQLite'ga yoziladi, so'ng navbat orqali ketma-ket yuboriladi. Server tomonda ikki narsa kafolatlanadi: **takroriy yuborish ikki marta yozilmaydi** va **amal haqiqiy vaqti bilan yoziladi**.

### 19.1 `GET avtolavkaSinxron/` — oflayn uchun hamma narsa bitta so'rovda
Ilova har sinxronda (internet qaytganda, har 30 s, pastga tortilganda) shuni oladi va mahalliy bazani yangilaydi.
```json
{ "serverVaqt": "…", "sana": "2026-10-16",
  "agent": { "id": 9, "ism": "Jahongir Mirzayev", "ombor": "Agent: Jahongir Mirzayev" },
  "holat": { …15.1 avtolavkaHolat bilan bir xil… },
  "mashina": { "qatorlar": [ { "tovarId": "12", "tovar": "Non", "turkum": "Non", "blokdagiSoni": 1, "qoldiq": 118, "narx": 10200, "summa": 1203600 } ], "jami": { … } },
  "mijozlar": [ { "klientId": "1", "nomi": "Anvar do'koni", "yuridikNomi": "", "tel": "+998…", "tel2": "", "manzil": "…", "moljal": "",
                  "lat": 40.47, "lng": 71.71, "qarz": 20400, "balans": -20400, "kreditLimit": 0, "narxTuri": "chakana",
                  "ruyxatId": null, "tashrifKunlari": "Du,Ch" } ],
  "reja": [ { "klientId": "1", "tartib": 1, "izoh": "" } ],
  "tashriflar": [ { "tashrifId": 13045, "klientId": "1", "checkinVaqt": "…", "checkoutVaqt": "…", "natija": "savdo", "arizaId": null } ],
  "narx": { "standart": { "chakana": 1, "optom": 2 },
            "ruyxatlar": [ { "id": 1, "nomi": "Chakana (standart)", "tur": "chakana", "narxlar": { "12": 10200 } } ],
            "eski": { "12": { "chakana": 10200, "optom": 9600 } } },
  "sabablar": [ { "id": "1", "name": "Do'kon yopiq" }, { "id": "2", "name": "Pul yo'q" }, { "id": "3", "name": "Tovar kerak emas" } ] }
```
- `mijozlar` — agentga biriktirilgan faol mijozlar + bugungi rejadagi boshqa mijozlar.
- `narx` — faqat mashinadagi tovarlar uchun. Ilova narxni 18-bo'lim qoidasi bilan o'zi hisoblaydi: `ruyxatId` (toifa ro'yxati) → `standart[narxTuri]` → `eski[narxTuri]`.

### 19.2 Oflayn maydonlar (mavjud endpoint'larga qo'shildi, hammasi ixtiyoriy)

| Endpoint | Maydon | Ma'nosi |
|---|---|---|
| `saveSell/` | `mobilId` | Takrorlanmas kalit (`^[A-Za-z0-9_.:-]{8,64}$`). Shu kalit bilan sotuv bor bo'lsa — yangisi yaratilmaydi, borini `takror: true` bilan qaytaradi |
| `saveSell/` | `vaqt` | Sotuv haqiqatda qilingan vaqt (ISO). Kassa, ombor chiqimi va agent registri shu vaqtga yoziladi. Kelajakdagi yoki 7 kundan eski vaqt — server vaqti olinadi |
| `saveSell/` | `oflayn` | `true` — internetsiz qilingan. Kredit limiti tekshiruvi bloklamaydi (tovar mijozga allaqachon berilgan), `ariza.oflayn = 1` |
| `saveSell/` | `tolanganSumma` | Avtolavkada joyida olingan naqd: shu summa kassaga, qolgani mijoz qarziga (qisman to'lov). Berilmasa — `currency` bo'yicha |
| `savePayment/` | `mobilId`, `vaqt` | Xuddi shunday — takroriy to'lov yozilmaydi (`takror: true`) |
| `checkIn/` | `vaqt` | Haqiqiy kelgan vaqt |
| `checkOut/` | `klientId`, `vaqt` | `tashrifId` o'rniga: shu mijozdagi oxirgi ochiq tashrif yopiladi. Ochiq tashrif bo'lmasa — xato emas |

Kredit limiti endi faqat **qarzga ketadigan qism** uchun tekshiriladi (naqd sotuv bloklanmaydi) — web bilan bir xil.

### 19.2a Qolgan jarayonlar ham oflayn (v2.1)

| Jarayon | Endpoint | Oflayn kontrakt |
|---|---|---|
| Yangi mijoz | `saveKlient/` | Parametrlar query yoki body'da. `mobilId` — takror kelsa borining `klientId` si `takror: true` bilan qaytadi. Ilova mijozni `yangi-…` vaqtinchalik id bilan yaratadi, javobdan keyin unga tegishli sotuv, to'lov, tashrif va navbatdagi so'rovlarni haqiqiy id'ga o'tkazadi |
| Yuklash so'rovi | `yuklashSorov/` | Bir kunda bitta qoralama: qayta yuborilsa qatorlari almashtiriladi (takror xavfsiz) |
| Yuk qabuli | `yuklashQabul/` | Qayta yuborilsa xato bermaydi |
| Kunni yopish | `kunniYopish/` | `sana` (YYYY-MM-DD, 3 kungacha orqaga) — kun shu sanaga yopiladi |

`avtolavkaSinxron` javobiga qo'shildi: `ombor` (asosiy ombordagi tovarlar — `yuklashTovarlar` shaklida), `tavsiya` (`yuklashTavsiya` shaklida), `yuklashlar` (bugungi hujjatlar — `yuklashlar` shaklida). Shu bilan yuklash formasi va Mashina ekrani internetsiz ochiladi.

Faqat bitta narsa internetsiz bo'lmaydi: omborchi webda tasdiqlagan yukni telefon bilishi uchun bir marta sinxron kerak (odatda omborda).

### 19.3 Ilovaning navbat qoidasi
1. Yozuvlar yaratilish tartibida ketma-ket yuboriladi (`checkIn` → `saveSell` → `checkOut`).
2. Tarmoq xatosi — to'xtaydi, keyingi safar davom etadi. Server `5xx` — 5 martagacha qayta urinadi.
3. Server `4xx` bilan rad etsa (masalan, mashinada tovar yetmaydi) — yozuv "rad etildi" bo'lib qoladi; agent "Navbat" ekranida qayta yuboradi yoki o'chiradi.
4. Navbat bo'sh bo'lmaguncha agent tizimdan chiqa olmaydi va kunni yopa olmaydi.

---

## 20. QARZ TO'LOV SANASI, CHEK TARIXI VA ZAXIRA (2026-10-17)

### 20.0 `saveSell/` ga qo'shimchalar
- **`tolovSana`** (ixtiyoriy, `YYYY-MM-DD` yoki `DD.MM.YYYY`) — qarzga yoki qisman sotuvda mijoz qarzni qachon to'lashi (agent kalendardan belgilaydi). Faqat sotuvning qarz qismi bo'lsa saqlanadi (`ariza.tolov_sana`); sotuv kunidan oldingi sana e'tiborsiz qoldiriladi. Muddati o'tgan qarz va kredit bloki shu sana bo'yicha hisoblanadi; sana bo'lmasa — sotuv sanasi + mijozning `tolov_muddati_kun` (standart 30). React Native ilovasi (`mobile-rn/`, v2.3) qarzli sotuvda sanani majburiy so'raydi.
- **Zaxira:** oddiy agent zakazi (avtolavka emas) skladdagi mavjud qoldiqdan oshsa — `error_code: 400`, `message`: `Skladda yetarli tovar yo'q: "Fanta 1.5L" — so'raldi 20, mavjud 7`. Hech narsa yaratilmaydi. Oflayn yig'ilgan zakaz (`oflayn: true`) bloklanmaydi — yig'ish bosqichida web tekshiradi. `editSell/` ham shu qoida bilan (tahrirlanayotgan zakazning o'z bandi hisobga olinmaydi).
- **Kredit bloki (402):** mijozning to'lov sanasidan o'tgan to'lanmagan qarzi bo'lsa (FIFO: to'lovlar eng eski savdolarni yopadi): `Mijozning to'lov sanasidan N kun o'tgan qarzi bor (X so'm). Avval qarzni yopish kerak.` Avval to'langan eski savdolar ham bloklardi — endi faqat haqiqatan to'lanmagan qism.

### 20.1 `GET mijozCheklar/` — mijozning chek tarixi
- **Query:** `klientId` (yoki `clientId`), `page` (0 dan, sahifada 20 yozuv)
- **Response:**
```json
{ "error": false, "message": "", "error_code": 200, "data": {
  "mijoz": { "klientId": "20", "nomi": "Zumrad savdo", "qarz": 3714225, "kreditLimit": 4000000, "tolovMuddatiKun": 30 },
  "jami": { "cheklar": 23, "xaridSumma": 20033600, "tolovSumma": 8898975, "ochiqQarz": 3714225 },
  "page": 0, "pages": 2,
  "data": [
    { "tur": "chek", "id": "9771", "raqam": "AR-2026-0837", "sana": "2026-09-19T05:10:00.000Z",
      "holat": "yetkazildi", "holatNomi": "Yetkazilgan", "agent": "Sherzod Karimov",
      "tolovTuri": "qarz", "jami": 362700, "tolangan": 0, "qarzga": 362700,
      "qolganQarz": 362700, "tolovSana": "2026-10-19", "sanaBelgilangan": false, "kechikkanKun": 0, "izoh": "",
      "qatorlar": [ { "tovarId": "5", "tovar": "Fanta 1.5L", "dona": 12, "narx": 20000, "summa": 240000 } ] },
    { "tur": "tolov", "id": "k812", "raqam": "TL-812", "sana": "2026-10-10T06:08:00.000Z", "jami": 446200, "usul": "naqt", "izoh": "" }
  ] } }
```
- `tur`: `chek` (sotuv), `tolov` (mijoz to'lovi), `qaytarish`. Yangidan eskiga tartiblangan. Bekor qilingan buyurtmalar kirmaydi.
- `tolovTuri`: `naqd` | `qisman` | `qarz` (joyida olingan pulga qarab). `qolganQarz` — shu chekdan hozir to'lanmay qolgani (FIFO), `tolovSana` — uning to'lov sanasi, `sanaBelgilangan` — agent kalendardan qo'yganmi, `kechikkanKun` — sanadan necha kun o'tgan (0 — o'tmagan).

### 20.2 `avtolavkaSinxron/` — mijozga qo'shildi
- `mijozlar[].tolovMuddatiKun` — mijozning to'lov muddati (kun); ilova kalendarda shu muddatni tezkor tugma sifatida taklif qiladi.

---

## 21. UCH ROL BITTA ILOVADA — DISTRIBUTSIYA AGENTI (`agentSinxron`) (2026-10-18)

React Native ilova (`mobile-rn/`) login javobidagi flaglar bo'yicha rejimni tanlaydi:

| Rol | Flag | Nima qiladi | Oflayn nusxa |
|---|---|---|---|
| Distributsiya agenti | `isAgent && !isAvtolavka` | Mijozlarga boradi, **zakaz** oladi (tovar skladdan, dostavchik yetkazadi va naqdni u oladi), eski qarzni undiradi | `GET agentSinxron/` |
| Avtolavka agenti | `isAvtolavka` | Tovar mashinasida — o'zi sotadi, naqd oladi, kun oxirida topshiradi | `GET avtolavkaSinxron/` (19) |
| Dostavchik | `isDeliver` (agent emas) | Tayinlangan buyurtmani yetkazadi, naqd oladi, qaytarma/brakni qayd etadi | `GET dostavchikSinxron/` (17.10) |

`dual_role` agent (isAgent va isDeliver birga) — agent rejimida ochiladi.

### 21.1 `GET agentSinxron/` — zakaz agentining oflayn nusxasi
- **Response `data`:**
```json
{ "serverVaqt": "…", "sana": "2026-10-18", "rejim": "agent",
  "agent": { "id": 1, "ism": "Sherzod Karimov", "ombor": "Основной склад" },
  "holat": { "sana", "rejim": "agent", "bosqich": 1, "holat": "savdo", "holatNomi": "Buyurtma yig'ish",
             "keyingiQadam": "savdo", "keyingiQadamMatn": "…", "mashina": { "tovarSoni", "dona", "summa" },
             "bugun": { "sotuvSoni", "sotuvDona", "sotuvSumma", "naqdSotuv", "qarzgaSotuv", "naqdQolda", "tashrif", "reja", "uzoqSotuv", "yuklandiDona": 0, "yuklandiSumma": 0 },
             "buyurtma": { "yangi": 1, "tasdiqlangan": 0, "yigilmoqda": 0, "yolda": 2, "yetkazildi": 33, "bekor": 3 },
             "pul": { "undirildi": 0, "tolovSoni": 0, "topshirildi": 0, "naqdQolda": 0, "inkassatsiya": null },
             "sorovlar": [], "qabulKutilmoqda": [], "kunYopish": null },
  "sklad": { "qatorlar": [ { "tovarId", "tovar", "turkum", "blokdagiSoni", "qoldiq", "band", "narx", "summa" } ], "jami": { "tovarSoni", "dona", "summa" } },
  "mijozlar": [ 19.1 bilan bir xil ], "reja": [...], "tashriflar": [...], "narx": {...}, "sabablar": [...],
  "buyurtmalar": [ { "docId", "docNumber", "mobilId", "klientId", "klient", "vaqt", "jonatishSana",
                     "holat": "yangi|tasdiqlangan|yigilmoqda|yolda|yetkazildi|bekor", "holatNomi", "bosqich": 1..5,
                     "summa", "dona", "tolovTuri": "naqt|qarz", "tolovSana", "tolangan", "dostavchi", "yetkazilganVaqt", "bekorSababi", "manba", "izoh",
                     "products": [ { "tovarId", "tovar", "dona", "narx", "summa" } ] } ] }
```
- `sklad.qatorlar[].qoldiq` — skladda **mavjud** (jismoniy − boshqa ochiq buyurtmalarga band, 20.0 bilan bir xil qoida); `band` — band qilingan miqdor. Ilova mashina jadvaliga shu ro'yxatni yozadi, agentning yuborilmagan zakazlari uni darhol kamaytiradi.
- `buyurtmalar` — agentning oxirgi 14 kunlik `sotish` hujjatlari; `bosqich` 1 yangi → 5 yetkazildi (bekor = 0). `holat.buyurtma` — shu ro'yxat bo'yicha sanoq.
- `holat.pul.undirildi` — bugun agent qabul qilgan mijoz to'lovlari (`kassa.manba_tur='mijoz'`, `user_id` = agent), `topshirildi` — bugungi inkassatsiya. Zakaz naqdini dostavchik oladi — agent kassasiga kirmaydi.

### 21.2 Zakaz — `POST saveSell/` (6.1) oddiy agentdan
- `currency`: `naqt` (yetkazishda naqd) yoki `qarz` (qarzga); `tolanganSumma` e'tiborga olinmaydi — naqdni dostavchik `yetkazdim/` da yozadi.
- `deliveryDate` (`YYYY.MM.DD`) — qachon yetkazilsin (`ariza.jonatish_sana`); ilova standart "ertaga" taklif qiladi.
- `tolovSana` — `currency='qarz'` bo'lsa majburiy (20.0).
- Hujjat `holat='yangi'` bilan tushadi: web **Arizalar** sahifasida ofis tasdiqlaydi → ombor yig'adi → "Yo'lda" bosqichida dostavchik tayinlanadi (`toplu-yolda`) → dostavchik ilovasi 17.5 bilan yetkazadi. Agent ilovasida shu bosqichlar `buyurtmalar[].bosqich` orqali ko'rinadi.

### 21.3 Web: kanal
- `GET /api/v1/arizalar?kanal=distributsiya|avtolavka`, `GET /api/v1/arizalar/statistika?kanal=…` (javobda `bosqich{yangi,tasdiqlangan,yigilmoqda,yolda,yetkazildi,bekor}` va `kanal{distributsiya,avtolavka}`), `GET /api/v1/mijozlar?kanal=…` — avtolavka mijozi — agenti `avtolavka=true`.
- **2026-10-22 dan** kanal ariza'ning o'z ustuni: `ariza.kanal` = `distributsiya` | `avtolavka` | `sklad` (ombor nomiga qaralmaydi). `sklad` — Won Sell → Sotuv qilish'da admin xodimsiz asosiy skladdan sotgani (`POST /api/v1/avtolavka/sotuv` `agent_id='sklad'`, `GET …/sotuv/tayyor?agent_id=sklad`); `?kanal=avtolavka` so'rovi `avtolavka`+`sklad`ni qaytaradi. Mobil javoblardagi ariza obyektlariga `kanal` maydoni qo'shildi (qo'shimcha maydon, eski maydonlar o'zgarmagan).

---

## 22. ISHLAB CHIQARISH (web, 2026-10-19) — `/api/v1/ishlab`

Kichik sex: xom ashyo → sof mahsulot (+ qo'shimcha mahsulot), tannarx bilan skladga kirim. Hisob qoidasi `utils/ishlab.utils.js` (CLAUDE.md da tavsif).

**Omborlar (2026-10-19):** tovar o'z TURI omborida turadi — `tovar.turi='xom_ashyo'` → `"Xom ashyo ombori"`, `'tovar'` (savdo tovari) → `"Основной склад"` (`utils/ombor.utils.js` `turOmbori`). Xom ashyo kirimda (prixod tasdig'i) avtomatik Xom ashyo omboriga tushadi, ishlab chiqarishga shu yerdan beriladi; tayyor savdo mahsuloti asosiy skladga kiradi, xom ashyo turidagi (yarim tayyor) mahsulot — Xom ashyo omboriga. Har qatorning `ombor`i hujjatda saqlanadi (bekor qilinganda o'sha joyga qaytadi). Xom ashyo savdo ro'yxatlarida chiqmaydi: web zakaz spravochnigi, mobil `getProducts`/kategoriyalar, agent sklad (`agentSinxron`), avtolavka yuklash, narx ro'yxatlari. Tovar turi o'zgarsa (`PATCH /tovar/:id { turi }`) qoldig'i yangi turi omboriga ko'chadi (`tovar_register.manba_tur='kochirish'`, tannarxda; javobda `kochirildi: { dona, dan, ga }`; ochiq buyurtmalarga band bo'lsa 400).

| Metod | Yo'l | Nima qiladi |
|---|---|---|
| GET | `/ishlab?holat&search&dan&gacha&page&limit` | Partiyalar + `stat` (shu oy: soni, qiymat, xarajat, chiqish_foiz, yo'qotish; ochiq qoralama/jarayonda; `xom_ombor: { nomi, tovar_soni, qiymat }`; `tartibsiz`) |
| GET | `/ishlab/spravochnik` | Tovarlar: `turi`, `ombor` (nomi), `qoldiq` (o'z omboridagi mavjud), `tannarx` (o'rtacha), so'nggi `optom_narx/chakana_narx`; `xarajat_turlari`; `tartibsiz` — noto'g'ri omborda turgan qoldiq (asosiy skladdagi xom ashyo, Xom ashyo omboridagi savdo tovari) |
| POST | `/ishlab/tartibla` | `tartibsiz` qoldiqning erkin qismini turi omboriga ko'chiradi → `{ kochdi: [{ nomi, dona, dan_nomi, ga_nomi }] }` |
| GET | `/ishlab/:id` | Hujjat + `qatorlar` (xom ashyoda `mavjud`, `joriy_tannarx`) + `xarajatlar` + `tarix` (shu mahsulotning oldingi partiyalari, o'rtacha chiqish va tannarx) |
| POST | `/ishlab` | Yangi qoralama `{ sana, izoh, taqsimlash: 'qiymat'|'miqdor', qatorlar[{ tur: 'xom_ashyo'|'mahsulot'|'qoshimcha', tovar_id, miqdor, narx, chakana_narx, optom_narx }], xarajatlar[{ nomi, summa, kassadan, tolov_usul }], boshlash?, yakunlash? }` |
| PATCH | `/ishlab/:id` | Qoralamada hammasi; jarayonda — faqat mahsulot, qo'shimcha va xarajatlar |
| POST | `/ishlab/:id/boshla` | Xom ashyo o'z omboridan chiqadi (o'rtacha tannarxda; mavjud qoldiqdan ko'p bo'lsa 400, xabarda ombor nomi) |
| POST | `/ishlab/:id/yakunla` | Haqiqiy natija → tannarx → mahsulot skladga kirim (turi bo'yicha); `kassadan` xarajatlar kassaga chiqim (`kategoriya='ishlab_chiqarish'`) |
| POST | `/ishlab/:id/bekor` | `{ sabab }` — tovar harakati qaytariladi; yakunlangan partiya faqat mahsulot omborda bo'lsa |
| POST | `/ishlab/:id/nusxa` | Shu partiyani takrorlash — yangi qoralama |

`qoshimcha.narx` — birlik bahosi (tannarxdan ayiriladi). `xom_ashyo.narx` — faqat ombordagi tannarx noma'lum bo'lsa ishlatiladi. Ombor jurnali: `/tahlil/jurnal?harakat=ishlab` (turi o'zgarishidagi ko'chirish — `harakat=kochirish`). `GET /tovar?turi=xom_ashyo|tovar` — turi bo'yicha filtr.

---

## 23. MOBIL ROLLAR (.env) VA `mobilSozlama/` (2026-11-19, Flutter ilova)

Qaysi rol oynalari ochilishini server `.env` belgilaydi:
```ini
MOBIL_ROLLAR=agent,avtolavka,dostavchik,tasdiq,audit   # bo'sh — hammasi yoqilgan
MOBIL_MIN_VERSIYA=1.0.0
```
Kalitlar: `agent` (distributsiya), `avtolavka`, `dostavchik`, `tasdiq` (`getConfirms`/`postConfirm`), `audit` (`chekUp`).

### 23.1 `GET mobilSozlama/` — token kerak emas
Ilova server manzili kiritilganda **bir marta** o'qiydi va keshlaydi (Sozlamalar → "Yangilash" bilan qayta o'qiladi).
```json
{ "error": false, "message": "", "error_code": 200, "data": {
    "sozlamaVersiya": 1, "serverVaqt": "2026-11-19T06:20:00.000Z", "biznesRejim": "distributsiya",
    "rollar": ["agent", "avtolavka", "dostavchik"],
    "rollarNomi": { "agent": "Distributsiya agenti", "avtolavka": "Avtolavka (ko'chma savdo)", "dostavchik": "Dostavchik" },
    "minIlovaVersiya": "1.0.0", "sotuvRadiusM": 300,
    "chek": { "nomi": "…", "telefon": "…", "manzil": "…", "izoh": "Xaridingiz uchun rahmat!" } } }
```
`chek` — web Sozlamalar → Chek rekvizitlari (`sozlama.chek_*`).

### 23.2 Server tomonda tekshiruv
- **Login (`Login/`)**: foydalanuvchining asosiy roli (`agent` / `avtolavka` / `dostavchik`) o'chirilgan bo'lsa — `error_code: 403`. Javobga qo'shildi: `asosiyRol`, `rollar` (= `.env` ∩ foydalanuvchi rollari). `isAvtolavka`, `isDeliver`, `isConfirmation` ham shu kesishma bilan beriladi (eski APK ham o'chirilgan oynani ko'rmaydi).
- **Har bir token'li so'rov**: asosiy rol keyin o'chirilsa — `403` (405 emas, ilova logout qilmaydi — xabar ko'rsatadi).
- **Route guruhlari**: dostavchik endpoint'lari (9, 16-trip, 17) `dostavchik`, `getConfirms`/`postConfirm` — `tasdiq`, `chekUp` — `audit` roli o'chiq bo'lsa `403` (dual_role agent uchun ham).

