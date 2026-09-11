import { describe, expect, it } from "vitest";
import { moveProductId } from "./productOrder";

describe("product drag order", () => {
  it("moves across multiple rows in either direction", () => {
    expect(moveProductId([1, 2, 3, 4], 1, 4, "after")).toEqual([2, 3, 4, 1]);
    expect(moveProductId([1, 2, 3, 4], 4, 1, "before")).toEqual([4, 1, 2, 3]);
  });
  it("preserves hidden products and leaves the input unchanged", () => {
    const all = [1, 2, 3, 4, 5]; // 2 and 4 hidden in the matrix
    expect(moveProductId(all, 1, 5, "before")).toEqual([2, 3, 4, 1, 5]);
    expect(all).toEqual([1, 2, 3, 4, 5]);
  });
  it("treats a drop on itself or its current boundary as a no-op", () => {
    expect(moveProductId([1, 2, 3], 2, 2, "after")).toEqual([1, 2, 3]);
    expect(moveProductId([1, 2, 3], 2, 3, "before")).toEqual([1, 2, 3]);
    expect(moveProductId([1, 2, 3], 2, 1, "after")).toEqual([1, 2, 3]);
  });
  it("rejects a removed product or target without dropping any remaining products", () => {
    expect(() => moveProductId([1, 2], 3, 1, "before")).toThrow("Mahsulot topilmadi.");
    expect(() => moveProductId([1, 2], 1, 3, "after")).toThrow("Mahsulot topilmadi.");
  });
});
