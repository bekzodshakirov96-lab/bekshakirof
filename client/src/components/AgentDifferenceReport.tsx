import { EmptyState, MetricCard, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { ExportMenu } from "@/components/ExportMenu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber, formatTashkentDate, tashkentDateInputValue, tashkentDayBoundary } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { Calculator, Check, ChevronDown, ChevronsUpDown, HandCoins, RotateCcw, Scale, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const currentMonthStart = () => `${tashkentDateInputValue().slice(0, 7)}-01`;

function signedMoney(value: number) {
  if (value === 0) return formatMoney(0);
  return `${value > 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`;
}

export function AgentDifferenceReport() {
  const [fromDate, setFromDate] = useState(currentMonthStart());
  const [toDate, setToDate] = useState(tashkentDateInputValue());
  const [selectedAgentIds, setSelectedAgentIds] = useState<number[] | null>(null);
  const [detailAgentId, setDetailAgentId] = useState<number | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [isExportingHistory, setIsExportingHistory] = useState(false);
  const agentsQuery = trpc.kassa.report.agentDifferenceOptions.useQuery();
  const agentList = agentsQuery.data ?? [];
  const normalizedAgentIds = useMemo(
    () => selectedAgentIds === null ? undefined : [...selectedAgentIds].sort((a, b) => a - b),
    [selectedAgentIds],
  );
  const datesValid = Boolean(fromDate && toDate && fromDate <= toDate);
  const differenceQuery = trpc.kassa.report.agentDifferenceSummary.useQuery(
    { fromDate, toDate, agentIds: normalizedAgentIds },
    { enabled: datesValid },
  );
  const historyInput = useMemo(() => ({
    from: tashkentDayBoundary(fromDate),
    to: tashkentDayBoundary(toDate, true),
    agentIds: normalizedAgentIds,
  }), [fromDate, toDate, normalizedAgentIds]);
  useEffect(() => setHistoryPage(1), [fromDate, toDate, normalizedAgentIds]);
  const historyQuery = trpc.kassa.report.agentReconciliation.useQuery(
    { ...historyInput, page: historyPage, pageSize: 50 },
    { enabled: datesValid },
  );
  const utils = trpc.useUtils();

  const selectedSet = useMemo(
    () => new Set(selectedAgentIds === null ? agentList.map(agent => agent.id) : selectedAgentIds),
    [agentList, selectedAgentIds],
  );
  const selectedCount = selectedAgentIds === null ? agentList.length : selectedAgentIds.length;
  const allSelected = agentList.length > 0 && selectedCount === agentList.length;
  const data = differenceQuery.data;
  const detailAgent = data?.agents.find(agent => agent.agentId === detailAgentId);
  useEffect(() => {
    if (detailAgentId !== null && !data?.agents.some(agent => agent.agentId === detailAgentId)) setDetailAgentId(null);
  }, [data?.agents, detailAgentId]);

  function toggleAgent(agentId: number) {
    const next = new Set(selectedAgentIds === null ? agentList.map(agent => agent.id) : selectedAgentIds);
    if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
    setSelectedAgentIds(Array.from(next));
  }

  function resetPeriod() {
    setFromDate(currentMonthStart());
    setToDate(tashkentDateInputValue());
    setSelectedAgentIds(null);
  }

  async function exportHistory(format: "xlsx" | "pdf") {
    setIsExportingHistory(true);
    try {
      const data = await utils.kassa.report.agentReconciliation.fetch(historyInput);
      type Row = (typeof data.rows)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Sana", value: row => formatTashkentDate(row.entryDate), width: 50 },
        { title: "Agent", value: row => row.agentName, width: "*" },
        { title: "Hisoblangan", value: row => row.computedAmount, width: 65, align: "right" },
        { title: "Kassa orqali yopilgan", value: row => row.submittedAmount, width: 65, align: "right" },
        { title: "Farq", value: row => row.farq, width: 65, align: "right" },
      ];
      const options = {
        title: "Agent solishtirish tarixi",
        fileName: `agent_solishtirish_${tashkentDateInputValue()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt,
        filterDescription: `${fromDate} — ${toDate}`,
        summary: [
          { label: "Hisoblangan", value: data.totals.computedAmount },
          { label: "Kassa orqali yopilgan", value: data.totals.submittedAmount },
          { label: "Farq", value: data.totals.farq },
        ],
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo‘lmadi.");
    } finally {
      setIsExportingHistory(false);
    }
  }

  return (
    <SectionCard
      title="Agentlar raznitsasi"
      description="Agent × Tovar bo‘yicha hisoblangan summa va Kassa orqali yopilgan tushumni tanlangan davrda solishtirish"
      className="mt-5"
    >
      <div className="grid gap-3 rounded-xl border border-border bg-muted/25 p-4 md:grid-cols-2 xl:grid-cols-[180px_180px_minmax(260px,1fr)_auto] xl:items-end">
        <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">
          Boshlanish sanasi
          <Input
            type="date"
            className="finance-input bg-card"
            value={fromDate}
            max={toDate || undefined}
            onChange={event => setFromDate(event.target.value)}
          />
        </label>
        <label className="space-y-1.5 text-xs font-semibold text-muted-foreground">
          Tugash sanasi
          <Input
            type="date"
            className="finance-input bg-card"
            value={toDate}
            min={fromDate || undefined}
            onChange={event => setToDate(event.target.value)}
          />
        </label>
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-muted-foreground">Agentlar</p>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full justify-between bg-card px-3 font-normal"
                aria-label="Hisobot uchun agentlarni tanlash"
              >
                <span className="truncate">
                  {selectedCount === 0
                    ? "Agent tanlanmagan"
                    : allSelected
                      ? `Barcha agentlar (${agentList.length})`
                      : `${selectedCount} ta agent tanlandi`}
                </span>
                <ChevronsUpDown className="size-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[320px] p-0">
              <Command>
                <CommandInput placeholder="Agentni qidirish..." />
                <CommandList>
                  <CommandEmpty>Agent topilmadi.</CommandEmpty>
                  <CommandGroup heading="Agentlar">
                    {agentList.map(agent => (
                      <CommandItem key={agent.id} value={agent.name} onSelect={() => toggleAgent(agent.id)}>
                        <span className={`grid size-4 place-items-center rounded border ${selectedSet.has(agent.id) ? "border-primary bg-primary text-primary-foreground" : "border-input"}`}>
                          {selectedSet.has(agent.id) ? <Check className="size-3" /> : null}
                        </span>
                        <span className="truncate">{agent.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandSeparator />
                  <div className="grid grid-cols-2 gap-2 p-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedAgentIds(null)}>Barchasini tanlash</Button>
                    <Button type="button" variant="outline" size="sm" onClick={() => setSelectedAgentIds([])}>Tanlovni tozalash</Button>
                  </div>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <Button type="button" variant="outline" className="h-10 bg-card" onClick={resetPeriod}>
          <RotateCcw className="size-4" /> Shu oy
        </Button>
      </div>

      {!datesValid ? (
        <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
          Boshlanish sanasi tugash sanasidan keyin bo‘lishi mumkin emas.
        </p>
      ) : null}

      {differenceQuery.error ? (
        <div className="mt-4"><QueryError description={differenceQuery.error.message} onRetry={() => differenceQuery.refetch()} /></div>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Hisoblangan" value={formatMoney(data?.computedTotal, true)} helper="Agent × Tovar jami" icon={Calculator} tone="blue" />
            <MetricCard label="Kassa orqali yopilgan" value={formatMoney(data?.submittedTotal, true)} helper="Naqd va elektron tushum" icon={HandCoins} tone="green" />
            <MetricCard
              label="Sof raznitsa"
              value={signedMoney(data?.netDifference ?? 0)}
              helper={(data?.netDifference ?? 0) > 0 ? "Topshirilmagan summa" : (data?.netDifference ?? 0) < 0 ? "Ortiqcha yopilgan summa" : "To‘liq mos"}
              icon={Scale}
              tone={(data?.netDifference ?? 0) > 0 ? "rose" : (data?.netDifference ?? 0) < 0 ? "amber" : "green"}
            />
            <MetricCard label="Jami nomoslik" value={formatMoney(data?.mismatchTotal, true)} helper="Kamomad va ortiqcha jami" icon={TriangleAlert} tone={(data?.mismatchTotal ?? 0) === 0 ? "green" : "rose"} />
          </div>

          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>Kamomad: <strong className="text-rose-600">{formatMoney(data?.deficitTotal)}</strong></span>
            <span>Ortiqcha: <strong className="text-amber-600">{formatMoney(data?.excessTotal)}</strong></span>
            <span>Raznitsa = hisoblangan − yopilgan</span>
          </div>

          <div className="-mx-5 mt-4 overflow-hidden border-t border-border">
            {differenceQuery.isLoading || agentsQuery.isLoading ? (
              <TableLoading columns={4} rows={5} />
            ) : (data?.agents.length ?? 0) === 0 ? (
              <EmptyState description={selectedCount === 0 ? "Hisobot uchun kamida bitta agent tanlang." : "Tanlangan davrda agentlar bo‘yicha ma’lumot topilmadi."} />
            ) : (
              <Table className="finance-table min-w-[760px]">
                <TableHeader><TableRow>
                  <TableHead>Agent · tafsilotni ochish</TableHead>
                  <TableHead className="text-right">Hisoblangan</TableHead>
                  <TableHead className="text-right">Kassa orqali yopilgan</TableHead>
                  <TableHead className="text-right">Raznitsa</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {data!.agents.map(row => (
                    <TableRow key={row.agentId}>
                      <TableCell className="font-semibold text-foreground"><button type="button" className="inline-flex items-center gap-2 rounded px-1 py-1 text-left hover:text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-expanded={detailAgentId === row.agentId} aria-controls="agent-product-details" onClick={() => setDetailAgentId(current => current === row.agentId ? null : row.agentId)}><ChevronDown className={`size-4 transition-transform ${detailAgentId === row.agentId ? "rotate-180" : ""}`} />{row.agentName}</button></TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.computedAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.submittedAmount)}</TableCell>
                      <TableCell className="text-right">
                        {row.difference === 0 ? (
                          <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">Mos</Badge>
                        ) : (
                          <Badge variant="outline" className={row.difference > 0
                            ? "border-rose-200 bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300"
                            : "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"}>
                            {signedMoney(row.difference)}
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
          {detailAgent && <AgentProductDetails key={detailAgent.agentId} agentId={detailAgent.agentId} agentName={detailAgent.agentName} fromDate={fromDate} toDate={toDate} onClose={() => setDetailAgentId(null)} />}
          <div className="mt-9 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
            <div><h3 className="font-semibold">Kunlik solishtirish tarixi</h3><p className="text-xs text-muted-foreground">Yuqoridagi sana va agent tanlovi bo‘yicha</p></div>
            <ExportMenu onExcel={() => exportHistory("xlsx")} onPdf={() => exportHistory("pdf")} isLoading={isExportingHistory} disabled={!datesValid || historyQuery.isLoading} />
          </div>
          {historyQuery.error ? <div className="mt-3"><QueryError description={historyQuery.error.message} onRetry={() => historyQuery.refetch()} /></div> : null}
          {!historyQuery.error && <div className="-mx-5 mt-4 overflow-hidden border-y border-border">
            {historyQuery.isLoading ? <TableLoading columns={5} /> : (historyQuery.data?.rows.length ?? 0) === 0 ? <EmptyState description="Tanlangan davrda kunlik yozuv topilmadi." /> : (
              <Table containerClassName="max-h-[620px] overflow-y-auto" className="finance-table min-w-[800px]"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
                <TableHead>Sana</TableHead><TableHead>Agent</TableHead><TableHead className="text-right">Hisoblangan</TableHead><TableHead className="text-right">Kassa orqali yopilgan</TableHead><TableHead className="text-right">Farq</TableHead>
              </TableRow></TableHeader><TableBody>
                {historyQuery.data!.rows.map(row => <TableRow key={`${row.agentId}-${formatTashkentDate(row.entryDate)}`}>
                  <TableCell>{formatTashkentDate(row.entryDate)}</TableCell>
                  <TableCell className="font-semibold">{row.agentName}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(row.computedAmount)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(row.submittedAmount)}</TableCell>
                  <TableCell className="text-right">{row.farq === 0 ? <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700">Mos</Badge> : <Badge variant="outline" className={row.farq > 0 ? "border-rose-200 bg-rose-50 text-rose-700" : "border-amber-200 bg-amber-50 text-amber-700"}>{row.farq > 0 ? "Kamomad " : "Ortiqcha "}{signedMoney(row.farq)}</Badge>}</TableCell>
                </TableRow>)}
              </TableBody></Table>
            )}
          </div>}
          {!historyQuery.error && historyQuery.data && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm"><span>Hisoblangan: <strong>{formatMoney(historyQuery.data.totals.computedAmount)}</strong> · Yopilgan: <strong>{formatMoney(historyQuery.data.totals.submittedAmount)}</strong> · Farq: <strong>{signedMoney(historyQuery.data.totals.farq)}</strong></span><div className="flex items-center gap-2 text-xs"><span>{historyPage}/{Math.max(1, Math.ceil(historyQuery.data.total / 50))} · {historyQuery.data.total} yozuv</span><Button variant="outline" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage(p => p - 1)}>Oldingi</Button><Button variant="outline" size="sm" disabled={historyPage * 50 >= historyQuery.data.total} onClick={() => setHistoryPage(p => p + 1)}>Keyingi</Button></div></div>}
        </>
      )}
    </SectionCard>
  );
}

function AgentProductDetails({ agentId, agentName, fromDate, toDate, onClose }: {
  agentId: number;
  agentName: string;
  fromDate: string;
  toDate: string;
  onClose: () => void;
}) {
  const [productFilter, setProductFilter] = useState("");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const products = trpc.products.list.useQuery({});
  const utils = trpc.useUtils();
  const filters = {
    from: tashkentDayBoundary(fromDate),
    to: tashkentDayBoundary(toDate, true),
    agentId,
    productId: productFilter ? Number(productFilter) : undefined,
  };
  useEffect(() => setPage(1), [fromDate, toDate, productFilter]);
  const query = trpc.kassa.report.agentTakingDetails.useQuery(
    { ...filters, page, pageSize: 50 },
    { enabled: Boolean(fromDate && toDate && fromDate <= toDate) },
  );
  const pageCount = Math.max(1, Math.ceil((query.data?.total ?? 0) / 50));

  async function exportDetails(format: "xlsx" | "pdf") {
    setIsExporting(true);
    try {
      const data = await utils.kassa.report.agentTakingDetails.fetch(filters);
      type Row = (typeof data.rows)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Sana", value: row => formatTashkentDate(row.entryDate), width: 48 },
        { title: "Agent", value: row => row.agentName, width: 70 },
        { title: "Mahsulot", value: row => row.productName, width: "*" },
        { title: "Miqdor", value: row => Number(row.quantity), width: 45, align: "right", numberFormat: "#,##0.000" },
        { title: "Birlik", value: row => row.productUnit || "—", width: 35 },
        { title: "Narx", value: row => row.unitPrice, width: 52, align: "right" },
        { title: "Summa", value: row => row.amount, width: 58, align: "right" },
      ];
      const options = {
        title: `${agentName} — tovar tafsilotlari`,
        fileName: `agent_tovar_${agentId}_${tashkentDateInputValue()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt,
        filterDescription: `${fromDate} — ${toDate}`,
        summary: [{ label: "Jami summa", value: data.totalAmount }],
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Tafsilotlarni eksport qilib bo‘lmadi.");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section id="agent-product-details" className="mt-5 rounded-xl border border-border bg-muted/20 p-4" aria-label={`${agentName} tovar tafsilotlari`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-foreground">{agentName} — tovarlar bo‘yicha tafsilotlar</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{fromDate} — {toDate} · agent qaysi mahsulotdan qancha olgan</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu onExcel={() => exportDetails("xlsx")} onPdf={() => exportDetails("pdf")} isLoading={isExporting} disabled={query.isLoading || !!query.error} />
          <Button type="button" variant="outline" size="icon" className="bg-card" onClick={onClose} aria-label="Tafsilotlarni yopish"><X className="size-4" /></Button>
        </div>
      </div>
      <select className="finance-input mt-4 w-full max-w-xs border bg-card px-3 text-muted-foreground" value={productFilter} onChange={event => setProductFilter(event.target.value)} aria-label="Tafsilotlarda mahsulotni tanlash">
        <option value="">Barcha mahsulotlar</option>
        {(products.data ?? []).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
      </select>
      <div className="mt-4 overflow-hidden rounded-lg border border-border bg-card">
        {query.error ? <QueryError description={query.error.message} onRetry={() => query.refetch()} /> : query.isLoading ? <TableLoading columns={5} /> : (query.data?.rows.length ?? 0) === 0 ? <EmptyState description="Bu agent uchun tanlangan davrda mahsulot yozuvi topilmadi." /> : (
          <Table containerClassName="max-h-[520px] overflow-y-auto" className="finance-table min-w-[700px]"><TableHeader className="sticky top-0 z-10 bg-card"><TableRow>
            <TableHead>Sana</TableHead><TableHead>Mahsulot</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead className="text-right">Narx</TableHead><TableHead className="text-right">Summa</TableHead>
          </TableRow></TableHeader><TableBody>
            {query.data!.rows.map(row => <TableRow key={row.id}>
              <TableCell className="text-muted-foreground">{formatTashkentDate(row.entryDate)}</TableCell>
              <TableCell className="font-medium text-foreground">{row.productName}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.quantity, 3)} {row.productUnit || ""}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(row.unitPrice)}</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatMoney(row.amount)}</TableCell>
            </TableRow>)}
          </TableBody></Table>
        )}
      </div>
      {!query.error && query.data && <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
        <strong>Jami summa: {formatMoney(query.data.totalAmount)}</strong>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{page}/{pageCount} sahifa · {query.data.total} yozuv</span>
          <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Oldingi</Button>
          <Button type="button" variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(value => value + 1)}>Keyingi</Button>
        </div>
      </div>}
    </section>
  );
}
