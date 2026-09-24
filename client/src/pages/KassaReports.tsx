import { ExportMenu } from "@/components/ExportMenu";
import { AgentDifferenceReport } from "@/components/AgentDifferenceReport";
import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/cashCategories";
import { formatMoney, formatTashkentDate, tashkentDateInputValue, tashkentDayBoundary } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { ELECTRONIC_PAYMENT_CATEGORY } from "../../../shared/cashAccounting";
import { Landmark, RotateCcw, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const firstOfMonth = () => `${tashkentDateInputValue().slice(0, 7)}-01`;
const today = tashkentDateInputValue;

export default function KassaReports() {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [agentFilter, setAgentFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [cashPage, setCashPage] = useState(1);
  const [openNotes, setOpenNotes] = useState<string[]>([]);
  const [isExportingCash, setIsExportingCash] = useState(false);
  const [isExportingExpense, setIsExportingExpense] = useState(false);

  const agents = trpc.kassa.report.agentDifferenceOptions.useQuery();
  const categories = trpc.cash.categories.useQuery({ type: typeFilter === "all" ? undefined : typeFilter });
  const categoryOptions = useMemo(() => {
    const staticList = typeFilter === "income"
      ? [...INCOME_CATEGORIES, ELECTRONIC_PAYMENT_CATEGORY]
      : typeFilter === "expense"
        ? EXPENSE_CATEGORIES
        : [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES, ELECTRONIC_PAYMENT_CATEGORY];
    return Array.from(new Set([...staticList, ...(categories.data ?? [])]));
  }, [typeFilter, categories.data]);

  const filters = useMemo(() => ({
    from: fromDate ? tashkentDayBoundary(fromDate) : undefined,
    to: toDate ? tashkentDayBoundary(toDate, true) : undefined,
    agentId: agentFilter ? Number(agentFilter) : undefined,
  }), [fromDate, toDate, agentFilter]);
  useEffect(() => { setCashPage(1); }, [fromDate, toDate, agentFilter, typeFilter, categoryFilter]);

  const summary = trpc.kassa.report.summary.useQuery({ from: filters.from, to: filters.to });
  const expenseByCategory = trpc.kassa.report.expenseByCategory.useQuery({ from: filters.from, to: filters.to });
  const cashList = trpc.cash.list.useQuery({
    from: filters.from, to: filters.to, agentId: filters.agentId,
    type: typeFilter, category: categoryFilter.trim() || undefined,
    page: cashPage, pageSize: 50,
  });
  const utils = trpc.useUtils();

  function clearFilters() {
    setFromDate(firstOfMonth()); setToDate(today());
    setAgentFilter(""); setTypeFilter("all"); setCategoryFilter("");
  }

  async function exportCash(format: "xlsx" | "pdf") {
    setIsExportingCash(true);
    try {
      const data = await utils.cash.exportData.fetch({
        from: filters.from, to: filters.to, agentId: filters.agentId,
        type: typeFilter, category: categoryFilter.trim() || undefined,
      });
      type Row = (typeof data.rows)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Sana", value: row => formatTashkentDate(row.entryDate), width: 48 },
        { title: "Harakat", value: row => row.category === ELECTRONIC_PAYMENT_CATEGORY ? "Elektron to‘lov" : row.type === "income" ? "Prihod" : "Rasxod", width: 48 },
        { title: "Kategoriya", value: row => row.category, width: "*" },
        { title: "Agent", value: row => row.agentName || "—", width: 62 },
        { title: "Izoh", value: row => row.description || "—", width: 80 },
        { title: "Naqd", value: row => row.cashAmount, width: 52, align: "right" },
        { title: "Terminal", value: row => row.terminalAmount, width: 52, align: "right" },
        { title: "Click", value: row => row.clickAmount, width: 48, align: "right" },
        { title: "O‘tkazma", value: row => row.transferAmount, width: 52, align: "right" },
      ];
      const options = {
        title: "Kassa harakatlari hisoboti",
        fileName: `kassa_hisoboti_${today()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt,
        filterDescription: `${fromDate} — ${toDate}`,
        summary: [
          { label: "Jami Prihod", value: data.summary.income },
          { label: "Jami Rasxod", value: data.summary.expense },
        ],
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo‘lmadi.");
    } finally {
      setIsExportingCash(false);
    }
  }

  async function exportExpenseByCategory(format: "xlsx" | "pdf") {
    setIsExportingExpense(true);
    try {
      const data = expenseByCategory.data;
      if (!data) return;
      type Row = (typeof data.rows)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Tur", value: row => row.category, width: "*" },
        { title: "Summa", value: row => row.total, width: 70, align: "right" },
        { title: "Ulush", value: row => data.total > 0 ? `${((row.total / data.total) * 100).toFixed(1)}%` : "0%", width: 50, align: "right" },
      ];
      const options = {
        title: "Rasxod turlari bo'yicha",
        fileName: `rasxod_turlari_${today()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt,
        filterDescription: `${fromDate} — ${toDate}`,
        summary: [{ label: "Jami rasxod", value: data.total }],
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo'lmadi.");
    } finally {
      setIsExportingExpense(false);
    }
  }

  if (summary.error) {
    return <div className="mx-auto w-full max-w-[1650px]"><PageHeader eyebrow="Hisobot" title="Kassa hisobotlari" description="Prihod, rasxod va agent solishtirish bo‘yicha filtrlangan hisobot." /><QueryError description={summary.error.message} onRetry={() => summary.refetch()} /></div>;
  }

  const cashRows = cashList.data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-[1650px]">
      <PageHeader eyebrow="Hisobot" title="Kassa hisobotlari" description="Kassa harakatlari va agentlar raznitsasi; mahsulot tafsiloti agent tanlanganda ochiladi." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Jami Prihod" value={formatMoney(summary.data?.jamiPrihod, true)} helper="Tanlangan davr" icon={TrendingUp} tone="green" />
        <MetricCard label="Jami Rasxod" value={formatMoney(summary.data?.jamiRasxod, true)} helper="Tanlangan davr" icon={TrendingDown} tone="rose" />
        <MetricCard label="Sof natija" value={formatMoney(summary.data?.sofNatija, true)} helper="Prihod − Rasxod" icon={Landmark} tone="cyan" />
      </div>

      <AgentDifferenceReport />

      <SectionCard title="Kassa harakatlari filtrlari" description="Sana umumiy ko‘rsatkichlar va pastki hisobotlarga ta’sir qiladi. Agent, harakat va kategoriya Kassa harakatlariga tegishli. Raznitsa kartasining o‘z filtrlari bor." className="mt-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input type="date" className="finance-input" value={fromDate} max={toDate} onChange={event => setFromDate(event.target.value)} aria-label="Boshlanish sanasi" />
          <Input type="date" className="finance-input" value={toDate} min={fromDate} onChange={event => setToDate(event.target.value)} aria-label="Tugash sanasi" />
          <select className="finance-input border px-3 text-muted-foreground" value={agentFilter} onChange={event => setAgentFilter(event.target.value)}><option value="">Barcha agentlar</option>{(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
          <select className="finance-input border px-3 text-muted-foreground" value={typeFilter} onChange={event => { setTypeFilter(event.target.value as typeof typeFilter); setCategoryFilter(""); }}><option value="all">Prihod + Rasxod</option><option value="income">Faqat Prihod</option><option value="expense">Faqat Rasxod</option></select>
          <select className="finance-input border px-3 text-muted-foreground" value={categoryFilter} onChange={event => setCategoryFilter(event.target.value)}>
            <option value="">Barcha turlar</option>
            {categoryOptions.map(category => <option key={category} value={category}>{category}</option>)}
          </select>
        </div>
        <div className="mt-3"><Button variant="outline" className="gap-2 bg-card" onClick={clearFilters}><RotateCcw className="size-4" />Filtrlarni tozalash</Button></div>
      </SectionCard>

      <SectionCard
        title="Rasxod turlari bo'yicha"
        description="Tanlangan davrda Ойлик, Обед, Газ, Завод va boshqa rasxodlarga qancha sarflangani"
        className="mt-5"
        action={<ExportMenu onExcel={() => exportExpenseByCategory("xlsx")} onPdf={() => exportExpenseByCategory("pdf")} isLoading={isExportingExpense} disabled={expenseByCategory.isLoading} />}
      >
        {expenseByCategory.error ? (
          <QueryError description={expenseByCategory.error.message} onRetry={() => expenseByCategory.refetch()} />
        ) : expenseByCategory.isLoading ? (
          <TableLoading columns={3} />
        ) : (expenseByCategory.data?.rows.length ?? 0) === 0 ? (
          <EmptyState description="Tanlangan davrda rasxod yo'q." />
        ) : (
          <div className="space-y-3">
            {expenseByCategory.data!.rows.map(row => {
              const share = expenseByCategory.data!.total > 0 ? (row.total / expenseByCategory.data!.total) * 100 : 0;
              return (
                <div key={row.category}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <p className="font-semibold text-foreground">{row.category}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{share.toFixed(1)}%</span>
                      <span className="font-bold tabular-nums text-foreground">{formatMoney(row.total)}</span>
                    </div>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.max(2, share)}%` }} />
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between border-t border-border pt-3 text-sm font-bold text-foreground">
              <p>Jami rasxod</p>
              <p className="tabular-nums">{formatMoney(expenseByCategory.data?.total ?? 0)}</p>
            </div>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Kassa harakatlari" description="Naqd prihod/rasxod va elektron to‘lovlar alohida ko‘rsatiladi" className="mt-5" action={<ExportMenu onExcel={() => exportCash("xlsx")} onPdf={() => exportCash("pdf")} isLoading={isExportingCash} disabled={cashList.isLoading} />}>
        <div className="-mx-5 overflow-hidden border-t border-border">
          {cashList.error ? <QueryError description={cashList.error.message} onRetry={() => cashList.refetch()} /> : cashList.isLoading ? <TableLoading columns={9} /> : cashRows.length === 0 ? <EmptyState /> : (
            <Table containerClassName="max-h-[620px] overflow-y-auto" className="finance-table min-w-[1100px]"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
              <TableHead>Sana</TableHead><TableHead>Harakat</TableHead><TableHead>Kategoriya</TableHead><TableHead>Agent</TableHead><TableHead>Izoh</TableHead>
              <TableHead className="text-right">Naqd</TableHead><TableHead className="text-right">Terminal</TableHead><TableHead className="text-right">Click</TableHead><TableHead className="text-right">O‘tkazma</TableHead>
            </TableRow></TableHeader><TableBody>
              {cashRows.map(row => <TableRow key={row.reportKey}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatTashkentDate(row.entryDate)}</TableCell>
                <TableCell><Badge className={row.category === ELECTRONIC_PAYMENT_CATEGORY ? "rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-50" : row.type === "income" ? "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50"}>{row.category === ELECTRONIC_PAYMENT_CATEGORY ? "Elektron" : row.type === "income" ? "Prihod" : "Rasxod"}</Badge></TableCell>
                <TableCell className="font-semibold text-foreground">{row.category}</TableCell>
                <TableCell>{row.agentName || "—"}</TableCell>
                <TableCell className="max-w-64"><button type="button" className={`block max-w-64 text-left ${openNotes.includes(row.reportKey) ? "whitespace-pre-wrap break-words" : "truncate"}`} onClick={() => setOpenNotes(current => current.includes(row.reportKey) ? current.filter(id => id !== row.reportKey) : [...current, row.reportKey])} aria-expanded={openNotes.includes(row.reportKey)} title={row.description || undefined}>{row.description || "—"}</button></TableCell>
                <TableCell className={`text-right font-bold tabular-nums ${row.type === "expense" ? "text-rose-500" : ""}`}>{row.type === "expense" && row.cashAmount > 0 ? "−" : ""}{formatMoney(row.cashAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.terminalAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.clickAmount)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.transferAmount)}</TableCell>
              </TableRow>)}
            </TableBody></Table>
          )}
        </div>
        {!cashList.error && cashList.data && <>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm font-medium"><span>Naqd prihod: {formatMoney(cashList.data.totals.cashIncome)}</span><span>Naqd rasxod: {formatMoney(cashList.data.totals.cashExpense)}</span><span>Terminal: {formatMoney(cashList.data.totals.terminal)}</span><span>Click: {formatMoney(cashList.data.totals.click)}</span><span>O‘tkazma: {formatMoney(cashList.data.totals.transfer)}</span></div>
          <ReportPager page={cashPage} pageSize={50} total={cashList.data.total} onPageChange={setCashPage} />
        </>}
      </SectionCard>

    </div>
  );
}

export function ReportPager({ page, pageSize, total, onPageChange }: { page: number; pageSize: number; total: number; onPageChange: (page: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span>Jami {total} ta yozuv · {page}/{pageCount} sahifa</span>
      <div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Oldingi</Button><Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>Keyingi</Button></div>
    </div>
  );
}
