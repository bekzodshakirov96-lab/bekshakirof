# Excel ma’lumotlarini tizimga xaritalash

`Qarzdorlik_Hisoboti.xlsm` faylidagi biznes varaqlari quyidagi qoidalarga muvofiq import qilinadi. `Dashboard` va `Qarzdorlik` varaqlari alohida yozuv sifatida import qilinmaydi, chunki ulardagi qiymatlar boshqa varaqlardagi asosiy yozuvlardan qayta hisoblanadi. Bu yondashuv bir xil ma’lumotning ikki joyda saqlanishini va yig‘indilar orasida tafovut paydo bo‘lishini oldini oladi.

| Excel varag‘i | Manba ustunlari | Tizimdagi manzil | Qoida |
|---|---|---|---|
| `Agentlar` | Agent ismi, Telefon, Izoh | `agents` | Agent ismi bo‘yicha upsert qilinadi. Bo‘sh nomli qatorlar o‘tkazib yuboriladi. |
| `Mijozlar` | Mijoz kodi, Mijoz nomi, Agent, Telefon, Manzil, Boshlang‘ich qarz | `clients` | Mijoz kodi bo‘yicha upsert qilinadi; agent nomi `agents.id` ga bog‘lanadi. |
| `Tovarlar` | Tovar kodi, Tovar nomi, O‘lchov birligi, Narxi | `products` | Tovar kodi bo‘yicha upsert qilinadi. |
| `Tovar_berish` | Sana, Agent, Mijoz, Tovar, Birlik, Miqdor, Joriy narx, Savdo narxi, Summa, Naqd, Terminal, Izoh | `transactions` | Sana va qator mazmunidan deterministik `sourceKey` yaratiladi; takroriy import bir xil yozuvni yangilaydi. |
| `Kassa` | Sana, Turi, Toifa, Agent, Tavsif, Naqd, Terminal, Click | `cash_entries` | Faqat sanasi va turi mavjud amaliy qatorlar olinadi; formula va dashboard bloklari olinmaydi. |
| `Dashboard` | KPI kartalari va grafik qiymatlari | `dashboard` tRPC hisob-kitoblari | `transactions`, `clients` va `cash_entries` asosida real vaqtda qayta hisoblanadi. |
| `Qarzdorlik` | Mijoz, agent, boshlang‘ich qarz, savdo va to‘lov yig‘indilari | `debtReport` tRPC hisob-kitoblari | `openingDebt + sales - cash - terminal - click` formulasi orqali qayta hisoblanadi. |
| `Tara_harakati` | Sana, Agent, Mijoz, Tara turi, Berildi/Qaytarildi, Miqdor, Izoh | `container_movements` | Qator raqami va yil asosidagi `sourceKey` bilan takroriy import qilinadi; berilgan va qaytarilgan KEGlar alohida saqlanadi. |

> Barcha pul qiymatlari so‘mda butun son sifatida, vaqt qiymatlari esa UTC vaqt tamg‘asi sifatida saqlanadi. Foydalanuvchi interfeysi sanalarni mahalliy vaqt mintaqasida ko‘rsatadi.
