import { EmptyState, TableLoading } from "@/components/finance-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportAktSverkaPdf } from "@/lib/akt-sverka-export";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function containerLabel(value: string) {
  if (value === "keg_30") return "KEG 30";
  if (value === "keg_50") return "KEG 50";
  return value;
}

export function ClientStatementDialog({
  clientId,
  clientName,
  open,
  onOpenChange,
}: {
  clientId: number | null;
  clientName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined;
  const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined;

  const statement = trpc.debts.clientStatement.useQuery(
    { clientId: clientId ?? 0, from, to },
    { enabled: open && Boolean(clientId) },
  );

  async function downloadPdf() {
    if (!statement.data) return;
    setIsExporting(true);
    try {
      await exportAktSverkaPdf({
        client: statement.data.client,
        periodLabel: fromDate || toDate ? `${fromDate || "boshidan"} — ${toDate || "hozirgacha"}` : "Barcha davr",
        openingBalance: statement.data.openingBalance,
        ledger: statement.data.ledger,
        closingBalance: statement.data.closingBalance,
        openingContainer: statement.data.openingContainer,
        containerLedger: statement.data.containerLedger,
        closingContainer: statement.data.closingContainer,
        generatedAt: statement.data.generatedAt,
      });
      toast.success("Akt sverka PDF yuklandi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF yaratib bo‘lmadi.");
    } finally {
      setIsExporting(false);
    }
  }

  const data = statement.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Akt sverka — {clientName || data?.client.name || ""}</DialogTitle>
          <DialogDescription>Mijoz bilan o‘zaro hisob-kitobni to‘liq ko‘rish va PDF hujjat sifatida yuklab olish.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label>Boshlanish sanasi</Label><Input className="finance-input" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Tugash sanasi</Label><Input className="finance-input" type="date" value={toDate} onChange={event => setToDate(event.target.value)} /></div>
          <p className="pb-2 text-xs text-muted-foreground">Bo‘sh qoldirilsa — butun davr</p>
          <div className="ml-auto">
            <Button type="button" disabled={!data || isExporting} onClick={downloadPdf} className="gap-2 text-xs font-semibold">
              <FileDown className="size-4" />{isExporting ? "Yaratilmoqda..." : "PDF yuklab olish"}
            </Button>
          </div>
        </div>

        {statement.isLoading ? (
          <TableLoading columns={6} />
        ) : !data ? null : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border bg-muted p-4"><p className="text-xs text-muted-foreground">Davr boshidagi qoldiq</p><p className="mt-1 text-lg font-bold text-foreground">{formatMoney(data.openingBalance)}</p></div>
              <div className={`rounded-2xl border p-4 ${data.closingBalance > 0 ? "border-rose-100 bg-rose-50/60" : "border-emerald-100 bg-emerald-50/60"}`}><p className={`text-xs ${data.closingBalance > 0 ? "text-rose-700" : "text-emerald-700"}`}>Davr oxiridagi qoldiq</p><p className="mt-1 text-lg font-bold text-foreground">{formatMoney(data.closingBalance)}</p></div>
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-sm font-bold text-foreground">Savdo va to‘lovlar</h4>
              {data.ledger.length === 0 ? <EmptyState title="Bu davrda operatsiya yo‘q" /> : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <Table className="finance-table"><TableHeader><TableRow>
                    <TableHead>Sana</TableHead><TableHead>Mahsulot</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead className="text-right">Summa</TableHead><TableHead className="text-right">To‘langan</TableHead><TableHead className="text-right">Qoldiq</TableHead>
                  </TableRow></TableHeader><TableBody>
                    {data.ledger.map(row => <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.transactionDate)}</TableCell>
                      <TableCell>{row.productName}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(row.quantity, 3)} {row.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMoney(row.totalAmount)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-700">{formatMoney(row.paid)}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{formatMoney(row.balanceAfter)}</TableCell>
                    </TableRow>)}
                  </TableBody></Table>
                </div>
              )}
            </div>

            {data.containerLedger.length > 0 && (
              <div className="mt-4">
                <h4 className="mb-2 text-sm font-bold text-foreground">Tara (KEG) harakati</h4>
                <div className="overflow-hidden rounded-xl border border-border">
                  <Table className="finance-table"><TableHeader><TableRow>
                    <TableHead>Sana</TableHead><TableHead>Tara turi</TableHead><TableHead>Harakat</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead className="text-right">KEG 30 qoldiq</TableHead><TableHead className="text-right">KEG 50 qoldiq</TableHead>
                  </TableRow></TableHeader><TableBody>
                    {data.containerLedger.map(row => <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.movementDate)}</TableCell>
                      <TableCell>{containerLabel(row.containerType)}</TableCell>
                      <TableCell>{row.movementType === "issued" ? "Berildi" : "Qaytdi"}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.keg30After}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.keg50After}</TableCell>
                    </TableRow>)}
                  </TableBody></Table>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Davr oxirida: KEG 30 — {data.closingContainer.keg30}, KEG 50 — {data.closingContainer.keg50}</p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
