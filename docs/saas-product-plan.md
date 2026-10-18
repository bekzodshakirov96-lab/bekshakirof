# BiznesControl SaaS — boshlang‘ich loyiha

To‘rtinchi bosqich: uchta faoliyat shabloni alohida lokal firmalarda audit qilindi.
Parallel shablon tanlash himoyasi, KEGning Toshkent sanasi va yuklanish holatlari
tuzatildi. Kassa/KEG formulalari va mavjud firma yozuvlari saqlandi. Natijalar:
`docs/saas-template-pilot-audit-2026-10-18.md`. Productionga qo‘llanmagan.

Uchinchi moslashtirish bosqichi localhostda qo‘shildi: bo‘sh yangi firma egasi
ulgurji savdo, agent tarqatish yoki ichimlik/KEG shablonini oldindan ko‘rib,
bir marta tanlaydi. Shablon faqat nom va menyuni sozlaydi; mavjud firmalar
avtomatik o‘zgarmaydi. Tafsilot: `docs/saas-company-templates.md`.

Firma moslashtirishining ikkinchi bosqichi localhostda qo‘shildi: Kunlik jurnal
va Agent × Tovar ustun nomlari, modullarni menyudan yashirish, firma/sana bo‘yicha
sozlamalar va rahbar uchun tahrirlash. Moliyaviy qoidalar o‘zgarmaydi; bu menyu
sozlamalari xavfsizlik ruxsatlarini almashtirmaydi. Batafsil:
`docs/saas-company-preferences.md`. Productionga qo‘llanmagan.

Mahalliy moslashtirishning birinchi bosqichi: ichki kassa toifa IDlari, nomlardan
ajratilgan moliyaviy ma'no va eski format bilan moslik qatlami qo'shildi. Mavjud
firma tarixi qayta yozilmaydi; Kassa/Tezkor KEG ishlash tartibi saqlanadi. Bu hali
sozlamalar konstruktori yoki yangi shablonlar emas. Batafsil:
`docs/saas-business-identities.md`. Productionga qo'llanmagan.

Holat: SaaS rejasi va birinchi bosqichning mahalliy implementatsiyasi. Firma chegarasi, sessiya/fayl ajratish va mavjud bazani tekshirib bog‘lash vositasi yozildi; productionga qo‘llanmagan. Ish tartibi: `docs/saas-tenant-isolation.md`.
Ikkinchi bosqichning mahalliy qo‘shimchasi: alohida platforma bazasi, firma ro‘yxatdan o‘tishi/email tasdiqlash, bir oylik trial, firma kabineti, super admin va audit. Yangi firmalar uchun tayyorlash operator komandasi orqali, infratuzilma hali avtomatik yaratilmaydi. To‘lov integratsiyasi/narx, mavjud firmaga aktivlashtirish va production relizi bajarilmagan. Ish tartibi: `docs/saas-control-plane.md`.
Sana: 2026-10-17, Asia/Tashkent.

Keyingi tasdiqlangan o‘zgarish: barcha 24 biznes jadvalida `tenant_id` va so‘rovlarda majburiy firma chegarasi qo‘shildi. Alohida baza/instansiya arxitekturasi saqlanadi. Avvalgi “firma ustuni yo‘q” auditi tarixiy boshlang‘ich holatni bildiradi; amaldagi migratsiya va cheklovlar: `docs/saas-tenant-query-scope.md`. Productionga qo‘llanmagan.

## Tasdiqlangan mahsulot modeli

- O‘zbekiston firmalari uchun B2B SaaS; obuna valyutasi UZS.
- Firma egasi o‘zi ro‘yxatdan o‘tadi, firma kabinetini yaratadi va onlayn obuna to‘laydi.
- Bir oy bepul foydalanish tasdiqlangan. Texnik taklif: email tasdiqlanib firma muvaffaqiyatli yaratilgandan boshlab bir kalendar oy; narx hali belgilanmagan.
- Har bir firma o‘z mijozlari, agentlari, xodimlari, tovarlari, ombori, kassasi va tarixiga ega.
- Hozirgi firmaning tarixiy yozuvlari va pul hisoblash qoidalari saqlanishi kerak.
- Kassa va Tezkor KEG savdosining foydalanuvchiga tanish ishlash tartibi saqlanadi.
- SaaS obunasi to‘lovi platforma billingida yuritiladi; firmaning kassa, savdo yoki qarz hisoblariga yozilmaydi.

## Koddan tasdiqlangan joriy holat

