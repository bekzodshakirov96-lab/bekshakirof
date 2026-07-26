import { describe, expect, it } from "vitest";
import { calculateContainerNet } from "./containerPreview";

describe("calculateContainerNet", () => {
  it("bir xil KEG turi uchun sof o‘zgarishni hisoblaydi", () => {
    expect(calculateContainerNet({
      issuedType: "keg_50",
      issuedQuantity: 4,
      returnedType: "keg_50",
      returnedQuantity: 1,
    })).toEqual({ keg30: 0, keg50: 3 });
  });

  it("turli KEG turlarini alohida sonli net qiymatlarda saqlaydi", () => {
    expect(calculateContainerNet({
      issuedType: "keg_50",
      issuedQuantity: 4,
      returnedType: "keg_30",
      returnedQuantity: 2,
    })).toEqual({ keg30: -2, keg50: 4 });
  });

  it("manfiy yoki aniqlanmagan inputni nolga normallashtiradi", () => {
    expect(calculateContainerNet({ issuedType: "keg_30", issuedQuantity: -2 })).toEqual({ keg30: 0, keg50: 0 });
  });
});
