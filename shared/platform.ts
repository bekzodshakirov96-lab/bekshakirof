export type PlatformAccount = {
  id: string;
  name: string;
  email: string;
  role: "owner" | "super_admin";
  verified: boolean;
};
export type Company = {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  ownerName: string;
  email: string;
  phone: string;
  state: "pending_email" | "provisioning" | "ready" | "suspended";
  origin: string | null;
  createdAt: number;
  trialStart: number | null;
  trialEnd: number | null;
  accessUntil: number | null;
  revision: number;
};
export type PlatformEvent = {
  id: number;
  companyId: string | null;
  actorName: string;
  action: string;
  reason: string;
  createdAt: number;
};
export type AccessState =
  | "pending_email"
  | "provisioning"
  | "suspended"
  | "expired"
  | "trialing"
  | "extended";
export type AdminActivity = PlatformEvent & {
  companyName: string | null;
  companySlug: string | null;
};
export type AdminOverview = {
  asOf: number;
  stats: { state: AccessState; total: number }[];
  recent: Company[];
  expiring: Company[];
  expiringTotal: number;
  registeredThisMonth: number;
  activity: AdminActivity[];
};
export function companyAccess(company: Company, now = Date.now()): AccessState {
  if (company.state !== "ready") return company.state;
  if (!company.accessUntil || now >= company.accessUntil) return "expired";
  return company.trialEnd && now < company.trialEnd ? "trialing" : "extended";
}
export const accessLabels: Record<AccessState, string> = {
  pending_email: "Email tasdiqlanmagan",
  provisioning: "Firma tayyorlanmoqda",
  suspended: "Kirish to‘xtatilgan",
  expired: "Muddat tugagan",
  trialing: "Bepul sinov",
  extended: "Muddat uzaytirilgan",
};

/** Calendar month in Uzbekistan's fixed UTC+05 business zone; clamp month end. */
export function trialEndAfterMonth(start: number): number {
  const offset = 5 * 60 * 60 * 1000;
  const date = new Date(start + offset);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + 1);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime() - offset;
}
