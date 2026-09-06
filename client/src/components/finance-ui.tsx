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
    <div className="mb-5 flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 text-xs font-medium text-muted-foreground">{eyebrow}</p> : null}
        <h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-[28px]">{title}</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
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
    blue: "bg-primary/10 text-primary",
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300",
    violet: "bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300",
    rose: "bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300",
    cyan: "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300",
  };
  const trendUp = trend ? trend.percent >= 0 : null;
  return (
    <Card className="gap-0 overflow-hidden rounded-xl border-border bg-card py-0 shadow-none">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">{label}</p>
            <p className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight text-foreground tabular-nums">{value}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {trend ? (
                <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold ${trendUp ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" : "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"}`}>
                  {trendUp ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {trendUp ? "+" : ""}
                  {trend.percent.toFixed(1)}%
                </span>
              ) : null}
              {helper ? <p className="text-xs leading-5 text-muted-foreground">{trend ? trend.label : helper}</p> : null}
            </div>
          </div>
          <div className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${tones[tone]}`}>
            <Icon className="h-[18px] w-[18px]" />
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
    <Card className={`gap-0 rounded-xl border-border bg-card py-0 shadow-none ${className}`}>
      <CardHeader className="grid-cols-1 items-start gap-3 p-5 pb-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold leading-5 text-foreground">{title}</CardTitle>
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
    <div className="flex min-h-48 flex-col items-center justify-center px-6 py-8 text-center">
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
    <div className="flex min-h-48 flex-col items-center justify-center rounded-xl border border-destructive/20 bg-destructive/5 px-6 py-8 text-center">
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
