export type BillingProvider = "payme" | "click";
export type BillingMode = "off" | "test" | "live";
export type BillingOrder = {
  id: string;
  companyId: string;
  provider: BillingProvider;
  mode: BillingMode;
  amountTiyin: number;
  state: "pending" | "paid" | "cancelled";
  createdAt: number;
  expiresAt: number;
  paidAt: number | null;
  periodStart: number | null;
  periodEnd: number | null;
  checkoutUrl?: string;
  needsReview?: boolean;
};
export type BillingReview = Pick<BillingOrder, "id" | "companyId" | "provider" | "mode" | "amountTiyin" | "expiresAt"> & {
  companyName: string;
  transactionId: number;
  externalId: string;
};
export type BillingView = {
  mode: BillingMode;
  price: { id: number; amountTiyin: number } | null;
  providers: Record<BillingProvider, boolean>;
  orders: BillingOrder[];
  pendingOrder: Pick<
    BillingOrder,
    "id" | "provider" | "amountTiyin" | "mode"
  > | null;
  total: number;
  page: number;
  pageCount: number;
};
export const billingMoney = (tiyin: number) =>
  `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(tiyin / 100)} so‘m`;
