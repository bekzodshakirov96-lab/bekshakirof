/**
 * Tannarx (o'rtacha xarid narxi) hisobi.
 *
 * Mahsulot bir necha marta, har xil narxda sotib olinadi. Foydani hisoblash
 * uchun sotilgan tovarning tannarxi kerak — biz **o'rtacha tortilgan narx**dan
 * foydalanamiz: umumiy xarajat / umumiy miqdor.
 *
 * Narxi kiritilmagan kirimlar (unitCost = 0) hisobga umuman olinmaydi — aks
 * holda o'rtacha narx sun'iy ravishda pasayib, foyda haqiqatdan katta ko'rinardi.
 */

export type StockInRow = {
  productId: number;
  /** Kirim miqdori (dona). */
  quantity: number;
  /** Bitta dona tannarxi; 0 bo'lsa narx kiritilmagan. */
  unitCost: number;
};

/**
 * Har bir mahsulot uchun o'rtacha tortilgan tannarxni qaytaradi.
 * Narxi bor kirimi bo'lmagan mahsulot natijaga umuman kirmaydi.
 */
export function averageCostByProduct(rows: StockInRow[]): Map<number, number> {
  const totals = new Map<number, { cost: number; quantity: number }>();

  for (const row of rows) {
    // Narxsiz yoki miqdorsiz kirim o'rtachani buzmasligi uchun tashlab ketiladi.
    if (row.unitCost <= 0 || row.quantity <= 0) continue;
    const current = totals.get(row.productId) ?? { cost: 0, quantity: 0 };
    current.cost += row.quantity * row.unitCost;
    current.quantity += row.quantity;
    totals.set(row.productId, current);
  }

  const result = new Map<number, number>();
  totals.forEach(({ cost, quantity }, productId) => {
    if (quantity > 0) result.set(productId, Math.round(cost / quantity));
  });
  return result;
}

export type ProfitLine = {
  /** Sotuv summasi (chegirma hisobga olingan holda). */
  totalAmount: number;
  quantity: number;
  /** Sotuv paytidagi tannarx nusxasi; 0 = noma'lum. */
  unitCost: number;
};

export type ProfitSummary = {
  revenue: number;
  /** Sotilgan tovarning tannarxi (faqat tannarxi ma'lum savdolar bo'yicha). */
  cost: number;
  /** revenue − cost, faqat tannarxi ma'lum savdolar bo'yicha. */
  profit: number;
  /** Foyda foizi: profit / (tannarxi ma'lum savdolar aylanmasi). */
  marginPercent: number;
  /** Tannarxi ma'lum savdolar aylanmasi — foiz shu asosda hisoblanadi. */
  revenueWithCost: number;
  /** Tannarxi kiritilmagan savdolar soni — foydaga kirmagan qism. */
  linesWithoutCost: number;
  /** Tannarxi kiritilmagan savdolar aylanmasi. */
  revenueWithoutCost: number;
};

/**
 * Savdo qatorlaridan foyda hisobini yig'adi.
 *
 * Tannarxi noma'lum qatorlar foyda hisobiga **kirmaydi**, lekin ular alohida
 * qaytariladi — foydalanuvchi raqam qanchalik to'liq ekanini ko'rib turishi kerak.
 */
export function summarizeProfit(lines: ProfitLine[]): ProfitSummary {
  let revenue = 0;
  let revenueWithCost = 0;
  let cost = 0;
  let linesWithoutCost = 0;
  let revenueWithoutCost = 0;

  for (const line of lines) {
    revenue += line.totalAmount;
    if (line.unitCost > 0) {
      revenueWithCost += line.totalAmount;
      cost += line.quantity * line.unitCost;
    } else {
      linesWithoutCost += 1;
      revenueWithoutCost += line.totalAmount;
    }
  }

  const profit = revenueWithCost - cost;
  return {
    revenue,
    cost,
    profit,
    marginPercent: revenueWithCost > 0 ? (profit / revenueWithCost) * 100 : 0,
    revenueWithCost,
    linesWithoutCost,
    revenueWithoutCost,
  };
}
