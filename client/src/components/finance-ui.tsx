import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, RefreshCw, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div>
        {eyebrow ? <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">{eyebrow}</p> : null}
        <h2 className="text-2xl font-bold tracking-[-0.03em] text-foreground md:text-[28px]">{title}</h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function MetricCard({
  label,
  value,
  helper,
  icon: Icon,
  tone = "blue",
  trend,
}: {
  label: string;
  value: string;
  helper?: string;
  icon: LucideIcon;
  tone?: "blue" | "green" | "amber" | "violet" | "rose" | "cyan";
  trend?: { percent: number; label: string };
}) {
  const tones = {
    blue: "from-blue-50 to-cyan-50 text-blue-700 ring-blue-100 dark:from-blue-500/15 dark:to-cyan-500/10 dark:text-blue-300 dark:ring-blue-400/20",
    green: "from-emerald-50 to-teal-50 text-emerald-700 ring-emerald-100 dark:from-emerald-500/15 dark:to-teal-500/10 dark:text-emerald-300 dark:ring-emerald-400/20",
    amber: "from-amber-50 to-orange-50 text-amber-700 ring-amber-100 dark:from-amber-500/15 dark:to-orange-500/10 dark:text-amber-300 dark:ring-amber-400/20",
    violet: "from-violet-50 to-fuchsia-50 text-violet-700 ring-violet-100 dark:from-violet-500/15 dark:to-fuchsia-500/10 dark:text-violet-300 dark:ring-violet-400/20",
    rose: "from-rose-50 to-red-50 text-rose-700 ring-rose-100 dark:from-rose-500/15 dark:to-red-500/10 dark:text-rose-300 dark:ring-rose-400/20",
    cyan: "from-cyan-50 to-sky-50 text-cyan-700 ring-cyan-100 dark:from-cyan-500/15 dark:to-sky-500/10 dark:text-cyan-300 dark:ring-cyan-400/20",
  };
  const trendUp = trend ? trend.percent >= 0 : null;
  return (
    <Card className="group overflow-hidden rounded-2xl border-border bg-card shadow-[0_6px_24px_rgba(27,52,76,0.06)] transition-transform duration-200 hover:-translate-y-0.5">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-muted-foreground">{label}</p>
            <p className="mt-2 break-words text-[22px] font-bold leading-tight tracking-[-0.035em] text-foreground">{value}</p>
            <div className="mt-2 flex items-center gap-2">
              {trend ? (
                <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${trendUp ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"}`}>
                  {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {trendUp ? "+" : ""}
                  {trend.percent.toFixed(1)}%
                </span>
              ) : null}
              {helper ? <p className="truncate text-[11px] text-muted-foreground">{trend ? trend.label : helper}</p> : null}
            </div>
          </div>
          <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br ring-1 ${tones[tone]}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function SectionCard({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={`rounded-2xl border-border bg-card shadow-[0_6px_24px_rgba(27,52,76,0.055)] ${className}`}>
      <CardHeader className="grid-cols-[1fr_auto] items-start gap-4 p-5 pb-3">
        <div>
          <CardTitle className="text-[15px] font-bold text-foreground">{title}</CardTitle>
          {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </CardHeader>
      <CardContent className="p-5 pt-2">{children}</CardContent>
    </Card>
  );
}

export function EmptyState({ title = "Ma’lumot topilmadi", description }: { title?: string; description?: string }) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-muted text-muted-foreground"><Inbox className="h-5 w-5" /></div>
      <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

export function QueryError({
  title = "Ma’lumotlarni yuklab bo‘lmadi",
  description,
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl bg-rose-50/50 px-6 py-12 text-center">
      <div className="grid h-12 w-12 place-items-center rounded-2xl bg-card text-rose-600 shadow-sm ring-1 ring-rose-100 dark:text-rose-400 dark:ring-rose-400/20">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <p className="mt-4 text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
        {description || "Internet aloqasini tekshiring yoki birozdan keyin qayta urinib ko‘ring."}
      </p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-4 h-9 rounded-xl bg-card" onClick={onRetry}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" /> Qayta urinish
        </Button>
      ) : null}
    </div>
  );
}

export function TableLoading({ columns = 6, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="space-y-3 p-5">
      {Array.from({ length: rows }).map((_, row) => (
        <div key={row} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {Array.from({ length: columns }).map((__, column) => <Skeleton key={column} className="h-8 rounded-lg" />)}
        </div>
      ))}
    </div>
  );
}

export function PaginationBar({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row">
      <p className="text-xs text-muted-foreground">Jami {total.toLocaleString("uz-UZ")} ta yozuv</p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={page <= 1} onClick={() => onChange(page - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-20 text-center text-xs font-semibold text-muted-foreground">{page} / {pageCount}</span>
        <Button variant="outline" size="sm" className="h-8 rounded-lg" disabled={page >= pageCount} onClick={() => onChange(page + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

export function DebtBadge({ value }: { value: number }) {
  if (value > 0) return <Badge className="rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50">Qarzdor</Badge>;
  if (value < 0) return <Badge className="rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-50">Haqdor</Badge>;
  return <Badge className="rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Yopilgan</Badge>;
}
