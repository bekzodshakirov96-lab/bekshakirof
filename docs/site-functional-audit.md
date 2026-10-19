# Saytning funksional va tezlik auditi

Tekshiruv faqat alohida lokal TEST firmada bajarildi. Productionga ulanilmadi, deploy qilinmadi. Kassa va Tezkor KEG hisoblash, tranzaksiya yozish va qoldiq yuritish qoidalari o‘zgartirilmadi.

## Natija

- Production uchun ajratilgan oxirgi master asosidagi release’da 61 ta test
  faylida **391 ta test o‘tdi**, 0 xato, 0 o‘tkazib yuborilgan test. Oldingi
  feature branch auditi 63 fayl / 396 test edi; uning alohida SaaS PR27 ishlari
  bu biznes sayt release’iga kiritilmagan.
- `npm run check`, haqiqiy API bilan `VITE_LOCAL_PREVIEW=false` build va `npm run check:build` o‘tdi.
- Yig‘ilgan versiyada 20 ta asosiy sahifa ochildi; sahifa ochilishida konsol xatosi va ish stoli oynasidan tashqariga chiqib ketish aniqlanmadi.
- 404 sahifasidan boshqaruv paneliga qaytish tekshirildi.
- Haqiqiy UI orqali saqlangan sinov operatsiyalari va qayta yuklashdan keyingi natijalar tekshirildi.

## Tuzatilgan kamchiliklar

1. **Barcha sahifalar kodi birdan yuklanardi.** Sahifalar alohida yuklanadi; umumiy menyu va autentifikatsiya qobig‘i saqlanadi. Yuklanish holati ekran o‘quvchisiga ham bildiriladi.
2. **Ishlab chiqish yordamchi kodi production HTMLga kiritilardi.** JSX inspektori va Manus yordamchilari faqat development serverida ishlaydi. Build HTML 368 062 baytdan 904 baytga tushdi.
3. **Uchta hisobot filtri ekran enidan chiqib ketardi.** Qarzdorlik, sotuv hisoboti va o‘zgarishlar tarixi filtrlari mavjud joyga qarab keyingi qatorga o‘tadi.
4. **Oy nomi ayrim brauzerlarda `M09` ko‘rinardi.** Oy nomlari barqaror o‘zbekcha yoziladi; noto‘g‘ri oy qiymati boshqa yilga jimgina surilmaydi. Ikki regressiya testi qo‘shildi.
5. **Savdo, Sklad va KEG tanlash oynalarida tugma ichida boshqa tugma bor edi.** Ichki interaktiv checkbox o‘rniga vizual belgi qo‘yildi; tashqi tugma checkbox holatini bildiradi. Sichqoncha va Space bilan tanlash tekshirildi, `button button` holati 0 bo‘ldi. Tanlash va hisoblash handlerlari o‘zgarmadi.
6. Qarzdorlikdagi to‘lov kartasi izohida o‘tkazma ham ko‘rsatildi; hisoblangan jamining o‘zi avval ham uni o‘z ichiga olgan.

`npm run check:build` ishlab chiqish skripti qaytib kirishini, boshlang‘ich HTML 16 KiB dan oshishini, boshlang‘ich JS 900 KB dan oshishini va eksport kutubxonalari boshlang‘ich HTMLdan yuklanishini tekshiradi. Bu tekshiruv CI’da builddan keyin ham bajariladi.

## Qo‘lda tekshirilgan ish oqimlari

| Oqim | Tekshirilgan natija |
|---|---|
| Mijoz | Bo‘sh forma saqlanmaydi; yangi TEST mijoz agentga va ikki faoliyat turiga biriktirildi. |
| Savdo | 2 × 59 500 = 119 000; naqd 50 000 + terminal 20 000 + Click 10 000 + o‘tkazma 9 000 = 89 000; qarz 30 000. Hisobotda bitta yozuv. |
| Mahsulot | KEG 30 va KEG 50 turidagi yangi TEST mahsulotlar saqlandi va qayta yuklanganda saqlandi. |
| Zavod → Sklad | Har bir KEG turidan 10 dona kirim saqlandi. |
| Tezkor KEG | 2 × 300 000 + 1 × 500 000 = 1 100 000; to‘rt usuldagi jami to‘lov 1 100 000; avvalgi qarz 30 000 saqlandi. Tara 30 qaytimi 1; yakuniy tara 30/50 = 1/1. Tab keyingi katakka o‘tdi. |
| Sklad va tara | KEG 30 = 8, KEG 50 = 9, Tosh suv = 198. Tara jami berilgan 3 − qaytgan 1 = 2. Barlosning mavjud qoldig‘i 622 saqlandi. |
| Butilka | 100 × 900 xarid, 60 × 1 700 sotuv, 50 000 to‘lov: qoldiq 40, sotuv 102 000, zavod qarzi 52 000. Qayta yuklanganda uchta yozuv. |
| Butilka sana filtri | Harakatlar bo‘lmagan kelgusi sana tanlanganda jamilar 0 va ro‘yxat bo‘sh bo‘ldi. SQL testlari davrning ikkala chegarasi ham kirishini tekshiradi. |
| Eksport | Excel va PDF yaratildi. Excel ma’lumotlar varag‘ida mahsulot, 119 000 summa va to‘rt to‘lov miqdori tekshirildi. PDF fayli `%PDF` sarlavhasi bilan yaratildi. |
| Kassa dizayni regressiyasi | Avvalgi lokal sinovda: naqd 5 000 bir marta saqlangan; 620 − 3 + 5 = 622; keyingi kun qoldig‘i 622, kunlik kirim 0; oldingi sana tartib va kengligi saqlangan; yangi kenglik/tartib qayta yuklanganda va kelgusi sanada saqlangan. Shu auditda Kassa va hisobot yana ochildi. |
| Mobil va klaviatura | 390 px ramkada Kassa va hisobot ko‘rinishi, mobil menyudan o‘tish/yopilish; mahsulot va KEG mijozini Space bilan tanlash. Release’da Home/End bilan tablar va fokus, menyudan KEG sahifasiga SPA o‘tishi tekshirildi. |
| Matritsa moduli | Lokal TEST firmada Agent × Tovar vaqtincha yashirilganda Kunlik jurnal ishladi, matritsa tabi yo‘q edi. So‘ng modul qayta yoqilib, sozlama tiklandi. |
| Lazy yuklashdan tiklanish | Release yig‘ilmasining Kassa chunkiga faqat lokal serverda bir martalik 503 javobi berildi. Xato ekrani chiqdi; “Sahifani qayta yuklash”dan keyin jurnal ochildi. Platforma va super-adminning kirishsiz renderer tarmoqlari lokal `/me` test javobi bilan ochildi; jonli platforma backendini tekshirish deb hisoblanmaydi. |

