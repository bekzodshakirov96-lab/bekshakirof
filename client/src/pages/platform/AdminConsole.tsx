import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useIsFetching, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  CreditCard,
  Building2,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  ShieldCheck,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/contexts/ThemeContext";
import { cn } from "@/lib/utils";
import type {
  AccessState,
  AdminOverview,
  PlatformAccount,
} from "@shared/platform";
import { api, date, time, Loading, ErrorMessage } from "./ui";
import { CompanyDetail } from "./CompanyDetail";
import { CompaniesPanel } from "./CompaniesPanel";
import { OverviewPanel } from "./OverviewPanel";
import { ActivityPanel } from "./ActivityPanel";
import { BillingSettings } from "./BillingSettings";
import {
  companyFiltersUrl,
  defaultCompanyFilters,
} from "@/lib/platformCompanyFilters";

const sections = [
  {
    id: "overview",
    path: "/super-admin",
    label: "Umumiy ko‘rinish",
    icon: LayoutDashboard,
  },
  {
    id: "companies",
    path: "/super-admin/firmalar",
    label: "Firmalar",
    icon: Building2,
  },
  {
    id: "activity",
    path: "/super-admin/tarix",
    label: "Amallar tarixi",
    icon: Activity,
  },
  {
    id: "billing",
    path: "/super-admin/obuna",
    label: "Obuna va tarif",
    icon: CreditCard,
  },
] as const;

