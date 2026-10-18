import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Link2,
  ListFilter,
  Loader2,
  Rows3,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  companyFiltersUrl,
  companyFilterStorageKey,
  defaultCompanyFilters,
  normalizeCompanyFilters,
  restoreCompanyFilters,
  type CompanyFilters,
} from "@/lib/platformCompanyFilters";
import {
  accessLabels,
  companyAccess,
  type AccessState,
  type AdminOverview,
  type Company,
} from "@shared/platform";
import { api, date, ErrorMessage } from "./ui";

function useCompanyFilters(accountId: string) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const storageKey = companyFilterStorageKey(accountId);
  const filters = useMemo(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(storageKey);
    } catch {
      /* Private browsing can disable storage. */
    }
    return restoreCompanyFilters(new URLSearchParams(search), saved);
  }, [search, storageKey]);
  const url = companyFiltersUrl(filters);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters));
    } catch {
      /* URL state still works. */
    }
    if (`/super-admin/firmalar${search ? `?${search}` : ""}` !== url)
      navigate(url, { replace: true });
  }, [url, search, storageKey, navigate]);
  const update = useCallback(
    (patch: Partial<CompanyFilters>, replace = false) => {
      navigate(
        companyFiltersUrl(normalizeCompanyFilters({ ...filters, ...patch })),
        { replace }
      );
    },
    [url, navigate]
  );
  return { filters, update };
}
const dotColors: Record<AccessState, string> = {
  trialing: "bg-blue-500",
  extended: "bg-emerald-500",
  pending_email: "bg-slate-400",
  provisioning: "bg-amber-500",
  expired: "bg-rose-500",
  suspended: "bg-orange-500",
};
const sortLabels: Record<CompanyFilters["sort"], string> = {
  newest: "Avval yangilari",
  oldest: "Avval eskilari",
  name: "Nom bo‘yicha A–Z",
  deadline: "Kirish muddati bo‘yicha",
};
function CompanyState({ company }: { company: Company }) {
  const state = companyAccess(company);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs">
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dotColors[state])}
      />
      {accessLabels[state]}
    </span>
  );
}

