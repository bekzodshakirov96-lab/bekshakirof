import { ExportMenu } from "@/components/ExportMenu";
import { ClientStatementDialog } from "@/components/ClientStatementDialog";
import { DebtBadge, EmptyState, MetricCard, PageHeader, PaginationBar, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, localDateInputValue, sanitizeIntegerInput, tashkentDateInputValue, tashkentDateToTimestamp, formatTashkentDate } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { Archive, ArrowDown, ArrowUp, ArrowUpDown, Banknote, CircleDollarSign, FileText, HandCoins, RotateCcw, Search, Trash2, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type DebtSortBy = "code" | "name" | "agentName" | "openingDebt" | "totalSales" | "totalPaid" | "currentDebt";
type SortOrder = "asc" | "desc";

const statusLabels = {
  all: "Barcha holatlar",
  debt: "Qarzdorlar",
  clear: "Qarzi yopilgan",
  credit: "Haqdorlar",
} as const;

export default function Debts() {
  const [search, setSearch] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState<keyof typeof statusLabels>("all");
  const [minDebt, setMinDebt] = useState("");
  const [maxDebt, setMaxDebt] = useState("");
  const [sortBy, setSortBy] = useState<DebtSortBy>("currentDebt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [isExporting, setIsExporting] = useState(false);
  const [statementClient, setStatementClient] = useState<{ id: number; name: string } | null>(null);
  const [paymentClient, setPaymentClient] = useState<{ id: number; name: string; currentDebt: number } | null>(null);
  const agents = trpc.agents.options.useQuery();
  const utils = trpc.useUtils();

  const filters = useMemo(() => ({
    search: search.trim() || undefined,
    agentId: agentId ? Number(agentId) : undefined,
    status,
    minDebt: minDebt === "" ? undefined : Number(minDebt),
    maxDebt: maxDebt === "" ? undefined : Number(maxDebt),
    sortBy,
    sortOrder,
  }), [agentId, maxDebt, minDebt, search, sortBy, sortOrder, status]);

  const debts = trpc.debts.list.useQuery({ ...filters, page, pageSize: 25 });
  const items = debts.data?.items ?? [];
  const summary = debts.data?.summary;

  function changeSort(column: DebtSortBy) {
    setPage(1);
    if (sortBy === column) setSortOrder(current => current === "asc" ? "desc" : "asc");
    else {
      setSortBy(column);
      setSortOrder(column === "code" || column === "name" || column === "agentName" ? "asc" : "desc");
    }
  }

  function clearFilters() {
    setSearch("");
    setAgentId("");
    setStatus("all");
    setMinDebt("");
    setMaxDebt("");
    setSortBy("currentDebt");
    setSortOrder("desc");
    setPage(1);
  }

  function filterDescription() {
    const parts: string[] = [];
    if (search.trim()) parts.push(`Qidiruv: ${search.trim()}`);
    if (agentId) parts.push(`Agent: ${agents.data?.find(agent => agent.id === Number(agentId))?.name ?? agentId}`);
    if (status !== "all") parts.push(`Holat: ${statusLabels[status]}`);
    if (minDebt !== "") parts.push(`Minimal qarz: ${Number(minDebt).toLocaleString("uz-UZ")}`);
    if (maxDebt !== "") parts.push(`Maksimal qarz: ${Number(maxDebt).toLocaleString("uz-UZ")}`);
    return parts.join("; ") || "Barcha mijozlar";
  }

  async function exportReport(format: "xlsx" | "pdf") {
    setIsExporting(true);
    try {
      const data = await utils.debts.exportData.fetch(filters);
      type DebtExportRow = (typeof data.rows)[number];
      const columns: ReportColumn<DebtExportRow>[] = [
        { title: "Mijoz kodi", value: row => row.code, width: 48 },
        { title: "Mijoz", value: row => row.name, width: "*" },
        { title: "Agent", value: row => row.agentName || "—", width: 70 },
        { title: "Boshlang‘ich qarz", value: row => row.openingDebt, width: 65, align: "right" },
        { title: "Jami savdo", value: row => row.totalSales, width: 62, align: "right" },
        { title: "Naqd", value: row => row.cashReceived, width: 58, align: "right" },
        { title: "Terminal", value: row => row.terminalReceived, width: 58, align: "right" },
        { title: "Click", value: row => row.clickReceived, width: 55, align: "right" },
        { title: "Перечисление", value: row => row.transferReceived, width: 60, align: "right" },
        { title: "Qoldiq qarz", value: row => row.currentDebt, width: 65, align: "right" },
      ];
      const options = {
        title: "Mijozlar qarzdorligi hisoboti",
        fileName: `qarzdorlik_${localDateInputValue()}`,
        rows: data.rows,
        columns,
        generatedAt: data.generatedAt,
        filterDescription: filterDescription(),
        summary: [
          { label: "Mijozlar", value: data.summary.clientCount },
          { label: "Qarzdorlar", value: data.summary.debtorCount },
          { label: "Jami savdo", value: data.summary.totalSales },
          { label: "Joriy qarz", value: data.summary.currentDebt },
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

  function SortableHead({ column, children, className = "" }: { column: DebtSortBy; children: string; className?: string }) {
    const active = sortBy === column;
    const Icon = !active ? ArrowUpDown : sortOrder === "asc" ? ArrowUp : ArrowDown;
    return (
      <TableHead className={className}>
        <button type="button" onClick={() => changeSort(column)} className={`inline-flex w-full items-center gap-1.5 font-semibold transition-colors hover:text-primary ${className.includes("text-right") ? "justify-end" : "justify-start"}`}>
          {children}<Icon className={`size-3.5 ${active ? "text-primary" : "text-muted-foreground"}`} />
        </button>
      </TableHead>
    );
  }

  if (debts.error) return <div className="mx-auto w-full max-w-[1600px]"><PageHeader eyebrow="Moliyaviy nazorat" title="Qarzdorlik hisoboti" description="Mijozlar qarzdorligi bo‘yicha hisobot." /><QueryError description={debts.error.message} onRetry={() => debts.refetch()} /></div>;

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <PageHeader eyebrow="Moliyaviy nazorat" title="Qarzdorlik hisoboti" description="Har bir mijozning boshlang‘ich qarzi, savdosi, to‘lovlari va joriy qoldig‘ini nazorat qiling." />
      <div className="mb-4 flex justify-end">
        <ExportMenu onExcel={() => exportReport("xlsx")} onPdf={() => exportReport("pdf")} isLoading={isExporting} disabled={debts.isLoading} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Topilgan mijozlar" value={(summary?.clientCount ?? 0).toLocaleString("uz-UZ")} helper="Amaldagi filter bo‘yicha" icon={UsersRound} tone="cyan" />
        <MetricCard label="Filtrlangan savdo" value={formatMoney(summary?.totalSales ?? 0, true)} helper="Barcha topilgan yozuvlar" icon={CircleDollarSign} tone="blue" />
        <MetricCard label="Filtrlangan to‘lov" value={formatMoney(summary?.totalPaid ?? 0, true)} helper="Naqd, terminal va Click" icon={HandCoins} tone="green" />
        <MetricCard label="Joriy qarz" value={formatMoney(summary?.currentDebt ?? 0, true)} helper={`${(summary?.debtorCount ?? 0).toLocaleString("uz-UZ")} ta qarzdor`} icon={Banknote} tone="rose" />
      </div>

      <CashJournalDebtReport />

      <SectionCard title="Mijozlar qarzdorligi" description="Qidiruv, filter va ustun sarlavhalari orqali saralang" className="mt-5">
        <div className="mb-4 grid gap-3 lg:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_180px_160px_150px_150px_auto]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Kod, mijoz yoki agentni qidiring..." className="finance-input pl-9" />
          </div>
          <select value={agentId} onChange={event => { setAgentId(event.target.value); setPage(1); }} className="finance-input border px-3 text-muted-foreground">
            <option value="">Barcha agentlar</option>
            {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <select value={status} onChange={event => { setStatus(event.target.value as keyof typeof statusLabels); setPage(1); }} className="finance-input border px-3 text-muted-foreground">
            {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <Input type="text" inputMode="numeric" value={minDebt} onChange={event => { setMinDebt(sanitizeIntegerInput(event.target.value)); setPage(1); }} placeholder="Minimal qarz" className="finance-input" />
          <Input type="text" inputMode="numeric" value={maxDebt} onChange={event => { setMaxDebt(sanitizeIntegerInput(event.target.value)); setPage(1); }} placeholder="Maksimal qarz" className="finance-input" />
          <Button type="button" variant="outline" onClick={clearFilters} className="gap-2 bg-card"><RotateCcw className="size-4" />Tozalash</Button>
        </div>
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
          {debts.isLoading ? <TableLoading columns={12} /> : items.length === 0 ? <EmptyState description="Qidiruv yoki filterlarni o‘zgartirib ko‘ring." /> : (
            <>
              <Table className="finance-table min-w-[1180px]">
                <TableHeader><TableRow>
                  <SortableHead column="code">Kod</SortableHead>
                  <SortableHead column="name">Mijoz</SortableHead>
                  <SortableHead column="agentName">Agent</SortableHead>
                  <SortableHead column="openingDebt" className="text-right">Boshlang‘ich qarz</SortableHead>
                  <SortableHead column="totalSales" className="text-right">Jami savdo</SortableHead>
                  <TableHead className="text-right">Naqd</TableHead><TableHead className="text-right">Terminal</TableHead><TableHead className="text-right">Click</TableHead><TableHead className="text-right">Перечисление</TableHead>
                  <SortableHead column="currentDebt" className="text-right">Qoldiq qarz</SortableHead>
                  <TableHead>Holat</TableHead>
                  <TableHead className="w-10" />
                </TableRow></TableHeader>
                <TableBody>{items.map(item => <TableRow key={item.id}>
                  <TableCell className="font-mono text-xs font-semibold text-primary">{item.code}</TableCell>
                  <TableCell className="font-semibold text-foreground">{item.name}</TableCell>
                  <TableCell>{item.agentName || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(item.openingDebt)}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatMoney(item.totalSales)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-700">{formatMoney(item.cashReceived)}</TableCell>
                  <TableCell className="text-right tabular-nums text-violet-700">{formatMoney(item.terminalReceived)}</TableCell>
                  <TableCell className="text-right tabular-nums text-cyan-700">{formatMoney(item.clickReceived)}</TableCell>
                  <TableCell className="text-right tabular-nums text-indigo-700">{formatMoney(item.transferReceived)}</TableCell>
                  <TableCell className={`text-right font-bold tabular-nums ${item.currentDebt > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatMoney(item.currentDebt)}</TableCell>
                  <TableCell><DebtBadge value={item.currentDebt} /></TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <button type="button" aria-label="To‘lov qabul qilish" title="To‘lov qabul qilish" className="rounded-lg p-1.5 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-600" onClick={() => setPaymentClient({ id: item.id, name: item.name, currentDebt: item.currentDebt })}><HandCoins className="size-4" /></button>
                      <button type="button" aria-label="Akt sverka" title="Akt sverka" className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary" onClick={() => setStatementClient({ id: item.id, name: item.name })}><FileText className="size-4" /></button>
                    </div>
                  </TableCell>
                </TableRow>)}</TableBody>
              </Table>
              <PaginationBar page={debts.data?.page ?? 1} pageCount={debts.data?.pageCount ?? 1} total={debts.data?.total ?? 0} onChange={setPage} />
            </>
          )}
        </div>
      </SectionCard>
      <ClientStatementDialog
        clientId={statementClient?.id ?? null}
        clientName={statementClient?.name}
        open={Boolean(statementClient)}
        onOpenChange={openState => !openState && setStatementClient(null)}
      />
      <DebtPaymentDialog
        client={paymentClient}
        onClose={() => setPaymentClient(null)}
        onSaved={() => { void debts.refetch(); }}
      />
    </div>
  );
}

function CashJournalDebtReport() {
  const [page, setPage] = useState(1);
  const [archivePage, setArchivePage] = useState(1);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveAgentId, setArchiveAgentId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState<"active" | "open" | "partial">("active");
  const [selected, setSelected] = useState<CashDebt | null>(null);
  const agents = trpc.agents.options.useQuery();
  const report = trpc.cash.journalDebt.repayments.report.useQuery({ page, pageSize: 25, agentId: agentId ? Number(agentId) : undefined, status });
  const archive = trpc.cash.journalDebt.repayments.report.useQuery(
    { page: archivePage, pageSize: 25, agentId: archiveAgentId ? Number(archiveAgentId) : undefined, status: "closed" },
    { enabled: archiveOpen },
  );
  return (
    <SectionCard title="Kassadagi qarz qaydlari" description="Kassa jurnalidagi yopilmagan qarzlar. To‘liq yopilganlari arxivda saqlanadi." className="mt-5"
      action={<Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => { setArchivePage(1); setArchiveOpen(true); }}><Archive className="size-4" />Arxiv</Button>}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Kassa qarzlari bo‘yicha agent" value={agentId} onChange={event => { setAgentId(event.target.value); setPage(1); }} className="finance-input border px-3 text-sm">
            <option value="">Barcha agentlar</option>
            {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
          <select aria-label="Kassa qarzi holati" value={status} onChange={event => { setStatus(event.target.value as typeof status); setPage(1); }} className="finance-input border px-3 text-sm">
            <option value="active">Barcha qarzdorlar</option><option value="open">Qaytim qayd etilmagan</option><option value="partial">Qisman qaytgan</option>
          </select>
          <Button type="button" variant="outline" disabled={report.isFetching} onClick={() => report.refetch()}>Yangilash</Button>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span>Berilgan: <strong className="text-foreground tabular-nums">{report.data ? formatMoney(report.data.originalAmount) : "—"}</strong></span>
          <span>Qaytgan: <strong className="text-foreground tabular-nums">{report.data ? formatMoney(report.data.repaidAmount) : "—"}</strong></span>
          <span>Qoldiq: <strong className="text-foreground tabular-nums">{report.data ? formatMoney(report.data.remainingAmount) : "—"}</strong></span>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Qarzni qisman yoki to‘liq yopish uchun “To‘lov qabul qilish”ni oching. Saqlangan qaytim qarz qoldig‘ini kamaytiradi va tanlangan usulda kassaga kirim yozadi.</p>
      {report.error ? <QueryError description={report.error.message} onRetry={() => report.refetch()} /> : report.isLoading ? <TableLoading columns={4} /> : !report.data?.items?.length ? (
        <EmptyState description="Yopilmagan kassa qarzi topilmadi. To‘liq yopilganlarni Arxivdan ko‘ring." />
      ) : (
        <>
          <Table className="finance-table min-w-[1150px]">
            <TableHeader><TableRow><TableHead>ID / sana</TableHead><TableHead>Agent / xodim</TableHead><TableHead>Kimga berilgan</TableHead><TableHead>Izoh</TableHead><TableHead className="text-right">Berilgan</TableHead><TableHead className="text-right">Qaytgan</TableHead><TableHead className="text-right">Qoldiq</TableHead><TableHead>Holat</TableHead><TableHead>Amal</TableHead></TableRow></TableHeader>
            <TableBody>{report.data.items.map(item => <TableRow key={item.id} className="bg-rose-500/10 hover:bg-rose-500/15 dark:bg-rose-500/10 dark:hover:bg-rose-500/20">
              <TableCell className="whitespace-nowrap align-top"><span className="text-xs text-muted-foreground">#{item.id}</span><br />{formatTashkentDate(item.entryDate)}</TableCell>
              <TableCell className="align-top font-medium">{item.agentName || (item.employeeName ? `${item.employeeName} (xodim)` : "Agent tanlanmagan")}</TableCell>
              <TableCell className="align-top font-medium">{item.borrowerName || <span className="text-muted-foreground">Aniqlanmagan</span>}</TableCell>
              <TableCell className="min-w-[180px] max-w-xs whitespace-pre-wrap break-words align-top [overflow-wrap:anywhere]">{item.description || "—"}</TableCell>
              <TableCell className="whitespace-nowrap text-right align-top tabular-nums">{formatMoney(item.amount)}</TableCell>
              <TableCell className="whitespace-nowrap text-right align-top tabular-nums">{formatMoney(item.paidAmount)}</TableCell>
              <TableCell className="whitespace-nowrap text-right align-top font-semibold tabular-nums">{formatMoney(item.amount - item.paidAmount)}</TableCell>
              <TableCell className="whitespace-nowrap align-top">{item.paidAmount === 0 ? "Qaytim qayd etilmagan" : "Qisman qaytgan"}</TableCell>
              <TableCell className="whitespace-nowrap align-top"><Button type="button" size="sm" variant="outline" className="h-8" onClick={() => setSelected(item)}>To‘lov qabul qilish</Button></TableCell>
            </TableRow>)}</TableBody>
          </Table>
          <PaginationBar page={report.data.page} pageCount={report.data.pageCount} total={report.data.total} onChange={setPage} />
        </>
      )}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Kassa qarzlari arxivi</DialogTitle>
            <DialogDescription>To‘liq yopilgan qarzlar va ularning qaytim tarixini ko‘ring. Yozuvlar bazada saqlanadi.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <select aria-label="Arxiv bo‘yicha agent" value={archiveAgentId} onChange={event => { setArchiveAgentId(event.target.value); setArchivePage(1); }} className="finance-input border px-3 text-sm">
              <option value="">Barcha agentlar</option>
              {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">Yopilgan qarzlar: <strong className="text-foreground">{archive.data?.total ?? "—"}</strong></span>
          </div>
          {archive.error ? <QueryError description={archive.error.message} onRetry={() => archive.refetch()} /> : archive.isLoading ? <TableLoading columns={7} /> : !archive.data?.items?.length ? (
            <EmptyState description="To‘liq yopilgan kassa qarzi topilmadi." />
          ) : <>
            <div className="overflow-x-auto rounded-lg border">
              <Table className="finance-table min-w-[850px]">
                <TableHeader><TableRow><TableHead>ID / sana</TableHead><TableHead>Agent / xodim</TableHead><TableHead>Kimga berilgan</TableHead><TableHead>Izoh</TableHead><TableHead className="text-right">Berilgan</TableHead><TableHead className="text-right">Qaytgan</TableHead><TableHead>Amal</TableHead></TableRow></TableHeader>
                <TableBody>{archive.data.items.map(item => <TableRow key={item.id} className="bg-emerald-500/10 hover:bg-emerald-500/15 dark:bg-emerald-500/15 dark:hover:bg-emerald-500/20">
                  <TableCell className="whitespace-nowrap"><span className="text-xs text-muted-foreground">#{item.id}</span><br />{formatTashkentDate(item.entryDate)}</TableCell>
                  <TableCell className="font-medium">{item.agentName || (item.employeeName ? `${item.employeeName} (xodim)` : "Agent tanlanmagan")}</TableCell>
                  <TableCell className="font-medium">{item.borrowerName || <span className="text-muted-foreground">Aniqlanmagan</span>}</TableCell>
                  <TableCell className="max-w-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{item.description || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(item.amount)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right tabular-nums">{formatMoney(item.paidAmount)}</TableCell>
                  <TableCell><Button type="button" size="sm" variant="outline" onClick={() => { setArchiveOpen(false); setSelected(item); }}>Batafsil</Button></TableCell>
                </TableRow>)}</TableBody>
              </Table>
            </div>
            <PaginationBar page={archive.data.page} pageCount={archive.data.pageCount} total={archive.data.total} onChange={setArchivePage} />
          </>}
        </DialogContent>
      </Dialog>
      <CashDebtRepaymentDialog key={selected?.id ?? "closed"} debt={selected} onClose={() => setSelected(null)} />
    </SectionCard>
  );
}

type CashDebt = { id: number; agentId: number | null; employeeId: number | null; amount: number; paidAmount: number; borrowerName: string | null; description: string | null };

function CashDebtRepaymentDialog({ debt, onClose }: { debt: CashDebt | null; onClose: () => void }) {
  const utils = trpc.useUtils();
  const [borrower, setBorrower] = useState("");
  const [date, setDate] = useState(() => tashkentDateInputValue());
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "terminal" | "click" | "transfer">("cash");
  const [showExisting, setShowExisting] = useState(false);
  const [cashEntryId, setCashEntryId] = useState("");
  const [note, setNote] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const history = trpc.cash.journalDebt.repayments.history.useQuery({ debtId: debt?.id ?? 0 }, { enabled: Boolean(debt) });
  const cashDay = trpc.cash.byDate.useQuery({ date: tashkentDateToTimestamp(date) || 0 }, { enabled: Boolean(debt) && showExisting && Number.isFinite(tashkentDateToTimestamp(date)) });
  const remaining = debt ? debt.amount - (debt.paidAmount ?? 0) : 0;
  const matchingEntries = (cashDay.data ?? []).filter(entry => entry.type === "income" && entry.category === "Qarz qaytimi" &&
    entry.agentId === debt?.agentId && entry.employeeId === debt?.employeeId &&
    entry.cashAmount === (method === "cash" ? Number(amount) : 0) &&
    entry.terminalAmount === (method === "terminal" ? Number(amount) : 0) &&
    entry.clickAmount === (method === "click" ? Number(amount) : 0) &&
    entry.transferAmount === (method === "transfer" ? Number(amount) : 0));
  const refresh = async () => {
    await Promise.all([
      utils.cash.journalDebt.repayments.report.invalidate(),
      utils.cash.journalDebt.repayments.history.invalidate(),
      utils.cash.byDate.invalidate(),
      utils.cash.openingBalance.invalidate(),
      utils.dashboard.overview.invalidate(),
    ]);
  };
  const saveBorrower = trpc.cash.journalDebt.repayments.setBorrower.useMutation({
    onSuccess: async () => { toast.success("Qarz oluvchi saqlandi"); await refresh(); onClose(); },
    onError: error => toast.error(error.message),
  });
  const create = trpc.cash.journalDebt.repayments.create.useMutation({
    onSuccess: async () => {
      toast.success(showExisting ? "Oldingi kirim qarzga bog‘landi" : "To‘lov saqlandi, qarz qoldig‘i kamaydi");
      setAmount(""); setNote(""); setCashEntryId(""); setRequestId(crypto.randomUUID());
      await refresh(); onClose();
    },
    onError: error => toast.error(error.message),
  });
  const voidPayment = trpc.cash.journalDebt.repayments.void.useMutation({
    onSuccess: async () => { toast.success("Qaytim bekor qilindi"); await refresh(); onClose(); },
    onError: error => toast.error(error.message),
  });
  const numericAmount = Number(amount);
  const canSave = debt && amount !== "" && Number.isInteger(numericAmount) && numericAmount > 0 && numericAmount <= remaining &&
    Number.isFinite(tashkentDateToTimestamp(date)) && (!showExisting || Number(cashEntryId) > 0) && !create.isPending;
  return <Dialog open={Boolean(debt)} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Kassa qarzi #{debt?.id} — {remaining > 0 ? "to‘lov qabul qilish" : "batafsil"}</DialogTitle><DialogDescription>
        {debt?.borrowerName || debt?.description || "Qarz oluvchi aniqlanmagan"} · Berilgan: {formatMoney(debt?.amount)} · Qaytgan: {formatMoney(debt?.paidAmount)} · Qoldiq: {formatMoney(remaining)}
      </DialogDescription></DialogHeader>
      <div className="space-y-4">
        {remaining > 0 && <form className="space-y-3 rounded-xl border bg-muted/20 p-4" onSubmit={event => {
          event.preventDefault();
          if (!canSave || !debt) return;
          const payment = { debtId: debt.id, paymentDate: tashkentDateToTimestamp(date), amount: numericAmount, method, note: note.trim(), requestId };
          create.mutate(showExisting ? { ...payment, mode: "existing", cashEntryId: Number(cashEntryId) } : { ...payment, mode: "new" });
        }}>
          <h4 className="text-sm font-semibold">Qaytimni kiritish</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5"><label htmlFor="cash-debt-payment-amount" className="text-xs font-semibold">Qaytgan summa</label><Input id="cash-debt-payment-amount" inputMode="numeric" className="finance-input" value={amount} onChange={event => { setAmount(sanitizeIntegerInput(event.target.value)); setCashEntryId(""); }} placeholder="0" /><p className="text-xs text-muted-foreground">Qoldiq: {formatMoney(remaining)}</p></div>
            <div className="space-y-1.5"><label htmlFor="cash-debt-payment-date" className="text-xs font-semibold">Qaytim sanasi</label><Input id="cash-debt-payment-date" type="date" className="finance-input" value={date} onChange={event => { setDate(event.target.value); setCashEntryId(""); }} /></div>
            <div className="space-y-1.5"><label htmlFor="cash-debt-payment-method" className="text-xs font-semibold">To‘lov usuli</label><select id="cash-debt-payment-method" className="finance-input w-full border px-3" value={method} onChange={event => { setMethod(event.target.value as typeof method); setCashEntryId(""); }}><option value="cash">Naqd</option><option value="terminal">Terminal</option><option value="click">Click</option><option value="transfer">O‘tkazma</option></select></div>
            <div className="space-y-1.5"><label htmlFor="cash-debt-payment-note" className="text-xs font-semibold">Izoh</label><Input id="cash-debt-payment-note" className="finance-input" value={note} onChange={event => setNote(event.target.value)} placeholder="Ixtiyoriy" /></div>
            {showExisting && <div className="space-y-1.5 sm:col-span-2"><label htmlFor="cash-debt-payment-existing" className="text-xs font-semibold">Oldingi kassa kirimi</label><select id="cash-debt-payment-existing" className="finance-input w-full border px-3" value={cashEntryId} onChange={event => setCashEntryId(event.target.value)}><option value="">Kirimni tanlang</option>{matchingEntries.map(entry => <option key={entry.id} value={entry.id}>#{entry.id} · {formatMoney(numericAmount)} · {entry.description || "Izohsiz"}</option>)}</select><p className="text-xs text-muted-foreground">Faqat shu sanadagi “Qarz qaytimi” turi va aynan shu summadagi kirim tanlanadi. Ikkinchi kassa kirimi yaratilmaydi.</p></div>}
          </div>
          <div className="flex flex-wrap items-center gap-2"><Button type="submit" disabled={!canSave}>{showExisting ? "Oldingi kirimni bog‘lash" : "To‘lovni saqlash"}</Button><Button type="button" variant="ghost" onClick={() => { setShowExisting(value => !value); setCashEntryId(""); }}>{showExisting ? "Yangi kirim yaratish" : "Kassaga oldin yozilgan kirimni bog‘lash"}</Button></div>
          {!showExisting && <p className="text-xs text-muted-foreground">Naqd qaytim naqd qoldiqqa qo‘shiladi. Terminal, Click va o‘tkazma naqd qoldiqni o‘zgartirmaydi.</p>}
        </form>}
        <div><h4 className="mb-2 text-sm font-semibold">Qaytimlar tarixi</h4>{history.isLoading ? <p className="text-xs text-muted-foreground">Yuklanmoqda...</p> : !history.data?.length ? <p className="text-xs text-muted-foreground">Hali qaytim qayd etilmagan.</p> : <div className="space-y-2">{history.data.map(payment => <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"><div><strong>{formatMoney(payment.amount)}</strong> · {formatTashkentDate(payment.paymentDate)} · {{ cash: "Naqd", terminal: "Terminal", click: "Click", transfer: "O‘tkazma" }[payment.method]} · kassa #{payment.cashEntryId}{payment.note ? ` · ${payment.note}` : ""}{payment.voidedAt && <span className="ml-2 text-rose-500">Bekor qilingan: {payment.voidReason}</span>}</div>{!payment.voidedAt && <Button type="button" size="sm" variant="outline" disabled={voidPayment.isPending} onClick={() => { const reason = window.prompt("Bekor qilish sababi (kamida 3 belgi):"); if (reason?.trim() && reason.trim().length >= 3) voidPayment.mutate({ id: payment.id, reason: reason.trim() }); }}>Bekor qilish</Button>}</div>)}</div>}</div>
        <div className="space-y-1.5"><label className="text-xs font-semibold">Qarz oluvchi ismini tuzatish</label>
          <div className="flex gap-2"><Input className="finance-input" value={borrower} onChange={event => setBorrower(event.target.value)} placeholder={debt?.borrowerName || "Qarz oluvchi ismi"} />
            <Button type="button" variant="outline" disabled={!debt || borrower.trim().length < 2 || saveBorrower.isPending} onClick={() => debt && saveBorrower.mutate({ debtId: debt.id, borrowerName: borrower.trim() })}>Saqlash</Button></div>
          {!debt?.borrowerName && <p className="text-xs text-muted-foreground">Eski qaydlarda ism izohdan avtomatik ajratilmaydi. Uni tekshirib kiriting.</p>}
        </div>
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Yopish</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

/**
 * Mijozdan qarz to'lovini qabul qilish oynasi.
 * Kassaga ta'sir qilmaydi — faqat mijozning qarz balansini kamaytiradi.
 */
function DebtPaymentDialog({
  client,
  onClose,
  onSaved,
}: {
  client: { id: number; name: string; currentDebt: number } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const [cash, setCash] = useState("");
  const [terminal, setTerminal] = useState("");
  const [click, setClick] = useState("");
  const [transfer, setTransfer] = useState("");
  const [date, setDate] = useState(() => localDateInputValue());
  const [note, setNote] = useState("");

  function reset() {
    setCash(""); setTerminal(""); setClick(""); setTransfer(""); setNote("");
    setDate(localDateInputValue());
  }

  const history = trpc.debts.payments.byClient.useQuery(
    { clientId: client?.id ?? 0 },
    { enabled: Boolean(client) },
  );

  const create = trpc.debts.payments.create.useMutation({
    onSuccess: async () => {
      toast.success("To‘lov qabul qilindi");
      reset();
      onClose();
      await Promise.all([
        utils.debts.list.invalidate(),
        utils.dashboard.overview.invalidate(),
        utils.debts.payments.byClient.invalidate(),
      ]);
      onSaved();
    },
    onError: error => toast.error(error.message),
  });

  const deletePayment = trpc.debts.payments.delete.useMutation({
    onSuccess: async () => {
      toast.success("To‘lov o‘chirildi");
      await Promise.all([
        utils.debts.list.invalidate(),
        utils.dashboard.overview.invalidate(),
        utils.debts.payments.byClient.invalidate(),
      ]);
      onSaved();
    },
    onError: error => toast.error(error.message),
  });

  const total = Number(cash || 0) + Number(terminal || 0) + Number(click || 0) + Number(transfer || 0);
  const canSubmit = total > 0 && !create.isPending;
  /** Qarzdan ortiq to'lov xato emas (avans bo'lishi mumkin), lekin ogohlantiramiz. */
  const exceedsDebt = client ? total > client.currentDebt && client.currentDebt > 0 : false;

  return (
    <Dialog open={Boolean(client)} onOpenChange={openState => { if (!openState) { reset(); onClose(); } }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>To‘lov qabul qilish</DialogTitle>
          <DialogDescription>
            {client?.name} — joriy qarzi <span className="font-semibold text-foreground">{formatMoney(client?.currentDebt ?? 0)}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Naqd</label>
              <Input className="finance-input" inputMode="numeric" placeholder="0" value={cash} onChange={event => setCash(sanitizeIntegerInput(event.target.value))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Terminal</label>
              <Input className="finance-input" inputMode="numeric" placeholder="0" value={terminal} onChange={event => setTerminal(sanitizeIntegerInput(event.target.value))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Click</label>
              <Input className="finance-input" inputMode="numeric" placeholder="0" value={click} onChange={event => setClick(sanitizeIntegerInput(event.target.value))} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground">Перечисление</label>
              <Input className="finance-input" inputMode="numeric" placeholder="0" value={transfer} onChange={event => setTransfer(sanitizeIntegerInput(event.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Sana</label>
            <Input className="finance-input" type="date" value={date} onChange={event => setDate(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-muted-foreground">Izoh</label>
            <Input className="finance-input" placeholder="Ixtiyoriy" value={note} onChange={event => setNote(event.target.value)} />
          </div>

          <div className="rounded-xl border border-border bg-muted/60 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Jami to‘lov</span>
              <span className="font-bold tabular-nums text-foreground">{formatMoney(total)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">To‘lovdan keyingi qarz</span>
              <span className="font-bold tabular-nums text-foreground">{formatMoney((client?.currentDebt ?? 0) - total)}</span>
            </div>
          </div>

          {exceedsDebt && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              To‘lov qarzdan ko‘p — qoldiq avans (haqdorlik) sifatida manfiy ko‘rinadi.
            </p>
          )}
          {total <= 0 && <p className="text-right text-xs font-medium text-rose-600">To‘lov summasi kiritilmagan</p>}
        </div>

        <div className="mt-1">
          <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Qarz to‘lovlari tarixi</h4>
          {history.isLoading ? (
            <p className="text-xs text-muted-foreground">Yuklanmoqda...</p>
          ) : !history.data || history.data.length === 0 ? (
            <p className="text-xs text-muted-foreground">Bu mijozdan hali qarz to‘lovi qabul qilinmagan.</p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-border">
              <Table className="finance-table text-xs">
                <TableHeader><TableRow>
                  <TableHead>Sana</TableHead>
                  <TableHead className="text-right">Naqd</TableHead>
                  <TableHead className="text-right">Terminal</TableHead>
                  <TableHead className="text-right">Click</TableHead>
                  <TableHead className="text-right">Перечисление</TableHead>
                  <TableHead>Izoh</TableHead>
                  <TableHead className="w-8" />
                </TableRow></TableHeader>
                <TableBody>
                  {history.data.map(payment => (
                    <TableRow key={payment.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(payment.paymentDate)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(payment.cashAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(payment.terminalAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(payment.clickAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(payment.transferAmount)}</TableCell>
                      <TableCell className="max-w-[140px] truncate text-muted-foreground">{payment.note || "—"}</TableCell>
                      <TableCell>
                        <button
                          type="button"
                          aria-label="O‘chirish"
                          title="O‘chirish"
                          disabled={deletePayment.isPending}
                          className="rounded-lg p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-50"
                          onClick={() => deletePayment.mutate({ id: payment.id })}
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => { reset(); onClose(); }}>Bekor qilish</Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!client) return;
              create.mutate({
                clientId: client.id,
                paymentDate: new Date(`${date}T12:00:00`).getTime(),
                cashAmount: Number(cash || 0),
                terminalAmount: Number(terminal || 0),
                clickAmount: Number(click || 0),
                transferAmount: Number(transfer || 0),
                note: note || undefined,
              });
            }}
          >
            {create.isPending ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