| Joy | Joriy holat | SaaS uchun talab |
| --- | --- | --- |
| `drizzle/schema.ts` | 24 ta jadval; firma identifikatori yo‘q; kod/nomlar uchun umumiy unique indekslar bor | Jadvalma-jadval egalik xaritasi, firma doirasidagi indekslar va aloqalar |
| `server/db.ts` | `DATABASE_URL` va bitta umumiy DB obyekti | Firma chegarasini majburiy tekshiradigan ma’lumotlarga kirish qatlami |
| `server/_core/context.ts` | So‘rov kontekstida faqat foydalanuvchi bor | Tasdiqlangan firma a’zoligi va firma roli |
| `server/access.ts` | Admin/buxgalter/agent/omborchi rollari umumiy foydalanuvchida | Platforma administratori va firma rollarini ajratish |
| `server/routers.ts` | Ochiq ro‘yxatdan o‘tish birinchi hisob yaratilgach yopiladi | Firma yaratish bilan bog‘langan, qayta so‘rovga bardoshli onboarding |
| `server/routers/users.ts` | `OWNER_USER_ID = 1`; foydalanuvchilar umumiy ro‘yxati | Har firmaning egasi/a’zolari; egani almashtirish qoidasi |
| `server/_core/localAuth.ts` | JWT `userId` va `tokenVersion` saqlaydi | Har so‘rovda faol a’zolik va tanlangan firma tekshirilishi |
| `server/_core/index.ts`, `server/storage.ts` | Yuklangan fayllar uchun login tekshiruvi bor, firma bo‘yicha tekshiruv yo‘q | Fayl metama’lumoti va yo‘li firma bilan bog‘lanadi; yuklab olishda egalik tekshiriladi |
| `server/routers/products.ts`, boshqa routerlar | Biznes so‘rovlari firma bo‘yicha chegaralanmagan | Ro‘yxat, hisobot, yig‘indi, ID orqali yozish va o‘chirishda bir xil firma nazorati |

Bu holatlar bitta firma tizimi uchun tushunarli; ikkinchi firma ulashdan oldin ularni o‘zgartirish zarur.

## Tavsiya etiladigan arxitektura

React + Node/tRPC + Drizzle/MySQL asosini saqlagan modular monolit.
SaaS boshqaruvi, autentifikatsiya va biznes hisob-kitoblari alohida modullar bo‘ladi.
Birinchi implementatsiya qarori: bir xil kod versiyasidan har firma uchun alohida ilova instansiyasi va alohida MySQL bazasi (silo modeli). Kodda bazaga 484 ta murojaat joyi bor; hozirgi hisoblashlarni firma filtrlari bilan ommaviy qayta yozish o‘rniga barcha so‘rovlar butunlay alohida bazada bajariladi.

Har instansiya bitta o‘zgarmas firma IDsi, baza akkaunti, JWT kaliti, hostlar ro‘yxati va fayl hajmiga ega. Bu operatsion xarajatni oshiradi; keyingi onboarding bosqichida provisioning va versiyalarni birgalikda boshqarish avtomatlashtiriladi. Hozirgi moliyaviy jadvallarga firma ustuni qo‘shish va tarixiy summalarni ko‘chirish talab qilinmaydi.

Umumiy bazadagi `tenant_id` usuli keyingi alohida arxitektura qarori bo‘lishi mumkin; ushbu relizda ishlatilmaydi. SaaS boshqaruv paneli, mustaqil ro‘yxatdan o‘tish va billing keyingi bosqichlar.

### Ma’lumot modeli

- `tenants`: firma nomi, noyob slug, faoliyat holati, vaqt mintaqasi, yaratilgan sana.
- `users`: global identifikatsiya, tasdiqlangan email, parol va sessiya xavfsizligi.
- `tenant_memberships`: `(tenant_id, user_id)` noyobligi, firma ichidagi rol, holat; agent aloqasi ayni firmaga tegishli.
- `tenant_invitations`: muddati va bir marta ishlatiladigan xeshlangan taklif tokeni.
- `plans`, `plan_prices`: versiyalangan tarif/narx, UZS, davr, funksiyalar va limitlar. Narx serverdan olinadi.
- `subscriptions`: firma obunasi va kirish davri. `pending`, `trialing`, `active`, `past_due`, `suspended`, `canceled` holatlari; boshlang‘ich tarifda bir oylik trial.
- `billing_orders`, `billing_transactions`, `billing_events`: buyurtma, provayder to‘lovi, qayta kelgan xabarlarni aniqlash va to‘lov tarixi.
- Platforma audit yozuvlari va har firma biznes auditi alohida doirada yuritiladi.
- Yuqoridagi platforma jadvallari keyingi control-plane bosqichi uchun reja. Birinchi bosqichda mavjud 24 jadval butunlay firma bazasiga tegishli; umumiy biznes jadvallari yo‘q.
- Kod, agent nomi, kunlik narx va jurnal layouti kabi unique cheklovlar o‘z firma bazasida qoladi. Firma egasi bo‘lgan `users.id=1` ham faqat o‘z bazasiga tegishli.

