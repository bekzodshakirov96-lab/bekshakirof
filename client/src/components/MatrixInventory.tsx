import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  formatNumber,
  formatTashkentDate,
  sanitizeDecimalInput,
  tashkentDateInputValue,
  tashkentDateToTimestamp,
} from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  clearPendingReceipt,
  pendingReceiptKey,
  persistPendingReceipt,
  readPendingReceipt,
} from "@/lib/matrixReceiptPending";
import { History } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Product = { id: number; name: string; unit: string };

/** A cell adds one NEW receipt. Its draft is separate from the day's total, so
 * refetching/re-blurring never posts an already displayed receipt a second time. */
type ReceiptCellProps = {
  product: Product;
  date: string;
  active: boolean;
  ready: boolean;
  received: number;
  onSaved: () => Promise<unknown>;
  onHistory: () => void;
};
export function MatrixReceiptCell(props: ReceiptCellProps) {
  const { user } = useAuth();
  if (!user)
    return (
      <span className="text-xs text-muted-foreground">Yuklanmoqda...</span>
    );
  return (
    <ReceiptInput
      key={`${user.id}:${props.product.id}:${props.date}`}
      {...props}
      userId={user.id}
    />
  );
}
function ReceiptInput({
  product,
  date,
  active,
  ready,
  received,
  onSaved,
  onHistory,
  userId,
}: ReceiptCellProps & { userId: number }) {
  const storageKey = pendingReceiptKey(userId, product.id, date);
  const [loaded] = useState(() => {
    try {
      return {
        pending: readPendingReceipt(sessionStorage, storageKey),
        error: "",
      };
    } catch (error) {
      return {
        pending: null,
        error:
          error instanceof Error
            ? error.message
            : "Brauzer xotirasini tekshirib bo'lmadi.",
      };
    }
  });
  const [draft, setDraft] = useState(loaded.pending?.text ?? "");
  const [error, setError] = useState(loaded.error);
  const [isSaving, setIsSaving] = useState(false);
  const [unresolved, setUnresolved] = useState(Boolean(loaded.pending));
  const operation = useRef(
    loaded.pending ?? { text: "", key: crypto.randomUUID() }
  );
  const saving = useRef(false);
  const receipt = trpc.matrixInventory.receipt.useMutation();
  async function save() {
    const current = operation.current;
    if (
      !ready ||
      !active ||
      loaded.error ||
      saving.current ||
      current.text === ""
    )
      return;
    const quantity = Number(current.text);
    if (
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      quantity > 1_000_000 ||
      Number(quantity.toFixed(3)) !== quantity
    ) {
      setError("Musbat miqdor, 3 tagacha kasr");
      return;
    }
    try {
      persistPendingReceipt(sessionStorage, storageKey, current);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "So'rov IDsi saqlanmadi."
      );
      return;
    }
    setUnresolved(true);
    saving.current = true;
    setIsSaving(true);
    try {
      await receipt.mutateAsync({
        productId: product.id,
        date: tashkentDateToTimestamp(date),
        quantity,
        requestKey: current.key,
      });
    } catch (error) {
      // Keep the same key for a retry after a lost network response.
      const message =
        error instanceof Error ? error.message : "Prixod saqlanmadi";
      setError(message);
      toast.error(message);
      saving.current = false;
      setIsSaving(false);
      return;
    }
    try {
      clearPendingReceipt(sessionStorage, storageKey, current.key);
    } catch {
      setError(
        "Prixod saqlandi. Brauzer xotirasini tozalab bo'lmadi; tarixdan tekshiring."
      );
      saving.current = false;
      setIsSaving(false);
      await onSaved().catch(() => undefined);
      return;
    }
    setUnresolved(false);
    operation.current = { text: "", key: crypto.randomUUID() };
    setDraft("");
    setError("");
    toast.success(
      `${product.name}: +${formatNumber(quantity, 3)} ${product.unit} prixod saqlandi`
    );
    try {
      await onSaved();
    } catch {
      toast.error("Prixod saqlandi, jadvalni yangilab ko'ring.");
    } finally {
      saving.current = false;
      setIsSaving(false);
    }
  }
  return (
    <div className="ml-auto w-fit">
      <div className="flex items-center justify-end gap-1">
        <Input
          className="finance-input h-8 w-20 px-2 text-right"
          aria-label={`${product.name}: yangi prixod, ${product.unit}`}
          aria-invalid={Boolean(error)}
          title="Faqat yangi kelgan miqdorni yozing. Enter yoki Tab bilan saqlanadi."
          type="text"
          inputMode="decimal"
          placeholder={active ? "+ kirim" : "—"}
          value={draft}
          disabled={!ready || !active || isSaving || Boolean(loaded.error)}
          readOnly={unresolved}
          onChange={event => {
            if (unresolved || saving.current) return;
            const text = sanitizeDecimalInput(event.target.value);
            if (text !== operation.current.text)
              operation.current = { text, key: crypto.randomUUID() };
            setDraft(text);
            setError("");
          }}
          onBlur={() => void save()}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
            if (event.key === "Escape" && !unresolved) {
              event.preventDefault();
              operation.current = { text: "", key: crypto.randomUUID() };
              setDraft("");
              setError("");
              event.currentTarget.blur();
            }
          }}
        />
        <button
          type="button"
          aria-label={`${product.name}: prixod tarixi`}
          title="Prixodlar tarixi"
          disabled={!ready || !active}
          onClick={onHistory}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
        >
          <History className="size-3.5" />
        </button>
      </div>
      <p
        className="mt-0.5 text-right text-[10px] tabular-nums text-muted-foreground"
        aria-live="polite"
      >
        {isSaving
          ? "Saqlanmoqda..."
          : active && ready
            ? `Jami: ${formatNumber(received, 3)} ${product.unit}`
            : "Avval qoldiqni sozlang"}
      </p>
      {unresolved && !isSaving && (
        <button
          type="button"
          className="mt-1 text-xs font-medium text-primary hover:underline"
          onClick={() => void save()}
          disabled={!ready || !active}
        >
          Oldingi prixodni tekshirish
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 max-w-44 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function useMatrixInventory(
  date: string,
  refreshMatrix: () => Promise<unknown>
) {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const timestamp = tashkentDateToTimestamp(date);
  const query = trpc.matrixInventory.day.useQuery({ date: timestamp });
  const [product, setProduct] = useState<Product | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [quantity, setQuantity] = useState("");
  const [startDate, setStartDate] = useState(tashkentDateInputValue);
  const [confirmed, setConfirmed] = useState(false);
  const [page, setPage] = useState(1);
  const [reversal, setReversal] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const history = trpc.matrixInventory.history.useQuery(
    { productId: product?.id ?? 0, date: timestamp, page },
    { enabled: Boolean(product) && isOpen }
  );
  const row = query.data?.find(row => row.productId === product?.id);
  const refresh = async () => {
    await Promise.all([
      utils.matrixInventory.invalidate(),
      utils.stock.invalidate(),
      refreshMatrix(),
    ]);
  };
  const activate = trpc.matrixInventory.activate.useMutation({
    onSuccess: async () => {
      toast.success("Boshlang'ich qoldiq tasdiqlandi");
      setQuantity("");
      setConfirmed(false);
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const reverse = trpc.matrixInventory.reverseReceipt.useMutation({
    onSuccess: async () => {
      toast.success("Prixod bekor qilindi; tarix saqlandi");
      setReversal(null);
      setReason("");
      await refresh();
    },
    onError: error => toast.error(error.message),
  });
  const busy = activate.isPending || reverse.isPending;
  const validQuantity =
    quantity.trim() !== "" &&
    Number.isFinite(Number(quantity)) &&
    Number(quantity) >= 0 &&
    Number(quantity) <= 1_000_000 &&
    Number(Number(quantity).toFixed(3)) === Number(quantity);
  function open(selected: Product) {
    setIsOpen(true);
    setProduct(selected);
    setQuantity("");
    setConfirmed(false);
    setPage(1);
    setReversal(null);
    setReason("");
    setStartDate(
      date < tashkentDateInputValue() ? tashkentDateInputValue() : date
    );
  }
  const dialog = (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open && !busy) setIsOpen(false);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{product?.name} · Ombor hisobi</DialogTitle>
          <DialogDescription>
            {formatTashkentDate(timestamp)} · {product?.unit}. Agent kataklari —
            omborchi hisoblab bergan tayyor miqdor; qaytim alohida kiritilmaydi.
          </DialogDescription>
        </DialogHeader>
        {query.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Ombor hisobini yuklab bo'lmadi.
          </p>
        ) : query.isPending ? (
          <p>Yuklanmoqda...</p>
        ) : !row ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-muted p-3 text-sm">
              Avval rahbar sanab tasdiqlangan <b>kun boshidagi</b> qoldiqni
              belgilaydi. Oldingi kunlar tarixi saqlanadi.
            </p>
            {user?.role === "admin" ? (
              <>
                <label className="grid gap-1.5 text-sm">
                  Hisob boshlanadigan sana
                  <Input
                    type="date"
                    value={startDate}
                    min={tashkentDateInputValue()}
                    disabled={busy}
                    onChange={event => setStartDate(event.target.value)}
                  />
                </label>
                <label className="grid gap-1.5 text-sm">
                  Kun boshidagi sanab tasdiqlangan qoldiq, {product?.unit}
                  <Input
                    type="text"
                    inputMode="decimal"
                    placeholder="0"
                    value={quantity}
                    disabled={busy}
                    onChange={event =>
                      setQuantity(sanitizeDecimalInput(event.target.value))
                    }
                  />
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={confirmed}
                    disabled={busy}
                    onChange={event => setConfirmed(event.target.checked)}
                  />
                  <span>
                    Bu shu kun boshidagi qoldiq ekanini tasdiqlayman. Shu sana
                    va keyingi kunlarning Agent × Tovar miqdorlari undan
                    ayriladi. Shu kundagi mavjud boshqa Sklad harakatlari ham
                    hisobga kiradi.
                  </span>
                </label>
                <Button
                  disabled={
                    busy ||
                    !validQuantity ||
                    !confirmed ||
                    !startDate ||
                    startDate < tashkentDateInputValue()
                  }
                  onClick={() =>
                    activate.mutate({
                      productId: product!.id,
                      date: tashkentDateToTimestamp(startDate),
                      openingQuantity: Number(quantity),
                    })
                  }
                >
                  Boshlang'ich qoldiqni tasdiqlash
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Boshlang'ich qoldiqni rahbar tasdiqlaydi.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-sm">
              <div>
                <p className="text-xs text-muted-foreground">Kun boshida</p>
                <b>{row.active ? formatNumber(row.opening, 3) : "—"}</b>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Prixod</p>
                <b>{row.active ? formatNumber(row.received, 3) : "—"}</b>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Ostatka</p>
                <b
                  className={
                    row.closing < 0 ? "text-destructive" : "text-emerald-600"
                  }
                >
                  {row.active ? formatNumber(row.closing, 3) : "—"}
                </b>
              </div>
            </div>
            {!row.active ? (
              <p className="text-sm text-muted-foreground">
                Hisob {formatTashkentDate(row.effectiveDate)} dan boshlanadi. Bu
                kun uchun yangi prixod kiritilmaydi.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Yangi prixodni jadvaldagi katakka yozing va Enter yoki Tab
                bosing. Bu oynada kirimlar tarixi ko'rsatiladi.
              </p>
            )}
            <div className="space-y-2">
              <h4 className="text-sm font-semibold">
                Shu kundagi prixodlar tarixi
              </h4>
              {history.isPending ? (
                <p className="text-sm">Yuklanmoqda...</p>
              ) : history.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  Tarixni yuklab bo'lmadi.
                </p>
              ) : history.data?.items.length === 0 ? (
                <p className="text-sm text-muted-foreground">Prixod yo'q.</p>
              ) : (
                history.data?.items.map(event => (
                  <div
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <div>
                      <p>
                        <b>
                          #{event.id} · {Number(event.quantity) > 0 ? "+" : ""}
                          {formatNumber(event.quantity, 3)} {product?.unit}
                        </b>{" "}
                        ·{" "}
                        {event.kind === "receipt_reversal"
                          ? "Bekor qilish"
                          : event.reversed
                            ? "Bekor qilingan prixod"
                            : "Prixod"}
                      </p>
                      <p className="break-words text-xs text-muted-foreground">
                        {event.note || "Izohsiz"}
                      </p>
                    </div>
                    {event.kind === "receipt" && !event.reversed && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => {
                          setReversal(event.id);
                          setReason("");
                        }}
                      >
                        Bekor qilish
                      </Button>
                    )}
                  </div>
                ))
              )}
              {history.data && history.data.pageCount > 1 && (
                <div className="flex items-center justify-between text-xs">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={history.data.page <= 1 || busy}
                    onClick={() => setPage(page - 1)}
                  >
                    Oldingi
                  </Button>
                  {history.data.page} / {history.data.pageCount}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      history.data.page >= history.data.pageCount || busy
                    }
                    onClick={() => setPage(page + 1)}
                  >
                    Keyingi
                  </Button>
                </div>
              )}
            </div>
            {reversal !== null && (
              <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
                <p className="text-sm">
                  Prixod #{reversal} bekor qilinadi. Asl yozuv tarixda qoladi.
                </p>
                <Input
                  aria-label="Bekor qilish sababi"
                  placeholder="Sababi"
                  value={reason}
                  disabled={busy}
                  onChange={event => setReason(event.target.value)}
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => reverse.mutate({ id: reversal, reason })}
                  >
                    Bekor qilishni tasdiqlash
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => setReversal(null)}
                  >
                    Qaytish
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
  return { query, open, dialog };
}
