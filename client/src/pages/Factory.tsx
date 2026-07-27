import { ExportMenu } from "@/components/ExportMenu";
import { FactoryStatementDialog } from "@/components/FactoryStatementDialog";
import { EmptyState, PageHeader, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber, localDateInputValue } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, FileText, Factory as FactoryIcon, PackageCheck, RotateCcw, Send, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type FactoryOperationType = "tara_sent" | "filled_received" | "brak_returned" | "brak_replaced";

const factoryOperationMeta: Record<FactoryOperationType, { label: string; icon: typeof Send; badgeClass: string }> = {
  tara_sent: { label: "Bo'sh tara yuborildi", icon: Send, badgeClass: "rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-100" },
  filled_received: { label: "To'la keg qabul qilindi", icon: PackageCheck, badgeClass: "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" },
  brak_returned: { label: "Brak qaytarildi", icon: AlertTriangle, badgeClass: "rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50" },
  brak_replaced: { label: "Brak o'rniga keg keldi", icon: RotateCcw, badgeClass: "rounded-lg bg-teal-50 text-teal-700 hover:bg-teal-50" },
};

/** Zavod bilan tara/KEG almashinuvi: bo'sh tara yuborish, to'la keg qabul qilish, brak qaytarish
 * va brak evaziga yangi keg qabul qilish. Kirim/chiqim turlari Sklad qoldig'iga avtomatik ta'sir qiladi. */
