import { TRPCError } from "@trpc/server";

export const MAX_EXPORT_ROWS = 10_000;

export function assertExportRowLimit(
  rowCount: number,
  options?: { entityLabel?: string; filterHint?: string },
): void {
  if (rowCount <= MAX_EXPORT_ROWS) return;
  const entityLabel = options?.entityLabel ?? "yozuv";
  const filterHint = options?.filterHint ?? "Filterlarni toraytiring.";
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `Eksport uchun ${MAX_EXPORT_ROWS.toLocaleString("uz-UZ")} tadan ko‘p ${entityLabel} topildi. ${filterHint}`,
  });
}
