import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { assertExportRowLimit, MAX_EXPORT_ROWS } from "./reportExport";

describe("assertExportRowLimit", () => {
  it("10 000 qatorgacha eksportga ruxsat beradi", () => {
    expect(() => assertExportRowLimit(MAX_EXPORT_ROWS)).not.toThrow();
  });

  it("10 000 dan ortiq datasetni o‘zbekcha BAD_REQUEST bilan bloklaydi", () => {
    try {
      assertExportRowLimit(MAX_EXPORT_ROWS + 1, { entityLabel: "agent", filterHint: "Filterlarni toraytiring." });
      throw new Error("Limit xatosi kutilgan edi");
    } catch (error) {
      expect(error).toBeInstanceOf(TRPCError);
      expect((error as TRPCError).code).toBe("BAD_REQUEST");
      expect((error as Error).message).toContain("agent");
      expect((error as Error).message).toContain("Filterlarni toraytiring");
    }
  });
});
