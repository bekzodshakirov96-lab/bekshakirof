import { accessLabels, type AccessState } from "@shared/platform";

export type CompanyFilters = {
  q: string;
  state: "all" | AccessState;
  sort: "newest" | "oldest" | "name" | "deadline";
  expiring: boolean;
  page: number;
  density: "compact" | "comfortable";
};
export const defaultCompanyFilters: CompanyFilters = {
  q: "",
  state: "all",
  sort: "newest",
  expiring: false,
  page: 1,
  density: "compact",
};
const keys = Object.keys(defaultCompanyFilters);
export const companyFilterStorageKey = (accountId: string) =>
  `bc:platform:companies:v1:${encodeURIComponent(accountId)}`;

export function normalizeCompanyFilters(value: unknown): CompanyFilters {
  const input =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  const page =
    typeof input.page === "number"
      ? input.page
      : typeof input.page === "string" && /^\d+$/.test(input.page)
        ? Number(input.page)
        : 1;
  return {
    q: typeof input.q === "string" ? input.q.trim().slice(0, 120) : "",
    state:
      input.state === "all" ||
      (typeof input.state === "string" &&
        Object.hasOwn(accessLabels, input.state))
        ? (input.state as CompanyFilters["state"])
        : "all",
    sort: ["newest", "oldest", "name", "deadline"].includes(String(input.sort))
      ? (input.sort as CompanyFilters["sort"])
      : "newest",
    expiring: input.expiring === true || input.expiring === "true",
    page: Number.isSafeInteger(page) && page >= 1 && page <= 100000 ? page : 1,
    density: input.density === "comfortable" ? "comfortable" : "compact",
  };
}
export function hasCompanyFilters(search: URLSearchParams): boolean {
  return keys.some(key => search.has(key));
}
export function parseCompanyFilters(search: URLSearchParams): CompanyFilters {
  return normalizeCompanyFilters(Object.fromEntries(search));
}
export function companyFiltersUrl(filters: CompanyFilters): string {
  const safe = normalizeCompanyFilters(filters);
  // Explicit defaults ensure a shared "all companies" URL overrides saved filters.
  const query = new URLSearchParams({
    state: safe.state,
    sort: safe.sort,
    page: String(safe.page),
    density: safe.density,
  });
  if (safe.q) query.set("q", safe.q);
  if (safe.expiring) query.set("expiring", "true");
  return `/super-admin/firmalar?${query}`;
}
export function restoreCompanyFilters(
  search: URLSearchParams,
  saved: string | null
): CompanyFilters {
  if (hasCompanyFilters(search)) return parseCompanyFilters(search);
  try {
    return normalizeCompanyFilters(saved ? JSON.parse(saved) : null);
  } catch {
    return { ...defaultCompanyFilters };
  }
}
