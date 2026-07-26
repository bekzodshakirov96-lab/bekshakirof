# Tezkor KEG savdosi — NAMUNA.xlsx xaritasi

## Manba fayl tuzilmasi

`NAMUNA.xlsx` faylining `KEG sotish va tara uchun` varag‘i `A1:Q30` maydonini egallaydi. Amaliy jadval sarlavhalari 9-qatorga joylashtirilgan va ma’lumot kiritish qatorlari 10–30-qatorlardan iborat.

| Excel katagi | Sarlavha | Tizimdagi vazifasi |
|---|---|---|
| E9 | AGENT | Bitta agent tanlash |
| G9 | MIJOZLAR | Tanlangan agentga tegishli mijozlar ketma-ketligi |
| H9 | KEG 30 | Mijoz olgan KEG 30 soni — buxgalter kiritadi |
| I9 | KEG 50 | Mijoz olgan KEG 50 soni — buxgalter kiritadi |
| J9 | KASSA | Mijozdan olingan to‘lov — buxgalter kiritadi |
| K9 | Qoldiqtara | KEG 30/50 bo‘yicha tizim hisoblaydigan tara qoldig‘i |
| M9:N9 vizual bloki | QARZ SUMMA | Savdo va kassa asosida tizim hisoblaydigan yakuniy qarz |

Faylda `Tara qaytdi 30` va `Tara qaytdi 50` uchun alohida matnli sarlavha yo‘q. Foydalanuvchi talabiga va mavjud KEG tara hisobiga muvofiq, veb-interfeysda ular alohida tezkor sonli inputlar sifatida `KEG 30/50` va `Kassa` oralig‘iga qo‘shiladi. `Qoldiq tara` input emas: u boshlang‘ich qoldiq, berilgan KEG va qaytgan tara asosida avtomatik hisoblanadi.

## Tasdiqlangan tezkor ish oqimi

1. Sana va agent tanlanadi.
2. Faqat shu agentga biriktirilgan faol mijozlar ochiladi.
3. Mijozlar checkbox bilan ko‘p tanlanadi va tanlash ketma-ketligida jadvalga joylashadi.
4. Buxgalter faqat `KEG 30`, `KEG 50`, `Tara qaytdi 30`, `Tara qaytdi 50` va `Kassa` qiymatlarini kiritadi.
5. Tizim KEG narxlarini mahsulot sozlamalaridan oladi; savdo summasi, yangi qarz, KEG 30/50 tara qoldig‘i va umumiy natijani jonli hisoblaydi.
6. Barcha mijoz operatsiyalari bitta atomik saqlash orqali yoziladi; bitta qatorda xato bo‘lsa, hech bir qator qisman saqlanmaydi.

## Hisoblash qoidalari

| Ko‘rsatkich | Hisob |
|---|---|
| Savdo summasi | `(KEG 30 × KEG 30 narxi) + (KEG 50 × KEG 50 narxi)` |
| KEG 30 tara o‘zgarishi | `berilgan KEG 30 − qaytgan tara 30` |
| KEG 50 tara o‘zgarishi | `berilgan KEG 50 − qaytgan tara 50` |
| Yakuniy tara qoldig‘i | `oldingi qoldiq + berilgan − qaytgan` (har tur bo‘yicha alohida) |
| Yakuniy qarz | `oldingi qarz + savdo summasi − kassa` |

Ortiqcha tara qaytarish bloklanadi. KEG 30 qaytishi KEG 30 qoldig‘idan, KEG 50 qaytishi esa KEG 50 qoldig‘idan ayriladi; turlar o‘zaro aralashtirilmaydi.
