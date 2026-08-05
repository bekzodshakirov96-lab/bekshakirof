import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader, SectionCard } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, formatNumber, localDateInputValue, sanitizeDecimalInput, sanitizeIntegerInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { calculateContainerNet } from "@shared/containerPreview";
import { normalizeSearch, normalizeSearchable } from "@shared/translit";
import { BarChart3, PackageCheck, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";

const today = localDateInputValue;

type CartLine = {
  key: string;
  productId: number;
  productName: string;
  code: string;
  unit: string;
  quantity: string;
  salePrice: string;
  containerType: "keg_30" | "keg_50" | null;
  containerUnitsPerItem: number;
  returnEnabled: boolean;
  returnContainerType: "keg_30" | "keg_50" | "";
  returnQuantity: string;
};

export default function Transactions() {
  const utils = trpc.useUtils();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const isAgentRole = user?.role === "agent";

  const [date, setDate] = useState(today());
  const [agentId, setAgentId] = useState(() => (isAgentRole && user?.agentId ? String(user.agentId) : ""));
  const [clientId, setClientId] = useState("");
  const [clientSearch, setClientSearch] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [cashPayment, setCashPayment] = useState("");
  const [terminalPayment, setTerminalPayment] = useState("");
  const [clickPayment, setClickPayment] = useState("");
  const [transferPayment, setTransferPayment] = useState("");
  const [debtPayment, setDebtPayment] = useState("");
  const [debtTerminalPayment, setDebtTerminalPayment] = useState("");
  const [debtClickPayment, setDebtClickPayment] = useState("");
  const [debtTransferPayment, setDebtTransferPayment] = useState("");
  const [note, setNote] = useState("");

  const agents = trpc.agents.options.useQuery();
  const clients = trpc.clients.options.useQuery({ type: "savdo" });
  const products = trpc.products.list.useQuery({});
  const clientDebt = trpc.debts.currentDebt.useQuery(
    { clientId: Number(clientId) },
    { enabled: Boolean(clientId) },
  );

  useEffect(() => {
    if (isAgentRole && user?.agentId && !agentId) setAgentId(String(user.agentId));
  }, [isAgentRole, user?.agentId, agentId]);

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

  const availableClients = useMemo(
    () => (clients.data ?? []).filter(item => !agentId || item.agentId === Number(agentId)),
    [clients.data, agentId],
  );

  /**
   * Mijozlar soni yuzlab bo'lgani uchun ro'yxat qidiruv bo'yicha toraytiriladi.
   * Tanlangan mijoz qidiruvga mos kelmasa ham ro'yxatda qoldiriladi — aks holda
   * `<select>` qiymati ro'yxatda yo'q bo'lib, maydon bo'sh ko'rinardi (lekin
   * savdo o'sha mijozga yozilaverardi).
   */
  const visibleClients = useMemo(() => {
    const needle = normalizeSearch(clientSearch);
    if (!needle) return availableClients;
    return availableClients.filter(
      client =>
        String(client.id) === clientId ||
        normalizeSearchable(`${client.code} ${client.name}`).includes(needle),
    );
  }, [availableClients, clientSearch, clientId]);

  const cartProductIds = useMemo(() => new Set(cart.map(line => line.productId)), [cart]);
  const sellableProducts = useMemo(() => (products.data ?? []).filter(product => !product.containerType), [products.data]);
  const filteredProducts = useMemo(() => {
    const needle = normalizeSearch(productSearch);
    if (!needle) return sellableProducts;
    return sellableProducts.filter(product => normalizeSearchable(`${product.code} ${product.name}`).includes(needle));
  }, [sellableProducts, productSearch]);

  const createMultiple = trpc.transactions.createMultiple.useMutation({
    onSuccess: async result => {
      const saleMessage = `${result.lineCount} ta mahsulot bo‘yicha savdo saqlandi: ${formatMoney(result.cartTotal)}`;
      toast.success(
        result.debtPaymentAmount > 0
          ? `${saleMessage}. Qarzga qo‘shimcha ${formatMoney(result.debtPaymentAmount)} to‘lov qabul qilindi.`
          : saleMessage,
      );
      setCart([]);
      setCashPayment(""); setTerminalPayment(""); setClickPayment(""); setTransferPayment(""); setDebtPayment(""); setDebtTerminalPayment(""); setDebtClickPayment(""); setDebtTransferPayment(""); setNote("");
      await Promise.all([
        utils.transactions.list.invalidate(), utils.dashboard.overview.invalidate(),
        utils.debts.list.invalidate(), utils.debts.currentDebt.invalidate(), utils.containers.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  /** Mahsulot tanlanmagan holatda ham — mijozdan faqat eski qarz to'lovi qabul qilish uchun. */
  const createDebtOnlyPayment = trpc.debts.payments.create.useMutation({
    onSuccess: async (_result, variables) => {
      const total =
        (variables.cashAmount ?? 0) + (variables.terminalAmount ?? 0) + (variables.clickAmount ?? 0) + (variables.transferAmount ?? 0);
      toast.success(`Qarz to‘lovi qabul qilindi: ${formatMoney(total)}`);
      setDebtPayment(""); setDebtTerminalPayment(""); setDebtClickPayment(""); setDebtTransferPayment(""); setNote("");
      await Promise.all([
        utils.dashboard.overview.invalidate(),
        utils.debts.list.invalidate(),
        utils.debts.currentDebt.invalidate(),
        utils.debts.payments.byClient.invalidate(),
      ]);
    },
    onError: error => toast.error(error.message),
  });

  function toggleProduct(product: NonNullable<typeof products.data>[number]) {
    if (cartProductIds.has(product.id)) {
      setCart(current => current.filter(line => line.productId !== product.id));
      return;
    }
    const containerType = product.containerType === "keg_30" || product.containerType === "keg_50" ? product.containerType : null;
    setCart(current => [
      ...current,
      {
        key: `${product.id}-${Date.now()}`,
        productId: product.id,
        productName: product.name,
        code: product.code,
        unit: product.unit,
        quantity: "",
        salePrice: String(product.price ?? 0),
        containerType,
        containerUnitsPerItem: product.containerUnitsPerItem || 1,
        returnEnabled: false,
        returnContainerType: containerType ?? "",
        returnQuantity: "0",
      },
    ]);
  }

  function updateLine(key: string, patch: Partial<CartLine>) {
    setCart(current => current.map(line => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: string) {
    setCart(current => current.filter(line => line.key !== key));
  }

  const lineTotals = cart.map(line => Math.round(Number(line.quantity || 0) * Number(line.salePrice || 0)));
  const cartTotal = lineTotals.reduce((sum, value) => sum + value, 0);
  const paid = Number(cashPayment || 0) + Number(terminalPayment || 0) + Number(clickPayment || 0) + Number(transferPayment || 0);

  const containerTotals = cart.reduce(
    (totals, line) => {
      if (!line.containerType) return totals;
      const issuedQuantity = Number(line.quantity || 0) * line.containerUnitsPerItem;
      const returnedQuantity = line.returnEnabled ? Number(line.returnQuantity || 0) : 0;
      const net = calculateContainerNet({
        issuedType: line.containerType,
        issuedQuantity,
        returnedType: line.returnEnabled && line.returnContainerType ? line.returnContainerType : null,
        returnedQuantity,
      });
      return { keg30: totals.keg30 + net.keg30, keg50: totals.keg50 + net.keg50 };
    },
    { keg30: 0, keg50: 0 },
  );

  const hasInvalidLine = cart.some(line => {
    const quantity = Number(line.quantity || 0);
    const price = Number(line.salePrice || 0);
    if (quantity <= 0 || price < 0) return true;
    if (line.returnEnabled && (!line.returnContainerType || Number(line.returnQuantity || 0) <= 0)) return true;
    return false;
  });
  const canSubmit = Boolean(agentId) && Boolean(clientId) && cart.length > 0 && !hasInvalidLine && !createMultiple.isPending;
  const overpaid = Math.max(0, paid - cartTotal);
  const currentDebt = clientDebt.data?.currentDebt ?? 0;
  /** Savdo to'lovidan avtomatik aniqlangan ortiqcha joriy qarzdan katta bo'lsa, mijozning
   * balansi manfiyga (haqdorlik/avans) o'tib ketadi — buxgalter buni aniq ko'rishi kerak,
   * aks holda sababsiz avans hosil bo'lib qoladi. */
  const overCredit = Math.max(0, overpaid - currentDebt);

  const emptyQuantityLines = cart.filter(line => Number(line.quantity || 0) <= 0).length;
  const invalidReturnLines = cart.filter(line => line.returnEnabled && (!line.returnContainerType || Number(line.returnQuantity || 0) <= 0)).length;
  const blockingReasons: string[] = [];
  if (!agentId) blockingReasons.push("Agent tanlanmagan");
  if (!clientId) blockingReasons.push("Mijoz tanlanmagan");
  if (emptyQuantityLines > 0) blockingReasons.push(`${emptyQuantityLines} ta mahsulotda miqdor kiritilmagan`);
  if (invalidReturnLines > 0) blockingReasons.push("Tara qaytarish miqdori to‘liq kiritilmagan");

  function submit() {
    createMultiple.mutate({
      transactionDate: new Date(`${date}T12:00:00`).getTime(),
      agentId: Number(agentId),
      clientId: Number(clientId),
      items: cart.map(line => ({
        productId: line.productId,
        quantity: Number(line.quantity),
        salePrice: Math.round(Number(line.salePrice)),
        returnContainerType: line.returnEnabled && line.returnContainerType ? line.returnContainerType : null,
        returnQuantity: line.returnEnabled ? Math.round(Number(line.returnQuantity || 0)) : 0,
      })),
      cashPayment: Math.round(Number(cashPayment || 0)),
      terminalPayment: Math.round(Number(terminalPayment || 0)),
      clickPayment: Math.round(Number(clickPayment || 0)),
      transferPayment: Math.round(Number(transferPayment || 0)),
      // Qo'lda kiritiladigan qarz to'lovi maydoni bu oqimdan olib tashlandi — ortiqcha
      // to'lov server tomonida avtomatik aniqlanib, eski qarzga yo'naltiriladi.
      debtPaymentAmount: 0,
      note: note || undefined,
    });
  }

  const debtOnlyTotal =
    Number(debtPayment || 0) + Number(debtTerminalPayment || 0) + Number(debtClickPayment || 0) + Number(debtTransferPayment || 0);
  const debtOnlyCanSubmit = Boolean(agentId) && Boolean(clientId) && debtOnlyTotal > 0 && !createDebtOnlyPayment.isPending;

  function submitDebtOnly() {
    createDebtOnlyPayment.mutate({
      clientId: Number(clientId),
      paymentDate: new Date(`${date}T12:00:00`).getTime(),
      cashAmount: Math.round(Number(debtPayment || 0)),
      terminalAmount: Math.round(Number(debtTerminalPayment || 0)),
      clickAmount: Math.round(Number(debtClickPayment || 0)),
      transferAmount: Math.round(Number(debtTransferPayment || 0)),
      note: note || undefined,
    });
  }

  return <div className="mx-auto w-full max-w-[1200px]">
    <PageHeader
      eyebrow="Tezkor savdo"
      title="Yangi savdo"
      description="Mijozni tanlang, bir nechta mahsulot qo‘shing va bitta operatsiyada saqlang."
      action={<Button variant="outline" className="h-10 gap-2 rounded-xl bg-card" onClick={() => navigate("/sotuv-hisoboti")}><BarChart3 className="size-4" />Sotuv bo‘yicha hisobot</Button>}
    />

    <SectionCard title="1. Agent va mijoz" description="Avval agent, so‘ng shu agentga biriktirilgan mijozni tanlang">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label>Sana</Label><Input className="finance-input" type="date" value={date} onChange={event => setDate(event.target.value)} /></div>
        <div />
        <div className="space-y-2">
          <Label>Agent</Label>
          <select
            className="finance-input w-full border px-3 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            value={agentId}
            disabled={isAgentRole}
            onChange={event => { setAgentId(event.target.value); setClientId(""); setDebtPayment(""); setDebtTerminalPayment(""); setDebtClickPayment(""); setDebtTransferPayment(""); }}
          >
            <option value="">Tanlang</option>
            {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="client-search">Mijoz</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="client-search"
              className="finance-input pl-9"
              placeholder="Mijoz qidirish (kod yoki nom)..."
              value={clientSearch}
              onChange={event => setClientSearch(event.target.value)}
              disabled={!agentId}
            />
          </div>
          <select
            className="finance-input w-full border px-3"
            value={clientId}
            onChange={event => { setClientId(event.target.value); setDebtPayment(""); setDebtTerminalPayment(""); setDebtClickPayment(""); setDebtTransferPayment(""); }}
            disabled={!agentId}
            size={clientSearch.trim() ? Math.min(8, Math.max(2, visibleClients.length + 1)) : undefined}
          >
            <option value="">{visibleClients.length === 0 ? "Mijoz topilmadi" : "Tanlang"}</option>
            {visibleClients.map(client => <option key={client.id} value={client.id}>{client.code} — {client.name}</option>)}
          </select>
        </div>
      </div>
    </SectionCard>

    <SectionCard title="2. Mahsulotlar" description="Bir nechta mahsulot qo‘shishingiz mumkin, har biriga alohida miqdor va narx belgilang. KEG/tara mahsulotlari bu yerda yo‘q — ularni Tezkor KEG savdosi orqali soting.">
      <div className="relative mb-4" ref={pickerRef}>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="finance-input pl-9"
            placeholder="Mahsulot qidirish va qo‘shish uchun bosing..."
            value={productSearch}
            onFocus={() => setPickerOpen(true)}
            onClick={() => setPickerOpen(true)}
            onChange={event => { setProductSearch(event.target.value); setPickerOpen(true); }}
          />
        </div>
        {pickerOpen && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <span className="text-xs font-semibold text-muted-foreground">{cartProductIds.size > 0 ? `${cartProductIds.size} ta tanlandi` : "Tanlash uchun bosing"}</span>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setPickerOpen(false)}>Tayyor</button>
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filteredProducts.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">Mahsulot topilmadi.</div>
              ) : filteredProducts.map(product => (
                <button
                  key={product.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-muted"
                  onClick={() => toggleProduct(product)}
                >
                  <Checkbox checked={cartProductIds.has(product.id)} />
                  <span className="min-w-0 flex-1"><span className="font-semibold text-foreground">{product.name}</span><span className="ml-2 text-xs text-muted-foreground">{product.code}</span></span>
                  <span className="shrink-0 text-muted-foreground">{formatMoney(product.price)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border py-12 text-center text-muted-foreground">
          <ShoppingCart className="size-8" />
          <p className="text-sm">Hali mahsulot qo‘shilmagan. Yuqoridagi qidiruv orqali qo‘shing.</p>
        </div>
      ) : (
        <Table className="finance-table">
          <TableHeader><TableRow>
            <TableHead>Mahsulot</TableHead>
            <TableHead className="w-32 text-right">Miqdor</TableHead>
            <TableHead className="w-36 text-right">Narx</TableHead>
            <TableHead className="w-36 text-right">Jami</TableHead>
            <TableHead className="w-56">Tara qaytdi</TableHead>
            <TableHead className="w-10" />
          </TableRow></TableHeader>
          <TableBody>
            {cart.map((line, index) => <TableRow key={line.key}>
              <TableCell><span className="font-semibold text-foreground">{line.productName}</span><span className="ml-2 text-xs text-muted-foreground">{line.code}</span></TableCell>
              <TableCell className="text-right"><Input className={`finance-input text-right ${Number(line.quantity || 0) <= 0 ? "border-rose-300 focus-visible:ring-rose-200" : ""}`} type="text" inputMode="decimal" placeholder="0" value={line.quantity} onChange={event => updateLine(line.key, { quantity: sanitizeDecimalInput(event.target.value) })} /><span className="mt-1 block text-[11px] text-muted-foreground">{line.unit}</span></TableCell>
              <TableCell className="text-right"><Input className="finance-input text-right" type="text" inputMode="numeric" value={line.salePrice} onChange={event => updateLine(line.key, { salePrice: sanitizeIntegerInput(event.target.value) })} /></TableCell>
              <TableCell className="text-right font-bold tabular-nums">{formatMoney(lineTotals[index])}</TableCell>
              <TableCell>
                {line.containerType ? (
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={line.returnEnabled} onCheckedChange={checked => updateLine(line.key, { returnEnabled: checked === true, returnContainerType: line.returnContainerType || line.containerType || "" })} />
                      Mijoz tara qaytardi
                    </label>
                    {line.returnEnabled && (
                      <div className="flex items-center gap-1.5">
                        <select className="finance-input h-8 border px-2 text-xs" value={line.returnContainerType} onChange={event => updateLine(line.key, { returnContainerType: event.target.value as CartLine["returnContainerType"] })}>
                          <option value="keg_30">KEG 30</option>
                          <option value="keg_50">KEG 50</option>
                        </select>
                        <Input className="finance-input h-8 w-20 text-right" type="text" inputMode="numeric" value={line.returnQuantity} onChange={event => updateLine(line.key, { returnQuantity: sanitizeIntegerInput(event.target.value) })} />
                      </div>
                    )}
                  </div>
                ) : <span className="text-xs text-muted-foreground">—</span>}
              </TableCell>
              <TableCell><button type="button" aria-label="O‘chirish" className="rounded-lg p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-rose-600" onClick={() => removeLine(line.key)}><Trash2 className="size-4" /></button></TableCell>
            </TableRow>)}
          </TableBody>
        </Table>
      )}
    </SectionCard>

    {cart.length > 0 && (
      <SectionCard title="3. To‘lov" description="Naqd, terminal, Click va Перечисление orqali to‘langan summani kiriting">
        <div className="grid gap-4 sm:grid-cols-4">
          <div className="space-y-2"><Label>Naqd to‘lov</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={cashPayment} onChange={event => setCashPayment(sanitizeIntegerInput(event.target.value))} /></div>
          <div className="space-y-2"><Label>Terminal</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={terminalPayment} onChange={event => setTerminalPayment(sanitizeIntegerInput(event.target.value))} /></div>
          <div className="space-y-2"><Label>Click</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={clickPayment} onChange={event => setClickPayment(sanitizeIntegerInput(event.target.value))} /></div>
          <div className="space-y-2"><Label>Перечисление</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={transferPayment} onChange={event => setTransferPayment(sanitizeIntegerInput(event.target.value))} /></div>
        </div>
        {clientId && currentDebt > 0 && (
          <p className="mt-3 text-xs text-muted-foreground">
            Mijozning joriy qarzi <span className="font-semibold text-foreground">{formatMoney(currentDebt)}</span>. Agent
            savdo narxidan ko‘proq pul olib kelgan bo‘lsa, shu yerga (yuqoridagi to‘lov maydonlariga) kiriting —
            ortiqcha qism qaysi kanaldan kelgan bo‘lsa, o‘sha kanal orqali eski qarzdan avtomatik yechiladi.
          </p>
        )}

        <div className="mt-4 space-y-2"><Label>Izoh</Label><Input className="finance-input" value={note} onChange={event => setNote(event.target.value)} placeholder="Ixtiyoriy" /></div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 dark:border-cyan-800 dark:bg-cyan-950/30"><p className="text-xs text-cyan-700 dark:text-cyan-300">Savat jamisi</p><p className="mt-1 text-lg font-bold text-foreground">{formatMoney(cartTotal)}</p></div>
          <div className="rounded-2xl border border-border bg-muted p-4"><p className="text-xs text-muted-foreground">To‘lov</p><p className="mt-1 text-lg font-bold text-foreground">{formatMoney(paid)}</p></div>
          <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/30"><p className="text-xs text-amber-700 dark:text-amber-300">Qarzga qoladi</p><p className="mt-1 text-lg font-bold text-foreground">{formatMoney(Math.max(0, cartTotal - paid))}</p></div>
        </div>

        {overpaid > 0 && overCredit > 0 && (
          <div className="mt-3 rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            Diqqat: Ortiqcha {formatMoney(overpaid)}dan {formatMoney(Math.min(overpaid, currentDebt))} eski qarzni to‘liq yopadi, qolgan{" "}
            {formatMoney(overCredit)} esa mijozning joriy qarzidan oshib ketadi — bu summa mijozning HAQDORLIGI (avans to‘lovi) sifatida qayd etiladi.
          </div>
        )}
        {overpaid > 0 && overCredit === 0 && (
          <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 text-sm font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">
            Ortiqcha {formatMoney(overpaid)} — savat jamisidan ko‘proq to‘langan qism mijozning eski qarzidan avtomatik yechiladi.
          </div>
        )}

        {(containerTotals.keg30 !== 0 || containerTotals.keg50 !== 0) && (
          <div className="mt-4 rounded-2xl border border-border bg-muted p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><PackageCheck className="size-4 text-primary" />Tara sof o‘zgarishi (savat bo‘yicha)</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline" className={containerTotals.keg30 > 0 ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300" : containerTotals.keg30 < 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-card text-muted-foreground"}>KEG 30: {containerTotals.keg30 > 0 ? "+" : ""}{formatNumber(containerTotals.keg30)}</Badge>
              <Badge variant="outline" className={containerTotals.keg50 > 0 ? "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-300" : containerTotals.keg50 < 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300" : "bg-card text-muted-foreground"}>KEG 50: {containerTotals.keg50 > 0 ? "+" : ""}{formatNumber(containerTotals.keg50)}</Badge>
            </div>
          </div>
        )}

        <div className="mt-6 flex flex-col items-end gap-2">
          {!canSubmit && !createMultiple.isPending && blockingReasons.length > 0 && (
            <ul className="text-right text-xs font-medium text-rose-600">
              {blockingReasons.map(reason => <li key={reason}>{reason}</li>)}
            </ul>
          )}
          <Button size="lg" className="h-12 rounded-xl px-8 font-semibold" disabled={!canSubmit} onClick={submit}>
            {createMultiple.isPending ? "Saqlanmoqda..." : `Savdoni saqlash — ${formatMoney(cartTotal)}`}
          </Button>
        </div>
      </SectionCard>
    )}

    {cart.length === 0 && agentId && clientId && currentDebt > 0 && (
      <SectionCard
        title="3. Qarz to‘lovi"
        description="Mahsulot tanlanmagan bo‘lsa ham, mijozdan qabul qilingan pulni to‘g‘ridan-to‘g‘ri eski qarzga yozib qo‘yishingiz mumkin."
      >
        <p className="text-xs text-muted-foreground">
          Mijozning joriy qarzi <span className="font-semibold text-foreground">{formatMoney(currentDebt)}</span>.
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-4">
          <div className="space-y-2"><Label>Naqd</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={debtPayment} onChange={event => setDebtPayment(sanitizeIntegerInput(event.target.value))} /></div>
          <div className="space-y-2"><Label>Terminal</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={debtTerminalPayment} onChange={event => setDebtTerminalPayment(sanitizeIntegerInput(event.target.value))} /></div>
          <div className="space-y-2"><Label>Click</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={debtClickPayment} onChange={event => setDebtClickPayment(sanitizeIntegerInput(event.target.value))} /></div>
          <div className="space-y-2"><Label>Перечисление</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={debtTransferPayment} onChange={event => setDebtTransferPayment(sanitizeIntegerInput(event.target.value))} /></div>
        </div>
        {debtOnlyTotal > currentDebt && (
          <p className="mt-2 text-xs font-medium text-rose-700 dark:text-rose-400">
            Kiritilgan summa joriy qarzdan katta — ortiqcha qism mijozning haqdorligi (avans) sifatida qoladi.
          </p>
        )}
        <div className="mt-4 space-y-2"><Label>Izoh</Label><Input className="finance-input" value={note} onChange={event => setNote(event.target.value)} placeholder="Ixtiyoriy" /></div>
        <div className="mt-6 flex justify-end">
          <Button
            size="lg"
            className="h-12 rounded-xl px-8 font-semibold"
            disabled={!debtOnlyCanSubmit}
            onClick={submitDebtOnly}
          >
            {createDebtOnlyPayment.isPending ? "Saqlanmoqda..." : `Qarz to‘lovini saqlash — ${formatMoney(debtOnlyTotal)}`}
          </Button>
        </div>
      </SectionCard>
    )}
  </div>;
}