export function CompaniesPanel({
  accountId,
  overview,
  selectedId,
  onSelect,
}: {
  accountId: string;
  overview?: AdminOverview;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const { filters, update } = useCompanyFilters(accountId);
  const { state, sort, expiring, page, density } = filters;
  const [q, setQ] = useState(filters.q);
  useEffect(() => {
    setQ(filters.q);
  }, [filters.q]);
  useEffect(() => {
    if (q.trim().slice(0, 120) === filters.q) return;
    const timer = setTimeout(() => update({ q, page: 1 }, true), 300);
    return () => clearTimeout(timer);
  }, [q, filters.q, update]);
  const companies = useQuery({
    queryKey: ["platform", "companies", filters.q, state, expiring, sort, page],
    queryFn: () =>
      api<{ companies: Company[]; total: number }>(
        `/admin/companies?${new URLSearchParams({ q: filters.q, state, expiring: String(expiring), sort, page: String(page) })}`
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const maxPage = Math.max(1, Math.ceil((companies.data?.total ?? 0) / 25));
  useEffect(() => {
    if (companies.data && !companies.isPlaceholderData && page > maxPage)
      update({ page: maxPage }, true);
  }, [companies.data, companies.isPlaceholderData, page, maxPage, update]);
  const count = (key: string) =>
    overview
      ? key === "all"
        ? overview.stats.reduce((sum, item) => sum + item.total, 0)
        : (overview.stats.find(item => item.state === key)?.total ?? 0)
      : "—";
  const total = companies.data?.total ?? 0;
  const hasFilter = !!filters.q || state !== "all" || expiring;
  const busy = companies.isPlaceholderData;
  const reset = () => {
    setQ("");
    update({ ...defaultCompanyFilters, density });
  };
  const rowSpace = density === "compact" ? "py-2.5" : "py-4";
  const tabKeys = [
    "all",
    "trialing",
    "provisioning",
    "expired",
    "suspended",
  ] as const;
  const tabNames = {
    all: "Barchasi",
    trialing: "Sinovda",
    provisioning: "Tayyorlanmoqda",
    expired: "Muddati tugagan",
    suspended: "To‘xtatilgan",
  };
  return (
    <section aria-label="Firmalar boshqaruvi" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex max-w-full gap-1 overflow-x-auto"
          aria-label="Holat bo‘yicha tezkor filtrlar"
        >
          {tabKeys.map(key => (
            <button
              key={key}
              type="button"
              aria-pressed={state === key && !expiring}
              onClick={() => update({ state: key, expiring: false, page: 1 })}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                state === key && !expiring
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {tabNames[key]}
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[10px] tabular-nums",
                  state === key && !expiring
                    ? "bg-background/15 text-background"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {count(key)}
              </span>
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(window.location.href);
              toast.success("Filtrlangan ro‘yxat havolasi nusxalandi.");
            } catch {
              toast.error("Havolani brauzer manzilidan nusxalang.");
            }
          }}
        >
          <Link2 className="size-3.5" />
          Havolani nusxalash
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3">
          <div className="relative min-w-40 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
            <Input
              value={q}
              onChange={e => setQ(e.target.value)}
              maxLength={120}
              aria-label="Firma qidirish"
              placeholder="Firma, kod yoki email qidirish…"
              className="h-9 border-transparent bg-muted/50 pl-9 pr-8 text-xs shadow-none focus-visible:border-input"
            />
            {q && (
              <button
                type="button"
                aria-label="Qidiruvni tozalash"
                onClick={() => setQ("")}
                className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 text-xs">
                <ListFilter className="size-3.5" />
                Filtrlar
                {(state !== "all" || expiring) && (
                  <span className="grid size-4 place-items-center rounded bg-primary/10 text-[10px] text-primary">
                    {Number(state !== "all") + Number(expiring)}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs text-muted-foreground">
                Firma holati
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={state}
                onValueChange={value =>
                  update({ state: value as CompanyFilters["state"], page: 1 })
                }
              >
                <DropdownMenuRadioItem value="all">
                  Barcha holatlar
                </DropdownMenuRadioItem>
                {Object.entries(accessLabels).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        dotColors[value as AccessState]
                      )}
                    />
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={expiring}
                onCheckedChange={value =>
                  update({ expiring: value === true, page: 1 })
                }
              >
                7 kunda muddati tugaydi
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 text-xs text-muted-foreground"
              >
                <ArrowDownWideNarrow className="size-3.5" />
                <span className="hidden sm:inline">{sortLabels[sort]}</span>
                <span className="sr-only sm:hidden">Saralash</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Saralash</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort}
                onValueChange={value =>
                  update({ sort: value as CompanyFilters["sort"], page: 1 })
                }
              >
                {Object.entries(sortLabels).map(([value, label]) => (
                  <DropdownMenuRadioItem key={value} value={value}>
                    {label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-9 text-xs text-muted-foreground"
              >
                <SlidersHorizontal className="size-3.5" />
                <span className="hidden md:inline">Ko‘rinish</span>
                <span className="sr-only md:hidden">Jadval ko‘rinishi</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Qatorlar balandligi</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={density}
                onValueChange={value =>
                  update({ density: value as CompanyFilters["density"] }, true)
                }
              >
                <DropdownMenuRadioItem value="compact">
                  <Rows3 className="size-3.5" />
                  Ixcham
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="comfortable">
                  Kengroq
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {hasFilter && (
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/15 px-4 py-2 text-[11px]">
            <span className="text-muted-foreground">Tanlangan:</span>
            {filters.q && (
              <FilterChip
                label={`Qidiruv: ${filters.q}`}
                onRemove={() => {
                  setQ("");
                  update({ q: "", page: 1 });
                }}
              />
            )}
            {state !== "all" && (
              <FilterChip
                label={accessLabels[state]}
                onRemove={() => update({ state: "all", page: 1 })}
              />
            )}
            {expiring && (
              <FilterChip
                label="7 kunda tugaydi"
                onRemove={() => update({ expiring: false, page: 1 })}
              />
            )}
            <button
              className="ml-auto rounded px-2 py-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              onClick={reset}
            >
              Tozalash
            </button>
          </div>
        )}
        <div className="flex min-h-10 flex-wrap items-center justify-between gap-2 px-4 py-2 text-[11px] text-muted-foreground">
          <span aria-live="polite">
            {companies.isPending
              ? "Firmalar yuklanmoqda…"
              : companies.isError
                ? "Ro‘yxat yuklanmadi"
                : `${total} ta firma${hasFilter ? " topildi" : " ro‘yxatda"}`}
          </span>
          <span className="flex items-center gap-1.5" role="status">
            {companies.isFetching ? (
              <>
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                Yangilanmoqda
              </>
            ) : (
              <>
                <Check className="size-3" />
                Tanlov saqlanadi
              </>
            )}
          </span>
        </div>
        {companies.error ? (
          <div className="space-y-3 p-5">
            <ErrorMessage message={companies.error.message} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => companies.refetch()}
            >
              Qayta urinish
            </Button>
          </div>
        ) : companies.isPending ? (
          <div
            className="space-y-1 px-4 py-3"
            role="status"
            aria-label="Firmalar yuklanmoqda"
          >
            {[1, 2, 3, 4].map(key => (
              <div key={key} className="flex h-12 items-center gap-4 border-t">
                <span className="size-7 rounded-md bg-muted motion-safe:animate-pulse" />
                <span className="h-3 w-1/4 rounded bg-muted motion-safe:animate-pulse" />
                <span className="ml-auto h-3 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          companies.data && (
            <>
              <div
                className="max-h-[65vh] overflow-auto"
                aria-busy={busy}
                tabIndex={0}
                role="region"
                aria-label="Firmalar jadvali"
              >
                <table
                  className={cn(
                    "w-full min-w-[850px] text-left text-[13px]",
                    busy && "opacity-50"
                  )}
                >
                  <caption className="sr-only">
                    Firmalar, ularning holati va kirish muddatlari
                  </caption>
                  <thead className="sticky top-0 z-10 border-y bg-muted text-[11px] text-muted-foreground">
                    <tr>
                      {[
                        "Firma",
                        "Firma egasi",
                        "Holat",
                        "Kirish muddati",
                        "Ro‘yxatdan o‘tgan",
                        "",
                      ].map((title, index) => (
                        <th
                          scope="col"
                          key={index}
                          className={cn(
                            "whitespace-nowrap px-4 py-2.5 font-medium",
                            index === 0 && "sticky left-0 z-20 bg-muted"
                          )}
                        >
                          {title || (
                            <span className="sr-only">
                              Firma kartasini ochish
                            </span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {companies.data.companies.map(company => (
                      <tr
                        key={company.id}
                        className={cn(
                          "group",
                          selectedId === company.id
                            ? "bg-primary/5"
                            : "hover:bg-muted/30"
                        )}
                      >
                        <td
                          className={cn(
                            "sticky left-0 z-[1] bg-card px-4 group-hover:bg-muted",
                            selectedId === company.id && "bg-accent",
                            rowSpace
                          )}
                        >
                          <button
                            disabled={busy}
                            type="button"
                            onClick={() => onSelect(company.id)}
                            className="flex max-w-80 items-center gap-2.5 rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/40 text-[11px] font-semibold text-muted-foreground">
                              {company.name.trim().slice(0, 1).toUpperCase()}
                            </span>
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {company.name}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                {company.slug}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className={cn("px-4", rowSpace)}>
                          <p className="font-medium">{company.ownerName}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {company.email}
                          </p>
                        </td>
                        <td className={cn("px-4", rowSpace)}>
                          <CompanyState company={company} />
                        </td>
                        <td className={cn("px-4 tabular-nums", rowSpace)}>
                          <p className="whitespace-nowrap">
                            {date(company.accessUntil)}
                          </p>
                          {company.accessUntil && (
                            <p
                              className={cn(
                                "mt-0.5 text-[10px]",
                                company.accessUntil <= Date.now() + 7 * 86400000
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-muted-foreground"
                              )}
                            >
                              {company.accessUntil <= Date.now()
                                ? "Muddati tugagan"
                                : `${Math.ceil((company.accessUntil - Date.now()) / 86400000)} kun qoldi`}
                            </p>
                          )}
                        </td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-4 text-muted-foreground tabular-nums",
                            rowSpace
                          )}
                        >
                          {date(company.createdAt)}
                        </td>
                        <td className={cn("px-4", rowSpace)}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground"
                            aria-label={`${company.name} — firma kartasini ochish`}
                            disabled={busy}
                            onClick={() => onSelect(company.id)}
                          >
                            <ArrowRight className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!companies.data.companies.length && (
                <div className="grid min-h-52 place-items-center px-6 py-10 text-center">
                  <div>
                    <Building2 className="mx-auto mb-3 size-7 text-muted-foreground/60" />
                    <p className="text-sm font-medium">
                      {hasFilter ? "Mos firma topilmadi" : "Hali firma yo‘q"}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {hasFilter
                        ? "Qidiruvni o‘zgartiring yoki filtrlarni tozalang."
                        : "Ro‘yxatdan o‘tgan firmalar shu yerda ko‘rinadi."}
                    </p>
                    {hasFilter && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 text-xs"
                        onClick={reset}
                      >
                        Filtrlarni tozalash
                      </Button>
                    )}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[11px] text-muted-foreground">
                <span>
                  {total
                    ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} / ${total} ta firma`
                    : "0 ta firma"}
                </span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">
                    {page} / {maxPage} sahifa
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label="Oldingi sahifa"
                      disabled={page === 1 || busy}
                      onClick={() => update({ page: page - 1 })}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label="Keyingi sahifa"
                      disabled={page >= maxPage || busy}
                      onClick={() => update({ page: page + 1 })}
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </div>
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Firma nomini bosing — tafsilotlar o‘ng tomonda ochiladi. Qidiruv, filtr
        va jadval ko‘rinishi sizning brauzeringizda saqlanadi.
      </p>
    </section>
  );
}
function FilterChip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <button
      onClick={onRemove}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 focus-visible:outline-2 focus-visible:outline-ring"
      aria-label={`${label} — filtrni olib tashlash`}
    >
      <span className="max-w-52 truncate">{label}</span>
      <X className="size-3 shrink-0 text-muted-foreground" />
    </button>
  );
}
