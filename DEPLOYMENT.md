# NOKDAUN mchj — Moliyaviy boshqaruv tizimi

Distribyutsiya biznesi uchun savdo, qarzdorlik, kassa va mijozlar boshqaruv tizimi.
Bu loyiha dastlab Manus'da yaratilgan, so'ng Manus infratuzilmasidan (OAuth, fayl
saqlash) mustaqil ishlaydigan holga o'tkazilgan — endi istalgan oddiy Node.js
serverida ishlaydi.

## Talab qilinadigan narsalar

- **Node.js 20+** (tavsiya etiladi: 22)
- **MySQL 8+** bazasi (o'zingizning serveringizda, yoki Railway/PlanetScale/RDS
  kabi xizmatlarda)
- Fayllarni saqlash uchun doimiy disk joyi (Excel importlar shu yerga yoziladi)

## 1. O'rnatish

```bash
npm install --legacy-peer-deps
```

(`--legacy-peer-deps` kerak, chunki bitta dev-dependency eski Vite versiyasini
kutadi — bu funksionallikka ta'sir qilmaydi.)

## 2. Muhit o'zgaruvchilari

`.env.example` faylini `.env` deb nusxalang va to'ldiring:

```bash
cp .env.example .env
```

- `DATABASE_URL` — MySQL bog'lanish satri: `mysql://user:parol@host:3306/baza_nomi`
- `JWT_SECRET` — uzun, tasodifiy satr (login sessiyalarini imzolash uchun).
  Generatsiya qilish uchun:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
  ```
- `PORT` — server porti (standart: 3000)
- `UPLOADS_DIR` — yuklangan Excel fayllari saqlanadigan papka (standart: `./uploads`)
- `TZ` — server vaqt mintaqasi (standart: `Asia/Tashkent`). **Bulutli serverga
  o'tayotganda bu qatorni albatta saqlab qoling** — ko'pchilik bulutli xizmatlar
  (Railway, RDS va h.k.) standart holda UTC bilan ishlaydi, agar `TZ`
  o'rnatilmasa Kassa va hisobotlardagi "kun" chegaralari 5 soatga siljib
  ketadi (masalan, tungi soat 00:00–05:00 orasidagi yozuvlar noto'g'ri kunga
  tushib qolishi mumkin).

  > MySQL bazaning o'zi (agar boshqa serverga/xizmatga ko'chirilsa) uchun
  > qo'shimcha sozlash shart emas — `server/db.ts` har bir ulanishda avtomatik
  > `SET time_zone = '+05:00'` yuboradi, shuning uchun baza qayerda joylashgan
  > bo'lishidan qat'iy nazar mavjud va yangi yozuvlar to'g'ri vaqt bilan
  > saqlanadi/o'qiladi.

## 3. Bazani tayyorlash

Bo'sh MySQL bazasi yarating, so'ng migratsiyalarni qo'llang:

```bash
npx drizzle-kit migrate
```

Bu `drizzle/` papkasidagi barcha SQL migratsiyalarni (`0000`–`0003`)
ketma-ket ishga tushiradi va kerakli jadval/ustunlarning barchasini yaratadi —
`0002` migratsiyasi joriy kod talab qiladigan barcha jadvallarni (shu jumladan
`factory_operations`, `stockMovements`, `daily_product_prices`) va
ustunlarni (`users.agentId`, `products.sortOrder` va h.k.), `0003` esa
`users.language` (interfeys alifbosi) ustunini o'z ichiga oladi.

> **Eslatma:** bu buyruq faqat **bo'sh** bazada ishlating. Agar bazada
> allaqachon eski (masalan avvalgi Manus versiyasidan qolgan) `users` jadvali
> bo'lsa, migratsiya xato berishi mumkin — bunday holda avval o'sha bazani
> butunlay tozalang yoki bizga ayting.

## 4. Build va ishga tushirish

```bash
npm run build
npm start
```

Yoki development rejimida (avtomatik qayta yuklash bilan):

```bash
npm run dev
```

Birinchi marta `/` manzilini ochganingizda, baza bo'sh bo'lgani uchun
avtomatik ravishda **"Boshlang'ich sozlash"** ekrani ko'rinadi — shu yerda
yaratilgan hisob avtomatik rahbar (admin) bo'ladi. Bu forma faqat bazada
birorta ham hisob yo'q bo'lgandagina ko'rinadi; birinchi hisob yaratilgach,
u butunlay yo'qoladi va o'rniga oddiy "Kirish" ekrani chiqadi.

Keyingi barcha hisoblar (buxgalter, agent, sklad xodimi va h.k.) ochiq
ro'yxatdan o'tish orqali emas, faqat rahbar/buxgalter tomonidan
"Foydalanuvchilar" bo'limidan to'g'ridan-to'g'ri (login+parol bilan)
yaratiladi.

## 5. Productionda doimiy ishlatish (tavsiya)

**PM2 bilan** (server qayta ishga tushganda avtomatik qayta ko'tariladi):

```bash
npm install -g pm2
pm2 start dist/index.js --name nokdaun-finance
pm2 save
pm2 startup   # server reboot bo'lganda avtomatik ishga tushishi uchun
```

**Nginx orqali (HTTPS bilan, tavsiya etiladi):**

```nginx
server {
    listen 443 ssl;
    server_name sizning-domeningiz.uz;

    ssl_certificate     /etc/letsencrypt/live/sizning-domeningiz.uz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sizning-domeningiz.uz/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

HTTPS bo'lsa, login cookie'si avtomatik `Secure` rejimda ishlaydi (kod buni
o'zi aniqlaydi — `X-Forwarded-Proto` sarlavhasi orqali). HTTPS'siz (masalan
faqat ichki tarmoqda) ham ishlayveradi, faqat shifrlanmagan bo'ladi — tashqi
internetga ochiq bo'lgan har qanday joyda **albatta HTTPS ishlating**,
chunki login parollari himoyasiz uzatilmasligi kerak.

## Arxitektura haqida qisqacha

- **Frontend:** React + TypeScript, Vite bilan yig'iladi
- **Backend:** Express + tRPC
- **Baza:** MySQL, Drizzle ORM orqali
- **Autentifikatsiya:** email + parol (bcrypt bilan xeshlangan), JWT sessiya
  cookie'si — hech qanday tashqi xizmatga bog'liq emas
- **Fayl saqlash:** local disk (`UPLOADS_DIR`), `/uploads/...` orqali serveriladi
- **Testlar:** Vitest, `npm test` bilan ishga tushiriladi (65 test)
- **Interfeys alifbosi:** har bir foydalanuvchi o'zi uchun **O'zbekcha (lotin)**
  yoki **Ўзбекча (кирилл)** ni tanlaydi (chap pastdagi hisob menyusidan yoki
  kirish ekranidan). Tanlov hisobga bog'lanadi (`users.language`), shuning uchun
  boshqa qurilmadan kirganda ham saqlanib qoladi va faqat foydalanuvchining o'zi
  o'zgartirmaguncha o'zgarmaydi. Kirill matn qo'lda yozilmaydi — `client/src/lib/translit.ts`
  lotin matnni avtomatik o'giradi, shuning uchun yangi qo'shilgan matnlar ham
  qo'shimcha ishsiz ikkala alifboda ishlaydi. Excel/PDF eksport va Akt sverka
  hujjatlari ham tanlangan alifboda chiqadi (shu jumladan mijoz, agent va
  mahsulot nomlari) — ekran bilan hujjat har doim bir xil bo'ladi.

## Zaxira nusxa olish

Muntazam ravishda:
1. MySQL bazasining dump'ini oling (`mysqldump`)
2. `UPLOADS_DIR` papkasini zaxiralang (yuklangan Excel fayllar shu yerda)
