# Agent × Tovar: prixod va ostatka

Agent katagiga omborchi qaytimlarni hisoblab bergan tayyor NET miqdor yoziladi.
Qaytim alohida qayta kiritilmaydi. Prixod — faqat yangi kelgan tovar; katakka
yozib Enter yoki Tab bosiladi. Har bir yangi kirimning alohida tarixi va so'rov
IDsi bor. Kassa pul qoldig'iga bu kirim avtomatik ta'sir qilmaydi.

Rahbar avval har bir mahsulot uchun sanab tasdiqlangan **kun boshidagi** qoldiq
va hisob boshlanadigan sanani belgilaydi. Qoldiq kun oxirida sanalgan bo'lsa,
keyingi kunni boshlash sanasi sifatida tanlash kerak. Oldingi agent yozuvlari
avtomatik ombor chiqimiga aylantirilmaydi.

Ostatka = boshlang'ich qoldiq + kirimlar − agentlarning tayyor miqdorlari.
Asosiy ombor jurnali `stockMovements`; Sklad va matritsa shu manbadan hisoblaydi.
40 → 35 tahriri omborga faqat +5 qaytaradi; katakni o'chirish miqdorni qaytaradi.
Keyingi kun oldingi kunning yakuniy qoldig'idan boshlanadi. Barcha agentlar,
jumladan yashirilgan ustunlar ham hisobga kiradi. Narx miqdorni o'zgartirmaydi.

## Uchta himoya

- Miqdor, kunlik narx yoki mahsulot nomi tahrirlanganda biznes sanasi saqlanadi,
  jumladan eski MySQL/MariaDB `ON UPDATE` ustuni mavjud bo'lsa ham.
- Tasdiqlangan boshlang'ich sanadan oldingi ombor harakatlarini qo'shish yoki
  o'chirish Sklad, Zavod va Savdo yo'llarida bloklanadi. Narx/nom tahriri ombor
  harakatini o'zgartirmasa tarixga tegmaydi. Mahsulot qulfi boshlang'ich qoldiq
  tasdiqlanishi bilan parallel kirim-chiqimni muvofiqlashtiradi.
- `matrix_cell_writes` har bir so'rov IDsi va tahrir versiyasini doimiy saqlaydi,
  jumladan katak o'chirilgandan keyin ham. Eski so'rov qayta kelganda yana chiqim
  yaratilmaydi; eski versiyali yangi so'rov rad etilib jadval yangilanadi.
- Javobi yo'qolgan prixod IDsi shu foydalanuvchi, mahsulot va sana uchun brauzer
  sessiyasida saqlanadi. Sana almashtirish yoki sahifani yangilashdan keyin
  "Oldingi prixodni tekshirish" aynan shu so'rovni qayta tekshiradi. Natija
  aniqlanmaguncha boshqa summa bilan eski so'rovni almashtirishga ruxsat yo'q.
- Agentning Agent × Tovar tarixi bo'lsa, uni butunlay o'chirish bloklanadi.
  Mavjud faolsizlantirish funksiyasidan foydalaniladi; eski miqdor va pul tarixi
  saqlanadi, ombor chiqimlari manbasiz qolmaydi.

## Mavjud production ma'lumotlarini saqlash

Release SaaS/multitenancy, login, obuna yoki bazani qayta bog'lashni kiritmaydi.
`ensureMatrixInventorySchema` faqat uchta yangi jadvalni `CREATE TABLE IF NOT
EXISTS` orqali yaratadi. U eski jadvalni ALTER qilmaydi, satrlarni yangilamaydi,
o'chirmaydi, inventarizatsiya boshlamaydi va tarixga kirim-chiqim yozmaydi.
Yangi jadvaldagi `tenant_id='legacy'` faqat kelajakdagi moslik uchun; mavjud
firma jadvallariga tenant ustuni qo'shilmaydi.

Deploydan oldin MySQL va uploads zaxirasi olinadi; mavjud jadvallar nazorat
xeshlari yozib olinadi. Deploydan keyin eski jadvallar solishtiriladi. Jonli
foydalanuvchi kiritgan yangi operatsiya sabab farq bo'lsa, u alohida tekshiriladi.
Boshlang'ich qoldiqlar productionda avtomatik belgilanmaydi; ularni rahbar haqiqiy
sanashdan keyin tasdiqlaydi. TEST mahsulotlari va lokal qoldiqlar ko'chirilmaydi.

Orqaga qaytish kerak bo'lsa, oldingi app deployment qayta ochiladi. Yangi ombor
jadvallari o'chirilmaydi. SQL zaxirasini jonli baza ustiga avtomatik tiklash mumkin
emas: deploydan keyingi haqiqiy tranzaksiyalarni yo'qotish xavfi bor.
