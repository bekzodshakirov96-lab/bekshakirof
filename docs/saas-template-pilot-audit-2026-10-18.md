# Faoliyat shablonlari: 4-bosqich lokal pilot auditi

Sana: 18.10.2026. Barcha amallar localhostda, sun’iy ma’lumotlar bilan bajarildi.
Productionga ulanish, migratsiya, push yoki deploy bajarilmadi.

## Natija

Ulgurji savdo, agentlar orqali tarqatish va ichimlik/KEG shablonlari uchta
alohida bazada tekshirildi. Har bir bazaga faqat o‘z huquqlari bo‘lgan SQL
foydalanuvchisi berildi. Uchalasida egasi, agent va mijoz IDlari hamda so‘rov
kalitlari ataylab bir xil bo‘ldi: ma’lumotlar bir-biriga qo‘shilmadi.

| Tekshiruv | Ulgurji savdo | Agentlar orqali tarqatish | Ichimliklar va KEG |
| --- | --- | --- | --- |
| Shablon boshlang‘ich nomlari va menyusi | O‘tdi | O‘tdi | O‘tdi; eski ichimlik profili saqlandi |
| Shablon o‘zi mahsulot yoki pul yozuvini yaratmasligi | O‘tdi | O‘tdi | O‘tdi |
| Naqd, Terminal, Click, o‘tkazma | O‘tdi | O‘tdi | O‘tdi |
| Kun yakunidagi naqd qoldiq | 1 475 000 so‘m | 1 475 000 so‘m | 1 475 000 so‘m |
| Keyingi kunning boshlang‘ich qoldig‘i | 1 475 000 so‘m | 1 475 000 so‘m | 1 475 000 so‘m |
| Qarz qaydi naqd qoldiqni o‘zgartirmasligi | O‘tdi | O‘tdi | O‘tdi |
| Kirim/chiqim tahriri va o‘chirilishining qoldiqqa ta’siri | O‘tdi | O‘tdi | O‘tdi |
| Takror so‘rov summa yoki tovarni qayta yozmasligi | O‘tdi | O‘tdi | O‘tdi |
| 100 + 500 − 40 − 40 | 520 blok | 520 blok | 520 blok |
| Ertasi kuni 520 + 20 − 30 | 510 blok | 510 blok | 510 blok |
| Oldingi 40 ni 10 ga tuzatgach ikki kun qoldig‘i | 550 / 540 blok | 550 / 540 blok | 550 / 540 blok |
| KEG: 1 400 000 savdo − 1 100 000 to‘lov | 300 000 qarz | 300 000 qarz | 300 000 qarz |
| KEG qaytimidan keyingi tara 30/50 | 1 / 1 | 1 / 1 | 1 / 1 |
| Boshlang‘ich 10 tadan to‘la KEGdan 2/1 sotilgach | 8 / 9 | 8 / 9 | 8 / 9 |
| Qolgan 300 000 qarz va bitta tara 50 qaytgach | Qarz 0, tara 1/0 | Qarz 0, tara 1/0 | Qarz 0, tara 1/0 |
| Ortiqcha qarz to‘lovi / boshqa agent nomidan yozish | Rad etildi | Rad etildi | Rad etildi |
| Boshqa firmaning SQL bazasini o‘qish | Rad etildi | Rad etildi | Rad etildi |

Yashirilgan modullar — menyu sozlamasi. Shu sababli KEGning asl API qoidalari
uchalasida ham regressiya sifatida tekshirildi. Rollar va ruxsatlar saqlanadi;
shablon tanlash serverdagi kirish huquqlarini almashtirmaydi.

## Topilgan va tuzatilgan kamchiliklar

### 1. Yangi firma tekshiruvida xodim yoki sozlama bilan parallel ishlash

Oldingi tekshiruv xodimlar va sozlamalarni oddiy snapshot orqali o‘qigan.
Boshqa tranzaksiyada hali saqlanayotgan birinchi xodim yoki davr sozlamasi
ko‘rinmasligi va shablon bo‘sh deb hisoblangan firmaga qo‘llanishi mumkin edi.
Ikkala holat ham alohida SQL regressiya sinovida qayta yaratildi.

Shablon qo‘llash paytida xodim va sozlamalar joriy holati qulf bilan qayta
tekshiriladi. Mos kelmasa shablon butunlay bekor qilinadi. Parallel bir xil
so‘rovlar uchun FK va sozlama qulflari olish tartibi ham birxillashtirildi:
avval egasi qatori, keyin sozlama boshi. To‘liq sinovda topilgan deadlock
regressiyasi shu tartib bilan bartaraf etildi. Mavjud yozuvlar o‘chirilmaydi.

### 2. Tezkor KEGning boshlang‘ich sanasi qurilmaga bog‘liq bo‘lgan

