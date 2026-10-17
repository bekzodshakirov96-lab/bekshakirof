export type PendingReceipt = { text: string; key: string };
type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const pendingReceiptKey = (
  userId: number,
  productId: number,
  date: string
) => `bc:matrix-receipt:v1:${userId}:${productId}:${date}`;

/** A pending request is persisted BEFORE sending. Reload/date navigation must
 * recover the same UUID, never turn a lost response into a second receipt. */
export function readPendingReceipt(
  store: Store,
  key: string
): PendingReceipt | null {
  const raw = store.getItem(key);
  if (raw === null) return null;
  const value = JSON.parse(raw) as PendingReceipt;
  const quantity = Number(value?.text);
  if (
    typeof value?.text !== "string" ||
    !Number.isFinite(quantity) ||
    quantity <= 0 ||
    quantity > 1_000_000 ||
    Number(quantity.toFixed(3)) !== quantity ||
    typeof value?.key !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      value.key
    )
  )
    throw new Error(
      "Saqlanmagan prixod so'rovini tekshirib bo'lmadi. Prixodlar tarixini tekshiring."
    );
  return { text: value.text, key: value.key };
}

export function persistPendingReceipt(
  store: Store,
  key: string,
  pending: PendingReceipt
) {
  const existing = readPendingReceipt(store, key);
  if (
    existing &&
    (existing.key !== pending.key || existing.text !== pending.text)
  )
    throw new Error("Avval oldingi prixod so'rovini qayta tekshiring.");
  store.setItem(key, JSON.stringify(pending));
}

export function clearPendingReceipt(
  store: Store,
  key: string,
  requestKey: string
) {
  if (readPendingReceipt(store, key)?.key === requestKey) store.removeItem(key);
}