export function AdminConsole({
  account,
  onLogout,
}: {
  account: PlatformAccount;
  onLogout: () => Promise<void>;
}) {
  const [location, navigate] = useLocation();
  const current =
    sections.find(section => section.path === location) ??
    sections.find(section => section.id === "overview")!;
  const cache = useQueryClient();
  const fetching = useIsFetching({ queryKey: ["platform"] }) > 0;
  const { theme, toggleTheme } = useTheme();
  const sidebarKey = `bc:platform:sidebar:v1:${account.id}`;
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(sidebarKey) === "collapsed";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(sidebarKey, collapsed ? "collapsed" : "expanded");
    } catch {
      /* Navigation works without browser storage. */
    }
  }, [collapsed, sidebarKey]);
  const lastTrigger = useRef<HTMLElement | null>(null);
  function selectCompany(id: string) {
    lastTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSelected(id);
  }
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const overview = useQuery({
    queryKey: ["platform", "overview"],
    queryFn: () => api<AdminOverview>("/admin/overview"),
    retry: false,
    refetchInterval: 60000,
  });
  const data = overview.data;
  const total = data?.stats.reduce((sum, item) => sum + item.total, 0) ?? 0;
  function openCompanies(state: "all" | AccessState = "all", expiring = false) {
    navigate(companyFiltersUrl({ ...defaultCompanyFilters, state, expiring }));
  }
  return (
    <div
      className={cn(
        "min-h-screen bg-background text-foreground transition-[padding] duration-150 motion-reduce:transition-none",
        collapsed ? "lg:pl-16" : "lg:pl-60"
      )}
    >
      <a
        href="#admin-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-lg focus:border focus:bg-card focus:p-3"
      >
        Asosiy qismga o‘tish
      </a>
      <aside
        id="platform-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col border-r bg-[#f0f2f6] transition-[width] duration-150 motion-reduce:transition-none dark:bg-[#141c29] lg:flex",
          collapsed ? "w-16" : "w-60"
        )}
      >
        <a
          href="/super-admin"
          aria-label="BiznesControl platformasi — umumiy ko‘rinish"
          className={cn(
            "flex h-14 items-center gap-2.5 border-b",
            collapsed ? "justify-center px-2" : "px-5"
          )}
          onClick={event => {
            if (
              !event.ctrlKey &&
              !event.metaKey &&
              !event.shiftKey &&
              !event.altKey
            ) {
              event.preventDefault();
              navigate("/super-admin");
            }
          }}
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-[11px] font-bold tracking-tight text-background">
            BC
          </span>
          {!collapsed && (
            <span className="text-sm font-semibold tracking-tight">
              BiznesControl
              <span className="mt-0.5 block text-[9px] font-medium tracking-[0.12em] text-muted-foreground">
                PLATFORMA
              </span>
            </span>
          )}
        </a>
        {!collapsed && (
          <div className="px-5 pb-2 pt-6 text-[10px] font-medium tracking-[0.08em] text-muted-foreground">
            BOSHQARUV
          </div>
        )}
        <nav
          aria-label="Platforma navigatsiyasi"
          className={cn("space-y-1 px-2.5", collapsed && "pt-4")}
        >
          {sections.map(section => (
            <a
              key={section.id}
              href={section.path}
              title={collapsed ? section.label : undefined}
              aria-label={section.label}
              aria-current={current.id === section.id ? "page" : undefined}
              onClick={event => {
                if (
                  !event.ctrlKey &&
                  !event.metaKey &&
                  !event.shiftKey &&
                  !event.altKey
                ) {
                  event.preventDefault();
                  navigate(section.path);
                }
              }}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg text-xs transition-colors focus-visible:outline-2 focus-visible:outline-ring",
                collapsed ? "justify-center px-1.5" : "px-2.5",
                current.id === section.id
                  ? "bg-card font-medium text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground"
              )}
            >
              <section.icon className="size-4 shrink-0" />
              {!collapsed && (
                <>
                  <span className="flex-1">{section.label}</span>
                  {section.id === "companies" && data && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                      {total}
                    </span>
                  )}
                </>
              )}
            </a>
          ))}
        </nav>
        <div
          className={cn("mt-auto border-t py-4", collapsed ? "px-3" : "px-4")}
        >
          <div
            className={cn(
              "flex items-center gap-2.5",
              collapsed && "justify-center"
            )}
          >
            <span
              className="grid size-8 shrink-0 place-items-center rounded-full border bg-card text-[11px] font-medium text-muted-foreground"
              title={account.name}
            >
              {account.name.trim().slice(0, 1).toUpperCase()}
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-medium">{account.name}</p>
                <p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <ShieldCheck className="size-3" />
                  Super administrator
                </p>
              </div>
            )}
          </div>
        </div>
      </aside>
      <header className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur-sm">
        <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-6 lg:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              size="icon"
              variant="ghost"
              className="hidden size-7 text-muted-foreground lg:inline-flex"
              aria-label={
                collapsed ? "Menyuni kengaytirish" : "Menyuni yig‘ish"
              }
              aria-controls="platform-sidebar"
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(value => !value)}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4" />
              ) : (
                <PanelLeftClose className="size-4" />
              )}
            </Button>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Platforma</span>
              <ChevronRight className="size-3 text-muted-foreground/60" />
              <span className="font-medium">{current.label}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {toggleTheme && (
              <Button
                size="icon"
                variant="ghost"
                className="size-8 text-muted-foreground"
                aria-label={theme === "dark" ? "Yorug‘ rejim" : "Tungi rejim"}
                onClick={toggleTheme}
              >
                {theme === "dark" ? (
                  <Sun className="size-3.5" />
                ) : (
                  <Moon className="size-3.5" />
                )}
              </Button>
            )}
            <span className="hidden rounded-md border px-2 py-1 text-[10px] text-muted-foreground sm:block">
              Super admin
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs text-muted-foreground"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setLogoutError("");
                try {
                  await onLogout();
                } catch (error) {
                  setLogoutError((error as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <LogOut className="size-3.5" />
              <span className="hidden sm:inline">Chiqish</span>
            </Button>
          </div>
        </div>
        <nav
          className="flex gap-1 overflow-x-auto border-t px-3 py-2 lg:hidden"
          aria-label="Mobil navigatsiya"
        >
          {sections.map(section => (
            <a
              key={section.id}
              href={section.path}
              onClick={event => {
                event.preventDefault();
                navigate(section.path);
              }}
              aria-current={section.id === current.id ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs",
                current.id === section.id
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <section.icon className="size-3.5" />
              {section.label}
            </a>
          ))}
        </nav>
      </header>
      <main
        id="admin-content"
        tabIndex={-1}
        className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 outline-none sm:px-6 lg:px-7"
      >
        {logoutError && <ErrorMessage message={logoutError} />}
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-2 text-[11px] text-muted-foreground">
              {date(Date.now())} · Toshkent vaqti
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              {current.id === "overview"
                ? "Platforma nazorat markazi"
                : current.label}
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {current.id === "overview"
                ? "Firmalar holati, yaqinlashayotgan muddatlar va oxirgi amallar."
                : current.id === "companies"
                  ? "Firma holati, aloqa ma’lumotlari va kirish muddatini boshqaring."
                  : current.id === "billing"
                    ? "Oylik narx va Payme/Click ulanish holatini boshqaring."
                    : "Platformadagi amallar kim tomonidan va qachon bajarilganini kuzating."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={fetching}
            onClick={() => cache.invalidateQueries({ queryKey: ["platform"] })}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                fetching && "animate-spin motion-reduce:animate-none"
              )}
            />
            Yangilash
          </Button>
        </div>
        {current.id === "overview" ? (
          overview.error ? (
            <div className="rounded-xl border bg-card p-5">
              <ErrorMessage message={overview.error.message} />
            </div>
          ) : overview.isPending ? (
            <div className="rounded-xl border bg-card">
              <Loading />
            </div>
          ) : (
            data && (
              <OverviewPanel
                data={data}
                onCompany={selectCompany}
                onCompanies={openCompanies}
                onHistory={() => navigate("/super-admin/tarix")}
              />
            )
          )
        ) : current.id === "companies" ? (
          <CompaniesPanel
            accountId={account.id}
            overview={overview.isError ? undefined : data}
            selectedId={selected}
            onSelect={selectCompany}
          />
        ) : current.id === "billing" ? (
          <BillingSettings />
        ) : (
          <ActivityPanel onCompany={selectCompany} />
        )}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-[10px] leading-relaxed text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <ShieldCheck className="size-3" />
            BiznesControl · Platforma boshqaruvi
          </span>
          <span>
            {data
              ? `Platforma holati yangilandi: ${time(data.asOf)}`
              : overview.isError
                ? "Yangilab qayta urinib ko‘ring"
                : "Ma’lumotlar yuklanmoqda"}
          </span>
        </footer>
      </main>
      <CompanyDetail
        id={selected}
        onClose={() => setSelected(null)}
        returnFocus={() => {
          if (lastTrigger.current?.isConnected) lastTrigger.current.focus();
        }}
      />
    </div>
  );
}
