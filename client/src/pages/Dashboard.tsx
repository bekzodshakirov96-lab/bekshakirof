import { useAuth } from "@/_core/hooks/useAuth";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
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
      className="mb-3 flex w-full items-center gap-3 rounded-xl border border-border border-l-2 border-l-amber-500 bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-400"><Lock className="size-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{prevMonthLabel} oyini qulflash vaqti keldi</p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">O‘tgan oy hisoboti tekshirilgan bo‘lsa, davr qulfini shu oyga o‘tkazing — keyin o‘sha kunlar tasodifan ham o‘zgartirilmaydi.</p>
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
    return <div className="w-full min-w-0"><PageHeader eyebrow="Kompaniya holati" title="Boshqaruv paneli" description="Savdo, to‘lovlar va qarzdorlik bo‘yicha asosiy ko‘rsatkichlar." /><QueryError description={overview.error.message} onRetry={() => overview.refetch()} /></div>;
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader
        eyebrow="Kompaniya holati"
        title="Boshqaruv paneli"
        description="Savdo, to‘lovlar va qarzdorlik bo‘yicha eng muhim ko‘rsatkichlarni bir qarashda kuzating."
        action={
          <Button onClick={() => setLocation("/import")} className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <FileUp className="mr-2 h-4 w-4" /> Excel ma’lumotini yangilash
          </Button>
        }
      />

      <PeriodLockReminder />

      {lowStockRows.length > 0 ? (
        <button
          type="button"
          onClick={() => setLocation("/sklad")}
          className="mb-3 flex w-full items-center gap-3 rounded-xl border border-border border-l-2 border-l-destructive bg-card px-4 py-3 text-left transition-colors hover:bg-muted/50"
        >
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive"><AlertTriangle className="size-4" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">{lowStockRows.length} ta mahsulot skladda kam qoldi</p>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{lowStockRows.map(row => row.name).join(", ")}</p>
          </div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        </button>
      ) : null}

      {overview.isLoading || !data ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-28 animate-pulse rounded-xl border border-border bg-card" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <MetricCard label="Jami sotilgan tovar" value={formatMoney(data.summary.totalSales, true)} helper="Umumiy savdo aylanmasi" icon={ReceiptText} tone="blue" trend={salesTrend} />
          <MetricCard label="Jami tushum" value={formatMoney(data.summary.totalReceived, true)} helper="Barcha to‘lov kanallari" icon={HandCoins} tone="green" trend={receivedTrend} />
          <MetricCard label="Joriy qarzdorlik" value={formatMoney(data.summary.currentDebt, true)} helper="Mijozlar qoldiq qarzi" icon={CircleDollarSign} tone="rose" />
          <MetricCard label="Naqd tushum" value={formatMoney(data.summary.cashIncome, true)} helper="Naqd to‘lovlar" icon={Banknote} tone="amber" />
          <MetricCard label="Terminal tushumi" value={formatMoney(data.summary.terminalIncome, true)} helper={`Click: ${formatMoney(data.summary.clickIncome, true)} • Перечисление: ${formatMoney(data.summary.transferIncome, true)}`} icon={CreditCard} tone="violet" />
          <MetricCard label="Faol mijozlar" value={data.summary.activeClients.toLocaleString("uz-UZ")} helper="Hamkor savdo nuqtalari" icon={Building2} tone="cyan" />
        </div>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.85fr)]">
        <SectionCard title="Savdo va tushum dinamikasi" description="Oylar kesimidagi savdo aylanmasi va kelib tushgan to‘lovlar">
          {overview.isLoading ? (
            <div className="h-[280px] animate-pulse rounded-lg bg-muted" />
          ) : (
            <ChartContainer config={monthlyConfig} className="h-[280px] w-full aspect-auto text-xs">
              <AreaChart data={data?.monthly.map(item => ({ ...item, label: formatMonth(item.month) })) ?? []} margin={{ left: 0, right: 8, top: 10, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={12} />
                <YAxis tickLine={false} axisLine={false} width={74} tickFormatter={value => new Intl.NumberFormat("uz-UZ", { notation: "compact", maximumFractionDigits: 1 }).format(value)} />
                <ChartTooltip cursor={false} content={<ChartTooltipContent formatter={value => <span className="ml-auto text-sm font-semibold tabular-nums">{formatMoney(Number(value))}</span>} />} />
                <Area type="monotone" dataKey="sales" stroke="var(--color-sales)" strokeWidth={2} fill="var(--color-sales)" fillOpacity={0.08} />
                <Area type="monotone" dataKey="received" stroke="var(--color-received)" strokeWidth={2} fill="var(--color-received)" fillOpacity={0.04} />
              </AreaChart>
            </ChartContainer>
          )}
        </SectionCard>

        <SectionCard title="Agentlar bo‘yicha qarz" description="Eng yuqori qarzdorlikka ega agent portfellari">
          {overview.isLoading ? (
            <div className="h-[280px] animate-pulse rounded-lg bg-muted" />
          ) : (data?.agentDebt ?? []).length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">Qarzdorlik topilmadi.</p>
          ) : (
            <div className="divide-y divide-border">
              {(data?.agentDebt ?? []).slice(0, 6).map((agent, index) => (
                <div key={agent.agentId} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className="w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{index + 1}</span>
                  <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/8 text-xs font-semibold text-primary">
                    {agent.agentName.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">{agent.agentName}</p>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{formatMoney(agent.debt)}</p>
                    </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary/70" style={{ width: `${Math.max(4, (agent.debt / maxAgentDebt) * 100)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4 space-y-4">
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">So‘nggi operatsiyalar</h3>
              <p className="mt-1 text-xs text-muted-foreground">Oxirgi kiritilgan savdo va to‘lov yozuvlari</p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 rounded-lg text-xs font-medium text-primary" onClick={() => setLocation("/sotuv-hisoboti")}>Barchasini ko‘rish <ArrowUpRight className="ml-1 h-3.5 w-3.5" /></Button>
          </div>
          <div>
            {overview.isLoading ? <TableLoading columns={6} rows={5} /> : (
              <Table className="finance-table min-w-[900px] text-sm [&_th]:text-xs">
                <TableHeader><TableRow><TableHead className="w-32">Sana</TableHead><TableHead className="w-[25%]">Mijoz</TableHead><TableHead>Agent</TableHead><TableHead>Mahsulot</TableHead><TableHead className="text-right">Savdo</TableHead><TableHead className="text-right">To‘landi</TableHead></TableRow></TableHeader>
                <TableBody>
                  {(data?.recentTransactions ?? []).map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(item.date)}</TableCell>
                      <TableCell className="font-medium text-foreground">{item.clientName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{item.agentName || "—"}</TableCell>
                      <TableCell className="max-w-64 truncate" title={item.productName}>{item.productName}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">{formatMoney(item.totalAmount)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-primary">{formatMoney(item.paid)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">Kassa balanslari</h3>
            <p className="mt-1 text-xs text-muted-foreground">Kirim va chiqimlardan hisoblangan joriy qoldiq</p>
          </div>
          <div className="grid divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {[
              { label: "Naqd pul", value: data?.cashBalances.cash ?? 0, icon: Banknote },
              { label: "Terminal", value: data?.cashBalances.terminal ?? 0, icon: CreditCard },
              { label: "Click", value: data?.cashBalances.click ?? 0, icon: Landmark },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-3 px-4 py-3">
                <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/8 text-primary"><item.icon className="size-4" /></div>
                <div className="min-w-0"><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 break-words text-base font-semibold tabular-nums text-foreground">{formatMoney(item.value)}</p></div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
