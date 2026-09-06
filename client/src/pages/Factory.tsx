import { ExportMenu } from "@/components/ExportMenu";
import { FactoryStatementDialog } from "@/components/FactoryStatementDialog";
import { EmptyState, PageHeader, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatNumber, localDateInputValue } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Banknote, FileText, Factory as FactoryIcon, PackageCheck, RotateCcw, Send, ShoppingCart, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

type FactoryOperationType = "tara_sent" | "filled_received" | "brak_returned" | "brak_replaced";

const factoryOperationMeta: Record<FactoryOperationType, { label: string; icon: typeof Send; badgeClass: string }> = {
  tara_sent: { label: "Bo'sh tara yuborildi", icon: Send, badgeClass: "rounded-md bg-primary/10 text-primary hover:bg-primary/10" },
  filled_received: { label: "To'la keg qabul qilindi", icon: PackageCheck, badgeClass: "rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-300" },
  brak_returned: { label: "Brak qaytarildi", icon: AlertTriangle, badgeClass: "rounded-md bg-rose-50 text-rose-700 hover:bg-rose-50 dark:bg-rose-500/15 dark:text-rose-300" },
  brak_replaced: { label: "Brak o'rniga keg keldi", icon: RotateCcw, badgeClass: "rounded-md bg-muted text-muted-foreground hover:bg-muted" },
};

