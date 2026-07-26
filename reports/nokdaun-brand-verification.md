# NOKDAUN mchj sidebar brendi — verifikatsiya

`DashboardLayout.tsx` dagi sidebar header elementi kodda aynan **`NOKDAUN mchj`** matnini render qiladi. Eski **`Distribyutsiya 360`** matni faqat login ekrani blokida saqlangan; foydalanuvchi tahriri ko‘rsatgan sidebar elementi line 190 da to‘g‘ri yangilangan.

Autentifikatsiyalangan desktop preview screenshotda sidebar bilan birga pastki foydalanuvchi bloki ham ko‘rindi. Screenshotning sidebar header va footer qismlari 4× kattalashtirilib, grayscale, invert, autocontrast va sharpen preprocessingdan keyin Tesseract 5.3.4 bilan o‘qildi. Raw chiqish `reports/nokdaun-brand-authenticated-ocr.txt` faylida saqlangan.

| Tekshiruv | Inspectable dalil | Natija |
|---|---|---|
| Sidebar brendi | Kod: `NOKDAUN mchj`; OCR: `NOKDAUN mehj` | O‘tdi; OCR kichik `c` glifini `e` sifatida o‘qigan, qolgan brend to‘liq mos |
| Auth holati | OCR: `bekshakirof`, `Rahbar` | O‘tdi; screenshot autentifikatsiyalangan rahbar sessiyasini ko‘rsatadi |
| Sidebar subtitle | OCR: `BIZNES BOSHQARUVI` | O‘tdi |
| TypeScript | `pnpm check` | O‘tdi |
| Vitest | 11 fayl, 42 test | O‘tdi |
| Production build | `pnpm build` | O‘tdi; faqat mavjud chunk-size warningi bor |

Vizual tahrir foydalanuvchi niyatiga mos: sidebarning ko‘rinadigan kompaniya nomi **NOKDAUN mchj** ga almashtirilgan, qolgan layout va subtitle o‘zgarmagan.