Sahifalar: boshqaruv paneli, qarzdorlik, agentlar, xodimlar, mijozlar, akt sverka, savdo, sotuv hisoboti, Tezkor KEG, mahsulotlar, Sklad, Sklad hisoboti, Zavod, Kassa, Kassa hisoboti, tara, import, foydalanuvchilar, o‘zgarishlar tarixi, firma sozlamalari.

## SQL va avtomatik qamrov

To‘liq suite quyidagilarni ham tekshiradi: tenantlararo ma’lumot ajratilishi, fayllar va logotiplar ajratilishi, firma shablonlari, rollar/ruxsatlar, sessiyalar va SSO, Kassa toifalari, qarz va qaytimlar, transfer, sanalar, davr qulfi, idempotent saqlash, ombor kirimi va keyingi kun qoldig‘i, bir vaqtdagi tahrirlar, import/eksport, platforma va test to‘lov callbacklari.

SQL testlari uchun foydalanuvchining aniq ruxsati bilan faqat `127.0.0.1:43317` ishlatildi. Shu auditning ikki yugurishidan qolgan 20 vaqtinchalik sxema va 18 test foydalanuvchisi nomi, yaratilish vaqti, ruxsatlari va faol ulanishlari tekshirilgach tozalandi. Ko‘rsatiladigan lokal TEST firma saqlandi.

## Tezlik o‘lchovi

Bir xil lokal backendga ulangan yig‘ilgan versiyalarda, siqishsiz:

| Sahifa | Dastlab yuklangan JS, avval | Keyin | Kamayish |
|---|---:|---:|---:|
| Kassa | 1 818 782 B | 760 567 B | 58% |
| Tezkor KEG | 1 818 782 B | 707 184 B | 61% |
| Boshqaruv paneli | 1 818 782 B | 1 050 275 B | 42% |

Bu bir martalik lokal laboratoriya o‘lchovi. Birinchi matn chizilishi tezlashdi, ammo sahifa chunkini alohida olish sababli shu sinovdagi LCP 152–296 ms dan 428–484 ms ga chiqdi. Bu production tezligi kafolati emas; internet, server keshi va qurilma ta’siri alohida o‘lchanishi kerak. O‘lchovda 50 ms dan uzun asosiy oqim vazifasi kuzatilmadi. PDF/Excel kutubxonalari talab bo‘yicha yuklanadi; ular uchun build hajmi ogohlantirishi saqlanadi.

## Qamrov chegarasi

Bu audit barcha mumkin bo‘lgan xatolar yo‘qligi kafolati emas. Brauzer sinovlari shu kompyuterdagi Chromium va tanlangan asosiy oqimlarda bajarildi. Haqiqiy Safari/Mac, sekin internet va ko‘p foydalanuvchili yuk testi bajarilmadi. Jonli Payme/Click to‘lovi va email jo‘natish sinovdan o‘tkazilmadi; ular oldingi qarorga ko‘ra keyingi bosqichda. Productionning jonli ma’lumotlari bilan tekshiruv bajarilmadi.

Lokal ko‘rish: `http://localhost:4199/kassa` — yig‘ilgan haqiqiy ilova; `http://localhost:4197/kassa` — development nusxa. `4196` portdagi sahifa alohida dizayn maketi.

Dalillar lokal `temp/site-audit/` ichida: `tests-final.json`, `routes-after.json`, `performance-summary.json`, `build-final.log`, `sql-cleanup-result.json` va skrinshotlar. Oldingi Kassa regressiyasi dalillari `temp/cash-real-design/` ichida.
