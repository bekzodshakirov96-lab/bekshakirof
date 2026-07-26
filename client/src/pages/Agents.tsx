import { useAuth } from "@/_core/hooks/useAuth";
import { ExportMenu } from "@/components/ExportMenu";
import { EmptyState, MetricCard, PageHeader, PaginationBar, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney, localDateInputValue } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { ArrowDown, ArrowUp, ArrowUpDown, CircleDollarSign, HandCoins, Plus, RotateCcw, Search, TrendingUp, UserCheck } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type AgentSortBy = "name" | "clientCount" | "debtorCount" | "totalSales" | "totalPaid" | "currentDebt";
type SortOrder = "asc" | "desc";
type AgentStatus = "all" | "active" | "inactive";
type AgentDebtStatus = "all" | "debt" | "clear";

export default function Agents() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<AgentStatus>("all");
  const [debtStatus, setDebtStatus] = useState<AgentDebtStatus>("all");
  const [sortBy, setSortBy] = useState<AgentSortBy>("currentDebt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const filters = useMemo(() => ({ search: search.trim() || undefined, status, debtStatus, sortBy, sortOrder }), [debtStatus, search, sortBy, sortOrder, status]);
  const agents = trpc.agents.list.useQuery({ ...filters, page, pageSize: 25 });
  const create = trpc.agents.create.useMutation({
    onSuccess: async () => {
      toast.success("Agent muvaffaqiyatli qo‘shildi"); setOpen(false); setName(""); setPhone(""); setNote("");
      await Promise.all([utils.agents.list.invalidate(), utils.agents.options.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const rows = agents.data?.items ?? [];
  const summary = agents.data?.summary;

  function changeSort(column: AgentSortBy) {
    setPage(1);
    if (sortBy === column) setSortOrder(current => current === "asc" ? "desc" : "asc");
    else {
      setSortBy(column);
      setSortOrder(column === "name" ? "asc" : "desc");
    }
  }

  function clearFilters() {
    setSearch(""); setStatus("all"); setDebtStatus("all"); setSortBy("currentDebt"); setSortOrder("desc"); setPage(1);
  }

  function filterDescription() {
    const parts: string[] = [];
    if (search.trim()) parts.push(`Qidiruv: ${search.trim()}`);
    if (status !== "all") parts.push(`Holat: ${status === "active" ? "Faol" : "Nofaol"}`);
    if (debtStatus !== "all") parts.push(`Qarz: ${debtStatus === "debt" ? "Qarzi bor" : "Qarzi yo‘q"}`);
    return parts.join("; ") || "Barcha agentlar";
  }

  async function exportReport(format: "xlsx" | "pdf") {
    setIsExporting(true);
    try {
      const data = await utils.agents.exportData.fetch(filters);
      type AgentExportRow = (typeof data.rows)[number];
      const columns: ReportColumn<AgentExportRow>[] = [
        { title: "Agent", value: row => row.name, width: "*" },
        { title: "Telefon", value: row => row.phone || "—", width: 70 },
        { title: "Mijozlar", value: row => row.clientCount, width: 48, align: "right" },
        { title: "Qarzdorlar", value: row => row.debtorCount, width: 50, align: "right" },
        { title: "Jami savdo", value: row => row.totalSales, width: 68, align: "right" },
        { title: "Jami to‘lov", value: row => row.totalPaid, width: 68, align: "right" },
        { title: "Joriy qarz", value: row => row.currentDebt, width: 68, align: "right" },
        { title: "Holat", value: row => row.isActive ? "Faol" : "Nofaol", width: 46 },
      ];
      const options = {
        title: "Agentlar bo‘yicha qarzdorlik va savdo hisoboti",
        fileName: `agentlar_hisoboti_${localDateInputValue()}`,
        rows: data.rows, columns, generatedAt: data.generatedAt, filterDescription: filterDescription(),
        summary: [
          { label: "Agentlar", value: data.summary.agentCount },
          { label: "Mijozlar", value: data.summary.clientCount },
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

  function SortableHead({ column, children, className = "" }: { column: AgentSortBy; children: string; className?: string }) {
    const active = sortBy === column;
    const Icon = !active ? ArrowUpDown : sortOrder === "asc" ? ArrowUp : ArrowDown;
    return <TableHead className={className}><button type="button" onClick={() => changeSort(column)} className={`inline-flex w-full items-center gap-1.5 font-semibold hover:text-primary ${className.includes("text-right") ? "justify-end" : className.includes("text-center") ? "justify-center" : "justify-start"}`}>{children}<Icon className={`size-3.5 ${active ? "text-primary" : "text-slate-400"}`} /></button></TableHead>;
  }

  if (agents.error) return <div className="mx-auto w-full max-w-[1500px]"><PageHeader eyebrow="Savdo jamoasi" title="Agentlar boshqaruvi" description="Agentlar va ularning ko‘rsatkichlari." /><QueryError description={agents.error.message} onRetry={() => agents.refetch()} /></div>;

  return <div className="mx-auto w-full max-w-[1500px]">
    <PageHeader eyebrow="Savdo jamoasi" title="Agentlar boshqaruvi" description="Agentlar portfeli, mijozlari, savdo natijalari va qarzdorligini solishtiring." action={<div className="flex flex-wrap gap-2"><ExportMenu onExcel={() => exportReport("xlsx")} onPdf={() => exportReport("pdf")} isLoading={isExporting} disabled={agents.isLoading} />{user?.role === "admin" && <Button onClick={() => setOpen(true)} className="h-10 rounded-xl bg-slate-900 text-xs font-semibold hover:bg-slate-800"><Plus className="mr-2 size-4" />Yangi agent</Button>}</div>} />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Topilgan agentlar" value={(summary?.agentCount ?? 0).toLocaleString("uz-UZ")} helper={`${(summary?.clientCount ?? 0).toLocaleString("uz-UZ")} ta mijoz`} icon={UserCheck} tone="cyan" />
      <MetricCard label="Jami savdo" value={formatMoney(summary?.totalSales ?? 0, true)} helper="Filtrlangan agentlar" icon={TrendingUp} tone="blue" />
      <MetricCard label="Jami to‘lov" value={formatMoney(summary?.totalPaid ?? 0, true)} helper="Mijozlardan tushum" icon={HandCoins} tone="green" />
      <MetricCard label="Jami qarz" value={formatMoney(summary?.currentDebt ?? 0, true)} helper={`${(summary?.debtorCount ?? 0).toLocaleString("uz-UZ")} ta qarzdor mijoz`} icon={CircleDollarSign} tone="rose" />
    </div>
    <SectionCard title="Agentlar samaradorligi" description="Qidiruv, filter va ustun sarlavhalari orqali saralang" className="mt-5">
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(240px,1fr)_190px_190px_auto]">
        <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input className="finance-input pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Agent yoki telefon raqami..." /></div>
        <select className="finance-input border px-3 text-slate-600" value={status} onChange={event => { setStatus(event.target.value as AgentStatus); setPage(1); }}><option value="all">Barcha holatlar</option><option value="active">Faol agentlar</option><option value="inactive">Nofaol agentlar</option></select>
        <select className="finance-input border px-3 text-slate-600" value={debtStatus} onChange={event => { setDebtStatus(event.target.value as AgentDebtStatus); setPage(1); }}><option value="all">Barcha qarz holati</option><option value="debt">Qarzi bor</option><option value="clear">Qarzi yo‘q</option></select>
        <Button variant="outline" onClick={clearFilters} className="gap-2 bg-white"><RotateCcw className="size-4" />Tozalash</Button>
      </div>
      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-slate-100">
        {agents.isLoading ? <TableLoading columns={8} /> : rows.length === 0 ? <EmptyState description="Qidiruv yoki filterlarni o‘zgartirib ko‘ring." /> : <>
          <Table className="finance-table min-w-[1020px]"><TableHeader><TableRow><SortableHead column="name">Agent</SortableHead><TableHead>Telefon</TableHead><SortableHead column="clientCount" className="text-center">Mijozlar</SortableHead><SortableHead column="debtorCount" className="text-center">Qarzdorlar</SortableHead><SortableHead column="totalSales" className="text-right">Savdo</SortableHead><SortableHead column="totalPaid" className="text-right">To‘lov</SortableHead><SortableHead column="currentDebt" className="text-right">Joriy qarz</SortableHead><TableHead>Holat</TableHead></TableRow></TableHeader>
            <TableBody>{rows.map(row => <TableRow key={row.id}><TableCell><div className="flex items-center gap-3"><div className="grid size-9 place-items-center rounded-xl bg-cyan-50 text-xs font-bold text-cyan-700">{row.name.charAt(0)}</div><span className="font-semibold text-slate-900">{row.name}</span></div></TableCell><TableCell>{row.phone || "—"}</TableCell><TableCell className="text-center font-semibold">{row.clientCount}</TableCell><TableCell className="text-center"><Badge className="rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50">{row.debtorCount}</Badge></TableCell><TableCell className="text-right font-semibold tabular-nums">{formatMoney(row.totalSales)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700">{formatMoney(row.totalPaid)}</TableCell><TableCell className="text-right font-bold tabular-nums text-rose-700">{formatMoney(row.currentDebt)}</TableCell><TableCell><Badge className={row.isActive ? "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-100"}>{row.isActive ? "Faol" : "Nofaol"}</Badge></TableCell></TableRow>)}</TableBody>
          </Table>
          <PaginationBar page={agents.data?.page ?? 1} pageCount={agents.data?.pageCount ?? 1} total={agents.data?.total ?? 0} onChange={setPage} />
        </>}
      </div>
    </SectionCard>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="rounded-2xl sm:max-w-md"><DialogHeader><DialogTitle>Yangi agent qo‘shish</DialogTitle><DialogDescription>Agentning asosiy aloqa ma’lumotlarini kiriting.</DialogDescription></DialogHeader><div className="space-y-4 py-2"><div className="space-y-2"><Label>Agent F.I.Sh.</Label><Input className="finance-input" value={name} onChange={event => setName(event.target.value)} placeholder="Masalan: Akmal Karimov" /></div><div className="space-y-2"><Label>Telefon raqami</Label><Input className="finance-input" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+998 90 000 00 00" /></div><div className="space-y-2"><Label>Izoh</Label><Textarea value={note} onChange={event => setNote(event.target.value)} placeholder="Qo‘shimcha ma’lumot..." className="min-h-24 rounded-xl" /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Bekor qilish</Button><Button disabled={name.trim().length < 2 || create.isPending} onClick={() => create.mutate({ name, phone: phone || undefined, note: note || undefined })}>{create.isPending ? "Saqlanmoqda..." : "Agentni saqlash"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
