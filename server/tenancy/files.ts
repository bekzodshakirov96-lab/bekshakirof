/** Validate before filesystem access AND before serving the legacy uploads root. */
export function validateStorageKey(key: string): string {
  const parts = key.split("/");
  if (!key || /[\\\0:%]/.test(key) || parts.some(part => !part || part === "." || part === ".." || /[. ]$/.test(part)) || parts[0].toLowerCase() === "tenants") {
    throw new Error("Invalid storage key.");
  }
  return key;
}
