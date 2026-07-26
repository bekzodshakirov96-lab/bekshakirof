import { describe, expect, it } from "vitest";
import {
  calculateIssuedContainerQuantity,
  normalizeContainerType,
  pairContainerCandidates,
  reconcileTransactionContainers,
} from "./containerAccounting";
import type { DatabaseTransaction } from "./containerAccounting";

const date = new Date("2026-07-01T00:00:00.000Z");

describe("containerAccounting", () => {
  it("Rozlivnoy KEG 30 va 50 nomlarini barqaror normalizatsiya qiladi", () => {
    expect(normalizeContainerType("Разливной КЕГ 50")).toBe("keg_50");
    expect(normalizeContainerType("rozlivnoy keg 30")).toBe("keg_30");
    expect(normalizeContainerType("Oddiy mahsulot")).toBeNull();
  });

  it("KEG mahsulot miqdorini tara koeffitsiyentiga ko‘paytiradi", () => {
    expect(calculateIssuedContainerQuantity(4, 1)).toBe(4);
    expect(calculateIssuedContainerQuantity(3, 2)).toBe(6);
    expect(calculateIssuedContainerQuantity(5, 0)).toBe(0);
  });

  it("bir xil kun va miqdordagi bir nechta yozuvlarni sourceKey tartibida bir martadan juftlaydi", () => {
    const result = pairContainerCandidates(
      [
        { id: 12, sourceKey: "excel:transaction:12", date, agentId: 3, clientId: 9, containerType: "keg_50", quantity: 4 },
        { id: 11, sourceKey: "excel:transaction:11", date, agentId: 3, clientId: 9, containerType: "keg_50", quantity: 4 },
      ],
      [
        { id: 22, sourceKey: "excel:container:22", date, agentId: 3, clientId: 9, containerType: "keg_50", quantity: 4 },
        { id: 21, sourceKey: "excel:container:21", date, agentId: 3, clientId: 9, containerType: "keg_50", quantity: 4 },
      ],
    );

    expect(result.pairs.map(pair => [pair.transaction.id, pair.movement.id])).toEqual([
      [11, 21],
      [12, 22],
    ]);
    expect(result.unmatchedTransactions).toHaveLength(0);
    expect(result.unmatchedMovements).toHaveLength(0);
  });

  it("agent mos kelmasa explicit tara yozuvini boshqa savdoga bog‘lamaydi", () => {
    const result = pairContainerCandidates(
      [
        { id: 11, sourceKey: "sale:11", date, agentId: 3, clientId: 9, containerType: "keg_30", quantity: 2 },
      ],
      [
        { id: 21, sourceKey: "movement:21", date, agentId: 4, clientId: 9, containerType: "keg_30", quantity: 2 },
      ],
    );

    expect(result.pairs).toHaveLength(0);
    expect(result.unmatchedTransactions.map(item => item.id)).toEqual([11]);
    expect(result.unmatchedMovements.map(item => item.id)).toEqual([21]);
  });

  it("ortiqcha savdo yoki explicit tara yozuvlarini unmatched sifatida qoldiradi", () => {
    const result = pairContainerCandidates(
      [
        { id: 11, sourceKey: "sale:11", date, agentId: 3, clientId: 9, containerType: "keg_30", quantity: 2 },
        { id: 12, sourceKey: "sale:12", date, agentId: 3, clientId: 9, containerType: "keg_30", quantity: 2 },
      ],
      [
        { id: 21, sourceKey: "movement:21", date, agentId: 3, clientId: 9, containerType: "keg_30", quantity: 2 },
      ],
    );

    expect(result.pairs).toHaveLength(1);
    expect(result.unmatchedTransactions.map(item => item.id)).toEqual([12]);
    expect(result.unmatchedMovements).toHaveLength(0);
  });

  function createTransactionDouble(balance = 0) {
    const inserted: Array<Record<string, unknown>> = [];
    let deleteCount = 0;
    const tx = {
      select: () => ({
        from: () => ({
          where: async () =>
            balance === 0 ? [] : [{ containerType: "keg_30", movementType: "issued", quantity: balance }],
        }),
      }),
      delete: () => ({
        where: async () => {
          deleteCount += 1;
          inserted.length = 0;
        },
      }),
      insert: () => ({
        values: async (value: Record<string, unknown>) => {
          inserted.push(value);
        },
      }),
    } as unknown as DatabaseTransaction;
    return { tx, inserted, getDeleteCount: () => deleteCount };
  }

  const baseInput = {
    transactionId: 77,
    movementDate: date,
    agentId: 3,
    clientId: 9,
    containerUnitsPerItem: 1,
    createdBy: 1,
    source: "manual" as const,
  };

  it("KEG 50 savdosida issued va shu operatsiyadagi qaytishni atomik rejalaydi", async () => {
    const testDouble = createTransactionDouble(0);
    const impact = await reconcileTransactionContainers(testDouble.tx, {
      ...baseInput,
      productContainerType: "keg_50",
      productQuantity: 4,
      returnContainerType: "keg_50",
      returnQuantity: 1,
    });

    expect(impact).toEqual({ issuedType: "keg_50", issuedQuantity: 4, returnedType: "keg_50", returnedQuantity: 1 });
    expect(testDouble.getDeleteCount()).toBe(1);
    expect(testDouble.inserted.map(row => [row.movementType, row.quantity])).toEqual([["issued", 4], ["returned", 1]]);
  });

  it("operatsiya update qilinganda avvalgi avtomatik tara yozuvlarini almashtiradi", async () => {
    const testDouble = createTransactionDouble(0);
    await reconcileTransactionContainers(testDouble.tx, {
      ...baseInput,
      productContainerType: "keg_30",
      productQuantity: 5,
    });
    await reconcileTransactionContainers(testDouble.tx, {
      ...baseInput,
      productContainerType: "keg_30",
      productQuantity: 2,
    });

    expect(testDouble.getDeleteCount()).toBe(2);
    expect(testDouble.inserted).toHaveLength(1);
    expect(testDouble.inserted[0]).toMatchObject({ movementType: "issued", quantity: 2, transactionId: 77 });
  });

  it("mijoz qoldig‘idan ortiq tara qaytarishni yozuvlarni o‘zgartirishdan oldin bloklaydi", async () => {
    const testDouble = createTransactionDouble(1);
    await expect(reconcileTransactionContainers(testDouble.tx, {
      ...baseInput,
      productContainerType: null,
      productQuantity: 1,
      returnContainerType: "keg_30",
      returnQuantity: 2,
    })).rejects.toThrow("mavjud 1 dona qoldiqdan oshmasligi kerak");
    expect(testDouble.getDeleteCount()).toBe(0);
    expect(testDouble.inserted).toHaveLength(0);
  });

  it("oddiy mahsulot sotilganda avtomatik tara yozuvi yaratmaydi", async () => {
    const testDouble = createTransactionDouble(0);
    const impact = await reconcileTransactionContainers(testDouble.tx, {
      ...baseInput,
      productContainerType: null,
      productQuantity: 6,
    });
    expect(impact).toEqual({ issuedType: null, issuedQuantity: 0, returnedType: null, returnedQuantity: 0 });
    expect(testDouble.inserted).toHaveLength(0);
  });
});
