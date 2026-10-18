import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { ownerProcedure } from "../access";
import { requireDb } from "../db";
import { companyBrandingSaveSchema } from "../../shared/companyBranding";
import { readCompanyBranding, saveCompanyBranding } from "../companyBranding";
export const companyBrandingRouter = router({
  get: protectedProcedure
    .input(z.object({}).strict().optional())
    .query(async () => readCompanyBranding(await requireDb())),
  save: ownerProcedure
    .input(companyBrandingSaveSchema)
    .mutation(async ({ ctx, input }) =>
      saveCompanyBranding(await requireDb(), input, ctx.user.id)
    ),
});
