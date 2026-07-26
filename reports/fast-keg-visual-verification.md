# Tezkor KEG vizual verifikatsiyasi

## 2026-07-23 holati

`/tezkor-keg` manzili desktop brauzerda muvaffaqiyatli ochildi, ammo himoyalangan ilova qismi o‘rniga o‘zbekcha **“Tizimga xush kelibsiz”** autentifikatsiya ekrani ko‘rsatildi. **“Xavfsiz kirish”** tugmasi Manus OAuth sahifasini to‘g‘ri ochdi. FastKeg sahifasining autentifikatsiyadan keyingi desktop va mobil ko‘rinishini tekshirish uchun foydalanuvchi sessiyasi talab qilinadi.

| Tekshiruv | Natija |
|---|---|
| Himoyalangan `/tezkor-keg` marshruti | Ishlaydi, autentifikatsiyasiz login ekraniga yo‘naltiradi |
| Login ekrani tili | O‘zbekcha |
| OAuth kirish tugmasi | Manus OAuth sahifasini ochadi |
| FastKeg desktop ichki ko‘rinishi | Dastlab login bilan bloklandi; boshqariladigan preview orqali keyin muvaffaqiyatli tekshirildi |
| FastKeg mobil ichki ko‘rinishi | Dastlab login bilan bloklandi; boshqariladigan preview orqali keyin muvaffaqiyatli tekshirildi |

Brauzer screenshotlari vaqtinchalik sandbox yo‘llarida saqlandi: `/home/ubuntu/screenshots/3000-iy215iblgkktryn_2026-07-23_17-06-11_9646.webp` va `/home/ubuntu/screenshots/manus_im_2026-07-23_17-06-25_5614.webp`.

My Browser ulagichi yoqilgach `/tezkor-keg` va **“Xavfsiz kirish”** oqimi qayta tekshirildi. Joriy avtomatlashtirilgan brauzer baribir `Sandbox` sessiyasida ochildi va OAuth sahifasi foydalanuvchi sessiyasini avtomatik qabul qilmadi. Shu sabab ichki FastKeg UI-ni real autentifikatsiya bilan screenshot qilish tashqi login sessiyasiga bog‘liq bo‘lib qolmoqda; yangi urinish screenshotlari `/home/ubuntu/screenshots/3000-iy215iblgkktryn_2026-07-23_17-09-17_1019.webp` va `/home/ubuntu/screenshots/manus_im_2026-07-23_17-09-37_5992.webp` da.

Keyingi boshqariladigan preview tekshiruvida autentifikatsiyalangan **FastKeg ichki sahifasi muvaffaqiyatli render qilindi**. Desktop `1440×1000` ko‘rinishda chap navigatsiya, agent tanlash, mijozlar ro‘yxati, to‘rtta umumiy ko‘rsatkich va ketma-ket kiritish jadvali bir-birini yopmasdan joylashdi. Mobil `390×844` ko‘rinishda bloklar bitta ustunga tushdi, matnlar kesilmadi va gorizontal viewport overflow kuzatilmadi; keng jadval konteyneri esa mijoz tanlangandan keyin ichki gorizontal scroll bilan ishlashga mo‘ljallangan.

| Autentifikatsiyalangan UI tekshiruvi | Natija |
|---|---|
| Desktop `1440×1000` | O‘tdi |
| Mobil `390×844` | O‘tdi |
| Sidebar va sahifa sarlavhasi | O‘tdi |
| Agent/mijoz bo‘sh holati | O‘tdi |
| Summary kartalari | O‘tdi |
| Jadval bo‘sh holati | O‘tdi |

Yakuniy desktop screenshot inspectable evidence sifatida [`/manus-storage/fast-keg-desktop-authenticated_203e250f.png`](/manus-storage/fast-keg-desktop-authenticated_203e250f.png) manziliga saqlandi. Unda **KEG 30 qoldig‘i** va **KEG 50 qoldig‘i** kartalaridagi `O‘zgarish: +0 • sotildi: 0` helper matni kesilmay, ikki qatorda to‘liq ko‘rinadi. Mobil evidence [`/manus-storage/fast-keg-mobile-authenticated_ae9ae010.png`](/manus-storage/fast-keg-mobile-authenticated_ae9ae010.png) manzilida.

`NAMUNA.xlsx` fayli `openpyxl` bilan haqiqatan parse qilindi. Natija `reports/namuna-workbook-audit.json` da: 2 varaq, jami 7 ta bo‘sh bo‘lmagan sarlavha katagi, **0 ta sonli katak** va **0 ta formula**. Shu sabab avtomatik formulalar workbookdagi sonli misol bilan emas, real bazadagi tarixiy KEG tranzaksiyasi va deterministik Vitest qiymatlari bilan verifikatsiya qilindi.
