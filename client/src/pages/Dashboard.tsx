import { useAuth } from "@/_core/hooks/useAuth";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Building2,
  CircleDollarSign,
  CreditCard,
  FileUp,
  HandCoins,
  Landmark,
  Lock,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useLocation } from "wouter";

const monthlyConfig = {
  sales: { label: "Savdo", color: "var(--chart-1)" },
  received: { label: "Tushum", color: "var(--chart-2)" },
} satisfies ChartConfig;

function monthOverMonthTrend(monthly: { sales: number; received: number }[] | undefined, key: "sales" | "received") {
  if (!monthly || monthly.length < 2) return undefined;
  const current = monthly[monthly.length - 1][key];
  const previous = monthly[monthly.length - 2][key];
  if (!previous) return undefined;
  return { percent: ((current - previous) / previous) * 100, label: "o‘tgan oyga nisbatan" };
}

/**
 * Har oyning 5-kunidan boshlab, agar o'tgan oy hali qulflanmagan bo'lsa, rahbarga
 * "davr qulfini qo'yish vaqti keldi" deb eslatadi. Faqat rahbar rolida ko'rinadi —
 * chunki qulfni faqat u o'zgartira oladi.
 */
function PeriodLockReminder() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const lock = trpc.audit.periodLock.get.useQuery(undefined, { enabled: user?.role === "admin" });

  if (user?.role !== "admin" || lock.isLoading) return null;

  const today = new Date();
  const dayOfMonth = today.getDate();
  if (dayOfMonth < 5) return null;

  // Joriy oyning 1-kunidan bir kun oldin = o'tgan oyning oxirgi kuni.
  const prevMonthEnd = new Date(today.getFullYear(), today.getMonth(), 0);
  const currentLock = lock.data?.lockDate ? new Date(`${lock.data.lockDate}T00:00:00`) : null;
  const alreadyLocked = currentLock !== null && currentLock.getTime() >= prevMonthEnd.getTime();
  if (alreadyLocked) return null;

  const prevMonthLabel = formatMonth(`${prevMonthEnd.getFullYear()}-${String(prevMonthEnd.getMonth() + 1).padStart(2, "0")}`);

  return (
    <button
      type="button"
      onClick={() => setLocation("/ozgarishlar-tarixi")}
      className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left transition-colors hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:hover:bg-amber-950/60"
    >
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-300"><Lock className="size-5" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-amber-900 dark:text-amber-200">{prevMonthLabel} oyini qulflash vaqti keldi</p>
        <p className="mt-0.5 text-xs text-amber-700 dark:text-amber-400">O‘tgan oy hisoboti tekshirilgan bo‘lsa, davr qulfini shu oyga o‘tkazing — keyin o‘sha kunlar tasodifan ham o‘zgartirilmaydi.</p>
      </div>
      <ArrowUpRight className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
    </button>
  );
}

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const overview = trpc.dashboard.overview.useQuery(undefined, { refetchOnWindowFocus: false });
  const stock = trpc.stock.list.useQuery();
  const data = overview.data;
  const salesTrend = monthOverMonthTrend(data?.monthly, "sales");
  const receivedTrend = monthOverMonthTrend(data?.monthly, "received");
  const maxAgentDebt = Math.max(1, ...(data?.agentDebt ?? []).slice(0, 6).map(a => a.debt));
  const lowStockRows = (stock.data ?? []).filter(row => row.isLow);

  if (overview.error) {
    return <div className="mx-auto w-full max-w-[1600px]"><PageHeader eyebrow="Kompaniya holati" title="Boshqaruv paneli" description="Savdo, to‘lovlar va qarzdorlik bo‘yicha asosiy ko‘rsatkichlar." /><QueryError description={overview.error.message} onRetry={() => overview.refetch()} /></div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <PageHeader
        eyebrow="Kompaniya holati"
        title="Boshqaruv paneli"
        description="Savdo, to‘lovlar va qarzdorlik bo‘yicha eng muhim ko‘rsatkichlarni bir qarashda kuzating."
        action={
          <Button onClick={() => setLocation("/import")} className="h-10 rounded-xl bg-slate-900 px-4 text-xs font-semibold hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200">
            <FileUp className="mr-2 h-4 w-4" /> Excel ma’lumotini yangilash
          </Button>
        }
      />

      <PeriodLockReminder />

      {lowStockRows.length > 0 ? (
        <button
          type="button"
          onClick={() => setLocation("/sklad")}
          className="mb-5 flex w-full items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-left transition-colors hover:bg-rose-100"
        >
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-rose-100 text-rose-700"><AlertTriangle className="size-5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-rose-900">{lowStockRows.length} ta mahsulot skladda kam qoldi</p>
            <p className="mt-0.5 truncate text-xs text-rose-700">{lowStockRows.map(row => row.name).join(", ")}</p>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-rose-500" />
        </button>
      ) : null}

      {overview.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl bg-card" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <MetricCard label="Jami sotilgan tovar" value={formatMoney(data.summary.totalSales, true)} helper="Umumiy savdo aylanmasi" icon={ReceiptText} tone="blue" trend={salesTrend} />
          <MetricCard label="Jami tushum" value={formatMoney(data.summary.totalReceived, true)} helper="Barcha to‘lov kanallari" icon={HandCoins} tone="green" trend={receivedTrend} />
          <MetricCard label="Joriy qarzdorlik" value={formatMoney(data.summary.currentDebt, true)} helper="Mijozlar qoldiq qarzi" icon={CircleDollarSign} tone="rose" />
          <MetricCard label="Naqd tushum" value={formatMoney(data.summary.cashIncome, true)} helper="Naqd to‘lovlar" icon={Banknote} tone="amber" />
          <MetricCard label="Terminal tushumi" value={formatMoney(data.summary.terminalIncome, true)} helper={`Click: ${formatMoney(data.summary.clickIncome, true)}`} icon={CreditCard} tone="violet" />
          <MetricCard label="Faol mijozlar" value={data.summary.activeClients.toLocaleString("uz-UZ")} helper="Hamkor savdo nuqtalari" icon={Building2} tone="cyan" />
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.85fr)]">
        <SectionCard title="Savdo va tushum dinamikasi" description="Oylar kesimidagi savdo aylanmasi va kelib tushgan to‘lovlar">
          {overview.isLoading ? (
            <div className="h-[300px] animate-pulse rounded-xl bg-muted" />
          ) : (
            <ChartContainer config={monthlyConfig} className="h-[300px] w-full aspect-auto">
              <AreaChart data={data?.monthly.map(item => ({ ...item, label: formatMonth(item.month) })) ?? []} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-sales)" stopOpacity={0.3} /><stop offset="95%" stopColor="var(--color-sales)" stopOpacity={0.02} /></linearGradient>
                  <linearGradient id="receivedFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-received)" stopOpacity={0.22} /><stop offset="95%" stopColor="var(--color-received)" stopOpacity={0.02} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={12} />
                <YAxis tickLine={false} axisLine={false} width={74} tickFormatter={value => new Intl.NumberFormat("uz-UZ", { notation: "compact", maximumFractionDigits: 1 }).format(value)} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={value => <span className="ml-auto font-mono font-semibold">{formatMoney(Number(value))}</span>} />} />
                <Area type="monotone" dataKey="sales" stroke="var(--color-sales)" strokeWidth={2.5} fill="url(#salesFill)" />
                <Area type="monotone" dataKey="received" stroke="var(--color-received)" strokeWidth={2.5} fill="url(#receivedFill)" />
              </AreaChart>
            </ChartContainer>
          )}
        </SectionCard>

        <SectionCard title="Agentlar bo‘yicha qarz" description="Eng yuqori qarzdorlikka ega agent portfellari">
          {overview.isLoading ? (
            <div className="h-[300px] animate-pulse rounded-xl bg-muted" />
          ) : (data?.agentDebt ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Qarzdorlik topilmadi.</p>
          ) : (
            <div className="space-y-3">
              {(data?.agentDebt ?? []).slice(0, 6).map((agent, index) => (
                <div key={agent.agentId} className="flex items-center gap-3">
                  <span className="w-4 shrink-0 text-right text-[11px] font-bold text-muted-foreground">{index + 1}</span>
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-rose-50 to-red-50 text-[11px] font-bold text-rose-700 ring-1 ring-rose-100">
                    {agent.agentName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-xs font-semibold text-foreground">{agent.agentName}</p>
                      <p className="shrink-0 font-mono text-xs font-bold text-foreground">{formatMoney(agent.debt)}</p>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.max(4, (agent.debt / maxAgentDebt) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(320px,0.7fr)]">
        <SectionCard
          title="So‘nggi operatsiyalar"
          description="Oxirgi kiritilgan savdo va to‘lov yozuvlari"
          action={<Button variant="ghost" size="sm" className="rounded-lg text-xs text-primary" onClick={() => setLocation("/sotuv-hisoboti")}>Barchasini ko‘rish <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Button>}
        >
          <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl">
            {overview.isLoading ? <TableLoading columns={5} rows={5} /> : (
              <Table className="finance-table">
                <TableHeader><TableRow><TableHead>Sana</TableHead><TableHead>Mijoz</TableHead><TableHead>Agent</TableHead><TableHead>Mahsulot</TableHead><TableHead className="text-right">Savdo</TableHead><TableHead className="text-right">To‘landi</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(data?.recentTransactions ?? []).map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(item.date)}</TableCell>
                      <TableCell className="font-semibold text-foreground">{item.clientName || "—"}</TableCell>
                      <TableCell>{item.agentName || "—"}</TableCell>
                      <TableCell className="max-w-44 truncate">{item.productName}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatMoney(item.totalAmount)}</TableCell>
                      <TableCell className="text-right"><Badge className="rounded-lg bg-emerald-50 font-semibold text-emerald-700 hover:bg-emerald-50">{formatMoney(item.paid)}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </SectionCard>

        <SectionCard title="Kassa balanslari" description="Kirim va chiqimlardan hisoblangan joriy qoldiq">
          <div className="space-y-3">
            {[
              { label: "Naqd pul", value: data?.cashBalances.cash ?? 0, icon: Banknote, color: "bg-amber-50 text-amber-700" },
              { label: "Terminal", value: data?.cashBalances.terminal ?? 0, icon: CreditCard, color: "bg-violet-50 text-violet-700" },
              { label: "Click", value: data?.cashBalances.click ?? 0, icon: Landmark, color: "bg-cyan-50 text-cyan-700" },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between rounded-2xl border border-border bg-muted/50 p-4">
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-xl ${item.color}`}><item.icon className="h-4 w-4" /></div>
                  <div><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-0.5 text-sm font-bold text-foreground">{formatMoney(item.value)}</p></div>
                </div>
                <WalletCards className="h-4 w-4 text-muted-foreground" />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
