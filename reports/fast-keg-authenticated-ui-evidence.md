# FastKeg autentifikatsiyalangan UI evidence

Manba screenshot: [`/manus-storage/fast-keg-desktop-authenticated_203e250f.png`](/manus-storage/fast-keg-desktop-authenticated_203e250f.png) (`1440×1078`). Screenshot deterministik 4 ta overlapping tile’ga bo‘lindi va row-major tartibida vizual o‘qildi.

## Tile 1 — yuqori chap

Ko‘rinadigan autentifikatsiyalangan ichki sahifa matnlari:

- `Tezkor KEG savdosi`
- `Operatsiya sanasi` — `07/23/2026`
- `Agent` — `Agentni tanlang`
- `Agent mijozlari`
- `Qidirib bir nechta mijozni belgilang`
- `KEG 30 qoldig‘i` — `0 dona`
- `O‘zgarish: +0 • sotildi: 0`

Chap navigatsiyada `Tezkor KEG savdosi` aktiv bo‘lib, `Savdo jurnali`, `Kassa jurnali`, `Mahsulotlar`, `Agentlar` va `Mijozlar` yo‘llari ham ko‘rinadi.

## Tile 2 — yuqori o‘ng

Ko‘rinadigan boshqaruv va summary matnlari:

- `0 ta qatorni saqlash`
- `Tanlangan mijozlar` — `0 ta`
- `KEG 30 qoldig‘i` — `0 dona`
- `O‘zgarish: +0 • sotildi: 0`
- `KEG 50 qoldig‘i` — `0 dona`
- `O‘zgarish: +0 • sotildi: 0`
- `Jami kassa` — `0 so‘m`
- `Savdo: 0 so‘m`
- `Yakuniy qarzlar` — `0 so‘m`
- `0 ta mijoz bo‘yicha`

Ikkala KEG helper matnida `O‘zgarish` va `sotildi` qismlari to‘liq o‘qildi; ellipsis yoki kesilgan fragment yo‘q.

## Tile 3 — pastki chap

Mijozlar panelida **“Avval agentni tanlang”** va **“Faqat shu agentga tegishli mijozlar ochiladi.”** matnlari ko‘rinadi. Bu agentga bog‘langan mijozlarni ajratish oqimining bo‘sh holatini tasdiqlaydi. Pastki navigatsiyada `Tara nazorati`, `Excel import`, `Foydalanuvchilar` va autentifikatsiyalangan `bekshakirof — Rahbar` profili ko‘rinadi.

## Tile 4 — pastki o‘ng

Tezkor jadval konteynerida **“Ketma-ket KEG kiritish jadvali”** sarlavhasi va **“Tab — keyingi katak, Enter/↑/↓ — shu ustundagi keyingi yoki oldingi mijoz.”** klaviatura yo‘riqnomasi to‘liq ko‘rinadi. Bo‘sh holatda **“Mijozlarni tanlang”** hamda **“Chapdagi ro‘yxatdan mijozlarni belgilasangiz, ular tanlash tartibida shu jadvalga avtomatik joylashadi.”** matnlari o‘qildi.

## Evidence xulosasi

| Tekshirilgan element | Inspectable matn dalili | Natija |
|---|---|---|
| Agent boshqaruvi | `Agentni tanlang` | O‘tdi |
| Agentga tegishli mijozlar paneli | `Faqat shu agentga tegishli mijozlar ochiladi.` | O‘tdi |
| Tanlangan mijozlar summarysi | `Tanlangan mijozlar — 0 ta` | O‘tdi |
| KEG 30 helper | `O‘zgarish: +0 • sotildi: 0` | O‘tdi, kesilmagan |
| KEG 50 helper | `O‘zgarish: +0 • sotildi: 0` | O‘tdi, kesilmagan |
| Kassa summarysi | `Jami kassa — 0 so‘m`, `Savdo: 0 so‘m` | O‘tdi |
| Qarz summarysi | `Yakuniy qarzlar — 0 so‘m`, `0 ta mijoz bo‘yicha` | O‘tdi |
| Tezkor jadval konteyneri | `Ketma-ket KEG kiritish jadvali` | O‘tdi |
| Klaviatura navigatsiyasi | `Tab`, `Enter/↑/↓` yo‘riqnomasi | O‘tdi |

