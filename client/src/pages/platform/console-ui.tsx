import type { ReactNode } from "react";
import { Check, History } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  accessLabels,
  companyAccess,
  type AccessState,
  type Company,
} from "@shared/platform";

export const accessDots: Record<AccessState, string> = {
  trialing: "bg-blue-500",
  extended: "bg-emerald-500",
  provisioning: "bg-amber-500",
  pending_email: "bg-slate-400",
  expired: "bg-rose-500",
  suspended: "bg-orange-500",
};
export function ConsoleSection({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {subtitle && (
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function ConsoleEmpty({
  title,
  description,
  history = false,
}: {
  title: string;
  description: string;
  history?: boolean;
}) {
  const Icon = history ? History : Check;
  return (
    <div className="grid min-h-36 place-items-center px-5 py-7 text-center">
      <div>
        <Icon className="mx-auto mb-3 size-5 text-muted-foreground/60" />
        <p className="text-xs font-medium">{title}</p>
        <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}
export function AccessIndicator({ company }: { company: Company }) {
  const state = companyAccess(company);
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-xs">
      <span
        className={cn("size-1.5 shrink-0 rounded-full", accessDots[state])}
      />
      {accessLabels[state]}
    </span>
  );
}
export function CompanyAvatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid size-8 shrink-0 place-items-center rounded-lg border bg-muted/30 text-[11px] font-semibold text-muted-foreground"
    >
      {name.trim().slice(0, 1).toUpperCase()}
    </span>
  );
}
export function EventIndicator({ action }: { action: string }) {
  const tone =
    action === "suspend"
      ? "bg-orange-500"
      : ["resume", "provisioned", "email_verified"].includes(action)
        ? "bg-emerald-500"
        : "bg-slate-400";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1.5 shrink-0 rounded-full", tone)}
    />
  );
}