### Firma chegarasi

Firma IDsi brauzerdan kelsa ham u faqat tanlov: server foydalanuvchining ayni firmaga a’zoligini tekshiradi.
Kontekst yo‘q, a’zolik bekor qilingan yoki firma bloklangan bo‘lsa biznes so‘rovi bajarilmaydi.
Faqat interfeysda bo‘lim yashirish yoki so‘rovlarning ayrimlariga `tenant_id` qo‘shish yetarli emas.
Xom SQL, import, eksport, yig‘indi hisobotlar, fon vazifalari, fayllar, audit va backup ham shu chegaradan o‘tadi.
Firma almashtirilganda brauzer query keshi tozalanadi, mahalliy sozlamalar firma va foydalanuvchi bilan nomlanadi.
Platforma administratori firma egasidan alohida; qo‘llab-quvvatlash kirishi vaqtli, qayd etiladigan va alohida ruxsatli bo‘ladi.

## Foydalanuvchi oqimi

1. Mahsulot sahifasi va tariflar → hisob yaratish → emailni tasdiqlash.
2. Firma yaratish → egani a’zo qilish → boshlang‘ich sozlamalar. Bular atomik yoki qayta urinilganda dublikat yaratmaydigan jarayon bo‘ladi.
3. Firma uchun bir oylik trial boshlanadi. Keyin tarif tanlash → server billing buyurtmasini yaratadi → Payme/Click orqali onlayn to‘lov.
4. Provayderning tasdiqlangan server xabari → buyurtma to‘langan holatga o‘tadi → obuna bir marta faollashadi.
5. Firma egasi xodimlarni taklif qiladi; a’zolar o‘z rollari bo‘yicha ishlaydi.
6. Kabinetda obuna muddati, tarif, to‘lovlar tarixi va uzaytirish ko‘rinadi.

## UZS onlayn to‘lovlari

Payme Merchant API va Click Shop API uchun provayder adapterlari rejalashtiriladi.
Birinchi reliz taklifi: provayder to‘lov sahifasi orqali har davr uchun onlayn to‘lov.
Kartadan avtomatik yechish alohida bosqich; onlayn to‘lov tanlovi avtomatik yechishga rozilik deb qabul qilinmaydi.

- Brauzerning qaytish sahifasi obunani faollashtirmaydi.
- Callback autentifikatsiyasi provayder protokoli bo‘yicha tekshiriladi; summa, valyuta, buyurtma va firma mosligi tekshiriladi.
- Takroriy xabar to‘lovni yoki obuna davrini ikkinchi marta yaratmaydi; unique provayder tranzaksiya IDsi va DB tranzaksiyasi ishlatiladi.
- Bekor qilish, qaytarish, vaqt tugashi va uzilgan javoblar alohida holatlarga ega. Fon tekshiruvi provayder bilan muvofiqlashtiradi.
- Pul miqdori float bilan hisoblanmaydi; provayder talab qilgan birlikka aniq o‘giriladi.
- Karta raqami va CVV saqlanmaydi; keyinchalik avtoyechish joriy etilsa provayder tokeni va rozilik tarixi qo‘llanadi.
- Haqiqiy to‘lov uchun savdogar kabineti, provayder ruxsati va tegishli test/production rekvizitlari kerak; maxfiy kalitlar chat yoki Gitga yozilmaydi.
- Bepul sinov — bir oy. Tarif narxi va limitlar hali belgilanmagan; qiymatlar taxminan productionga qo‘yilmaydi.

### Bir oylik sinovning taklif etilayotgan qoidalari

- Bir oy 30 kunlik doimiy sekund emas, kalendar oy sifatida hisoblanadi: keyingi oyda ayni kun yo‘q bo‘lsa o‘sha oyning oxirgi kuni olinadi.
- Vaqt chegaralari UTC vaqt nuqtasi sifatida saqlanadi; firma uchun Asia/Tashkent vaqtida ko‘rsatiladi.
- Sinov foydalanuvchiga emas, firmaga beriladi. Xodim taklifi, logout/login, qayta yuborilgan onboarding yoki tarif almashtirish `trialEndsAt`ni qayta boshlamaydi.
- Boshlang‘ich trial karta talab qilmaydi va avtomatik pul yechmaydi; avtomatik yechish keyinchalik alohida rozilik bilan qo‘shilishi mumkin.
- Muddat tugashi serverda tekshiriladi; brauzer soati yoki oynadagi qolgan kunlar kirish qarorini belgilamaydi.
- Bir xil tashkilot uchun takroriy trial olishni cheklash siyosati onboarding va firma identifikatsiyasi bilan aniqlanadi.

