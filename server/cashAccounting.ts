import { sql } from "drizzle-orm";
import { cashEntries } from "../drizzle/schema";

/** Realizatsiya qilingan kirimga Terminal/Click tushumlari qo'shiladi; ular rasxod bo'la olmaydi. */
export const realizedIncomeSql = () =>
  sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} else 0 end), 0)
    + coalesce(sum(${cashEntries.terminalAmount} + ${cashEntries.clickAmount}), 0)`.mapWith(Number);

/** Rasxod — faqat kassadan chiqqan naqd summa. */
export const cashExpenseSql = () =>
  sql<number>`coalesce(sum(case when ${cashEntries.type} = 'expense' then ${cashEntries.cashAmount} else 0 end), 0)`.mapWith(Number);

/** Jismoniy kassada qolishi kerak bo'lgan naqd pul. */
export const physicalCashBalanceSql = () =>
  sql<number>`coalesce(sum(case when ${cashEntries.type} = 'income' then ${cashEntries.cashAmount} else -${cashEntries.cashAmount} end), 0)`.mapWith(Number);
