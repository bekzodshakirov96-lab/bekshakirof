import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { cashEntries } from "../drizzle/schema";
import { toMySqlDate } from "./businessDay";

export const cashReportFilterFields = {
  from: z.number().int().optional(),
  to: z.number().int().optional(),
  agentId: z.number().int().positive().optional(),
  employeeId: z.number().int().positive().optional(),
};

type CashReportScope = { from?: number; to?: number; agentId?: number; employeeId?: number };

export const oneCashParticipant = (input: CashReportScope) => !(input.agentId && input.employeeId);
export const cashParticipantError = { message: "Bitta agent yoki xodimni tanlang.", path: ["employeeId"] };
export const cashReportScopeInput = z.object(cashReportFilterFields).refine(oneCashParticipant, cashParticipantError);

/** Agent and employee IDs belong to separate dictionaries; never match them with OR. */
export function cashReportConditions(input: CashReportScope) {
  return [
    input.agentId ? eq(cashEntries.agentId, input.agentId) : undefined,
    input.employeeId ? eq(cashEntries.employeeId, input.employeeId) : undefined,
    input.from !== undefined ? sql`${cashEntries.entryDate} >= ${toMySqlDate(new Date(input.from))}` : undefined,
    input.to !== undefined ? sql`${cashEntries.entryDate} <= ${toMySqlDate(new Date(input.to))}` : undefined,
  ];
}