KEG sahifasi bugungi sanani qurilmaning vaqt mintaqasidan olgan. Endi Kassa bilan
bir xil `Asia/Tashkent` yordamchisidan foydalanadi. Yil va oy chegaralari hamda
turli qurilma offsetlari sinovdan o‘tdi. Faqat yangi ochilgan formaning bugungi
sanasi tuzatildi; saqlangan sanalar va KEGning pul/tara formulalari o‘zgarmadi.

### 3. Yuklanishda eski nomlar yoki nol qoldiq vaqtincha ko‘rinishi

Firma sozlamalari kelguncha eski standart menyu va jadvallar ochilishi mumkin
edi. Kunlik jurnal yoki boshlang‘ich qoldiq kechiksa, bo‘sh/nol qiymatlar ham
ko‘rinardi. Endi firma sozlamalari, jurnal, boshlang‘ich qoldiq va matritsaning
zarur ma’lumotlari kelguncha yuklanish holati ko‘rsatiladi. Xatoda qayta urinish
taklif qilinadi; to‘liq yuklanmagan jadvalda yozuv kiritish ochilmaydi.

Qo‘shimcha ravishda “Jami Приход” kartasi ostida uning mavjud tarkibi yozildi:
**naqd kirim + Terminal + Click; bank o‘tkazmasi alohida**. Hisoblash formulasi
o‘zgartirilmadi.

## Hisoblash qoidalarini ajratish

Pilotning birinchi kunida 1 000 000 va 500 000 naqd kirim, 125 000 naqd chiqim,
100 000 naqd qarz qaytimi, 225 000 Terminal, 300 000 Click va 400 000 o‘tkazma bor.
700 000 so‘mlik mustaqil qarz qaydi ham kiritilgan.

- Jismoniy naqd: 1 000 000 + 500 000 + 100 000 − 125 000 = **1 475 000**.
- Mavjud “Jami kirim” KPI: naqd kirim 1 600 000 + Terminal 225 000 + Click
  300 000 = **2 125 000**. Bank o‘tkazmasi alohida hisoblanadi.
- Agent × Tovar solishtirishi: agent topshirgan naqd 1 500 000 + Terminal
  200 000 + Click 300 000 + o‘tkazma 400 000 = **2 400 000**. Qarz qaytimi
  100 000 + 25 000 bu ko‘rsatkichga qayta qo‘shilmaydi.
- KEGdagi mijoz to‘lovi savdo/agent hisobida qayd etiladi. Shu summani Kunlik
  jurnalga avtomatik yana qo‘shish bajarilmadi; Kassa qoldig‘i o‘zgarmadi.

Sun’iy kirimlar agentlarning olib ketgan tovari bilan ataylab tenglashtirilmagan:
bu auditda kanal summalarini mustaqil tekshirish uchun. Pilotdagi solishtirish
farqlari real firmaning kamomadi yoki qarzdorligi emas.

## Dalillar va takrorlash

- To‘liq avtomatik to‘plam: 55 faylda 339 ta test. TypeScript va build ham o‘tdi.
- Yangi real SQL pilotlari:
  `server/companyTemplatePilot.integration.test.ts` — 12 ta ssenariy.
- SQL sinovlari faqat aniq berilgan vaqtinchalik localhost bazalarini ishlatadi.
  Test tugagach aynan o‘zi yaratgan `bc_pilot_*` bazalari va SQL hisoblari
  tekshirilgan nomlar asosida tozalanadi.
- Brauzerda uchala firma: 4185 — ulgurji, 4186 — agentlar, 4187 — ichimliklar.
  Bular alohida `bc_pilot_ui_*` test bazalari; namunalarni qayta ko‘rish uchun
  localhostda saqlangan. Ularda faqat sun’iy audit ma’lumotlari bor.
- Ichimliklar pilotida brauzerning o‘zida to‘rt kanal bilan KEG savdosi saqlandi;
  300 000 qarz va 1/1 tara tasdiqlandi. Keyin Kassa yana 1 475 000 ekanligi
  tekshirildi. Agent pilotida 520 blok va mos yangi sarlavhalar ko‘rindi.
- Mavjud TEST va Namuna: har birining barcha 29 jadvali oldingi nazorat xeshlari
  bilan solishtirildi. Barcha mavjud satrlar va sxemalar aynan saqlandi. KEG
  server routeri, umumiy KEG arifmetikasi va server naqd hisoblash fayli o‘zgarmadi.
  Lokal nazorat dalillari: `temp/category-preservation-before.json` va
  `temp/category-preservation-after.json`.

Bu tekshiruv shu uch shablon va yuqoridagi ssenariylarni qamrab oladi. Yangi
faoliyat formulalari, obuna huquqlari, Payme/Click orqali real to‘lovlar yoki
production yuklamasi sinovga kiritilmadi.
