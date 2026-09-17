export type CashAccountingEntry = {
  type: "income" | "expense";
  cashAmount: number;
  terminalAmount: number;
  clickAmount: number;
  transferAmount?: number;
};

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
