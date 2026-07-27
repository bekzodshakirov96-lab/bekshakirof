import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatNumber, localDateInputValue, sanitizeDecimalInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, Package, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

function dateToTimestamp(value: string): number {
  return new Date(`${value}T00:00:00`).getTime();
}

/** Inline-editable "Min. chegara" cell — saves on blur when changed. */
function MinLevelCell({ productId, minStockLevel }: { productId: number; minStockLevel: number }) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(String(minStockLevel));
  const setMinLevel = trpc.stock.setMinLevel.useMutation({
    onSuccess: async () => { await utils.stock.list.invalidate(); },
    onError: error => { toast.error(error.message); setValue(String(minStockLevel)); },
  });
  return (
    <Input
      className="finance-input h-9 w-24 text-right"
      type="text"
      inputMode="numeric"
      value={value}
      onChange={event => setValue(event.target.value.replace(/[^0-9]/g, ""))}
      onBlur={() => {
        const parsed = Math.max(0, Number(value) || 0);
        setValue(String(parsed));
        if (parsed !== minStockLevel) setMinLevel.mutate({ id: productId, minStockLevel: parsed });
      }}
    />
  );
}

type StockCartLine = { key: string; productId: number; productName: string; unit: string; quantity: string };

/** Kirim uchun: bir nechta mahsulotni checkbox orqali tanlab, har biriga alohida miqdor kiritish. */
function StockInBatchForm() {
  const utils = trpc.useUtils();
  const products = trpc.stock.list.useQuery();
  const [cart, setCart] = useState<StockCartLine[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [date, setDate] = useState(() => localDateInputValue());
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!pickerOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPickerOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [pickerOpen]);

  const productList = products.data ?? [];
  const cartProductIds = useMemo(() => new Set(cart.map(line => line.productId)), [cart]);
  const filteredProducts = useMemo(() => {
    const needle = productSearch.trim().toLocaleLowerCase("uz-Latn");
    if (!needle) return productList;
    return productList.filter(product => product.name.toLocaleLowerCase("uz-Latn").includes(needle));
  }, [productList, productSearch]);

  function toggleProduct(product: (typeof productList)[number]) {
    if (cartProductIds.has(product.id)) {
      setCart(current => current.filter(line => line.productId !== product.id));
      return;
    }
    setCart(current => [...current, { key: `${product.id}-${Date.now()}`, productId: product.id, productName: product.name, unit: product.unit, quantity: "" }]);
  }

  function updateLineQuantity(key: string, quantity: string) {
    setCart(current => current.map(line => (line.key === key ? { ...line, quantity } : line)));
  }

  function removeLine(key: string) {
    setCart(current => current.filter(line => line.key !== key));
  }

  const stockInBatch = trpc.stock.stockInBatch.useMutation({
    onSuccess: async result => {
      toast.success(`${result.count} ta mahsulot bo'yicha kirim qo'shildi`);
      setCart([]); setNote("");
      await Promise.all([utils.stock.list.invalidate(), utils.stock.movements.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const hasInvalidLine = cart.some(line => Number(line.quantity || 0) <= 0);
  const canSubmit = cart.length > 0 && !hasInvalidLine && !stockInBatch.isPending;
  const emptyQuantityLines = cart.filter(line => Number(line.quantity || 0) <= 0).length;
  const blockingReasons: string[] = [];
  if (emptyQuantityLines > 0) blockingReasons.push(`${emptyQuantityLines} ta mahsulotda miqdor kiritilmagan`);

  function submit() {
    stockInBatch.mutate({
      movementDate: dateToTimestamp(date),
      note: note || undefined,
      items: cart.map(line => ({ productId: line.productId, quantity: Number(line.quantity) })),
    });
  }

  return (
    <div>
      <div className="relative mb-4" ref={pickerRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="finance-input pl-9"
            placeholder="Mahsulot qidirish va qo'shish uchun bosing..."
            value={productSearch}
            onFocus={() => setPickerOpen(true)}
            onClick={() => setPickerOpen(true)}
            onChange={event => { setProductSearch(event.target.value); setPickerOpen(true); }}
          />
        </div>
        {pickerOpen && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
              <span className="text-xs font-semibold text-slate-500">{cartProductIds.size > 0 ? `${cartProductIds.size} ta tanlandi` : "Tanlash uchun bosing"}</span>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setPickerOpen(false)}>Tayyor</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filteredProducts.length === 0 ? (
                <div className="p-4 text-sm text-slate-400">Mahsulot topilmadi.</div>
              ) : filteredProducts.map(product => (
                <button
                  key={product.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50"
                  onClick={() => toggleProduct(product)}
                >
                  <Checkbox checked={cartProductIds.has(product.id)} />
                  <span className="min-w-0 flex-1 font-semibold text-slate-900">{product.name}</span>
                  <span className="shrink-0 text-xs text-slate-400">Qoldiq: {formatNumber(product.currentStock, 1)} {product.unit}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 py-10 text-center text-slate-400">
          <ShoppingCart className="size-8" />
          <p className="text-sm">Hali mahsulot tanlanmagan. Yuqoridagi qidiruv orqali qo'shing.</p>
        </div>
      ) : (
        <Table className="finance-table">
          <TableHeader><TableRow><TableHead>Mahsulot</TableHead><TableHead className="w-40 text-right">Miqdor</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
          <TableBody>
            {cart.map(line => (
              <TableRow key={line.key}>
                <TableCell className="font-semibold text-slate-900">{line.productName}</TableCell>
                <TableCell className="text-right">
                  <Input
                    className={`finance-input text-right ${Number(line.quantity || 0) <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`}
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={line.quantity}
                    onChange={event => updateLineQuantity(line.key, sanitizeDecimalInput(event.target.value))}
                  />
                  <span className="mt-1 block text-[11px] text-slate-400">{line.unit}</span>
                </TableCell>
                <TableCell><button type="button" aria-label="O'chirish" className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => removeLine(line.key)}><Trash2 className="size-4" /></button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Input className="finance-input" type="date" value={date} onChange={event => setDate(event.target.value)} />
        <Input className="finance-input" placeholder="Izoh (ixtiyoriy)" value={note} onChange={event => setNote(event.target.value)} />
        <Button disabled={!canSubmit} onClick={submit} className="bg-emerald-600 hover:bg-emerald-700">
          {stockInBatch.isPending ? "Saqlanmoqda..." : cart.length > 1 ? `${cart.length} ta mahsulot kirim qilish` : "Kirim qo'shish"}
        </Button>
      </div>
      {!canSubmit && !stockInBatch.isPending && blockingReasons.length > 0 && (
        <ul className="mt-2 text-right text-xs font-medium text-rose-600">
          {blockingReasons.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </div>
  );
}

/** Chiqim uchun: bitta mahsulot + sabab (zarar, ishlatish va h.k.). */
function StockOutForm() {
  const utils = trpc.useUtils();
  const products = trpc.stock.list.useQuery();
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [date, setDate] = useState(() => localDateInputValue());
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  const stockOut = trpc.stock.stockOut.useMutation({
    onSuccess: async () => {
      toast.success("Chiqim qo'shildi");
      setQuantity(""); setReason(""); setNote("");
      await Promise.all([utils.stock.list.invalidate(), utils.stock.movements.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const productList = products.data ?? [];
  const canSubmit = productId && Number(quantity) > 0 && reason.trim().length >= 2 && !stockOut.isPending;
  const blockingReasons: string[] = [];
  if (!productId) blockingReasons.push("Mahsulot tanlanmagan");
  if (Number(quantity) <= 0) blockingReasons.push("Miqdor kiritilmagan");
  if (reason.trim().length > 0 && reason.trim().length < 2) blockingReasons.push("Sabab kamida 2 belgidan iborat bo'lishi kerak");
  else if (reason.trim().length === 0) blockingReasons.push("Sabab kiritilmagan (masalan: zarar, ishlatish)");

  function submit() {
    stockOut.mutate({ productId: Number(productId), quantity: Number(quantity), movementDate: dateToTimestamp(date), reason: reason.trim(), note: note || undefined });
  }

  return (
    <div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <select className={`finance-input border px-3 text-slate-700 ${!productId ? "border-rose-300" : ""}`} value={productId} onChange={event => setProductId(event.target.value)}>
          <option value="">Mahsulot tanlang</option>
          {productList.map(product => <option key={product.id} value={product.id}>{product.name}</option>)}
        </select>
        <Input className={`finance-input ${Number(quantity) <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`} type="text" inputMode="decimal" placeholder="Miqdor" value={quantity} onChange={event => setQuantity(sanitizeDecimalInput(event.target.value))} />
        <Input className="finance-input" type="date" value={date} onChange={event => setDate(event.target.value)} />
        <Input className={`finance-input ${reason.trim().length < 2 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`} placeholder="Sabab (zarar, ishlatish...)" value={reason} onChange={event => setReason(event.target.value)} />
        <Button disabled={!canSubmit} onClick={submit} className="bg-rose-600 hover:bg-rose-700">
          {stockOut.isPending ? "Saqlanmoqda..." : "Chiqim qo'shish"}
        </Button>
        <Input className="finance-input md:col-span-2 xl:col-span-5" placeholder="Izoh (ixtiyoriy)" value={note} onChange={event => setNote(event.target.value)} />
      </div>
      {!canSubmit && !stockOut.isPending && blockingReasons.length > 0 && (
        <ul className="mt-2 text-right text-xs font-medium text-rose-600">
          {blockingReasons.map(item => <li key={item}>{item}</li>)}
        </ul>
      )}
    </div>
  );
}

function StockEntryForm() {
  const [mode, setMode] = useState<"in" | "out">("in");
  return (
    <SectionCard title="Kirim / Chiqim kiritish" description="Ishlab chiqarishdan kirim (bir nechta mahsulot birdaniga), zarar yoki boshqa sabab bilan chiqim." className="mt-5">
      <div className="mb-4 flex gap-2">
        <button type="button" onClick={() => setMode("in")} className={`h-9 flex-1 rounded-xl text-xs font-semibold transition-colors ${mode === "in" ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>+ Kirim</button>
        <button type="button" onClick={() => setMode("out")} className={`h-9 flex-1 rounded-xl text-xs font-semibold transition-colors ${mode === "out" ? "bg-rose-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>− Chiqim</button>
      </div>
      {mode === "in" ? <StockInBatchForm /> : <StockOutForm />}
    </SectionCard>
  );
}

function MovementHistory() {
  const utils = trpc.useUtils();
  const movements = trpc.stock.movements.useQuery({ page: 1, pageSize: 30 });
  const deleteMovement = trpc.stock.deleteMovement.useMutation({
    onSuccess: async () => {
      toast.success("Harakat o'chirildi");
      await Promise.all([utils.stock.list.invalidate(), utils.stock.movements.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });
  const rows = movements.data?.items ?? [];

  return (
    <SectionCard title="So'nggi harakatlar" description="Oxirgi 30 ta kirim/chiqim yozuvi" className="mt-5">
      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-slate-100">
        {movements.isLoading ? <TableLoading columns={6} /> : rows.length === 0 ? <EmptyState description="Hali hech qanday harakat yo'q." /> : (
          <Table className="finance-table min-w-[820px]">
            <TableHeader><TableRow><TableHead>Sana</TableHead><TableHead>Mahsulot</TableHead><TableHead>Turi</TableHead><TableHead className="text-right">Miqdor</TableHead><TableHead>Sabab</TableHead><TableHead /></TableRow></TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap text-slate-500">{formatDate(row.movementDate)}</TableCell>
                  <TableCell className="font-semibold text-slate-900">{row.productName ?? "—"}</TableCell>
                  <TableCell>{row.movementType === "in" ? <Badge className="rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Kirim</Badge> : <Badge className="rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50">Chiqim</Badge>}</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">{formatNumber(row.quantity, 3)} {row.unit}</TableCell>
                  <TableCell className="max-w-56 truncate text-slate-500">{row.reason ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {!row.isAutomatic ? (
                      <button
                        type="button"
                        aria-label="O'chirish"
                        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                        onClick={() => deleteMovement.mutate({ id: row.id })}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </SectionCard>
  );
}

export default function Stock() {
  const stock = trpc.stock.list.useQuery();
  const rows = stock.data ?? [];
  const lowStockRows = rows.filter(row => row.isLow);

  if (stock.error) {
    return <div className="mx-auto w-full max-w-[1500px]"><PageHeader eyebrow="Ombor" title="Sklad" description="Mahsulot zaxirasi va harakatlari." /><QueryError description={stock.error.message} onRetry={() => stock.refetch()} /></div>;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <PageHeader eyebrow="Ombor" title="Sklad" description="Mahsulotlarning joriy zaxirasini, kirim/chiqim harakatlarini va kam qolgan mahsulotlarni kuzating." />
      <div className="grid gap-4 sm:grid-cols-2">
        <MetricCard label="Mahsulot turlari" value={String(rows.length)} helper="Faol mahsulotlar" icon={Package} tone="cyan" />
        <MetricCard label="Kam qolgan" value={String(lowStockRows.length)} helper="Minimal chegaradan past" icon={AlertTriangle} tone={lowStockRows.length > 0 ? "rose" : "green"} />
      </div>

      <SectionCard title="Sklad qoldig'i" description="Joriy zaxira = barcha kirim − chiqim. Min. chegarani tahrirlash mumkin." className="mt-5">
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-slate-100">
          {stock.isLoading ? <TableLoading columns={5} /> : rows.length === 0 ? <EmptyState description="Faol mahsulot topilmadi." /> : (
            <Table className="finance-table">
              <TableHeader><TableRow><TableHead>Mahsulot</TableHead><TableHead className="text-right">Joriy qoldiq</TableHead><TableHead className="text-right">Min. chegara</TableHead><TableHead>Holat</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-semibold text-slate-900">{row.name}</TableCell>
                    <TableCell className="text-right font-bold tabular-nums">{formatNumber(row.currentStock, 1)} {row.unit}</TableCell>
                    <TableCell className="text-right"><MinLevelCell productId={row.id} minStockLevel={row.minStockLevel} /></TableCell>
                    <TableCell>
                      {row.isLow ? (
                        <Badge className="rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50"><AlertTriangle className="mr-1 size-3" />Kam qoldi</Badge>
                      ) : (
                        <Badge className="rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50">Yetarli</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SectionCard>

      <StockEntryForm />
      <MovementHistory />
    </div>
  );
}