function FactorySection({ title, description, action, children }: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

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
  const blockingReasons: string[] = [];
  if (!productId) blockingReasons.push("KEG turi tanlanmagan");
  if (Number(quantity) <= 0) blockingReasons.push("Miqdor kiritilmagan");

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
    <div className="mx-auto w-full max-w-[1600px] space-y-4 text-sm">
      <PageHeader
        eyebrow="Ombor"
        title="Zavod hisob-kitobi"
        description="Tara almashinuvi, KEG qoldiqlari va zavod bilan hisob-kitob."
        action={<Button variant="outline" className="h-9 gap-2 rounded-lg bg-card" onClick={() => setStatementOpen(true)}><FileText className="size-4" />Akt sverka</Button>}
      />

      <FactorySection title="Joriy tara qoldiqlari" action={<span className="text-xs text-muted-foreground">O'lchov birligi: dona</span>}>
        {balances.isLoading ? (
          <TableLoading columns={4} rows={2} />
        ) : balanceRows.length === 0 ? (
          <EmptyState description="KEG turidagi mahsulot topilmadi." />
        ) : (
          <Table className="finance-table min-w-[650px] [&_td]:px-4 [&_th]:px-4">
            <TableHeader>
              <TableRow>
                <TableHead>KEG turi</TableHead>
                <TableHead className="text-right">Omborda · bo'sh tara</TableHead>
                <TableHead className="text-right">Zavodda · to'lmagan tara</TableHead>
                <TableHead className="text-right">Brak evaziga kutilmoqda</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balanceRows.map(row => (
                <TableRow key={row.productId}>
                  <TableCell className="font-semibold text-foreground">
                    <span className="flex items-center gap-2.5"><FactoryIcon className="size-4 text-primary" />{row.productName}</span>
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums text-foreground">{formatNumber(row.warehouseTara, 0)}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${row.taraPending > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>{formatNumber(row.taraPending, 0)}</TableCell>
                  <TableCell className={`text-right font-semibold tabular-nums ${row.brakPending > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground"}`}>{formatNumber(row.brakPending, 0)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </FactorySection>

      <FactorySection title="Yangi operatsiya" description="Harakat turini tanlab, miqdorni kiriting.">
        <div className="grid gap-3 p-4">
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-border bg-muted/50 p-1 xl:grid-cols-4" role="group" aria-label="Tara operatsiyasi turi">
            {(Object.keys(factoryOperationMeta) as FactoryOperationType[]).map(type => {
              const meta = factoryOperationMeta[type];
              const Icon = meta.icon;
              return (
                <button
                  key={type}
                  type="button"
                  aria-pressed={operationType === type}
                  onClick={() => setOperationType(type)}
                  className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${operationType === type ? "bg-card text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-card/70 hover:text-foreground"}`}
                >
                  <Icon className="size-4 shrink-0" />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_1fr_1.5fr_auto]">
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              KEG turi
              <select className={`finance-input w-full border px-3 text-foreground ${!productId ? "border-rose-300" : ""}`} value={productId} onChange={event => setProductId(event.target.value)}>
                <option value="">KEG turini tanlang</option>
                {balanceRows.map(row => <option key={row.productId} value={row.productId}>{row.productName}</option>)}
              </select>
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              Miqdor, dona
              <Input className={`finance-input text-foreground ${Number(quantity) <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`} type="text" inputMode="numeric" placeholder="0" value={quantity} onChange={event => setQuantity(event.target.value.replace(/[^0-9]/g, ""))} />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              Sana
              <Input className="finance-input text-foreground" type="date" value={date} onChange={event => setDate(event.target.value)} />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              Izoh
              <Input className="finance-input text-foreground" placeholder="Ixtiyoriy" value={note} onChange={event => setNote(event.target.value)} />
            </label>
            <Button className="h-10 rounded-lg px-5 sm:col-span-2 xl:col-span-1" disabled={!canSubmit} onClick={submit}>{record.isPending ? "Saqlanmoqda..." : "Qo'shish"}</Button>
          </div>
          {!canSubmit && !record.isPending && blockingReasons.length > 0 && (
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-rose-600 dark:text-rose-400">
              {blockingReasons.map(item => <li key={item}>{item}</li>)}
            </ul>
          )}
        </div>
      </FactorySection>

      <FactorySection
        title="Zavod operatsiyalari tarixi"
        description="So'nggi 20 ta yozuv"
        action={<ExportMenu onExcel={() => exportHistory("xlsx")} onPdf={() => exportHistory("pdf")} isLoading={isExportingHistory} disabled={operations.isLoading} />}
      >
        <div>
          {operations.isLoading ? <TableLoading columns={6} rows={4} /> : operationRows.length === 0 ? <EmptyState description="Hali zavod operatsiyasi yo'q." /> : (
            <Table className="finance-table min-w-[850px] [&_td]:px-4 [&_th]:px-4">
              <TableHeader><TableRow><TableHead>Sana</TableHead><TableHead>Turi</TableHead><TableHead>KEG</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead>Izoh</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>
                {operationRows.map(row => {
                  const meta = factoryOperationMeta[row.operationType as FactoryOperationType];
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.operationDate)}</TableCell>
                      <TableCell><Badge className={meta.badgeClass}>{meta.label}</Badge></TableCell>
                      <TableCell className="font-semibold text-foreground">{row.productName ?? "—"}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">{formatNumber(row.quantity, 0)} dona</TableCell>
                      <TableCell className="max-w-64 truncate text-muted-foreground" title={row.note ?? undefined}>{row.note ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          aria-label="O'chirish"
                          className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
      </FactorySection>

      <BottleLedger />

      <FactoryStatementDialog open={statementOpen} onOpenChange={setStatementOpen} />
    </div>
  );
}

/** Zavodga sotish narxi — yangi yozuvda shu qiymat taklif qilinadi, lekin narx
 * o'zgarsa qo'lda tuzatish mumkin (har bir yozuv o'z narxini saqlaydi). */
const DEFAULT_SALE_PRICE = "1700";

type BottleEntryType = "purchase" | "sent" | "payment";

const bottleTypeMeta: Record<BottleEntryType, { label: string; icon: typeof Send }> = {
  purchase: { label: "Butilka sotib olindi", icon: ShoppingCart },
  sent: { label: "Zavodga yuborildi", icon: Send },
  payment: { label: "Zavoddan pul olindi", icon: Banknote },
};

/**
 * Butilka harakati: yig'ilgan bo'sh butilkalarni zavodga sotish va zavoddan
 * pul olish hisobi. Kassa bilan bog'lanmagan — mustaqil hisob-kitob.
 */
function BottleLedger() {
  const utils = trpc.useUtils();
  const summary = trpc.factory.bottles.summary.useQuery();
  const list = trpc.factory.bottles.list.useQuery({ limit: 100 });

  const [entryType, setEntryType] = useState<BottleEntryType>("purchase");
  const [date, setDate] = useState(() => localDateInputValue());
  const [quantity, setQuantity] = useState("");
  /** Sotib olish va sotish narxlari alohida saqlanadi — tur almashganda
   * bir-birini o'chirib yubormasligi uchun. */
  const [purchasePrice, setPurchasePrice] = useState("");
  const [salePrice, setSalePrice] = useState(DEFAULT_SALE_PRICE);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const refresh = () =>
    Promise.all([utils.factory.bottles.summary.invalidate(), utils.factory.bottles.list.invalidate()]);

  const create = trpc.factory.bottles.create.useMutation({
    onSuccess: async () => {
      toast.success(`${bottleTypeMeta[entryType].label} — qayd etildi`);
      setQuantity(""); setAmount(""); setNote("");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.factory.bottles.delete.useMutation({
    onSuccess: async () => { toast.success("Yozuv o'chirildi"); await refresh(); },
    onError: error => toast.error(error.message),
  });

  const isPayment = entryType === "payment";
  const quantityValue = Number(quantity || 0);
  const priceValue = Number((entryType === "purchase" ? purchasePrice : salePrice) || 0);
  const amountValue = Number(amount || 0);
  /** Soni × narx — foydalanuvchi saqlashdan oldin summani ko'rib turadi. */
  const computedTotal = quantityValue * priceValue;

  const blockingReasons: string[] = [];
  if (isPayment) {
    if (amountValue <= 0) blockingReasons.push("Summa kiritilmagan");
  } else {
    if (quantityValue <= 0) blockingReasons.push("Butilka soni kiritilmagan");
    if (priceValue <= 0) blockingReasons.push(entryType === "purchase" ? "Olingan narx kiritilmagan" : "Sotish narxi kiritilmagan");
  }
  const canSubmit = blockingReasons.length === 0 && !create.isPending;

  function submit() {
    const movementDate = new Date(`${date}T12:00:00`).getTime();
    if (isPayment) {
      create.mutate({ movementType: "payment", movementDate, amount: amountValue, note: note || undefined });
      return;
    }
    create.mutate({
      movementType: entryType === "purchase" ? "purchase" : "sent",
      movementDate,
      quantity: quantityValue,
      unitPrice: priceValue,
      note: note || undefined,
    });
  }

  const rows = list.data ?? [];
  const stats = summary.data;

  return (
    <FactorySection
      title="Butilka harakati"
      description="Bo'sh butilkalar xaridi, zavodga sotuv va to'lovlar."
    >
      <div className="grid grid-cols-2 gap-px border-b border-border bg-border sm:grid-cols-3 2xl:grid-cols-6">
        <div className="min-w-0 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Qo'lda qolgan butilka</p>
          <p className="mt-1.5 break-words text-lg font-semibold tabular-nums text-foreground">{formatNumber(stats?.onHand ?? 0, 0)} <span className="text-xs font-normal text-muted-foreground">dona</span></p>
          <p className="mt-1 text-xs text-muted-foreground">
            Olingan {formatNumber(stats?.purchasedQuantity ?? 0, 0)} − yuborilgan {formatNumber(stats?.sentQuantity ?? 0, 0)}
          </p>
        </div>
        <div className="min-w-0 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Sotib olishga xarajat</p>
          <p className="mt-1.5 break-words text-lg font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(stats?.purchasedAmount ?? 0)}</p>
        </div>
        <div className="min-w-0 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Sotuv summasi</p>
          <p className="mt-1.5 break-words text-lg font-semibold tabular-nums text-foreground">{formatMoney(stats?.sentAmount ?? 0)}</p>
        </div>
        <div className="min-w-0 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Sof foyda</p>
          <p className={`mt-1.5 break-words text-lg font-semibold tabular-nums ${(stats?.profit ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {formatMoney(stats?.profit ?? 0)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Sotuv − xarajat</p>
        </div>
        <div className="min-w-0 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Zavod to'lagan</p>
          <p className="mt-1.5 break-words text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(stats?.paidAmount ?? 0)}</p>
        </div>
        <div className="min-w-0 bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">Zavod qarzi</p>
          <p className={`mt-1.5 break-words text-lg font-semibold tabular-nums ${(stats?.outstanding ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
            {formatMoney(stats?.outstanding ?? 0)}
          </p>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        <div className="grid grid-cols-1 gap-1 rounded-xl border border-border bg-muted/50 p-1 sm:grid-cols-3 xl:max-w-3xl" role="group" aria-label="Butilka harakati turi">
          {(Object.keys(bottleTypeMeta) as BottleEntryType[]).map(type => {
            const meta = bottleTypeMeta[type];
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                aria-pressed={entryType === type}
                onClick={() => setEntryType(type)}
                className={`flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${entryType === type ? "bg-card text-primary shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-card/70 hover:text-foreground"}`}
              >
                <Icon className="size-4 shrink-0" />
                {meta.label}
              </button>
            );
          })}
        </div>

        <div className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1.5fr_auto]">
          {isPayment ? (
            <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground sm:col-span-2">
              Olingan summa, so'm
              <Input
                className={`finance-input text-foreground ${amountValue <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
                type="text" inputMode="numeric" placeholder="0"
                value={amount} onChange={event => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
              />
            </label>
          ) : (
            <>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
                Butilka soni, dona
                <Input
                  className={`finance-input text-foreground ${quantityValue <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
                  type="text" inputMode="numeric" placeholder="0"
                  value={quantity} onChange={event => setQuantity(event.target.value.replace(/[^0-9]/g, ""))}
                />
              </label>
              <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
                {entryType === "purchase" ? "Olingan narx, 1 dona" : "Sotish narxi, 1 dona"}
                <Input
                  className={`finance-input text-foreground ${priceValue <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
                  type="text" inputMode="numeric" placeholder="0"
                  value={entryType === "purchase" ? purchasePrice : salePrice}
                  onChange={event => {
                    const next = event.target.value.replace(/[^0-9]/g, "");
                    if (entryType === "purchase") setPurchasePrice(next);
                    else setSalePrice(next);
                  }}
                />
              </label>
            </>
          )}
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
            Sana
            <Input className="finance-input text-foreground" type="date" value={date} onChange={event => setDate(event.target.value)} />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
            Izoh
            <Input className="finance-input text-foreground" placeholder="Ixtiyoriy" value={note} onChange={event => setNote(event.target.value)} />
          </label>
          <Button className="h-10 rounded-lg px-5 sm:col-span-2 xl:col-span-1" disabled={!canSubmit} onClick={submit}>{create.isPending ? "Saqlanmoqda..." : "Qo'shish"}</Button>
        </div>

        {!isPayment && computedTotal > 0 ? (
          <p className="text-xs text-muted-foreground">
            Hisoblangan summa: <span className="font-semibold tabular-nums text-foreground">{formatMoney(computedTotal)}</span>
          </p>
        ) : null}
        {!canSubmit && !create.isPending && blockingReasons.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-rose-600 dark:text-rose-400">
            {blockingReasons.map(item => <li key={item}>{item}</li>)}
          </ul>
        )}
      </div>

      <div className="border-t border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h4 className="text-sm font-semibold text-foreground">Butilka harakatlari tarixi</h4>
          <span className="text-xs text-muted-foreground">So'nggi 100 ta yozuv</span>
        </div>
        {list.isLoading ? <TableLoading columns={8} rows={4} /> : rows.length === 0 ? (
          <EmptyState description="Hali butilka harakati yo'q. Yuqoridagi forma orqali qo'shing." />
        ) : (
          <Table className="finance-table min-w-[1000px] [&_td]:px-4 [&_th]:px-4">
            <TableHeader>
              <TableRow>
                <TableHead>Sana</TableHead>
                <TableHead>Turi</TableHead>
                <TableHead className="text-right">Soni</TableHead>
                <TableHead className="text-right">Narx</TableHead>
                <TableHead className="text-right">Summa</TableHead>
                <TableHead className="text-right">Zavod qarzi</TableHead>
                <TableHead>Izoh</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => {
                const hasQuantity = row.movementType !== "payment";
                const badge = {
                  purchase: { label: "Sotib olindi", className: "rounded-md bg-rose-50 text-rose-700 hover:bg-rose-50 dark:bg-rose-500/15 dark:text-rose-300" },
                  sent: { label: "Zavodga yuborildi", className: "rounded-md bg-primary/10 text-primary hover:bg-primary/10" },
                  payment: { label: "Pul olindi", className: "rounded-md bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-300" },
                }[row.movementType];
                /** Xarajat qizil (−), sotuv va tushum yashil/qora (+). */
                const amountClass =
                  row.movementType === "purchase" ? "text-rose-600 dark:text-rose-400"
                  : row.movementType === "payment" ? "text-emerald-600 dark:text-emerald-400"
                  : "text-foreground";
                return (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(row.movementDate)}</TableCell>
                    <TableCell><Badge className={badge.className}>{badge.label}</Badge></TableCell>
                    <TableCell className="text-right tabular-nums">{hasQuantity ? `${formatNumber(row.quantity, 0)} dona` : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{hasQuantity ? formatMoney(row.unitPrice) : "—"}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${amountClass}`}>
                      {row.movementType === "purchase" ? "−" : row.movementType === "payment" ? "−" : "+"}{formatMoney(row.amount)}
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(row.balanceAfter)}</TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground" title={row.note ?? undefined}>{row.note ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        aria-label="O'chirish"
                        className="ml-auto flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        onClick={() => remove.mutate({ id: row.id })}
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
    </FactorySection>
  );
}
