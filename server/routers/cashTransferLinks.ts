import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { cashTransferLinks } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

/** Old links are retained as history only. No new cross-module links are permitted. */
export const cashTransferLinksRouter = router({
  options: businessProcedure.input(z.object({ cashEntryId: z.number().int().positive() })).query(async ({ input }) => {
    const db = await requireDb();
    return { readOnly: true, links: await db.select().from(cashTransferLinks).where(eq(cashTransferLinks.cashEntryId, input.cashEntryId)) };
  }),
  save: businessProcedure.input(z.object({
    cashEntryId: z.number().int().positive(), mode: z.enum(["legacy", "linked", "independent"]),
    sources: z.array(z.object({kind:z.enum(["transaction", "client_payment"]),id:z.number().int().positive()})).max(100),
  })).mutation(() => {
    throw new TRPCError({code:"FORBIDDEN",message:"Kassa mustaqil hisob-kitob bo‘limi. Savdo va qarz to‘lovlariga yangi bog‘lanish yaratilmaydi. Eski tarix saqlanadi."});
  }),
});
