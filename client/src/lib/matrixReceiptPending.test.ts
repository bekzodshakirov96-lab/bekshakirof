import { describe, expect, it } from "vitest";
import {
  clearPendingReceipt,
  pendingReceiptKey,
  persistPendingReceipt,
  readPendingReceipt,
} from "./matrixReceiptPending";

const createStore = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
};
const pending = { text: "100", key: "cd7d0c42-b609-4ea5-8bc5-4cfbf15c2f30" };
describe("unresolved matrix receipts", () => {
  it("restores the same request after date navigation/reload and clears only its own acknowledgement", () => {
    const store = createStore();
    const key = pendingReceiptKey(1, 2, "2026-10-17");
    persistPendingReceipt(store, key, pending);
    expect(readPendingReceipt(store, key)).toEqual(pending);
    persistPendingReceipt(store, key, readPendingReceipt(store, key)!);
    clearPendingReceipt(store, key, "other-response");
    expect(readPendingReceipt(store, key)).toEqual(pending);
    expect(() =>
      persistPendingReceipt(store, key, {
        ...pending,
        key: "cd7d0c42-b609-4ea5-8bc5-4cfbf15c2f31",
      })
    ).toThrow("oldingi");
    clearPendingReceipt(store, key, pending.key);
    expect(readPendingReceipt(store, key)).toBeNull();
    persistPendingReceipt(store, key, {
      ...pending,
      key: "cd7d0c42-b609-4ea5-8bc5-4cfbf15c2f31",
    });
  });
  it("separates users, products and dates", () => {
    const store = createStore();
    persistPendingReceipt(
      store,
      pendingReceiptKey(1, 2, "2026-10-17"),
      pending
    );
    for (const key of [
      pendingReceiptKey(2, 2, "2026-10-17"),
      pendingReceiptKey(1, 3, "2026-10-17"),
      pendingReceiptKey(1, 2, "2026-10-18"),
    ])
      expect(readPendingReceipt(store, key)).toBeNull();
  });
  it("fails closed on corrupt or unavailable storage", () => {
    const store = createStore();
    store.setItem("key", "broken");
    expect(() => readPendingReceipt(store, "key")).toThrow();
    expect(() =>
      persistPendingReceipt(
        {
          ...store,
          setItem: () => {
            throw new Error("quota");
          },
        },
        "new",
        pending
      )
    ).toThrow("quota");
  });
});
