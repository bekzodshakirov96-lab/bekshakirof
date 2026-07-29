export type FastKegQuantities = {
  keg30: number;
  keg50: number;
  returned30: number;
  returned50: number;
  cash: number;
  terminal: number;
  /** Click ilovasi orqali kartadan-kartaga to'lov. */
  click: number;
  /** Bank o'tkazmasi — mijoz (odatda firma) hisob-raqamidan bizning hisob-raqamimizga. */
  transfer: number;
};

export type FastKegCurrentState = {
  currentDebt: number;
  currentKeg30Balance: number;
  currentKeg50Balance: number;
};

export type FastKegPricing = {
  keg30Price: number;
  keg50Price: number;
  keg30UnitsPerItem: number;
  keg50UnitsPerItem: number;
};

export function calculateFastKegRow(
  quantities: FastKegQuantities,
  current: FastKegCurrentState,
  pricing: FastKegPricing,
) {
  const issued30 = quantities.keg30 * pricing.keg30UnitsPerItem;
  const issued50 = quantities.keg50 * pricing.keg50UnitsPerItem;
  const saleAmount = quantities.keg30 * pricing.keg30Price + quantities.keg50 * pricing.keg50Price;
  const totalPayment = quantities.cash + quantities.terminal + quantities.click + quantities.transfer;
  const endingDebt = current.currentDebt + saleAmount - totalPayment;
  const endingKeg30Balance = current.currentKeg30Balance + issued30 - quantities.returned30;
  const endingKeg50Balance = current.currentKeg50Balance + issued50 - quantities.returned50;

  return {
    saleAmount,
    endingDebt,
    issued30,
    issued50,
    netKeg30: issued30 - quantities.returned30,
    netKeg50: issued50 - quantities.returned50,
    endingKeg30Balance,
    endingKeg50Balance,
  };
}

export function summarizeFastKegRows(
  rows: Array<FastKegQuantities & { saleAmount: number; endingDebt: number }>,
) {
  return rows.reduce<{
    clientCount: number;
    keg30: number;
    keg50: number;
    returned30: number;
    returned50: number;
    cash: number;
    terminal: number;
    click: number;
    transfer: number;
    saleAmount: number;
    endingDebt: number;
  }>(
    (summary, row) => ({
      clientCount: summary.clientCount + 1,
      keg30: summary.keg30 + row.keg30,
      keg50: summary.keg50 + row.keg50,
      returned30: summary.returned30 + row.returned30,
      returned50: summary.returned50 + row.returned50,
      cash: summary.cash + row.cash,
      terminal: summary.terminal + row.terminal,
      click: summary.click + row.click,
      transfer: summary.transfer + row.transfer,
      saleAmount: summary.saleAmount + row.saleAmount,
      endingDebt: summary.endingDebt + row.endingDebt,
    }),
    {
      clientCount: 0,
      keg30: 0,
      keg50: 0,
      returned30: 0,
      returned50: 0,
      cash: 0,
      terminal: 0,
      click: 0,
      transfer: 0,
      saleAmount: 0,
      endingDebt: 0,
    },
  );
}