## Amalga oshirish ketma-ketligi

1. **Firma chegarasi:** jadval/endpoint xaritasi, server a’zolik konteksti, firma rollari, cheklangan ma’lumotlar qatlami va ikki firma bilan ajratish testlari.
2. **Mavjud biznesni moslashtirish:** barcha biznes jadvallari/routerlar/import/eksport/fayllar/auditni bir xil firma doirasiga o‘tkazish; eski firma uchun qaytariladigan migratsiya.
3. **Mustaqil ro‘yxatdan o‘tish:** email tasdiqlash, parol tiklash, firma yaratish va xodim takliflari; spam/soxta ro‘yxatdan o‘tishga qarshi chegaralar.
4. **Obuna va to‘lov:** tariflar, kabinet, provayder test muhiti, callback va muvofiqlashtirish, muddati tugagan obunaga kirish siyosati.
5. **SaaS boshqaruvi va pilot:** platforma paneli, kuzatuv, firma kesimida zaxira/tiklash sinovi, pilot firmalar va bosqichli production relizi.

Tavsiya: obuna tugaganda ma’lumotni o‘chirmasdan, billing va tarixni ko‘rish/eksport imkonini saqlagan cheklangan rejim. Yakuniy siyosat mahsulot qarori sifatida belgilanadi.

## Mavjud firmaga migratsiya

- Production bazasi va fayllarining zaxirasi olinadi, nusxada qayta tiklash amalda tekshiriladi.
- Migratsiya avval izolyatsiyalangan muhitda bajariladi; mavjud yozuvlar legacy firmaga biriktiriladi, yangi firmalar bo‘sh boshlanadi.
- Migratsiyadan oldin/keyin kunlik kassa qoldiqlari, agent hisoblari, mijoz qarzlari va tara/ombor qoldiqlari solishtiriladi.
- Eski firma yangi obuna chekloviga tasodifan tushmasligi uchun uning xizmat holati alohida belgilanadi.
- Constraint, indeks va kod versiyasining mosligi tekshirilgachgina cutover qilinadi; yozuvlar aralashgan qisman SaaS productionga chiqmaydi.
- Rollback rejasi eski kod bilan mos migratsiya bosqichini va cutoverdan keyingi yozuvlarni saqlab qolish tartibini belgilaydi; eski backupni ko‘r-ko‘rona tiklash yetarli emas.

## Qabul mezonlari

- A firma foydalanuvchisi B firma IDlarini bersa ham Bning yozuvini o‘qiy, o‘zgartira, o‘chira yoki unga bog‘langan yozuv yarata olmaydi.
- Ro‘yxatlar, yig‘indilar, paginatsiya, hisobotlar, eksport, fayl yuklab olish, import va audit bo‘yicha ikki firma bilan testlar o‘tadi.
- Bir vaqtdagi onboarding ikkita egani yoki dublikat firma yaratmaydi.
- Trial oy oxiri/kabisa yili holatlarida to‘g‘ri tugaydi; qayta kirish yoki xodim qo‘shish uni uzaytirmaydi.
- Takroriy, soxta yoki boshqa summadagi provayder xabari obunani faollashtirmaydi; bekor qilish va javob uzilishi testlari o‘tadi.
- A’zolik bekor qilinganda eski sessiya biznes ma’lumotlariga kirishni davom ettirmaydi.
- Mavjud firma kassa/qarz/ombor hisobotlari nusxadagi migratsiyadan oldingi qiymatlar bilan mos qoladi.
- Firma kesimida backupdan tiklash sinovi va relizni ortga qaytarish mashqi bajariladi.

## Manbalar

- [AWS SaaS Lens: Silo, Pool, and Bridge Models](https://docs.aws.amazon.com/wellarchitected/latest/saas-lens/silo-pool-and-bridge-models.html)
- [OWASP Multi-Tenant Application Security](https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html)
- [Payme Merchant API](https://developer.help.paycom.uz/metody-merchant-api/)
- [Payme Subscribe API: cards.create](https://developer.help.paycom.uz/metody-subscribe-api/cards.create/)
- [Click rasmiy integratsiya hujjatlari](https://docs.click.uz/)
