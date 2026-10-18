import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { accessLabels, companyAccess, type Company } from "@shared/platform";
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/platform${path}`, {
    credentials: "same-origin",
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const data = await response.json().catch(() => ({
    error: "Platforma xizmati ushbu manzilda ishga tushirilmagan.",
  }));
  if (!response.ok) throw new Error(data.error ?? "Xizmatga ulanib bo‘lmadi.");
  return data;
}
export const date = (value: number | null) =>
  value
    ? new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "Asia/Tashkent",
      })
        .format(value)
        .replaceAll("/", ".")
    : "—";
export const time = (value: number) =>
  new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  }).format(value);
export const events: Record<string, string> = {
  billing_price_changed: "Obuna narxi o‘zgartirildi",
  billing_order_created: "Obuna to‘lov buyurtmasi yaratildi",
  billing_order_cancelled: "To‘lov buyurtmasi bekor qilindi",
  billing_paid: "Obuna to‘lovi tasdiqlandi",
  billing_cancelled: "Obuna to‘lovi bekor qilindi",
  super_admin_created: "Super administrator yaratildi",
  registered: "Firma ro‘yxatdan o‘tdi",
  email_verified: "Email tasdiqlandi",
  provisioned: "Firma tayyorlandi, sinov boshlandi",
  suspend: "Kirish to‘xtatildi",
  resume: "Kirish tiklandi",
  extend: "Kirish muddati uzaytirildi",
  owner_login: "Firma egasi kabinetga kirdi",
};
export const selectClass =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Status({ company }: { company: Company }) {
  const state = companyAccess(company);
  const color =
    state === "trialing" || state === "extended"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300"
      : state === "suspended" || state === "expired"
        ? "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
        : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300";
  return (
    <Badge variant="outline" className={`whitespace-nowrap ${color}`}>
      {accessLabels[state]}
    </Badge>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}
export function Loading() {
  return (
    <div
      className="flex items-center justify-center gap-2 p-12 text-muted-foreground"
      role="status"
    >
      <Loader2 className="size-5 animate-spin" /> Yuklanmoqda…
    </div>
  );
}
export function ErrorMessage({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
    >
      {message}
    </p>
  );
}
