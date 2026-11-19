#!/usr/bin/env bash
# Tekshiruv demo bazasini har kuni boshlang'ich holatga qaytaradi (cron).
# FAQAT tamzor_demo bazasi va tamzor-demo pm2 jarayoni bilan ishlaydi.
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:$PATH
cd "$(dirname "$0")/../.."
DB=tamzor_demo
PORT=3024
SIRLAR=/home/sellz/tamzor/demo.sirlar
[ "$DB" = "tamzor_demo" ] || { echo "Faqat demo baza!"; exit 1; }

pm2 stop tamzor-demo >/dev/null 2>&1 || true
mysql -e "DROP DATABASE IF EXISTS \`$DB\`; CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`$DB\`.* TO 'tamzor'@'localhost'; FLUSH PRIVILEGES;"
# Demo instansiya muhiti: alohida port/baza, yo'naltirishsiz, GPS ish vaqti kun bo'yi (tekshiruvchi istalgan soatda ko'rsin)
export PORT=$PORT DB_DATABASE=$DB DEMO_LOGIN= DEMO_SERVER= GPS_BOSH=00:00 GPS_OXIR=23:59
pm2 restart tamzor-demo --update-env >/dev/null 2>&1 || pm2 start src/server.js --name tamzor-demo --update-env
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:$PORT/api/v1/rejim" >/dev/null && break; sleep 2; done
DB_DATABASE=$DB DEMO_API="http://127.0.0.1:$PORT/api/v1" DEMO_SIRLAR=$SIRLAR node scripts/demo/seed-demo.js
# Admin parolini almashtirish (demo panel ochiq portda)
ADMIN_PAROL=$(grep '^ADMIN_PAROL=' $SIRLAR | cut -d= -f2-)
HASH=$(node -e "console.log(require('bcryptjs').hashSync(process.argv[1], 8))" "$ADMIN_PAROL")
mysql "$DB" -e "UPDATE user SET password='$HASH' WHERE username IN ('Admin','Programmer');"
echo "Demo tiklandi: $(date)"
