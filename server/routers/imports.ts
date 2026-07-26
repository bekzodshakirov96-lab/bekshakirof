import { desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { importHistory } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { requireDb } from "../db";
import { importDistributionWorkbook } from "../excelImport";
import { router } from "../_core/trpc";

const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm", ".xls"];

export const importsRouter = router({
  history: businessProcedure.query(async () => {
    const db = await requireDb();
    return db.select().from(importHistory).orderBy(desc(importHistory.createdAt)).limit(50);
  }),
  upload: businessProcedure
    .input(
      z.object({
        fileName: z.string().trim().min(1).max(255),
        base64: z.string().min(10).max(45_000_000),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const extension = input.fileName.slice(input.fileName.lastIndexOf(".")).toLowerCase();
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Faqat XLSX, XLSM yoki XLS fayli qabul qilinadi." });
      }
      const rawBase64 = input.base64.includes(",") ? input.base64.split(",").pop() ?? "" : input.base64;
      const buffer = Buffer.from(rawBase64, "base64");
      if (buffer.byteLength === 0 || buffer.byteLength > 30 * 1024 * 1024) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Fayl bo‘sh yoki 30 MB dan katta." });
      }
      return importDistributionWorkbook({
        buffer,
        fileName: input.fileName,
        userId: ctx.user.id,
        storeFile: true,
      });
    }),
});
