import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getPendingWriteCount,
  subscribePendingWrites,
  withPendingWrite,
} from "./pendingWrites";
import { api } from "../pages/platform/ui";

afterEach(() => {
  vi.unstubAllGlobals();
  expect(getPendingWriteCount()).toBe(0);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => {
    resolve = finish;
  });
  return { promise, resolve };
}

describe("pending writes", () => {
  it("tracks overlapping saves until each settles and notifies subscribers", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const counts: number[] = [];
    const unsubscribe = subscribePendingWrites(() =>
      counts.push(getPendingWriteCount())
    );
    const firstWrite = withPendingWrite(() => first.promise);
    const secondWrite = withPendingWrite(() => second.promise);
    expect(getPendingWriteCount()).toBe(2);
    second.resolve("second saved");
    expect(await secondWrite).toBe("second saved");
    expect(getPendingWriteCount()).toBe(1);
    first.resolve("first saved");
    expect(await firstWrite).toBe("first saved");
    expect(counts).toEqual([1, 2, 1, 0]);
    unsubscribe();
    await withPendingWrite(async () => undefined);
    expect(counts).toEqual([1, 2, 1, 0]);
  });

  it("releases saves on rejected promises and synchronous exceptions", async () => {
    await expect(
      withPendingWrite(async () => {
        throw new Error("network failed");
      })
    ).rejects.toThrow("network failed");
    expect(getPendingWriteCount()).toBe(0);
    await expect(
      withPendingWrite(() => {
        throw new Error("serialization failed");
      })
    ).rejects.toThrow("serialization failed");
    expect(getPendingWriteCount()).toBe(0);
  });
});

describe("platform API write integration", () => {
  it("keeps POSTs pending through response parsing while GETs stay untracked", async () => {
    const parsed = deferred<{ saved: boolean }>();
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: () => parsed.promise,
    });
    vi.stubGlobal("fetch", fetcher);
    const saving = api("/admin/billing/price", { amountSom: 100 });
    expect(getPendingWriteCount()).toBe(1);
    await Promise.resolve();
    expect(getPendingWriteCount()).toBe(1);
    expect(fetcher).toHaveBeenCalledWith("/api/platform/admin/billing/price", {
      credentials: "same-origin",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"amountSom":100}',
    });
    parsed.resolve({ saved: true });
    expect(await saving).toEqual({ saved: true });
    expect(getPendingWriteCount()).toBe(0);

    const read = deferred<Response>();
    fetcher.mockReturnValueOnce(read.promise);
    const loading = api("/me");
    expect(getPendingWriteCount()).toBe(0);
    expect(fetcher).toHaveBeenLastCalledWith("/api/platform/me", {
      credentials: "same-origin",
    });
    read.resolve(new Response('{"account":null}'));
    expect(await loading).toEqual({ account: null });
  });

  it("releases platform writes on network and API errors", async () => {
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        new Response('{"error":"Save rejected"}', { status: 409 })
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(api("/billing/orders/order-1/cancel", {})).rejects.toThrow(
      "offline"
    );
    expect(getPendingWriteCount()).toBe(0);
    await expect(api("/admin/billing/price", {})).rejects.toThrow("Save rejected");
    expect(getPendingWriteCount()).toBe(0);
  });
});
