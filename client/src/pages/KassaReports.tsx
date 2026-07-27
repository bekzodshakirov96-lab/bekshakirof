import { ExportMenu } from "@/components/ExportMenu";
import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/cashCategories";
import { formatDate, formatMoney, formatNumber, localDateInputValue } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { Landmark, RotateCcw, Scale, TrendingDown, TrendingUp, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const firstOfMonth = () => { const d = new Date(); d.setDate(1); return localDateInputValue(d); };
const today = localDateInputValue;
const toTs = (value: string, endOfDay = false) => new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).getTime();

export default function KassaReports() {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [agentFilter, setAgentFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | "income" | "expense">("all");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [isExportingCash, setIsExportingCash] = useState(false);
  const [isExportingAgent, setIsExportingAgent] = useState(false);
  const [isExportingExpense, setIsExportingExpense] = useState(false);

  const agents = trpc.agents.options.useQuery();
  const products = trpc.products.list.useQuery({});
  const categories = trpc.cash.categories.useQuery({ type: typeFilter === "all" ? undefined : typeFilter });
  const categoryOptions = useMemo(() => {
    const staticList = typeFilter === "income" ? INCOME_CATEGORIES : typeFilter === "expense" ? EXPENSE_CATEGORIES : [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
    return Array.from(new Set([...staticList, ...(categories.data ?? [])]));
  }, [typeFilter, categories.data]);

  const filters = useMemo(() => ({
    from: fromDate ? toTs(fromDate) : undefined,
    to: toDate ? toTs(toDate, true) : undefined,
    agentId: agentFilter ? Number(agentFilter) : undefined,
    productId: productFilter ? Number(productFilter) : undefined,
  }), [fromDate, toDate, agentFilter, productFilter]);

  const summary = trpc.kassa.report.summary.useQuery({ from: filters.from, to: filters.to });
  const expenseByCategory = trpc.kassa.report.expenseByCategory.useQuery({ from: filters.from, to: filters.to });
  const cashList = trpc.cash.list.useQuery({
    from: filters.from, to: filters.to, agentId: filters.agentId,
    type: typeFilter, category: categoryFilter.trim() || undefined,
    page: 1, pageSize: 100,
  });
  const agentDetails = trpc.kassa.report.agentTakingDetails.useQuery({
    from: filters.from, to: filters.to, agentId: filters.agentId, productId: filters.productId,
  });
  const utils = trpc.useUtils();

  function clearFilters() {
    setFromDate(firstOfMonth()); setToDate(today());
    setAgentFilter(""); setProductFilter(""); setTypeFilter("all"); setCategoryFilter("");
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
        { title: "Sana", value: row => formatDate(row.entryDate), width: 48 },
        { title: "Turi", value: row => row.type === "income" ? "Prihod" : "Rasxod", width: 40 },
        { title: "Tur", value: row => row.category, width: "*" },
        { title: "Agent", value: row => row.agentName || "—", width: 62 },
        { title: "Izoh", value: row => row.description || "—", width: 80 },
        { title: "Naqd", value: row => row.cashAmount, width: 52, align: "right" },
        { title: "Terminal", value: row => row.terminalAmount, width: 52, align: "right" },
        { title: "Click", value: row => row.clickAmount, width: 48, align: "right" },
      ];
      const options = {
        title: "Kassa harakatlari hisoboti",
        fileName: `kassa_hisoboti_${localDateInputValue()}`,
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
        fileName: `rasxod_turlari_${localDateInputValue()}`,
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

  async function exportAgent(format: "xlsx" | "pdf") {
    setIsExportingAgent(true);
    try {
      const data = agentDetails.data;
      if (!data) return;
      type Row = (typeof data.rows)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Sana", value: row => formatDate(row.entryDate), width: 48 },
        { title: "Agent", value: row => row.agentName, width: 70 },
        { title: "Mahsulot", value: row => row.productName, width: "*" },
        { title: "Miqdor", value: row => Number(row.quantity), width: 45, align: "right", numberFormat: "#,##0.000" },
        { title: "Narx", value: row => row.unitPrice, width: 52, align: "right" },
        { title: "Summa", value: row => row.amount, width: 58, align: "right" },
      ];
      const options = {
        title: "Agent-tovar tafsilotlari hisoboti",
        fileName: `agent_tovar_hisoboti_${localDateInputValue()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt,
        filterDescription: `${fromDate} — ${toDate}`,
        summary: [{ label: "Jami summa", value: data.totalAmount }],
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo‘lmadi.");
    } finally {
      setIsExportingAgent(false);
    }
  }

  if (summary.error) {
    return <div className="mx-auto w-full max-w-[1650px]"><PageHeader eyebrow="Hisobot" title="Kassa hisobotlari" description="Prihod, rasxod va agent solishtirish bo‘yicha filtrlangan hisobot." /><QueryError description={summary.error.message} onRetry={() => summary.refetch()} /></div>;
  }

  const cashRows = cashList.data?.items ?? [];
  const agentRows = agentDetails.data?.rows ?? [];

  return (
    <div className="mx-auto w-full max-w-[1650px]">
      <PageHeader eyebrow="Hisobot" title="Kassa hisobotlari" description="Sana oralig'i, agent va tovar bo'yicha filtrlangan kassa va agent solishtirish hisoboti." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Jami Prihod" value={formatMoney(summary.data?.jamiPrihod, true)} helper="Tanlangan davr" icon={TrendingUp} tone="green" />
        <MetricCard label="Jami Rasxod" value={formatMoney(summary.data?.jamiRasxod, true)} helper="Tanlangan davr" icon={TrendingDown} tone="rose" />
        <MetricCard label="Sof natija" value={formatMoney(summary.data?.sofNatija, true)} helper="Prihod − Rasxod" icon={Landmark} tone="cyan" />
        <MetricCard label="Agentlar farqi" value={formatMoney(summary.data?.agentFarqTotal, true)} helper={`Hisoblangan: ${formatMoney(summary.data?.agentComputedTotal, true)}`} icon={Users} tone={summary.data && summary.data.agentFarqTotal !== 0 ? "rose" : "green"} />
      </div>

      <SectionCard title="Filtrlar" description="Ikkala jadval ham shu filtrlarga mos yangilanadi" className="mt-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <Input type="date" className="finance-input" value={fromDate} onChange={event => setFromDate(event.target.value)} aria-label="Boshlanish sanasi" />
          <Input type="date" className="finance-input" value={toDate} onChange={event => setToDate(event.target.value)} aria-label="Tugash sanasi" />
          <select className="finance-input border px-3 text-muted-foreground" value={agentFilter} onChange={event => setAgentFilter(event.target.value)}><option value="">Barcha agentlar</option>{(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
          <select className="finance-input border px-3 text-muted-foreground" value={productFilter} onChange={event => setProductFilter(event.target.value)}><option value="">Barcha mahsulotlar</option>{(products.data ?? []).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
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
        {expenseByCategory.isLoading ? (
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

      <SectionCard title="Kassa harakatlari" description="Prihod va rasxod yozuvlari" className="mt-5" action={<ExportMenu onExcel={() => exportCash("xlsx")} onPdf={() => exportCash("pdf")} isLoading={isExportingCash} disabled={cashList.isLoading} />}>
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
          {cashList.isLoading ? <TableLoading columns={7} /> : cashRows.length === 0 ? <EmptyState /> : (
            <Table className="finance-table min-w-[900px]"><TableHeader><TableRow>
              <TableHead>Sana</TableHead><TableHead>Turi</TableHead><TableHead>Tur</TableHead><TableHead>Agent</TableHead><TableHead>Izoh</TableHead><TableHead className="text-right">Summa</TableHead>
            </TableRow></TableHeader><TableBody>
              {cashRows.map(row => <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.entryDate)}</TableCell>
                <TableCell><Badge className={row.type === "income" ? "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50"}>{row.type === "income" ? "Prihod" : "Rasxod"}</Badge></TableCell>
                <TableCell className="font-semibold text-foreground">{row.category}</TableCell>
                <TableCell>{row.agentName || "—"}</TableCell>
                <TableCell className="max-w-64 truncate">{row.description || "—"}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{formatMoney(row.cashAmount + row.terminalAmount + row.clickAmount)}</TableCell>
              </TableRow>)}
            </TableBody></Table>
          )}
        </div>
        {cashList.data && cashList.data.total > cashRows.length && (
          <p className="mt-3 px-1 text-xs text-muted-foreground">Jadvalda so'nggi {cashRows.length} ta yozuv ko'rsatilgan (jami {cashList.data.total} ta). To'liq ro'yxat uchun Excel/PDF eksportdan foydalaning.</p>
        )}
      </SectionCard>

      <SectionCard title="Agent-tovar tafsilotlari" description="Har bir agent qaysi kuni qaysi tovardan qancha olib chiqqani" className="mt-5" action={<ExportMenu onExcel={() => exportAgent("xlsx")} onPdf={() => exportAgent("pdf")} isLoading={isExportingAgent} disabled={agentDetails.isLoading} />}>
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
          {agentDetails.isLoading ? <TableLoading columns={6} /> : agentRows.length === 0 ? <EmptyState /> : (
            <Table className="finance-table min-w-[850px]"><TableHeader><TableRow>
              <TableHead>Sana</TableHead><TableHead>Agent</TableHead><TableHead>Mahsulot</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead className="text-right">Narx</TableHead><TableHead className="text-right">Summa</TableHead>
            </TableRow></TableHeader><TableBody>
              {agentRows.map(row => <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.entryDate)}</TableCell>
                <TableCell className="font-semibold text-foreground">{row.agentName}</TableCell>
                <TableCell>{row.productName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(row.quantity, 3)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(row.unitPrice)}</TableCell>
                <TableCell className="text-right font-bold tabular-nums">{formatMoney(row.amount)}</TableCell>
              </TableRow>)}
            </TableBody></Table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Agent solishtirish tarixi" description="Har bir agentning kunlik hisoblangan va topshirgan puli" className="mt-5">
        <AgentReconciliationTable from={filters.from} to={filters.to} agentId={filters.agentId} />
      </SectionCard>
    </div>
  );
}

function AgentReconciliationTable({ from, to, agentId }: { from?: number; to?: number; agentId?: number }) {
  const query = trpc.kassa.report.agentReconciliation.useQuery({ from, to, agentId });
  const rows = query.data?.rows ?? [];
  return (
    <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
      {query.isLoading ? <TableLoading columns={5} /> : rows.length === 0 ? <EmptyState /> : (
        <Table className="finance-table min-w-[800px]"><TableHeader><TableRow>
          <TableHead>Sana</TableHead><TableHead>Agent</TableHead><TableHead className="text-right">Hisoblangan</TableHead><TableHead className="text-right">Topshirgan</TableHead><TableHead className="text-right">Farq</TableHead>
        </TableRow></TableHeader><TableBody>
          {rows.map(row => <TableRow key={`${row.agentId}-${row.entryDate}`}>
            <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.entryDate)}</TableCell>
            <TableCell className="font-semibold text-foreground">{row.agentName}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.computedAmount)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatMoney(row.submittedAmount)}</TableCell>
            <TableCell className="text-right">
              {row.farq === 0 ? (
                <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Mos</Badge>
              ) : (
                <Badge variant="outline" className="gap-1 border-rose-200 bg-rose-50 text-rose-700"><Scale className="size-3" />{formatMoney(Math.abs(row.farq))}</Badge>
              )}
            </TableCell>
          </TableRow>)}
        </TableBody></Table>
      )}
    </div>
  );
}