export default function Factory() {
  const utils = trpc.useUtils();
  const balances = trpc.factory.balances.useQuery();
  const operations = trpc.factory.operations.useQuery({ page: 1, pageSize: 20 });
  const [operationType, setOperationType] = useState<FactoryOperationType>("tara_sent");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(() => localDateInputValue());
  const [note, setNote] = useState("");
  const [statementOpen, setStatementOpen] = useState(false);
  const [isExportingHistory, setIsExportingHistory] = useState(false);

  const record = trpc.factory.record.useMutation({
    onSuccess: async () => {
      toast.success("Zavod operatsiyasi qo'shildi");
      setQuantity("");
      setNote("");
      await Promise.all([utils.factory.balances.invalidate(), utils.factory.operations.invalidate(), utils.stock.list.invalidate(), utils.stock.movements.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const deleteOperation = trpc.factory.delete.useMutation({
    onSuccess: async () => {
      toast.success("Yozuv o'chirildi");
      await Promise.all([utils.factory.balances.invalidate(), utils.factory.operations.invalidate(), utils.stock.list.invalidate(), utils.stock.movements.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const balanceRows = balances.data ?? [];
  const operationRows = operations.data?.items ?? [];
  const canSubmit = Boolean(productId) && Number(quantity) > 0 && !record.isPending;

  function submit() {
    record.mutate({
      operationType,
      productId: Number(productId),
      quantity: Math.round(Number(quantity)),
      operationDate: new Date(`${date}T00:00:00`).getTime(),
      note: note || undefined,
    });
  }

  async function exportHistory(format: "xlsx" | "pdf") {
    setIsExportingHistory(true);
    try {
      const data = await utils.factory.statement.fetch({});
      type Row = (typeof data.ledger)[number];
      const columns: ReportColumn<Row>[] = [
        { title: "Sana", value: row => formatDate(row.operationDate), width: 48 },
        { title: "Turi", value: row => factoryOperationMeta[row.operationType as FactoryOperationType]?.label ?? row.operationType, width: 90 },
        { title: "KEG", value: row => row.productName ?? "—", width: 70 },
        { title: "Miqdor", value: row => row.quantity, width: 45, align: "right", numberFormat: "#,##0" },
        { title: "Tara qoldiq", value: row => row.taraPendingAfter, width: 50, align: "right", numberFormat: "#,##0" },
        { title: "Brak qoldiq", value: row => row.brakPendingAfter, width: 50, align: "right", numberFormat: "#,##0" },
        { title: "Izoh", value: row => row.note ?? "—", width: "*" },
      ];
      const options = {
        title: "Zavod operatsiyalari tarixi",
        fileName: `zavod_operatsiyalari_${localDateInputValue()}`,
        rows: data.ledger, columns, generatedAt: data.generatedAt,
      };
      if (format === "xlsx") await exportReportXlsx(options); else await exportReportPdf(options);
      toast.success(`${format === "xlsx" ? "Excel" : "PDF"} hisoboti yuklandi.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Hisobotni eksport qilib bo'lmadi.");
    } finally {
      setIsExportingHistory(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <PageHeader
        eyebrow="Ombor"
        title="Zavod hisob-kitobi"
        description="Bo'sh tara yuborish, to'la keg qabul qilish va brak (yaroqsiz) KEG almashinuvini zavod bilan kuzating."
        action={<Button variant="outline" className="gap-2 bg-white" onClick={() => setStatementOpen(true)}><FileText className="size-4" />Akt sverka</Button>}
      />

      <SectionCard title="Joriy balanslar" description="Har bir KEG turi bo'yicha ombordagi, zavoddagi va brak evaziga kutilayotgan tara.">
        {balances.isLoading ? (
          <TableLoading columns={3} />
        ) : balanceRows.length === 0 ? (
          <EmptyState description="KEG turidagi mahsulot topilmadi." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {balanceRows.map(row => (
              <div key={row.productId} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-slate-900"><FactoryIcon className="size-4 text-slate-400" />{row.productName}</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Omborda (bo'sh tara)</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-slate-900">{formatNumber(row.warehouseTara, 0)} dona</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Zavodda (to'lmagan tara)</p>
                    <p className={`mt-1 text-lg font-bold tabular-nums ${row.taraPending > 0 ? "text-amber-600" : "text-slate-900"}`}>{formatNumber(row.taraPending, 0)} dona</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Brak evaziga kutilmoqda</p>
                    <p className={`mt-1 text-lg font-bold tabular-nums ${row.brakPending > 0 ? "text-rose-600" : "text-slate-900"}`}>{formatNumber(row.brakPending, 0)} dona</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Yangi operatsiya" description="Tara/keg harakatini qayd eting." className="mt-5">
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(Object.keys(factoryOperationMeta) as FactoryOperationType[]).map(type => {
              const meta = factoryOperationMeta[type];
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setOperationType(type)}
                  className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-semibold transition-colors ${operationType === type ? "border-primary bg-primary/5 text-primary" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                >
                  <Icon className="size-4" />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select className="finance-input border px-3 text-slate-700" value={productId} onChange={event => setProductId(event.target.value)}>
              <option value="">KEG turini tanlang</option>
              {balanceRows.map(row => <option key={row.productId} value={row.productId}>{row.productName}</option>)}
            </select>
            <Input className="finance-input" type="text" inputMode="numeric" placeholder="Miqdor (dona)" value={quantity} onChange={event => setQuantity(event.target.value.replace(/[^0-9]/g, ""))} />
            <Input className="finance-input" type="date" value={date} onChange={event => setDate(event.target.value)} />
            <Button disabled={!canSubmit} onClick={submit}>{record.isPending ? "Saqlanmoqda..." : "Qo'shish"}</Button>
          </div>
          <Input className="finance-input" placeholder="Izoh (ixtiyoriy)" value={note} onChange={event => setNote(event.target.value)} />
        </div>
      </SectionCard>

      <SectionCard
        title="Zavod operatsiyalari tarixi"
        description="So'nggi 20 ta yozuv"
        className="mt-5"
        action={<ExportMenu onExcel={() => exportHistory("xlsx")} onPdf={() => exportHistory("pdf")} isLoading={isExportingHistory} disabled={operations.isLoading} />}
      >
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-slate-100">
          {operations.isLoading ? <TableLoading columns={5} /> : operationRows.length === 0 ? <EmptyState description="Hali zavod operatsiyasi yo'q." /> : (
            <Table className="finance-table min-w-[760px]">
              <TableHeader><TableRow><TableHead>Sana</TableHead><TableHead>Turi</TableHead><TableHead>KEG</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead>Izoh</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {operationRows.map(row => {
                  const meta = factoryOperationMeta[row.operationType as FactoryOperationType];
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-slate-500">{formatDate(row.operationDate)}</TableCell>
                      <TableCell><Badge className={meta.badgeClass}>{meta.label}</Badge></TableCell>
                      <TableCell className="font-semibold text-slate-900">{row.productName ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatNumber(row.quantity, 0)} dona</TableCell>
                      <TableCell className="max-w-56 truncate text-slate-500">{row.note ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          aria-label="O'chirish"
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                          onClick={() => deleteOperation.mutate({ id: row.id })}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </SectionCard>

      <FactoryStatementDialog open={statementOpen} onOpenChange={setStatementOpen} />
    </div>
  );
}
