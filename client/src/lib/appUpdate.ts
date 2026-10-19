import {
  APP_VERSION_PATH,
  parseAppVersion,
  type AppVersion,
} from "@shared/appVersion";

export const APP_UPDATE_INTERVAL_MS = 60_000;
export const APP_UPDATE_TIMEOUT_MS = 10_000;

export async function readAppVersion(
  signal: AbortSignal
): Promise<AppVersion | null> {
  const response = await fetch(APP_VERSION_PATH, {
    cache: "no-store",
    credentials: "same-origin",
    redirect: "error",
    signal,
  });
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    return null;
  return parseAppVersion(await response.json());
}

/** Compare against the build that rendered this tab, never a first-poll baseline. */
export function createAppUpdateMonitor(options: {
  currentBuildId: string;
  onUpdate: (version: AppVersion) => void;
  isActive: () => boolean;
  readVersion?: (signal: AbortSignal) => Promise<AppVersion | null>;
  intervalMs?: number;
}) {
  let stopped = false;
  let request: AbortController | null = null;
  let announced: string | null = null;
  const read = options.readVersion ?? readAppVersion;
  async function check() {
    if (stopped || request || !options.isActive()) return;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), APP_UPDATE_TIMEOUT_MS);
    try {
      const version = parseAppVersion(await read(controller.signal));
      if (
        !stopped &&
        !controller.signal.aborted &&
        version &&
        version.buildId !== options.currentBuildId &&
        version.buildId !== announced
      ) {
        announced = version.buildId;
        options.onUpdate(version);
      }
    } catch {
      // Offline, maintenance, a missing old-server manifest or a rolling deploy
      // must not interrupt work or clear an already displayed update notice.
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = null;
    }
  }
  const timer = setInterval(() => {
    void check();
  }, options.intervalMs ?? APP_UPDATE_INTERVAL_MS);
  void check();
  return {
    check,
    stop() {
      stopped = true;
      clearInterval(timer);
      request?.abort();
    },
  };
}
