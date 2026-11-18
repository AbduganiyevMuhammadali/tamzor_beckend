# Bazani o'rnatish

Yangi serverda bo'sh MySQL'dan to'liq ishlaydigan tizimga.

## 1. MySQL bazasini yaratish

```bash
mysql -u root -p
```

```sql
CREATE DATABASE disturbitor
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

-- Alohida foydalanuvchi (tavsiya etiladi)
CREATE USER 'sellz'@'localhost' IDENTIFIED BY 'KUCHLI_PAROL';
GRANT ALL PRIVILEGES ON disturbitor.* TO 'sellz'@'localhost';
FLUSH PRIVILEGES;
EXIT;
```

## 2. `.env` faylini sozlash

`beckend/.env`:

```ini
HOST=localhost
DB_PORT=3306
DB_USER=sellz
DB_PASS=KUCHLI_PAROL
DB_DATABASE=disturbitor

PORT=3003
SECRET_JWT=uzun_tasodifiy_satr
NODE_ENV=production

# Mobil ilova shu manzilga ulanadi (serverning tarmoqdagi IP'si)
MOBILE_API_IP=192.168.1.100
MOBILE_API_PORT=3003
```

`SECRET_JWT` uchun tasodifiy satr:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Bir buyruq bilan to'liq o'rnatish

```bash
cd beckend
npm install
npm run db:setup
```

`db:setup` uchta bosqichni ketma-ket bajaradi:

| Bosqich | Buyruq | Nima qiladi |
|---|---|---|
| 1 | `migrate:up` | 38 ta jadval yaratadi + Admin/Programmer |
| 2 | `db:bootstrap` | Agent, dostavchi, hudud, tovar, mijoz |
| 3 | `demo:all` | Savdo, to'lov, tashrif, GPS, inkassatsiya |

## Buyruqlar alohida

```bash
npm run migrate:up      # faqat jadvallar
npm run db:bootstrap    # faqat asosiy ma'lumot
npm run demo:all        # faqat demo harakatlar
```

Barchasi **idempotent** — qayta ishga tushirish xavfsiz, dublikat hosil qilmaydi.

## Kirish ma'lumotlari

| Kim | Login | Parol |
|---|---|---|
| Administrator | `Admin` | `admin123` |
| Dasturchi | `Programmer` | `123456` |
| Agent (mobil) | `sherzod`, `dilshod`, `bekzod`, `otabek` | `123456` |
| Dostavchi (mobil) | `jasur`, `islom`, `ravshan` | `123456` |

**Ishlab chiqarishga chiqarishdan oldin parollarni almashtiring.**

Parol ishlamasa — tashxis va tiklash:

```bash
npm run login:tekshir              # kim bor, paroli nima
node scripts/login-tekshir.js --tikla   # Admin parolini 123456 ga qaytarish
```

## Demo ma'lumotni yangilash

Demo sanaga bog'langan — sanalar bugungi kunga nisbatan hisoblanadi.
Prezentatsiya yoki namoyish kuni bir marta ishga tushiring:

```bash
npm run demo:all
```

## Demo ma'lumotni olib tashlash

Haqiqiy foydalanishga o'tishda:

```bash
npm run demo:seed  -- --tozala
npm run demo:agent -- --tozala
npm run demo:bugun -- --tozala
```

Faqat skript yaratgan yozuvlar o'chadi — qo'lda kiritilgan ma'lumotga tegilmaydi.

## Nusxa olish va tiklash

```bash
# Zaxira
mysqldump -u sellz -p disturbitor > sellz_$(date +%F).sql

# Tiklash
mysql -u sellz -p disturbitor < sellz_2026-08-20.sql
```

## Muammolar

**`Access denied for user`** — `.env` dagi `DB_USER` / `DB_PASS` ni tekshiring.

**`Unknown database`** — 1-bosqichdagi `CREATE DATABASE` bajarilmagan.

**`ER_NOT_SUPPORTED_AUTH_MODE`** — MySQL 8 da:

```sql
ALTER USER 'sellz'@'localhost'
  IDENTIFIED WITH mysql_native_password BY 'KUCHLI_PAROL';
FLUSH PRIVILEGES;
```

**Migratsiya to'xtab qolsa** — server ishga tushganda ham avtomatik
bajariladi (Umzug). `npm start` bilan ham o'tishi mumkin.
