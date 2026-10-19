# Changelog

## Unreleased

- Yangi versiya chiqqanda ochiq sahifalarda yangilanish xabari va “Yangilash”
  tugmasi ko‘rinadi. Saqlash davomida qayta yuklash bloklanadi; yozuv yoki fayl
  kiritilgan bo‘lsa, foydalanuvchidan avval saqlash so‘raladi.

- Kassa sahifasida Kunlik jurnal va Agent × Tovar uchun alohida yoki birgalikdagi
  ko‘rinish, ixcham/qulay qatorlar va diqqat rejimi qo‘shildi. Jadval, prixod,
  qoldiq, saqlash va sana bo‘yicha tartib/kenglik sozlamalari saqlandi.
- Kerakli sahifa kodini alohida yuklash orqali boshlang‘ich yuk kamaytirildi;
  ishlab chiqish yordamchi skriptlari production yig‘ilmasidan chiqarildi.
- Qarzdorlik, sotuv hisoboti va amallar tarixi filtrlari tor ekranga moslandi;
  oy nomlari va Savdo/Sklad/KEG tanlash ro‘yxatlaridagi ichma-ich tugmalar tuzatildi.
- Hisobot eksportlari va hisob-kitoblar lokal sinovdan o‘tkazildi; yig‘ilma hajmi
  va ishlab chiqish skriptlarini nazorat qiluvchi tekshiruv CI’ga qo‘shildi.

- Agent × Tovar jadvalida yangi kelgan tovarlarni bevosita Prixod katagiga yozish
  va har bir tovarning kun yakunidagi ombor qoldig'ini ko'rish mumkin.
- Qoldiq keyingi kunga o'tadi; rahbar sanab tasdiqlagan boshlang'ich qoldiq
  asosida hisob boshlanadi, eski agent yozuvlari avtomatik chiqimga aylantirilmaydi.
- Tahrirda sana siljishi, tasdiqlangan qoldiqning eski ombor harakatlari orqali
  buzilishi va kechikkan so'rovning yangi tahrirni almashtirishi tuzatildi.
- Javobi yo'qolgan prixod so'rovi sahifa yangilanganda saqlanadi. Agentning
  tovar tarixi o'chib ketmasligi uchun o'chirish o'rniga faolsizlantirish taklif etiladi.
