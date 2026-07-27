import { ExportMenu } from "@/components/ExportMenu";
import { ClientStatementDialog } from "@/components/ClientStatementDialog";
import { DebtBadge, EmptyState, MetricCard, PageHeader, PaginationBar, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, localDateInputValue, sanitizeIntegerInput } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { ArrowDown, ArrowUp, ArrowUpDown, Banknote, CircleDollarSign, FileText, HandCoins, RotateCcw, Search, UsersRound } from "lucide-react";
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
        { title: "Naqd", value: row => row.cashPaid, width: 58, align: "right" },
        { title: "Terminal", value: row => row.terminalPaid, width: 58, align: "right" },
        { title: "Click", value: row => row.clickPaid, width: 55, align: "right" },
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
          {debts.isLoading ? <TableLoading columns={11} /> : items.length === 0 ? <EmptyState description="Qidiruv yoki filterlarni o‘zgartirib ko‘ring." /> : (
            <>
              <Table className="finance-table min-w-[1180px]">
                <TableHeader><TableRow>
                  <SortableHead column="code">Kod</SortableHead>
                  <SortableHead column="name">Mijoz</SortableHead>
                  <SortableHead column="agentName">Agent</SortableHead>
                  <SortableHead column="openingDebt" className="text-right">Boshlang‘ich qarz</SortableHead>
                  <SortableHead column="totalSales" className="text-right">Jami savdo</SortableHead>
                  <TableHead className="text-right">Naqd</TableHead><TableHead className="text-right">Terminal</TableHead><TableHead className="text-right">Click</TableHead>
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
                  <TableCell className="text-right tabular-nums text-emerald-700">{formatMoney(item.cashPaid)}</TableCell>
                  <TableCell className="text-right tabular-nums text-violet-700">{formatMoney(item.terminalPaid)}</TableCell>
                  <TableCell className="text-right tabular-nums text-cyan-700">{formatMoney(item.clickPaid)}</TableCell>
                  <TableCell className={`text-right font-bold tabular-nums ${item.currentDebt > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatMoney(item.currentDebt)}</TableCell>
                  <TableCell><DebtBadge value={item.currentDebt} /></TableCell>
                  <TableCell><button type="button" aria-label="Akt sverka" title="Akt sverka" className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary" onClick={() => setStatementClient({ id: item.id, name: item.name })}><FileText className="size-4" /></button></TableCell>
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
    </div>
  );
}
