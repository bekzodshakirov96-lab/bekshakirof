import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, ArrowUpFromLine, Boxes, PackageCheck } from "lucide-react";

export default function Containers() {
  const balances = trpc.containers.balances.useQuery();
  const movements = trpc.containers.list.useQuery();
  const balanceRows = balances.data ?? [];
  const issued = (movements.data ?? []).filter(row => row.movementType === "issued").reduce((sum, row) => sum + Number(row.quantity), 0);
  const returned = (movements.data ?? []).filter(row => row.movementType === "returned").reduce((sum, row) => sum + Number(row.quantity), 0);
  const outstanding = balanceRows.reduce((sum, row) => sum + Math.max(0, Number(row.balance)), 0);
  if (balances.error || movements.error) { const error = balances.error ?? movements.error; return <div className="mx-auto w-full max-w-[1550px]"><PageHeader eyebrow="Aylanma tara" title="Tara nazorati" description="Tara harakati va qoldiqlari." /><QueryError description={error?.message} onRetry={() => { balances.refetch(); movements.refetch(); }} /></div>; }
  return <div className="mx-auto w-full max-w-[1550px]">
    <PageHeader eyebrow="Aylanma tara" title="Tara nazorati" description="Mijozlarga berilgan va qaytarilgan KEG yoki boshqa taralarni agentlar kesimida kuzating." />
    <div className="grid gap-4 sm:grid-cols-3"><MetricCard label="Jami berilgan" value={formatNumber(issued, 3)} helper="Barcha harakatlar" icon={ArrowUpFromLine} tone="blue" /><MetricCard label="Jami qaytarilgan" value={formatNumber(returned, 3)} helper="Barcha harakatlar" icon={ArrowDownToLine} tone="green" /><MetricCard label="Qoldiq tara" value={formatNumber(outstanding, 3)} helper="Mijozlardagi qoldiq" icon={Boxes} tone="amber" /></div>
    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <SectionCard title="Mijozlardagi qoldiq" description="Mijoz, agent va tara turi bo‘yicha"><div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">{balances.isLoading ? <TableLoading columns={5} /> : balanceRows.length === 0 ? <EmptyState /> : <Table className="finance-table"><TableHeader><TableRow><TableHead>Mijoz</TableHead><TableHead>Agent</TableHead><TableHead>Tara turi</TableHead><TableHead className="text-right">Berildi</TableHead><TableHead className="text-right">Qaytdi</TableHead><TableHead className="text-right">Qoldiq</TableHead></TableRow></TableHeader><TableBody>{balanceRows.map((row, index) => <TableRow key={`${row.clientName}-${row.containerType}-${index}`}><TableCell className="font-semibold text-foreground">{row.clientName || "—"}</TableCell><TableCell>{row.agentName || "—"}</TableCell><TableCell><Badge variant="outline" className="rounded-lg">{row.containerType}</Badge></TableCell><TableCell className="text-right tabular-nums">{formatNumber(row.issued, 3)}</TableCell><TableCell className="text-right tabular-nums text-emerald-700">{formatNumber(row.returned, 3)}</TableCell><TableCell className="text-right font-bold tabular-nums text-amber-700">{formatNumber(row.balance, 3)}</TableCell></TableRow>)}</TableBody></Table>}</div></SectionCard>
      <SectionCard title="So‘nggi tara harakatlari" description="Excel faylidan import qilingan jurnal"><div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">{movements.isLoading ? <TableLoading columns={5} /> : (movements.data ?? []).length === 0 ? <EmptyState /> : <Table className="finance-table"><TableHeader><TableRow><TableHead>Sana</TableHead><TableHead>Mijoz</TableHead><TableHead>Tara</TableHead><TableHead>Harakat</TableHead><TableHead className="text-right">Miqdor</TableHead></TableRow></TableHeader><TableBody>{(movements.data ?? []).slice(0, 25).map(row => <TableRow key={row.id}><TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.movementDate)}</TableCell><TableCell className="font-semibold text-foreground">{row.clientName || "—"}</TableCell><TableCell>{row.containerType}</TableCell><TableCell>{row.movementType === "issued" ? <Badge className="rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-50">Berildi</Badge> : <Badge className="rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Qaytarildi</Badge>}</TableCell><TableCell className="text-right font-semibold tabular-nums">{formatNumber(row.quantity, 3)}</TableCell></TableRow>)}</TableBody></Table>}</div></SectionCard>
    </div>
  </div>;
}
