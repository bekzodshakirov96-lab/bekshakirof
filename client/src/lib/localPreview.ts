import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import type { AppRouter } from "../../../server/routers";

const agents = ["Dilshod", "Doston", "Farhod", "Rasul", "Rustam", "Suxrob", "Zafar", "Xusayn"]
  .map((name, index) => ({ id: index + 1, name }));

const productNames = [
  ["BUCHINGER-15", "Buchinger 1.5", 123_000],
  ["BUCHINGER-130", "BUCHINGER 130000", 130_000],
  ["BUCHINGER-NF", "Buchinger NF", 128_000],
  ["FELLIZ-05", "Felliz 0.5", 47_000],
  ["FELLIZ-125", "Felliz 1.25", 57_000],
  ["ITALIANO", "Italyano", 90_000],
  ["PANDA", "PANDA", 145_000],
  ["SUV-OQ", "Suv oq", 58_000],
  ["TAMAT", "TAMAT", 24_000],
  ["TIKTOK-05", "Tik tok 0.5", 35_000],
  ["ZAMZAM-05", "ZAMZAM 0.5", 45_000],
  ["BARLOS-25", "Barlos 2.5l", 90_000],
] as const;

const products = productNames.map(([code, name, price], index) => ({
  id: index + 1,
  code,
  name,
  unit: "dona",
  price,
  containerType: null,
  containerUnitsPerItem: 1,
  sortOrder: index,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
}));

const cashEntries = [
  { id: 1, type: "income", category: "Приход кег", agentId: 1, agentName: "Dilshod", cashAmount: 2_450_000, terminalAmount: 350_000, clickAmount: 0, transferAmount: 0, description: "Kunlik tushum" },
  { id: 2, type: "income", category: "Приход пет", agentId: 4, agentName: "Rasul", cashAmount: 1_780_000, terminalAmount: 0, clickAmount: 420_000, transferAmount: 0, description: "Savdo tushumi" },
  { id: 3, type: "expense", category: "Газ", agentId: 6, agentName: "Suxrob", cashAmount: 80_000, terminalAmount: 0, clickAmount: 0, transferAmount: 0, description: "Avtomobil uchun gaz" },
  { id: 4, type: "expense", category: "Расход", agentId: 2, agentName: "Doston", cashAmount: 125_000, terminalAmount: 0, clickAmount: 0, transferAmount: 0, description: "Yetkazib berish xarajati" },
].map(row => ({ ...row, entryDate: new Date(), employeeId: null, employeeName: null }));

const takingRows = [
  { id: 1, agentId: 1, productId: 1, productName: "Buchinger 1.5", unitPrice: 123_000, quantity: "20.000", amount: 2_460_000, entryDate: new Date(), createdBy: 1 },
  { id: 2, agentId: 2, productId: 2, productName: "BUCHINGER 130000", unitPrice: 130_000, quantity: "12.000", amount: 1_560_000, entryDate: new Date(), createdBy: 1 },
  { id: 3, agentId: 4, productId: 7, productName: "PANDA", unitPrice: 145_000, quantity: "15.000", amount: 2_175_000, entryDate: new Date(), createdBy: 1 },
  { id: 4, agentId: 6, productId: 8, productName: "Suv oq", unitPrice: 58_000, quantity: "18.000", amount: 1_044_000, entryDate: new Date(), createdBy: 1 },
];

const daySummary = {
  jamiPrihod: 5_000_000,
  jamiRasxod: 205_000,
  kassaQoldigi: 42_496_000,
  actualCash: null,
  actualCashNote: "",
  actualDiff: null,
  agentSummaries: agents.map(agent => {
    const computedAmount = takingRows.filter(row => row.agentId === agent.id).reduce((sum, row) => sum + row.amount, 0);
    const submittedAmount = cashEntries.filter(row => row.agentId === agent.id && row.type === "income")
      .reduce((sum, row) => sum + row.cashAmount + row.terminalAmount + row.clickAmount + row.transferAmount, 0);
    return { agentId: agent.id, agentName: agent.name, computedAmount, submittedAmount, farq: computedAmount - submittedAmount, note: null };
  }),
  agentComputedTotal: takingRows.reduce((sum, row) => sum + row.amount, 0),
  agentSubmittedTotal: 5_000_000,
  agentFarqTotal: 2_239_000,
  problemAgentCount: 4,
  pendingByChannel: {
    cash: { today: 0, cumulative: 0 },
    terminal: { today: 0, cumulative: 0 },
    click: { today: 0, cumulative: 0 },
    transfer: { today: 0, cumulative: 0 },
  },
  channelConfirmed: { terminal: 0, click: 0, transfer: 0, note: "" },
};

function previewResult(path: string) {
  switch (path) {
    case "auth.me":
      return { id: 1, name: "Local preview", email: "preview@localhost", role: "admin", tokenVersion: 0, agentId: null, language: "latin", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
    case "auth.needsSetup": return false;
    case "agents.options": return agents;
    case "employees.options": return [];
    case "products.list": return products;
    case "cash.byDate": return cashEntries;
    case "cash.journalDebt.byDate": return [{ id: 1, entryDate: new Date(), agentId: 6, agentName: "Suxrob", employeeId: null, employeeName: null, amount: 300_000, description: "Mahalliy preview uchun qarz qaydi" }];
    case "cash.openingBalance": return { openingBalance: 37_701_000 };
    case "kassa.daySummary": return daySummary;
    case "kassa.agentTaking.listForDay": return takingRows;
    case "kassa.dayPrice.listForDay": return [];
    case "kassa.matrixLayout.forDate": return null;
    default: return { success: true, id: Date.now(), amount: 0 };
  }
}

/**
 * Faqat localhost maketini ko‘rish uchun: Railway/MySQL bilan ulanmaydi va
 * kiritilgan o‘zgarishlarni hech qayerga saqlamaydi.
 */
export const localPreviewLink: TRPCLink<AppRouter> = () => ({ op }) =>
  observable(observer => {
    observer.next({ result: { data: previewResult(op.path) } });
    observer.complete();
    return () => {};
  });
