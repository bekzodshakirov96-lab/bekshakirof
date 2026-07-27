import { EmptyState, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { exportFactoryAktSverkaPdf } from "@/lib/factory-akt-sverka-export";
import { formatDate, formatNumber } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { FileDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const operationMeta: Record<string, { label: string; badgeClass: string }> = {
  tara_sent: { label: "Bo'sh tara yuborildi", badgeClass: "rounded-lg bg-muted text-muted-foreground hover:bg-muted" },
  filled_received: { label: "To'la keg qabul qilindi", badgeClass: "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" },
  brak_returned: { label: "Brak qaytarildi", badgeClass: "rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50" },
  brak_replaced: { label: "Brak o'rniga keg keldi", badgeClass: "rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-50" },
};

export function FactoryStatementDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const from = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined;
  const to = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined;

  const statement = trpc.factory.statement.useQuery({ from, to }, { enabled: open });

  async function downloadPdf() {
    if (!statement.data) return;
    setIsExporting(true);
    try {
      await exportFactoryAktSverkaPdf({
        periodLabel: fromDate || toDate ? `${fromDate || "boshidan"} — ${toDate || "hozirgacha"}` : "Barcha davr",
        products: statement.data.products,
        ledger: statement.data.ledger,
        generatedAt: statement.data.generatedAt,
      });
      toast.success("Zavod Akt sverka PDF yuklandi.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "PDF yaratib bo'lmadi.");
    } finally {
      setIsExporting(false);
    }
  }

  const data = statement.data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto rounded-2xl sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Zavod bilan Akt sverka</DialogTitle>
          <DialogDescription>Davr bo'yicha tara/keg va brak evazi hisob-kitobini ko'rish va PDF hujjat sifatida yuklab olish.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5"><Label>Boshlanish sanasi</Label><Input className="finance-input" type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} /></div>
          <div className="space-y-1.5"><Label>Tugash sanasi</Label><Input className="finance-input" type="date" value={toDate} onChange={event => setToDate(event.target.value)} /></div>
          <p className="pb-2 text-xs text-muted-foreground">Bo'sh qoldirilsa — butun davr</p>
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
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {data.products.map(row => (
                <div key={row.productId} className="rounded-2xl border border-border bg-muted p-4">
                  <p className="text-sm font-bold text-foreground">{row.productName}</p>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-muted-foreground">Tara: {row.openingTaraPending} → <span className="font-bold text-foreground">{row.closingTaraPending} dona</span></p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Brak: {row.openingBrakPending} → <span className="font-bold text-foreground">{row.closingBrakPending} dona</span></p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4">
              <h4 className="mb-2 text-sm font-bold text-foreground">Operatsiyalar tarixi</h4>
              {data.ledger.length === 0 ? <EmptyState title="Bu davrda operatsiya yo'q" /> : (
                <div className="overflow-hidden rounded-xl border border-border">
                  <Table className="finance-table"><TableHeader><TableRow>
                    <TableHead>Sana</TableHead><TableHead>Turi</TableHead><TableHead>KEG</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead className="text-right">Tara qoldiq</TableHead><TableHead className="text-right">Brak qoldiq</TableHead>
                  </TableRow></TableHeader><TableBody>
                    {data.ledger.map(row => {
                      const meta = operationMeta[row.operationType] ?? { label: row.operationType, badgeClass: "rounded-lg bg-muted text-muted-foreground" };
                      return (
                        <TableRow key={row.id}>
                          <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.operationDate)}</TableCell>
                          <TableCell><Badge className={meta.badgeClass}>{meta.label}</Badge></TableCell>
                          <TableCell>{row.productName ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.quantity, 0)} dona</TableCell>
                          <TableCell className="text-right tabular-nums">{formatNumber(row.taraPendingAfter, 0)} dona</TableCell>
                          <TableCell className="text-right font-bold tabular-nums">{formatNumber(row.brakPendingAfter, 0)} dona</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody></Table>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
