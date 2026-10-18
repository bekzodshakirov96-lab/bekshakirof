import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { ownerProcedure } from "../access";
import {
  applyCompanyTemplate,
  companyTemplateStatus,
} from "../companyTemplates";
import { templateApplySchema } from "../../shared/companyTemplates";
import { requireDb } from "../db";
import {
  readCompanyPreferences,
  saveCompanyPreferences,
} from "../companyPreferences";
import {
  companyDateSchema,
  companyPreferencesSaveSchema,
} from "../../shared/companyPreferences";

export const companyPreferencesRouter = router({
  onboarding: router({
    status: ownerProcedure
      .input(z.object({}).strict().optional())
      .query(async ({ ctx }) =>
        companyTemplateStatus(await requireDb(), ctx.user.id)
      ),
    choose: ownerProcedure
      .input(templateApplySchema)
      .mutation(async ({ ctx, input }) =>
        applyCompanyTemplate(
          await requireDb(),
          input.templateId,
          input.requestKey,
          ctx.user.id
        )
      ),
  }),
  get: protectedProcedure
    .input(z.object({ date: companyDateSchema.optional() }).strict().optional())
    .query(async ({ input }) =>
      readCompanyPreferences(await requireDb(), input?.date)
    ),
  save: ownerProcedure
    .input(companyPreferencesSaveSchema)
    .mutation(async ({ ctx, input }) =>
      saveCompanyPreferences(
        await requireDb(),
        input.preferences,
        input.expectedRevision,
        ctx.user.id
      )
    ),
});
