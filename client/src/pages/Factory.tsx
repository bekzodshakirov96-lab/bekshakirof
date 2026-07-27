import { ExportMenu } from "@/components/ExportMenu";
import { FactoryStatementDialog } from "@/components/FactoryStatementDialog";
import { EmptyState, PageHeader, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatMoney, formatNumber, localDateInputValue } from "@/lib/format";
import { exportReportPdf, exportReportXlsx, type ReportColumn } from "@/lib/report-export";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Banknote, FileText, Factory as FactoryIcon, PackageCheck, RotateCcw, Send, ShoppingCart, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type FactoryOperationType = "tara_sent" | "filled_received" | "brak_returned" | "brak_replaced";

const factoryOperationMeta: Record<FactoryOperationType, { label: string; icon: typeof Send; badgeClass: string }> = {
  tara_sent: { label: "Bo'sh tara yuborildi", icon: Send, badgeClass: "rounded-lg bg-muted text-muted-foreground hover:bg-muted" },
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
    <div className="mx-auto w-full max-w-[1500px]">
      <PageHeader
        eyebrow="Ombor"
        title="Zavod hisob-kitobi"
        description="Bo'sh tara yuborish, to'la keg qabul qilish va brak (yaroqsiz) KEG almashinuvini zavod bilan kuzating."
        action={<Button variant="outline" className="gap-2 bg-card" onClick={() => setStatementOpen(true)}><FileText className="size-4" />Akt sverka</Button>}
      />

      <SectionCard title="Joriy balanslar" description="Har bir KEG turi bo'yicha ombordagi, zavoddagi va brak evaziga kutilayotgan tara.">
        {balances.isLoading ? (
          <TableLoading columns={3} />
        ) : balanceRows.length === 0 ? (
          <EmptyState description="KEG turidagi mahsulot topilmadi." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {balanceRows.map(row => (
              <div key={row.productId} className="rounded-2xl border border-border bg-muted/60 p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-foreground"><FactoryIcon className="size-4 text-muted-foreground" />{row.productName}</p>
                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Omborda (bo'sh tara)</p>
                    <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatNumber(row.warehouseTara, 0)} dona</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Zavodda (to'lmagan tara)</p>
                    <p className={`mt-1 text-lg font-bold tabular-nums ${row.taraPending > 0 ? "text-amber-600" : "text-foreground"}`}>{formatNumber(row.taraPending, 0)} dona</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Brak evaziga kutilmoqda</p>
                    <p className={`mt-1 text-lg font-bold tabular-nums ${row.brakPending > 0 ? "text-rose-600" : "text-foreground"}`}>{formatNumber(row.brakPending, 0)} dona</p>
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
                  className={`flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-semibold transition-colors ${operationType === type ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
                >
                  <Icon className="size-4" />
                  {meta.label}
                </button>
              );
            })}
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <select className={`finance-input border px-3 text-foreground ${!productId ? "border-rose-300" : ""}`} value={productId} onChange={event => setProductId(event.target.value)}>
              <option value="">KEG turini tanlang</option>
              {balanceRows.map(row => <option key={row.productId} value={row.productId}>{row.productName}</option>)}
            </select>
            <Input className={`finance-input ${Number(quantity) <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`} type="text" inputMode="numeric" placeholder="Miqdor (dona)" value={quantity} onChange={event => setQuantity(event.target.value.replace(/[^0-9]/g, ""))} />
            <Input className="finance-input" type="date" value={date} onChange={event => setDate(event.target.value)} />
            <Button disabled={!canSubmit} onClick={submit}>{record.isPending ? "Saqlanmoqda..." : "Qo'shish"}</Button>
          </div>
          {!canSubmit && !record.isPending && blockingReasons.length > 0 && (
            <ul className="text-right text-xs font-medium text-rose-600">
              {blockingReasons.map(item => <li key={item}>{item}</li>)}
            </ul>
          )}
          <Input className="finance-input" placeholder="Izoh (ixtiyoriy)" value={note} onChange={event => setNote(event.target.value)} />
        </div>
      </SectionCard>

      <SectionCard
        title="Zavod operatsiyalari tarixi"
        description="So'nggi 20 ta yozuv"
        className="mt-5"
        action={<ExportMenu onExcel={() => exportHistory("xlsx")} onPdf={() => exportHistory("pdf")} isLoading={isExportingHistory} disabled={operations.isLoading} />}
      >
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
          {operations.isLoading ? <TableLoading columns={5} /> : operationRows.length === 0 ? <EmptyState description="Hali zavod operatsiyasi yo'q." /> : (
            <Table className="finance-table min-w-[760px]">
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
                      <TableCell className="max-w-56 truncate text-muted-foreground">{row.note ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <button
                          type="button"
                          aria-label="O'chirish"
                          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
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
    <SectionCard
      title="Butilka harakati"
      description="Yig'ilgan bo'sh butilkalarni zavodga sotish va zavoddan olingan pul hisobi."
      className="mt-5"
    >
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Qo'lda qolgan butilka</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatNumber(stats?.onHand ?? 0, 0)} dona</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Olingan {formatNumber(stats?.purchasedQuantity ?? 0, 0)} − yuborilgan {formatNumber(stats?.sentQuantity ?? 0, 0)}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sotib olishga xarajat</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-rose-600 dark:text-rose-400">{formatMoney(stats?.purchasedAmount ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sotuv summasi</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{formatMoney(stats?.sentAmount ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sof foyda</p>
          <p className={`mt-1 text-lg font-bold tabular-nums ${(stats?.profit ?? 0) >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
            {formatMoney(stats?.profit ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Sotuv − xarajat</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Zavod to'lagan</p>
          <p className="mt-1 text-lg font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{formatMoney(stats?.paidAmount ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/60 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Zavod qarzi</p>
          <p className={`mt-1 text-lg font-bold tabular-nums ${(stats?.outstanding ?? 0) > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground"}`}>
            {formatMoney(stats?.outstanding ?? 0)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:max-w-2xl">
          {(Object.keys(bottleTypeMeta) as BottleEntryType[]).map(type => {
            const meta = bottleTypeMeta[type];
            const Icon = meta.icon;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setEntryType(type)}
                className={`flex h-14 flex-col items-center justify-center gap-1 rounded-xl border text-[11px] font-semibold transition-colors ${entryType === type ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
              >
                <Icon className="size-4" />
                {meta.label}
              </button>
            );
          })}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {isPayment ? (
            <Input
              className={`finance-input md:col-span-2 ${amountValue <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
              type="text" inputMode="numeric" placeholder="Olingan summa (so'm)"
              value={amount} onChange={event => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
            />
          ) : (
            <>
              <Input
                className={`finance-input ${quantityValue <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
                type="text" inputMode="numeric" placeholder="Butilka soni (dona)"
                value={quantity} onChange={event => setQuantity(event.target.value.replace(/[^0-9]/g, ""))}
              />
              <Input
                className={`finance-input ${priceValue <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
                type="text" inputMode="numeric"
                placeholder={entryType === "purchase" ? "Olingan narx (1 dona)" : "Sotish narxi (1 dona)"}
                value={entryType === "purchase" ? purchasePrice : salePrice}
                onChange={event => {
                  const next = event.target.value.replace(/[^0-9]/g, "");
                  if (entryType === "purchase") setPurchasePrice(next);
                  else setSalePrice(next);
                }}
              />
            </>
          )}
          <Input className="finance-input" type="date" value={date} onChange={event => setDate(event.target.value)} />
          <Button disabled={!canSubmit} onClick={submit}>{create.isPending ? "Saqlanmoqda..." : "Qo'shish"}</Button>
        </div>

        {!isPayment && computedTotal > 0 ? (
          <p className="text-right text-xs font-semibold text-muted-foreground">
            Hisoblangan summa: <span className="text-foreground">{formatMoney(computedTotal)}</span>
          </p>
        ) : null}
        {!canSubmit && !create.isPending && blockingReasons.length > 0 && (
          <ul className="text-right text-xs font-medium text-rose-600">
            {blockingReasons.map(item => <li key={item}>{item}</li>)}
          </ul>
        )}
        <Input className="finance-input" placeholder="Izoh (ixtiyoriy)" value={note} onChange={event => setNote(event.target.value)} />
      </div>

      <div className="-mx-5 -mb-5 mt-5 overflow-hidden rounded-b-2xl border-t border-border">
        {list.isLoading ? <TableLoading columns={6} /> : rows.length === 0 ? (
          <EmptyState description="Hali butilka harakati yo'q. Yuqoridagi forma orqali qo'shing." />
        ) : (
          <Table className="finance-table min-w-[820px]">
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
                  purchase: { label: "Sotib olindi", className: "rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50 dark:bg-rose-500/15 dark:text-rose-300" },
                  sent: { label: "Zavodga yuborildi", className: "rounded-lg bg-muted text-muted-foreground hover:bg-muted" },
                  payment: { label: "Pul olindi", className: "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-500/15 dark:text-emerald-300" },
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
                    <TableCell className="text-right font-bold tabular-nums">{formatMoney(row.balanceAfter)}</TableCell>
                    <TableCell className="max-w-56 truncate text-muted-foreground">{row.note ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <button
                        type="button"
                        aria-label="O'chirish"
                        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
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
    </SectionCard>
  );
}