## Mobil evidence — tile 1 va 2

Mobil manba screenshot [`/manus-storage/fast-keg-mobile-authenticated_ae9ae010.png`](/manus-storage/fast-keg-mobile-authenticated_ae9ae010.png) (`390×2262`) yuqoridan pastga overlapping tile’larda o‘qildi. Birinchi tile’da **“Tezkor KEG savdosi”**, tushuntirish matni, **“0 ta qatorni saqlash”**, `07/23/2026` operatsiya sanasi va **“Agentni tanlang”** boshqaruvi bitta ustunda, matnlar kesilmasdan ko‘rinadi.

Ikkinchi tile’da **“Tanlangan mijozlar — 0 ta”**, **“Agent mijozlari”**, **“Qidirib bir nechta mijozni belgilang”**, **“Avval agentni tanlang”** va **“Faqat shu agentga tegishli mijozlar ochiladi.”** matnlari to‘liq o‘qildi. Kartalar 390 px viewport ichida joylashgan; ko‘rinadigan elementlarda gorizontal kesilish yo‘q.

Uchinchi tile’da mobil summary kartalari ketma-ket bitta ustunda joylashgan: **“KEG 30 qoldig‘i — 0 dona”**, **“O‘zgarish: +0 • sotildi: 0”**, **“KEG 50 qoldig‘i — 0 dona”**, **“O‘zgarish: +0 • sotildi: 0”**, **“Jami kassa — 0 so‘m”**, **“Savdo: 0 so‘m”**, **“Yakuniy qarzlar — 0 so‘m”** va **“0 ta mijoz bo‘yicha”**. Helper matnlar kesilmagan.

To‘rtinchi tile’da **“Ketma-ket KEG kiritish jadvali”**, `Tab` hamda `Enter/↑/↓` klaviatura yo‘riqnomasi, **“Mijozlarni tanlang”** va mijozlar tanlash tartibida jadvalga avtomatik joylashishi haqidagi matn to‘liq ko‘rinadi. Bu mobil breakpointda summary va jadval konteyneri bir-birini yopmasdan, tabiiy vertikal oqimda render bo‘lishini tasdiqlaydi.

| Mobil tekshiruv | Evidence | Natija |
|---|---|---|
| Sarlavha va saqlash amali | `Tezkor KEG savdosi`, `0 ta qatorni saqlash` | O‘tdi |
| Sana va agent boshqaruvi | `07/23/2026`, `Agentni tanlang` | O‘tdi |
| Mijoz boshqaruvi | `Agent mijozlari`, `Faqat shu agentga tegishli mijozlar ochiladi.` | O‘tdi |
| KEG helper matnlari | `O‘zgarish: +0 • sotildi: 0` | O‘tdi, kesilmagan |
| Kassa va qarz summarysi | `Jami kassa`, `Yakuniy qarzlar` | O‘tdi |
| Jadval konteyneri | `Ketma-ket KEG kiritish jadvali` | O‘tdi |

## Haqiqiy OCR chiqishi

Desktop summary hududi original screenshotdan crop qilindi, 4 baravar kattalashtirildi, grayscale/autocontrast/sharpen preprocessingdan o‘tkazildi va **Tesseract 5.3.4** bilan `--psm 6` rejimida o‘qildi. Raw natija `reports/fast-keg-desktop-summary-ocr.txt` fayliga saqlandi. OCR chiqishida quyidagi ketma-ketlik aniq mavjud:

> `O'zgarish: +0 ... O’zgarish: +0 ...`
>
> `sotildi: 0   sotildi: 0`

Demak, desktopdagi **KEG 30** va **KEG 50** helper matnlarining har ikkalasida ham `O‘zgarish` va `sotildi` qismlari screenshot pikselidan haqiqiy OCR orqali olindi; matn truncate ellipsis bilan yo‘qolmagan.
