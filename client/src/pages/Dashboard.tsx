import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { formatDate, formatMoney, formatMonth } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  ArrowUpRight,
  Banknote,
  Building2,
  CircleDollarSign,
  CreditCard,
  FileUp,
  HandCoins,
  Landmark,
  ReceiptText,
  WalletCards,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useLocation } from "wouter";

const monthlyConfig = {
  sales: { label: "Savdo", color: "var(--chart-1)" },
  received: { label: "Tushum", color: "var(--chart-2)" },
} satisfies ChartConfig;

const debtConfig = {
  debt: { label: "Qarzdorlik", color: "var(--chart-3)" },
} satisfies ChartConfig;

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const overview = trpc.dashboard.overview.useQuery(undefined, { refetchOnWindowFocus: false });
  const data = overview.data;

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
          <Button onClick={() => setLocation("/import")} className="h-10 rounded-xl bg-slate-900 px-4 text-xs font-semibold hover:bg-slate-800">
            <FileUp className="mr-2 h-4 w-4" /> Excel ma’lumotini yangilash
          </Button>
        }
      />

      {overview.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl bg-white" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          <MetricCard label="Jami sotilgan tovar" value={formatMoney(data.summary.totalSales, true)} helper="Umumiy savdo aylanmasi" icon={ReceiptText} tone="blue" />
          <MetricCard label="Jami tushum" value={formatMoney(data.summary.totalReceived, true)} helper="Barcha to‘lov kanallari" icon={HandCoins} tone="green" />
          <MetricCard label="Joriy qarzdorlik" value={formatMoney(data.summary.currentDebt, true)} helper="Mijozlar qoldiq qarzi" icon={CircleDollarSign} tone="rose" />
          <MetricCard label="Naqd tushum" value={formatMoney(data.summary.cashIncome, true)} helper="Naqd to‘lovlar" icon={Banknote} tone="amber" />
          <MetricCard label="Terminal tushumi" value={formatMoney(data.summary.terminalIncome, true)} helper={`Click: ${formatMoney(data.summary.clickIncome, true)}`} icon={CreditCard} tone="violet" />
          <MetricCard label="Faol mijozlar" value={data.summary.activeClients.toLocaleString("uz-UZ")} helper="Hamkor savdo nuqtalari" icon={Building2} tone="cyan" />
        </div>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.65fr)_minmax(340px,0.85fr)]">
        <SectionCard title="Savdo va tushum dinamikasi" description="Oylar kesimidagi savdo aylanmasi va kelib tushgan to‘lovlar">
          {overview.isLoading ? (
            <div className="h-[300px] animate-pulse rounded-xl bg-slate-50" />
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
            <div className="h-[300px] animate-pulse rounded-xl bg-slate-50" />
          ) : (
            <ChartContainer config={debtConfig} className="h-[300px] w-full aspect-auto">
              <BarChart data={(data?.agentDebt ?? []).slice(0, 6)} layout="vertical" margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} strokeDasharray="4 4" />
                <YAxis type="category" dataKey="agentName" tickLine={false} axisLine={false} width={92} tick={{ fontSize: 11 }} />
                <XAxis type="number" hide />
                <ChartTooltip cursor={{ fill: "rgba(15, 91, 123, 0.05)" }} content={<ChartTooltipContent formatter={value => <span className="ml-auto font-mono font-semibold">{formatMoney(Number(value))}</span>} />} />
                <Bar dataKey="debt" fill="var(--color-debt)" radius={[0, 8, 8, 0]} barSize={22} />
              </BarChart>
            </ChartContainer>
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
                      <TableCell className="whitespace-nowrap text-slate-500">{formatDate(item.date)}</TableCell>
                      <TableCell className="font-semibold text-slate-900">{item.clientName || "—"}</TableCell>
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
              <div key={item.label} className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/50 p-4">
                <div className="flex items-center gap-3">
                  <div className={`grid h-10 w-10 place-items-center rounded-xl ${item.color}`}><item.icon className="h-4 w-4" /></div>
                  <div><p className="text-xs text-slate-400">{item.label}</p><p className="mt-0.5 text-sm font-bold text-slate-900">{formatMoney(item.value)}</p></div>
                </div>
                <WalletCards className="h-4 w-4 text-slate-300" />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
