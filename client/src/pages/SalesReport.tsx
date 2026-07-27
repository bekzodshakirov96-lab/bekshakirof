import { ExportMenu } from "@/components/ExportMenu";
import { EmptyState, PageHeader, PaginationBar, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatNumber, localDateInputValue } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { ArrowDown, ArrowUp, ArrowUpDown, RotateCcw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type TransactionSortBy = "transactionDate" | "agentName" | "clientName" | "productName" | "quantity" | "totalAmount";
type SortOrder = "asc" | "desc";

function containerLabel(value: string | null | undefined) {
  if (!value) return "Tara";
  // Older rows stored the raw enum ("keg_30"), newer ones store the display label ("KEG 30").
  if (/30/.test(value)) return "KEG 30";
  if (/50/.test(value)) return "KEG 50";
  return "Tara";
}

export default function SalesReport() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [clientFilter, setClientFilter] = useState("");
  const [productFilter, setProductFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [sortBy, setSortBy] = useState<TransactionSortBy>("transactionDate");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; label: string } | null>(null);

  const agents = trpc.agents.options.useQuery();
  const clients = trpc.clients.options.useQuery();
  const products = trpc.products.list.useQuery({});
  const filters = useMemo(() => ({
    search: search.trim() || undefined,
    agentId: agentFilter ? Number(agentFilter) : undefined,
    clientId: clientFilter ? Number(clientFilter) : undefined,
    productId: productFilter ? Number(productFilter) : undefined,
    from: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
    to: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined,
    sortBy,
    sortOrder,
  }), [agentFilter, clientFilter, fromDate, productFilter, search, sortBy, sortOrder, toDate]);
  const journal = trpc.transactions.list.useQuery({ ...filters, page, pageSize: 25 });
  /** Foyda butun tanlov bo'yicha hisoblanadi — jurnal esa faqat joriy sahifani ko'rsatadi. */
  const profit = trpc.transactions.profitSummary.useQuery(filters);

  const deleteTransaction = trpc.transactions.delete.useMutation({
    onSuccess: async () => {
      toast.success("Operatsiya o‘chirildi.");
      setDeleteTarget(null);
      await Promise.all([
        utils.transactions.list.invalidate(), utils.dashboard.overview.invalidate(),
        utils.debts.list.invalidate(), utils.containers.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  function changeSort(column: TransactionSortBy) {
    setPage(1);
    if (sortBy === column) setSortOrder(current => current === "asc" ? "desc" : "asc");
    else {
      setSortBy(column);
      setSortOrder(column === "transactionDate" ? "desc" : "asc");
    }
  }

  function clearFilters() {
    setSearch(""); setAgentFilter(""); setClientFilter(""); setProductFilter("");
    setFromDate(""); setToDate(""); setSortBy("transactionDate"); setSortOrder("desc"); setPage(1);
  }

  function filterDescription() {
    const parts: string[] = [];
    if (search.trim()) parts.push(`Qidiruv: ${search.trim()}`);
    if (agentFilter) parts.push(`Agent: ${agents.data?.find(item => item.id === Number(agentFilter))?.name ?? agentFilter}`);
    if (clientFilter) parts.push(`Mijoz: ${clients.data?.find(item => item.id === Number(clientFilter))?.name ?? clientFilter}`);
    if (productFilter) parts.push(`Mahsulot: ${(products.data ?? []).find(item => item.id === Number(productFilter))?.name ?? productFilter}`);
    if (fromDate) parts.push(`Boshlanish: ${fromDate}`);
    if (toDate) parts.push(`Tugash: ${toDate}`);
    return parts.join("; ") || "Barcha operatsiyalar";
  }

  async function exportReport(format: "xlsx" | "pdf") {
    setIsExporting(true);
    try {
      const data = await utils.transactions.exportData.fetch({ ...filters, page: 1, pageSize: 25 });
      type TransactionExportRow = (typeof data.rows)[number];
      const columns: ReportColumn<TransactionExportRow>[] = [
        { title: "Sana", value: row => formatDate(row.transactionDate), width: 48 },
        { title: "Agent", value: row => row.agentName || "—", width: 62 },
        { title: "Mijoz", value: row => row.clientName || "—", width: 75 },
        { title: "Mahsulot", value: row => row.productName, width: "*" },
        { title: "Miqdor", value: row => Number(row.quantity), width: 45, align: "right", numberFormat: "#,##0.000" },
        { title: "Narx", value: row => row.salePrice, width: 52, align: "right" },
        { title: "Jami", value: row => row.totalAmount, width: 58, align: "right" },
        { title: "Naqd", value: row => row.cashPayment, width: 52, align: "right" },
        { title: "Terminal", value: row => row.terminalPayment, width: 52, align: "right" },
        { title: "Click", value: row => row.clickPayment, width: 48, align: "right" },
        { title: "Tara berildi", value: row => row.issuedContainerQuantity ? `${containerLabel(row.issuedContainerType)}: ${row.issuedContainerQuantity}` : "—", width: 58 },
        { title: "Tara qaytdi", value: row => row.returnedContainerQuantity ? `${containerLabel(row.returnedContainerType)}: ${row.returnedContainerQuantity}` : "—", width: 58 },
      ];
      const options = {
        title: "Sotuv bo‘yicha hisobot",
        fileName: `sotuv_hisoboti_${localDateInputValue()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt, filterDescription: filterDescription(),
        summary: [
          { label: "Operatsiyalar", value: data.summary.rowCount },
          { label: "Jami savdo", value: data.summary.totalAmount },
          { label: "Naqd", value: data.summary.cashPayment },
          { label: "Terminal + Click", value: data.summary.terminalPayment + data.summary.clickPayment },
        ],
      };
      if (format === "xlsx") await exportReportXlsx(options);
      else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo‘lmadi.");
    } finally {
      setIsExporting(false);
    }
  }

  function SortableHead({ column, children, className = "" }: { column: TransactionSortBy; children: string; className?: string }) {
    const active = sortBy === column;
    const Icon = !active ? ArrowUpDown : sortOrder === "asc" ? ArrowUp : ArrowDown;
    return <TableHead className={className}><button type="button" onClick={() => changeSort(column)} className={`inline-flex w-full items-center gap-1.5 font-semibold hover:text-primary ${className.includes("text-right") ? "justify-end" : "justify-start"}`}>{children}<Icon className={`size-3.5 ${active ? "text-primary" : "text-muted-foreground"}`} /></button></TableHead>;
  }

  const rows = journal.data?.items ?? [];
  if (journal.error) return <div className="mx-auto w-full max-w-[1650px]"><PageHeader eyebrow="Hisobot" title="Sotuv bo‘yicha hisobot" description="Barcha savdo operatsiyalari jurnali." /><QueryError description={journal.error.message} onRetry={() => journal.refetch()} /></div>;

  return <div className="mx-auto w-full max-w-[1650px]">
    <PageHeader eyebrow="Hisobot" title="Sotuv bo‘yicha hisobot" description="Barcha savdo operatsiyalarini ko‘rish, qidirish, filtrlash va eksport qilish." action={<ExportMenu onExcel={() => exportReport("xlsx")} onPdf={() => exportReport("pdf")} isLoading={isExporting} disabled={journal.isLoading} />} />

    <SectionCard title="Foyda hisobi" description="Tanlangan filter bo‘yicha aylanma, tannarx va foyda.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Aylanma</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatMoney(profit.data?.revenue ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sotilgan tovar tannarxi</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(profit.data?.cost ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Foyda</p>
          <p className={`mt-1 text-lg font-bold tabular-nums ${(profit.data?.profit ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {formatMoney(profit.data?.profit ?? 0)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Foyda foizi</p>
          <p className={`mt-1 text-lg font-bold tabular-nums ${(profit.data?.marginPercent ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {(profit.data?.marginPercent ?? 0).toFixed(1)}%
          </p>
        </div>
      </div>
      {(profit.data?.linesWithoutCost ?? 0) > 0 && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          {profit.data?.linesWithoutCost} ta savdoda ({formatMoney(profit.data?.revenueWithoutCost ?? 0)}) tannarx
          yozilmagan — ular foyda hisobiga kirmadi. Tannarx Sklad → Kirim qo‘shishda “Olingan narx”
          yozilganda paydo bo‘ladi va shundan keyingi savdolarga qo‘llanadi.
        </p>
      )}
    </SectionCard>

    <SectionCard title="Operatsiyalar jurnali" description="Qidiruv, filter va ustun sarlavhalari orqali saralang" className="mt-5">
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(210px,1fr)_160px_180px_180px_145px_145px_auto]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input className="finance-input pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Mijoz, agent yoki mahsulot..." /></div>
        <select className="finance-input border px-3 text-muted-foreground" value={agentFilter} onChange={event => { setAgentFilter(event.target.value); setPage(1); }}><option value="">Barcha agentlar</option>{(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
        <select className="finance-input border px-3 text-muted-foreground" value={clientFilter} onChange={event => { setClientFilter(event.target.value); setPage(1); }}><option value="">Barcha mijozlar</option>{(clients.data ?? []).map(client => <option key={client.id} value={client.id}>{client.code} — {client.name}</option>)}</select>
        <select className="finance-input border px-3 text-muted-foreground" value={productFilter} onChange={event => { setProductFilter(event.target.value); setPage(1); }}><option value="">Barcha mahsulotlar</option>{(products.data ?? []).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
        <Input type="date" className="finance-input" value={fromDate} onChange={event => { setFromDate(event.target.value); setPage(1); }} aria-label="Boshlanish sanasi" />
        <Input type="date" className="finance-input" value={toDate} onChange={event => { setToDate(event.target.value); setPage(1); }} aria-label="Tugash sanasi" />
        <Button variant="outline" className="gap-2 bg-card" onClick={clearFilters}><RotateCcw className="size-4" />Tozalash</Button>
      </div>
      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">{journal.isLoading ? <TableLoading columns={13} /> : rows.length === 0 ? <EmptyState /> : <>
        <Table className="finance-table min-w-[1520px]"><TableHeader><TableRow>
          <SortableHead column="transactionDate">Sana</SortableHead><SortableHead column="agentName">Agent</SortableHead><SortableHead column="clientName">Mijoz</SortableHead><SortableHead column="productName">Mahsulot</SortableHead><SortableHead column="quantity" className="text-right">Miqdor</SortableHead><TableHead className="text-right">Narx</TableHead><SortableHead column="totalAmount" className="text-right">Jami</SortableHead><TableHead className="text-right">Naqd</TableHead><TableHead className="text-right">Terminal</TableHead><TableHead className="text-right">Click</TableHead><TableHead>Tara ta’siri</TableHead><TableHead>Manba</TableHead><TableHead className="w-10" />
        </TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}>
          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.transactionDate)}</TableCell><TableCell>{row.agentName || "—"}</TableCell><TableCell className="font-semibold text-foreground">{row.clientName || "—"}</TableCell><TableCell>{row.productName}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(row.quantity, 3)} {row.unit}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(row.salePrice)}</TableCell><TableCell className="text-right font-bold tabular-nums">{formatMoney(row.totalAmount)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700">{formatMoney(row.cashPayment)}</TableCell><TableCell className="text-right tabular-nums text-violet-700">{formatMoney(row.terminalPayment)}</TableCell><TableCell className="text-right tabular-nums text-cyan-700">{formatMoney(row.clickPayment)}</TableCell>
          <TableCell><div className="space-y-1 text-xs">{row.issuedContainerQuantity > 0 && <div className="font-medium text-rose-700">+ {containerLabel(row.issuedContainerType)}: {row.issuedContainerQuantity}</div>}{row.returnedContainerQuantity > 0 && <div className="font-medium text-emerald-700">− {containerLabel(row.returnedContainerType)}: {row.returnedContainerQuantity}</div>}{row.issuedContainerQuantity === 0 && row.returnedContainerQuantity === 0 && "—"}</div></TableCell>
          <TableCell><Badge variant="outline" className="rounded-lg text-[10px]">{row.source === "excel" ? "Excel" : "Qo‘lda"}</Badge></TableCell>
          <TableCell><button type="button" aria-label="Operatsiyani o‘chirish" className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600" onClick={() => setDeleteTarget({ id: row.id, label: `${row.clientName || "—"} — ${row.productName}` })}><Trash2 className="size-4" /></button></TableCell>
        </TableRow>)}</TableBody></Table><PaginationBar page={journal.data?.page ?? 1} pageCount={journal.data?.pageCount ?? 1} total={journal.data?.total ?? 0} onChange={setPage} />
      </>}</div>
    </SectionCard>

    <Dialog open={Boolean(deleteTarget)} onOpenChange={openState => !openState && setDeleteTarget(null)}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader><DialogTitle>Operatsiyani o‘chirish</DialogTitle><DialogDescription>
          <strong className="text-foreground">{deleteTarget?.label}</strong> operatsiyasini o‘chirmoqchimisiz? Bog‘liq tara harakati yozuvi ham birga o‘chadi. Bu amalni ortga qaytarib bo‘lmaydi.
        </DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDeleteTarget(null)}>Bekor qilish</Button>
          <Button
            className="bg-rose-600 hover:bg-rose-700"
            disabled={deleteTransaction.isPending}
            onClick={() => deleteTarget && deleteTransaction.mutate({ id: deleteTarget.id })}
          >
            {deleteTransaction.isPending ? "O‘chirilmoqda..." : "Ha, o‘chirish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
