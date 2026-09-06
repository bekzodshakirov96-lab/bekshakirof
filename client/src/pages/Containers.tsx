import { EmptyState, MetricCard, PageHeader, QueryError, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { ArrowDownToLine, ArrowUpFromLine, Boxes } from "lucide-react";

export default function Containers() {
  const balances = trpc.containers.balances.useQuery();
  const movements = trpc.containers.list.useQuery();
  const balanceRows = balances.data ?? [];
  const issued = (movements.data ?? []).filter(row => row.movementType === "issued").reduce((sum, row) => sum + Number(row.quantity), 0);
  const returned = (movements.data ?? []).filter(row => row.movementType === "returned").reduce((sum, row) => sum + Number(row.quantity), 0);
  const outstanding = balanceRows.reduce((sum, row) => sum + Number(row.balance), 0);
  if (balances.error || movements.error) {
    const error = balances.error ?? movements.error;
    return (
      <div className="w-full min-w-0">
        <PageHeader eyebrow="Aylanma tara" title="Tara nazorati" description="Tara harakati va qoldiqlari." />
        <QueryError description={error?.message} onRetry={() => { balances.refetch(); movements.refetch(); }} />
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <PageHeader eyebrow="Aylanma tara" title="Tara nazorati" description="Mijozlarga berilgan va qaytarilgan KEG yoki boshqa taralarni agentlar kesimida kuzating." />

      <div className="grid gap-3 sm:grid-cols-3">
        <MetricCard label="Jami berilgan" value={formatNumber(issued, 3)} helper="Barcha harakatlar" icon={ArrowUpFromLine} tone="blue" />
        <MetricCard label="Jami qaytarilgan" value={formatNumber(returned, 3)} helper="Barcha harakatlar" icon={ArrowDownToLine} tone="green" />
        <MetricCard label="Qoldiq tara" value={formatNumber(outstanding, 3)} helper="Mijozlardagi qoldiq" icon={Boxes} tone="blue" />
      </div>

      <div className="mt-4 space-y-4">
        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Mijozlardagi qoldiq</h3>
              <p className="mt-1 text-xs text-muted-foreground">Mijoz, agent va tara turi bo‘yicha</p>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{balanceRows.length} ta yozuv</span>
          </div>
          {balances.isLoading ? <TableLoading columns={6} /> : balanceRows.length === 0 ? <EmptyState /> : (
            <Table className="finance-table min-w-[760px] text-sm [&_th]:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[30%]">Mijoz</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead>Tara turi</TableHead>
                  <TableHead className="text-right">Berildi</TableHead>
                  <TableHead className="text-right">Qaytdi</TableHead>
                  <TableHead className="bg-primary/5 text-right">Qoldiq</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {balanceRows.map((row, index) => (
                  <TableRow key={`${row.clientName}-${row.containerType}-${index}`}>
                    <TableCell className="font-medium text-foreground">{row.clientName || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{row.agentName || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className="rounded-md border-border bg-muted/40 text-xs font-medium text-foreground">{row.containerType}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.issued, 3)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatNumber(row.returned, 3)}</TableCell>
                    <TableCell className={`bg-primary/5 text-right font-semibold tabular-nums ${Number(row.balance) < 0 ? "text-destructive" : "text-primary"}`}>{formatNumber(row.balance, 3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>

        <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h3 className="text-sm font-semibold text-foreground">So‘nggi tara harakatlari</h3>
            <p className="mt-1 text-xs text-muted-foreground">Berilgan va qaytarilgan tara bo‘yicha oxirgi 25 ta yozuv</p>
          </div>
          {movements.isLoading ? <TableLoading columns={5} /> : (movements.data ?? []).length === 0 ? <EmptyState /> : (
            <Table className="finance-table min-w-[720px] text-sm [&_th]:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Sana</TableHead>
                  <TableHead className="w-[35%]">Mijoz</TableHead>
                  <TableHead>Tara</TableHead>
                  <TableHead>Harakat</TableHead>
                  <TableHead className="text-right">Miqdor</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(movements.data ?? []).slice(0, 25).map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDate(row.movementDate)}</TableCell>
                    <TableCell className="font-medium text-foreground">{row.clientName || "—"}</TableCell>
                    <TableCell>{row.containerType}</TableCell>
                    <TableCell>
                      {row.movementType === "issued" ? (
                        <Badge variant="outline" className="gap-1 rounded-md border-primary/20 bg-primary/5 text-xs font-medium text-primary"><ArrowUpFromLine className="size-3" />Berildi</Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1 rounded-md border-emerald-600/20 bg-emerald-600/5 text-xs font-medium text-emerald-700 dark:text-emerald-400"><ArrowDownToLine className="size-3" />Qaytarildi</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatNumber(row.quantity, 3)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      </div>
    </div>
  );
}
