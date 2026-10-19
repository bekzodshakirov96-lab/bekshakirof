import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APP_UPDATE_TIMEOUT_MS,
  createAppUpdateMonitor,
  readAppVersion,
} from "./appUpdate";

const oldBuild = { schema: 1 as const, buildId: "release-a-123" };
const newBuild = { schema: 1 as const, buildId: "release-b-456" };
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("application update monitor", () => {
  it("detects a deployment that happened before the first poll, using the loaded client ID", async () => {
    const notify = vi.fn();
    const monitor = createAppUpdateMonitor({
      currentBuildId: oldBuild.buildId,
      onUpdate: notify,
      isActive: () => true,
      readVersion: async () => newBuild,
    });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(newBuild));
    monitor.stop();
  });

  it("does not notify for the current build or duplicate responses, and does not clear a notice during rollback overlap/errors", async () => {
    const notify = vi.fn();
    const read = vi
      .fn()
      .mockResolvedValueOnce(oldBuild)
      .mockResolvedValueOnce(newBuild)
      .mockResolvedValueOnce(newBuild)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(oldBuild);
    const monitor = createAppUpdateMonitor({
      currentBuildId: oldBuild.buildId,
      onUpdate: notify,
      isActive: () => true,
      readVersion: read,
    });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    await monitor.check();
    await monitor.check();
    await monitor.check();
    await monitor.check();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(newBuild);
    monitor.stop();
  });

  it("notifies again if a different release or rollback replaces the detected build", async () => {
    const notify = vi.fn();
    const read = vi
      .fn()
      .mockResolvedValueOnce(newBuild)
      .mockResolvedValueOnce({ schema: 1, buildId: "release-c-789" })
      .mockResolvedValueOnce(newBuild);
    const monitor = createAppUpdateMonitor({
      currentBuildId: oldBuild.buildId,
      onUpdate: notify,
      isActive: () => true,
      readVersion: read,
    });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    await monitor.check();
    await monitor.check();
    expect(notify).toHaveBeenCalledTimes(3);
    monitor.stop();
  });

  it("pauses background/offline polling and checks immediately when the page becomes active", async () => {
    vi.useFakeTimers();
    let active = false;
    const read = vi.fn().mockResolvedValue(newBuild),
      notify = vi.fn();
    const monitor = createAppUpdateMonitor({
      currentBuildId: oldBuild.buildId,
      onUpdate: notify,
      isActive: () => active,
      readVersion: read,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(3000);
    expect(read).not.toHaveBeenCalled();
    active = true;
    await monitor.check();
    expect(notify).toHaveBeenCalledOnce();
    monitor.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(read).toHaveBeenCalledOnce();
  });

  it("never overlaps requests and ignores a late response after unmount", async () => {
    let finish!: (value: typeof newBuild) => void;
    let signal!: AbortSignal;
    const read = vi.fn((s: AbortSignal) => {
      signal = s;
      return new Promise<typeof newBuild>(resolve => {
        finish = resolve;
      });
    });
    const notify = vi.fn();
    const monitor = createAppUpdateMonitor({
      currentBuildId: oldBuild.buildId,
      onUpdate: notify,
      isActive: () => true,
      readVersion: read,
    });
    await monitor.check();
    expect(read).toHaveBeenCalledOnce();
    monitor.stop();
    expect(signal.aborted).toBe(true);
    finish(newBuild);
    await Promise.resolve();
    expect(notify).not.toHaveBeenCalled();
  });

  it("aborts stalled requests and can poll again after a timeout", async () => {
    vi.useFakeTimers();
    const notify = vi.fn();
    const read = vi.fn(
      (signal: AbortSignal) =>
        new Promise<null>((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("timeout")))
        )
    );
    const monitor = createAppUpdateMonitor({
      currentBuildId: oldBuild.buildId,
      onUpdate: notify,
      isActive: () => true,
      readVersion: read,
      intervalMs: 60_000,
    });
    await vi.advanceTimersByTimeAsync(APP_UPDATE_TIMEOUT_MS);
    expect(read.mock.calls[0][0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(60_000 - APP_UPDATE_TIMEOUT_MS);
    expect(read).toHaveBeenCalledTimes(2);
    expect(notify).not.toHaveBeenCalled();
    monitor.stop();
    await vi.runOnlyPendingTimersAsync();
  });

  it("uses a fresh same-origin GET and ignores maintenance, HTML fallback and invalid metadata", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(newBuild), {
          headers: { "Content-Type": "application/json" },
        })
      );
    vi.stubGlobal("fetch", fetcher);
    const signal = new AbortController().signal;
    expect(await readAppVersion(signal)).toEqual(newBuild);
    expect(fetcher).toHaveBeenCalledWith(
      "/app-version.json",
      expect.objectContaining({
        cache: "no-store",
        credentials: "same-origin",
        redirect: "error",
        signal,
      })
    );
    for (const response of [
      new Response("maintenance", { status: 503 }),
      new Response("<html>old server</html>", {
        headers: { "Content-Type": "text/html" },
      }),
      new Response('{"schema":1,"buildId":null}', {
        headers: { "Content-Type": "application/json" },
      }),
    ]) {
      fetcher.mockResolvedValueOnce(response);
      expect(await readAppVersion(signal)).toBeNull();
    }
  });
});
