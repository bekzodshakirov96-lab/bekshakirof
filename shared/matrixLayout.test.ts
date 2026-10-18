import { describe, expect, it } from "vitest";
import { clampMatrixColumnWidth, matrixLayoutValueSchema, matrixColumnWidthsSchema } from "./matrixLayout";

describe("dated matrix column widths", () => {
  it("reads legacy snapshots without widths and round-trips independent agent widths", () => {
    const legacy = { productOrder: [2, 1], visibleProductIds: [2], agentOrder: [4, 7] };
    expect(matrixLayoutValueSchema.parse(legacy)).toEqual(legacy);
    const layout = { ...legacy, columnWidths: { product: 310, "agent:4": 205, "agent:7": 130 } };
    expect(matrixLayoutValueSchema.parse(JSON.parse(JSON.stringify(layout)))).toEqual(layout);
  });
  it("rejects invalid keys, non-finite/fractional widths and unusable sizes", () => {
    for (const bad of [{ unknown: 200 }, { "agent:0": 200 }, { "agent:-1": 200 }, { product: 90 },
      { receipt: 110 }, { price: 110.5 }, { stock: NaN }, { stock: Infinity }, { stock: 1601 }]) {
      expect(matrixColumnWidthsSchema.safeParse(bad).success).toBe(false);
    }
    expect(clampMatrixColumnWidth("product", -20)).toBe(170);
    expect(clampMatrixColumnWidth("agent:4", 1601)).toBe(1600);
    expect(clampMatrixColumnWidth("stock", 147.5)).toBe(148);
  });
});
