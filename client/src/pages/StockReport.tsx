import { ExportMenu } from "@/components/ExportMenu";
import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber, localDateInputValue } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, ArrowUpFromLine, RotateCcw, Scale } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const firstOfMonth = () => { const d = new Date(); d.setDate(1); return localDateInputValue(d); };
const today = localDateInputValue;
const toTs = (value: string, endOfDay = false) => new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).getTime();

export default function StockReport() {
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [productFilter, setProductFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [movementTypeFilter, setMovementTypeFilter] = useState<"all" | "in" | "out">("all");
  const [isExportingSummary, setIsExportingSummary] = useState(false);
  const [isExportingMovements, setIsExportingMovements] = useState(false);

  const products = trpc.stock.list.useQuery();
  const agents = trpc.agents.options.useQuery();
  const utils = trpc.useUtils();

  const filters = useMemo(() => ({
    from: fromDate ? toTs(fromDate) : undefined,
    to: toDate ? toTs(toDate, true) : undefined,
    productId: productFilter ? Number(productFilter) : undefined,
    agentId: agentFilter ? Number(agentFilter) : undefined,
  }), [fromDate, toDate, productFilter, agentFilter]);

  const report = trpc.stock.report.useQuery({ from: filters.from, to: filters.to, productId: filters.productId });
  const movements = trpc.stock.movements.useQuery({
    productId: filters.productId,
    agentId: filters.agentId,
    from: filters.from,
    to: filters.to,
    page: 1,
    pageSize: 50,
  });

  function clearFilters() {
    setFromDate(firstOfMonth()); setToDate(today()); setProductFilter(""); setAgentFilter(""); setMovementTypeFilter("all");
  }

  const reportRows = report.data?.rows ?? [];
  const movementRows = (movements.data?.items ?? []).filter(row => movementTypeFilter === "all" || row.movementType === movementTypeFilter);

  async function exportSummary(format: "xlsx" | "pdf") {
    setIsExportingSummary(true);
    try {
      const data = report.data;
      if (!data) return;
      type Row = (typeof data.rows)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Mahsulot", value: row => row.productName, width: "*" },
        { title: "Kirim", value: row => row.inTotal, width: 60, align: "right", numberFormat: "#,##0.000" },
        { title: "Chiqim", value: row => row.outTotal, width: 60, align: "right", numberFormat: "#,##0.000" },
        { title: "Sof o'zgarish", value: row => row.net, width: 65, align: "right", numberFormat: "#,##0.000" },
        { title: "Joriy qoldiq", value: row => row.currentStock, width: 65, align: "right", numberFormat: "#,##0.000" },
      ];
      const options = {
        title: "Sklad hisoboti — mahsulot bo'yicha",
        fileName: `sklad_hisoboti_${localDateInputValue()}`,
        rows: data.rows, columns, generatedAt: Date.now(),
        filterDescription: `${fromDate} — ${toDate}`,
        summary: [
          { label: "Jami kirim", value: data.summary.totalIn },
          { label: "Jami chiqim", value: data.summary.totalOut },
        ],
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo'lmadi.");
    } finally {
      setIsExportingSummary(false);
    }
  }

  async function exportMovements(format: "xlsx" | "pdf") {
    setIsExportingMovements(true);
    try {
      const data = await utils.stock.exportData.fetch({
        productId: filters.productId, agentId: filters.agentId, movementType: movementTypeFilter, from: filters.from, to: filters.to,
      });
      type Row = (typeof data.rows)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Sana", value: row => formatDate(row.movementDate), width: 48 },
        { title: "Mahsulot", value: row => row.productName ?? "—", width: "*" },
        { title: "Turi", value: row => row.movementType === "in" ? "Kirim" : "Chiqim", width: 40 },
        { title: "Miqdor", value: row => Number(row.quantity), width: 50, align: "right", numberFormat: "#,##0.000" },
        { title: "Agent", value: row => row.agentName ?? "—", width: 60 },
        { title: "Sabab", value: row => row.reason ?? "—", width: 70 },
        { title: "Manba", value: row => row.isAutomatic ? "Savdo (avtomatik)" : "Qo'lda", width: 60 },
      ];
      const options = {
        title: "Sklad harakatlari",
        fileName: `sklad_harakatlari_${localDateInputValue()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt,
        filterDescription: `${fromDate} — ${toDate}`,
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo'lmadi.");
    } finally {
      setIsExportingMovements(false);
    }
  }

  if (report.error) {
    return <div className="mx-auto w-full max-w-[1650px]"><PageHeader eyebrow="Hisobot" title="Sklad hisoboti" description="Davr bo'yicha kirim, chiqim va qoldiq hisoboti." /><QueryError description={report.error.message} onRetry={() => report.refetch()} /></div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1650px]">
      <PageHeader eyebrow="Hisobot" title="Sklad hisoboti" description="Sana oralig'i va mahsulot bo'yicha filtrlangan kirim/chiqim hisoboti." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <MetricCard label="Jami kirim" value={formatNumber(report.data?.summary.totalIn ?? 0, 1)} helper="Tanlangan davr" icon={ArrowDownToLine} tone="green" />
        <MetricCard label="Jami chiqim" value={formatNumber(report.data?.summary.totalOut ?? 0, 1)} helper="Tanlangan davr" icon={ArrowUpFromLine} tone="rose" />
        <MetricCard label="Sof o'zgarish" value={formatNumber((report.data?.summary.totalIn ?? 0) - (report.data?.summary.totalOut ?? 0), 1)} helper="Kirim − Chiqim" icon={Scale} tone="cyan" />
      </div>

      <SectionCard title="Filtrlar" description="Ikkala jadval ham shu filtrlarga mos yangilanadi" className="mt-5">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <Input type="date" className="finance-input" value={fromDate} onChange={event => setFromDate(event.target.value)} aria-label="Boshlanish sanasi" />
          <Input type="date" className="finance-input" value={toDate} onChange={event => setToDate(event.target.value)} aria-label="Tugash sanasi" />
          <select className="finance-input border px-3 text-muted-foreground" value={productFilter} onChange={event => setProductFilter(event.target.value)}>
            <option value="">Barcha mahsulotlar</option>
            {(products.data ?? []).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
          </select>
          <select className="finance-input border px-3 text-muted-foreground" value={agentFilter} onChange={event => setAgentFilter(event.target.value)}>
            <option value="">Barcha agentlar</option>
            {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <select className="finance-input border px-3 text-muted-foreground" value={movementTypeFilter} onChange={event => setMovementTypeFilter(event.target.value as typeof movementTypeFilter)}>
            <option value="all">Kirim + Chiqim</option>
            <option value="in">Faqat Kirim</option>
            <option value="out">Faqat Chiqim</option>
          </select>
        </div>
        {agentFilter && (
          <p className="mt-3 text-xs text-muted-foreground">
            Agent bo'yicha filtrlanganda faqat shu agentning savdosi orqali yaratilgan chiqim yozuvlari ko'rinadi — qo'lda kiritilgan kirim/chiqimlar agentga bog'liq emas.
          </p>
        )}
        <div className="mt-3"><Button variant="outline" className="gap-2 bg-card" onClick={clearFilters}><RotateCcw className="size-4" />Filtrlarni tozalash</Button></div>
      </SectionCard>

      <SectionCard title="Mahsulot bo'yicha yig'indi" description="Tanlangan davrdagi kirim/chiqim va joriy qoldiq" className="mt-5" action={<ExportMenu onExcel={() => exportSummary("xlsx")} onPdf={() => exportSummary("pdf")} isLoading={isExportingSummary} disabled={report.isLoading} />}>
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
          {report.isLoading ? <TableLoading columns={5} /> : reportRows.length === 0 ? <EmptyState /> : (
            <Table className="finance-table">
              <TableHeader><TableRow><TableHead>Mahsulot</TableHead><TableHead className="text-right">Kirim</TableHead><TableHead className="text-right">Chiqim</TableHead><TableHead className="text-right">Sof o'zgarish</TableHead><TableHead className="text-right">Joriy qoldiq</TableHead></TableRow></TableHeader>
              <TableBody>
                {reportRows.map(row => (
                  <TableRow key={row.productId}>
                    <TableCell className="font-semibold text-foreground">{row.productName}</TableCell>
                    <TableCell className="text-right tabular-nums text-emerald-700">{formatNumber(row.inTotal, 1)} {row.unit}</TableCell>
                    <TableCell className="text-right tabular-nums text-rose-700">{formatNumber(row.outTotal, 1)} {row.unit}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${row.net >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{row.net >= 0 ? "+" : ""}{formatNumber(row.net, 1)}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{formatNumber(row.currentStock, 1)} {row.unit}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SectionCard>

      <SectionCard title="Harakatlar tafsiloti" description="Tanlangan davrdagi barcha kirim/chiqim yozuvlari" className="mt-5" action={<ExportMenu onExcel={() => exportMovements("xlsx")} onPdf={() => exportMovements("pdf")} isLoading={isExportingMovements} disabled={movements.isLoading} />}>
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
          {movements.isLoading ? <TableLoading columns={7} /> : movementRows.length === 0 ? <EmptyState /> : (
            <Table className="finance-table min-w-[900px]">
              <TableHeader><TableRow><TableHead>Sana</TableHead><TableHead>Mahsulot</TableHead><TableHead>Turi</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead>Agent</TableHead><TableHead>Sabab</TableHead><TableHead>Manba</TableHead></TableRow></TableHeader>
              <TableBody>
                {movementRows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.movementDate)}</TableCell>
                    <TableCell className="font-semibold text-foreground">{row.productName ?? "—"}</TableCell>
                    <TableCell>{row.movementType === "in" ? <Badge className="rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Kirim</Badge> : <Badge className="rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50">Chiqim</Badge>}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatNumber(row.quantity, 3)} {row.unit}</TableCell>
                    <TableCell className="text-muted-foreground">{row.agentName ?? "—"}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{row.reason ?? "—"}</TableCell>
                    <TableCell>{row.isAutomatic ? <Badge variant="outline" className="rounded-lg">Savdo</Badge> : <Badge variant="outline" className="rounded-lg">Qo'lda</Badge>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        {movements.data && movements.data.total > movementRows.length && (
          <p className="mt-3 px-1 text-xs text-muted-foreground">Jadvalda so'nggi {movementRows.length} ta yozuv ko'rsatilgan (jami {movements.data.total} ta). To'liq ro'yxat uchun Excel/PDF eksportdan foydalaning.</p>
        )}
      </SectionCard>
    </div>
  );
}
