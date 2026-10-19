export const APP_VERSION_PATH = "/app-version.json";

export type AppVersion = { schema: 1; buildId: string };

export function parseAppVersion(value: unknown): AppVersion | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const version = value as Record<string, unknown>;
  if (
    version.schema !== 1 ||
    typeof version.buildId !== "string" ||
    !/^[a-zA-Z0-9._-]{8,128}$/.test(version.buildId)
  )
    return null;
  return { schema: 1, buildId: version.buildId };
}
