export type CashAccountingEntry = {
  type: "income" | "expense";
  cashAmount: number;
  terminalAmount: number;
  clickAmount: number;
  transferAmount?: number;
};

export const ELECTRONIC_PAYMENT_CATEGORY = "Elektron to‘lovlar";
export const AGENT_SETTLEMENT_CASH_CATEGORIES = ["Приход кег", "Приход пет"] as const;

export type CashReportEntry = CashAccountingEntry & {
  id: number;
  category: string;
};

export type NormalizedCashReportEntry<T extends CashReportEntry> = T & {
  reportKey: string;
  isElectronicSplit: boolean;
};

/**
 * Agent x Tovar solishtirishida agent yopgan summa: topshirilgan naqd pul va uning
 * nomiga yozilgan barcha elektron to'lovlar. Rasxod qatoriga tarixan birikib qolgan
 * elektron to'lov ham to'lov hisoblanadi, ammo rasxodning naqd qismi hisoblanmaydi.
 */
export function agentSettlementAmount(entry: CashAccountingEntry & { category: string }) {
  const submittedCash = entry.type === "income"
    && AGENT_SETTLEMENT_CASH_CATEGORIES.includes(entry.category as typeof AGENT_SETTLEMENT_CASH_CATEGORIES[number])
    ? entry.cashAmount
    : 0;
  return submittedCash + entry.terminalAmount + entry.clickAmount + (entry.transferAmount ?? 0);
}

/**
 * Eski Kassa jurnalida bitta rasxod qatoriga naqd rasxod bilan birga Terminal,
 * Click yoki O‘tkazma ham yozilgan. Hisobotda bu kanallarni rasxod deb ko‘rsatmaslik
 * uchun qatorni ikki virtual harakatga ajratamiz. Bazadagi asl yozuv o‘zgarmaydi.
 */
export function normalizeCashReportEntries<T extends CashReportEntry>(entries: T[]) {
  return entries.flatMap<NormalizedCashReportEntry<T>>(entry => {
    const electronicAmount = entry.terminalAmount + entry.clickAmount + (entry.transferAmount ?? 0);
    if (entry.type !== "expense" || electronicAmount <= 0) {
      return [{ ...entry, reportKey: `${entry.id}:base`, isElectronicSplit: false }];
    }

    const normalized: NormalizedCashReportEntry<T>[] = [];
    if (entry.cashAmount > 0) {
      normalized.push({
        ...entry,
        terminalAmount: 0,
        clickAmount: 0,
        transferAmount: 0,
        reportKey: `${entry.id}:cash`,
        isElectronicSplit: false,
      });
    }
    normalized.push({
      ...entry,
      type: "income",
      category: ELECTRONIC_PAYMENT_CATEGORY,
      cashAmount: 0,
      reportKey: `${entry.id}:electronic`,
      isElectronicSplit: true,
    });
    return normalized;
  });
}

/** Kassaning bo'laklab o'qilgan hisobotini xotirada butun tarixni saqlamasdan yig'adi. */
export function createCashReportPageAccumulator<T extends CashReportEntry>(options: {
  page: number;
  pageSize: number;
  type: "all" | "income" | "expense";
  category?: string;
}) {
  const items: NormalizedCashReportEntry<T>[] = [];
  const totals = { cashIncome: 0, cashExpense: 0, terminal: 0, click: 0, transfer: 0 };
  let total = 0;
  const firstWanted = (options.page - 1) * options.pageSize;
  const category = options.category?.toLocaleLowerCase();
  return {
    add(batch: T[]) {
      for (const item of normalizeCashReportEntries(batch)) {
        if (options.type !== "all" && item.type !== options.type) continue;
        if (category && !item.category.toLocaleLowerCase().includes(category)) continue;
        if (total >= firstWanted && total < firstWanted + options.pageSize) items.push(item);
        total++;
        if (item.type === "income") totals.cashIncome += item.cashAmount;
        else totals.cashExpense += item.cashAmount;
        totals.terminal += item.terminalAmount;
        totals.click += item.clickAmount;
        totals.transfer += item.transferAmount ?? 0;
      }
    },
    result() { return { items, total, totals }; },
  };
}

/**
 * Terminal va Click — agentdan kassaga keladigan elektron tushumlar. Ular qaysi
 * naqd toifa yozuviga biriktirilganidan qat'i nazar rasxod bo'la olmaydi.
 * Перечисление tasdiqlanguncha kutilayotgan summa bo'lib, realizatsiya qilingan
 * prihod/rasxod va jismoniy naqd qoldiqqa kirmaydi.
 */
export function summarizeCashAccounting(entries: CashAccountingEntry[]) {
  return entries.reduce(
    (summary, entry) => {
      if (entry.type === "income") summary.income += entry.cashAmount;
      else summary.expense += entry.cashAmount;
      summary.income += entry.terminalAmount + entry.clickAmount;
      summary.cashBalance += entry.type === "income" ? entry.cashAmount : -entry.cashAmount;
      summary.terminal += entry.terminalAmount;
      summary.click += entry.clickAmount;
      summary.transfer += entry.transferAmount ?? 0;
      return summary;
    },
    { income: 0, expense: 0, cashBalance: 0, terminal: 0, click: 0, transfer: 0 },
  );
}
