type TokenKind = "verify" | "reset";
type TabStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const key = (kind: TokenKind) => `bc-platform-link-v1:${kind}`;
const valid = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const lifetime = 60 * 60 * 1000;

// Keep only the one-use link, never the password. sessionStorage is scoped to
// this origin and browser tab; server expiry/consumption remain authoritative.
export function restorePlatformToken(
  kind: TokenKind,
  fragment: string,
  storage: TabStorage | null,
  now = Date.now()
): string {
  const incoming = fragment.startsWith("#") ? fragment.slice(1) : fragment;
  if (incoming) {
    clearPlatformToken(kind, storage);
    if (!valid(incoming)) return "";
    try {
      storage?.setItem(
        key(kind),
        JSON.stringify({ token: incoming, expiresAt: now + lifetime })
      );
    } catch {
      /* The original link still works if tab storage is unavailable. */
    }
    return incoming;
  }
  try {
    const saved = JSON.parse(storage?.getItem(key(kind)) ?? "null");
    if (
      saved &&
      valid(saved.token) &&
      Number.isFinite(saved.expiresAt) &&
      saved.expiresAt > now &&
      saved.expiresAt <= now + lifetime
    )
      return saved.token;
  } catch {
    /* Corrupt or unavailable storage is never an authentication bypass. */
  }
  clearPlatformToken(kind, storage);
  return "";
}

export function clearPlatformToken(
  kind: TokenKind,
  storage: TabStorage | null
) {
  try {
    storage?.removeItem(key(kind));
  } catch {
    /* Storage may be blocked. */
  }
}

export function platformTabStorage(): TabStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}
