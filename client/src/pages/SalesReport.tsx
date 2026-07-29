import { ExportMenu } from "@/components/ExportMenu";
import { EmptyState, PageHeader, PaginationBar, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatNumber, localDateInputValue, sanitizeDecimalInput, sanitizeIntegerInput } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { ArrowDown, ArrowUp, ArrowUpDown, Pencil, RotateCcw, Search, Trash2 } from "lucide-react";
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

/** Eski yozuvlarda "KEG 30" kabi ko'rinish nomi, yangilarida "keg_30" kodi saqlangan bo'lishi mumkin. */
function normalizeContainerTypeValue(value: string | null | undefined): "keg_30" | "keg_50" | "" {
  if (!value) return "";
  if (/30/.test(value)) return "keg_30";
  if (/50/.test(value)) return "keg_50";
  return "";
}

type EditTransactionForm = {
  id: number;
  date: string;
  agentId: string;
  clientId: string;
  productId: string;
  quantity: string;
  salePrice: string;
  cashPayment: string;
  terminalPayment: string;
  clickPayment: string;
  transferPayment: string;
  note: string;
  returnEnabled: boolean;
  returnContainerType: "keg_30" | "keg_50" | "";
  returnQuantity: string;
};

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
  const [editTarget, setEditTarget] = useState<EditTransactionForm | null>(null);

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

  const updateTransaction = trpc.transactions.update.useMutation({
    onSuccess: async () => {
      toast.success("Operatsiya yangilandi.");
      setEditTarget(null);
      await Promise.all([
        utils.transactions.list.invalidate(), utils.dashboard.overview.invalidate(),
        utils.debts.list.invalidate(), utils.containers.invalidate(), utils.stock.invalidate(),
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
        { title: "Перечисление", value: row => row.transferPayment, width: 62, align: "right" },
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
          { label: "Перечисление", value: data.summary.transferPayment },
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

    <SectionCard title="Foyda–zarar hisobi" description="Aylanmadan tannarx, so‘ng operatsion xarajatlar ayirilib sof foyda chiqadi.">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Aylanma</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatMoney(profit.data?.revenue ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">− Sotilgan tovar tannarxi</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(profit.data?.cost ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">= Yalpi foyda</p>
          <p className={`mt-1 text-lg font-bold tabular-nums ${(profit.data?.grossProfit ?? 0) >= 0 ? "text-foreground" : "text-rose-600 dark:text-rose-400"}`}>
            {formatMoney(profit.data?.grossProfit ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Xarajatlar ayirilmagan</p>
        </div>
      </div>

      {profit.data?.expensesApplicable === false ? (
        <p className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
          Agent, mijoz yoki mahsulot bo‘yicha filtr qo‘yilgan. Ish haqi, ijara va shunga o‘xshash
          xarajatlarni bitta agent yoki mijozga bo‘lib bo‘lmaydi — shuning uchun sof foyda faqat
          sana bo‘yicha (yoki filtrsiz) ko‘rsatiladi.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl border border-border bg-muted/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">− Operatsion xarajatlar</p>
            <p className="mt-1 text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(profit.data?.operatingExpenses ?? 0)}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Ish haqi, ijara, gaz, transport…</p>
          </div>
          <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">= Sof foyda</p>
            <p className={`mt-1 text-xl font-bold tabular-nums ${(profit.data?.netProfit ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {formatMoney(profit.data?.netProfit ?? 0)}
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-muted/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sof foyda foizi</p>
            <p className={`mt-1 text-lg font-bold tabular-nums ${(profit.data?.netMarginPercent ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
              {(profit.data?.netMarginPercent ?? 0).toFixed(1)}%
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">Aylanmaga nisbatan</p>
          </div>
        </div>
      )}

      {(profit.data?.excludedGoodsPayments ?? 0) > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Zavodga tovar uchun to‘langan {formatMoney(profit.data?.excludedGoodsPayments ?? 0)} xarajatlarga
          qo‘shilmadi — u summa tovar tannarxida allaqachon hisobga olingan (aks holda bir pul ikki
          marta ayirilardi).
        </p>
      )}
      {(profit.data?.linesWithoutCost ?? 0) > 0 && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          {profit.data?.linesWithoutCost} ta savdoda ({formatMoney(profit.data?.revenueWithoutCost ?? 0)}) tannarx
          yozilmagan — ular yalpi foyda hisobiga kirmadi, shuning uchun sof foyda ham to‘liq emas.
          Tannarx Sklad → Kirim qo‘shishda “Olingan narx” yozilganda paydo bo‘ladi va shundan keyingi
          savdolarga qo‘llanadi.
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
      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">{journal.isLoading ? <TableLoading columns={14} /> : rows.length === 0 ? <EmptyState /> : <>
        <Table className="finance-table min-w-[1620px]"><TableHeader><TableRow>
          <SortableHead column="transactionDate">Sana</SortableHead><SortableHead column="agentName">Agent</SortableHead><SortableHead column="clientName">Mijoz</SortableHead><SortableHead column="productName">Mahsulot</SortableHead><SortableHead column="quantity" className="text-right">Miqdor</SortableHead><TableHead className="text-right">Narx</TableHead><SortableHead column="totalAmount" className="text-right">Jami</SortableHead><TableHead className="text-right">Naqd</TableHead><TableHead className="text-right">Terminal</TableHead><TableHead className="text-right">Click</TableHead><TableHead className="text-right">Перечисление</TableHead><TableHead>Tara ta’siri</TableHead><TableHead>Manba</TableHead><TableHead className="w-10" />
        </TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}>
          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.transactionDate)}</TableCell><TableCell>{row.agentName || "—"}</TableCell><TableCell className="font-semibold text-foreground">{row.clientName || "—"}</TableCell><TableCell>{row.productName}</TableCell><TableCell className="text-right tabular-nums">{formatNumber(row.quantity, 3)} {row.unit}</TableCell><TableCell className="text-right tabular-nums">{formatMoney(row.salePrice)}</TableCell><TableCell className="text-right font-bold tabular-nums">{formatMoney(row.totalAmount)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700">{formatMoney(row.cashPayment)}</TableCell><TableCell className="text-right tabular-nums text-violet-700">{formatMoney(row.terminalPayment)}</TableCell><TableCell className="text-right tabular-nums text-cyan-700">{formatMoney(row.clickPayment)}</TableCell><TableCell className="text-right tabular-nums text-indigo-700">{formatMoney(row.transferPayment)}</TableCell>
          <TableCell><div className="space-y-1 text-xs">{row.issuedContainerQuantity > 0 && <div className="font-medium text-rose-700">+ {containerLabel(row.issuedContainerType)}: {row.issuedContainerQuantity}</div>}{row.returnedContainerQuantity > 0 && <div className="font-medium text-emerald-700">− {containerLabel(row.returnedContainerType)}: {row.returnedContainerQuantity}</div>}{row.issuedContainerQuantity === 0 && row.returnedContainerQuantity === 0 && "—"}</div></TableCell>
          <TableCell><Badge variant="outline" className="rounded-lg text-[10px]">{row.source === "excel" ? "Excel" : "Qo‘lda"}</Badge></TableCell>
          <TableCell>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Operatsiyani tahrirlash"
                title="Tahrirlash"
                className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary"
                onClick={() => setEditTarget({
                  id: row.id,
                  date: localDateInputValue(new Date(row.transactionDate)),
                  agentId: row.agentId ? String(row.agentId) : "",
                  clientId: row.clientId ? String(row.clientId) : "",
                  productId: row.productId ? String(row.productId) : "",
                  quantity: String(row.quantity),
                  salePrice: String(row.salePrice),
                  cashPayment: String(row.cashPayment),
                  terminalPayment: String(row.terminalPayment),
                  clickPayment: String(row.clickPayment),
                  transferPayment: String(row.transferPayment),
                  note: row.note ?? "",
                  returnEnabled: row.returnedContainerQuantity > 0,
                  returnContainerType: normalizeContainerTypeValue(row.returnedContainerType),
                  returnQuantity: String(row.returnedContainerQuantity || 0),
                })}
              >
                <Pencil className="size-4" />
              </button>
              <button type="button" aria-label="Operatsiyani o‘chirish" className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600" onClick={() => setDeleteTarget({ id: row.id, label: `${row.clientName || "—"} — ${row.productName}` })}><Trash2 className="size-4" /></button>
            </div>
          </TableCell>
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

    <Dialog open={Boolean(editTarget)} onOpenChange={openState => !openState && setEditTarget(null)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader><DialogTitle>Operatsiyani tahrirlash</DialogTitle><DialogDescription>Savdo yozuvining barcha maydonlarini yangilang.</DialogDescription></DialogHeader>
        {editTarget && (
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2"><Label>Sana</Label><Input className="finance-input" type="date" value={editTarget.date} onChange={event => setEditTarget({ ...editTarget, date: event.target.value })} /></div>
            <div className="space-y-2">
              <Label>Agent</Label>
              <select className="finance-input w-full border px-3" value={editTarget.agentId} onChange={event => setEditTarget({ ...editTarget, agentId: event.target.value })}>
                <option value="">Tanlang</option>
                {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Mijoz</Label>
              <select className="finance-input w-full border px-3" value={editTarget.clientId} onChange={event => setEditTarget({ ...editTarget, clientId: event.target.value })}>
                <option value="">Tanlang</option>
                {(clients.data ?? []).map(client => <option key={client.id} value={client.id}>{client.code} — {client.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Mahsulot</Label>
              <select className="finance-input w-full border px-3" value={editTarget.productId} onChange={event => setEditTarget({ ...editTarget, productId: event.target.value })}>
                <option value="">Tanlang</option>
                {(products.data ?? []).filter(product => !product.containerType).map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </div>
            <div className="space-y-2"><Label>Miqdor</Label><Input className="finance-input" type="text" inputMode="decimal" value={editTarget.quantity} onChange={event => setEditTarget({ ...editTarget, quantity: sanitizeDecimalInput(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Narx</Label><Input className="finance-input" type="text" inputMode="numeric" value={editTarget.salePrice} onChange={event => setEditTarget({ ...editTarget, salePrice: sanitizeIntegerInput(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Naqd to‘lov</Label><Input className="finance-input" type="text" inputMode="numeric" value={editTarget.cashPayment} onChange={event => setEditTarget({ ...editTarget, cashPayment: sanitizeIntegerInput(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Terminal</Label><Input className="finance-input" type="text" inputMode="numeric" value={editTarget.terminalPayment} onChange={event => setEditTarget({ ...editTarget, terminalPayment: sanitizeIntegerInput(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Click</Label><Input className="finance-input" type="text" inputMode="numeric" value={editTarget.clickPayment} onChange={event => setEditTarget({ ...editTarget, clickPayment: sanitizeIntegerInput(event.target.value) })} /></div>
            <div className="space-y-2"><Label>Перечисление</Label><Input className="finance-input" type="text" inputMode="numeric" value={editTarget.transferPayment} onChange={event => setEditTarget({ ...editTarget, transferPayment: sanitizeIntegerInput(event.target.value) })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Izoh</Label><Input className="finance-input" value={editTarget.note} onChange={event => setEditTarget({ ...editTarget, note: event.target.value })} placeholder="Ixtiyoriy" /></div>
            <div className="space-y-2 sm:col-span-2">
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input type="checkbox" checked={editTarget.returnEnabled} onChange={event => setEditTarget({ ...editTarget, returnEnabled: event.target.checked, returnContainerType: editTarget.returnContainerType || "keg_30" })} className="h-4 w-4 accent-primary" />
                Mijoz tara qaytardi
              </label>
              {editTarget.returnEnabled && (
                <div className="mt-2 flex items-center gap-2">
                  <select className="finance-input h-9 border px-2" value={editTarget.returnContainerType} onChange={event => setEditTarget({ ...editTarget, returnContainerType: event.target.value as "keg_30" | "keg_50" })}>
                    <option value="keg_30">KEG 30</option>
                    <option value="keg_50">KEG 50</option>
                  </select>
                  <Input className="finance-input h-9 w-24 text-right" type="text" inputMode="numeric" value={editTarget.returnQuantity} onChange={event => setEditTarget({ ...editTarget, returnQuantity: sanitizeIntegerInput(event.target.value) })} />
                </div>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditTarget(null)}>Bekor qilish</Button>
          <Button
            disabled={
              !editTarget ||
              !editTarget.agentId || !editTarget.clientId || !editTarget.productId ||
              Number(editTarget.quantity || 0) <= 0 ||
              updateTransaction.isPending
            }
            onClick={() => {
              if (!editTarget) return;
              updateTransaction.mutate({
                id: editTarget.id,
                transactionDate: new Date(`${editTarget.date}T12:00:00`).getTime(),
                agentId: Number(editTarget.agentId),
                clientId: Number(editTarget.clientId),
                productId: Number(editTarget.productId),
                quantity: Number(editTarget.quantity),
                salePrice: Math.round(Number(editTarget.salePrice || 0)),
                cashPayment: Math.round(Number(editTarget.cashPayment || 0)),
                terminalPayment: Math.round(Number(editTarget.terminalPayment || 0)),
                clickPayment: Math.round(Number(editTarget.clickPayment || 0)),
                transferPayment: Math.round(Number(editTarget.transferPayment || 0)),
                returnContainerType: editTarget.returnEnabled && editTarget.returnContainerType ? editTarget.returnContainerType : null,
                returnQuantity: editTarget.returnEnabled ? Math.round(Number(editTarget.returnQuantity || 0)) : 0,
                note: editTarget.note || null,
              });
            }}
          >
            {updateTransaction.isPending ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
