import { useState } from "react";
import {
  Building2,
  CalendarDays,
  Check,
  ExternalLink,
  Info,
  Loader2,
  Mail,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  accessLabels,
  companyAccess,
  type Company,
  type PlatformAccount,
} from "@shared/platform";
import { api, date, ErrorMessage, Status } from "./ui";
import { ConsoleSection } from "./console-ui";
import { BillingPanel } from "./BillingPanel";

export function CompanyCabinet({
  account,
  company,
  refresh,
}: {
  account: PlatformAccount;
  company: Company | null;
  refresh: () => unknown;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!company)
    return (
      <ErrorMessage message="Firma topilmadi. Platforma administratoriga murojaat qiling." />
    );
  const state = companyAccess(company);
  const ready = state === "trialing" || state === "extended";
  const trialProgress =
    company.trialStart &&
    company.trialEnd &&
    company.trialEnd > company.trialStart
      ? Math.min(
          100,
          Math.max(
            0,
            ((Date.now() - company.trialStart) /
              (company.trialEnd - company.trialStart)) *
              100
          )
        )
      : 0;
  const description =
    state === "pending_email"
      ? "Emailingizga yuborilgan havola orqali hisobingizni tasdiqlang. Shundan keyin firma kabineti tayyorlanadi."
      : state === "provisioning"
        ? "Email tasdiqlandi. Platforma operatori firmangiz uchun alohida baza va kabinetni tayyorlaydi. Bu vaqtda bepul sinov muddati sarflanmaydi."
        : state === "suspended"
          ? "Firma kirishi vaqtincha to‘xtatilgan. Sababini aniqlash uchun platforma administratoriga murojaat qiling. Ma’lumotlaringiz saqlanadi."
          : state === "expired"
            ? "Foydalanish muddati tugagan. Davom etish uchun platforma administratoriga murojaat qiling. Ma’lumotlaringiz saqlanadi."
            : "Firma kabinetingiz tayyor. Savdo, ombor, kassa va hisobotlar bilan ishni davom ettirishingiz mumkin.";
  async function action(kind: "resend" | "launch") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "resend") {
        await api("/resend", {});
        toast.success("Tasdiqlash xati yuborildi.");
      } else {
        const result = await api<{ action: string; token: string }>(
          `/companies/${company!.id}/launch`,
          {}
        );
        const form = document.createElement("form");
        form.method = "POST";
        form.action = result.action;
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = "token";
        input.value = result.token;
        form.append(input);
        document.body.append(form);
        form.submit();
        form.remove();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-[11px] text-muted-foreground">
            Firma kabineti · {date(Date.now())}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {company.name}
          </h1>
          <p className="mt-2 text-xs text-muted-foreground">
            Xush kelibsiz, {account.name}. Firma holati va foydalanish muddati
            shu yerda.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => refresh()}
          >
            <RefreshCw className="size-3.5" />
            Yangilash
          </Button>
          {ready && (
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={busy}
              onClick={() => action("launch")}
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ExternalLink className="size-3.5" />
              )}
              Ish maydonini ochish
            </Button>
          )}
        </div>
      </div>
      {error && <ErrorMessage message={error} />}
      <div className="grid divide-y overflow-hidden rounded-xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {[
          { label: "Firma kodi", value: company.slug, icon: Building2 },
          { label: "Bepul sinov", value: "1 kalendar oy", icon: CalendarDays },
          {
            label: "Kirish muddati",
            value: date(company.accessUntil),
            icon: ShieldCheck,
          },
        ].map(item => (
          <div key={item.label} className="min-w-0 p-4">
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <item.icon className="size-3.5" />
              {item.label}
            </p>
            <p className="mt-2 break-words text-sm font-semibold tabular-nums">
              {item.value}
            </p>
          </div>
        ))}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <div className="space-y-5">
          <ConsoleSection
            title="Firma holati"
            action={<Status company={company} />}
          >
            <div className="space-y-4 p-4">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {description}
              </p>
              <div className="divide-y rounded-xl border px-4">
                {[
                  {
                    label: "Email tasdiqlash",
                    done: account.verified,
                    text: account.verified
                      ? "Tasdiqlangan"
                      : "Tasdiqlash kutilmoqda",
                  },
                  {
                    label: "Firma kabineti",
                    done: !!company.trialStart,
                    text: company.trialStart
                      ? "Tayyor"
                      : "Tayyorlash kutilmoqda",
                  },
                  {
                    label: "Kirish huquqi",
                    done: ready,
                    text: accessLabels[state],
                  },
                ].map(step => (
                  <div
                    key={step.label}
                    className="flex items-center gap-2.5 py-3"
                  >
                    <span
                      className={`grid size-5 shrink-0 place-items-center rounded-full ${step.done ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "border bg-muted text-muted-foreground"}`}
                    >
                      {step.done ? (
                        <Check className="size-3" />
                      ) : (
                        <span className="size-1 rounded-full bg-muted-foreground/60" />
                      )}
                    </span>
                    <span className="flex-1 text-xs">{step.label}</span>
                    <span className="text-right text-[11px] text-muted-foreground">
                      {step.text}
                    </span>
                  </div>
                ))}
              </div>
              {!account.verified && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs"
                  disabled={busy}
                  onClick={() => action("resend")}
                >
                  <Mail className="size-3.5" />
                  Xatni qayta yuborish
                </Button>
              )}
            </div>
          </ConsoleSection>
          <ConsoleSection title="Firma ma’lumotlari">
            <dl className="divide-y px-4 text-xs">
              {[
                ["Firma nomi", company.name],
                ["Firma egasi", company.ownerName],
                ["Email", company.email],
                ["Telefon", company.phone || "Ko‘rsatilmagan"],
                ["Ro‘yxatdan o‘tgan", date(company.createdAt)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-3"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </ConsoleSection>
        </div>
        <div className="space-y-5">
          <ConsoleSection
            title="Foydalanish muddati"
            subtitle="Bir oylik sinov firma tayyor bo‘lgach boshlanadi"
          >
            <div className="p-4">
              <div className="mb-4 flex justify-between gap-3 text-xs">
                <span className="text-muted-foreground">Bepul sinov</span>
                <span className="font-medium">1 oy</span>
              </div>
              <div
                className="mb-5 h-1.5 overflow-hidden rounded-full bg-muted"
                aria-hidden="true"
              >
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${trialProgress}%` }}
                />
              </div>
              <dl className="space-y-3 text-xs">
                {[
                  ["Sinov boshlandi", date(company.trialStart)],
                  ["Sinov tugaydi", date(company.trialEnd)],
                  ["Kirish muddati", date(company.accessUntil)],
                ].map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="font-medium tabular-nums">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 border-t pt-4 text-[11px] leading-relaxed text-muted-foreground">
                Obunani to‘lash va to‘lovlar tarixi uchun “Obuna va to‘lovlar”
                bo‘limidan foydalaning.
              </p>
            </div>
          </ConsoleSection>
          <p className="flex items-start gap-2 px-1 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Firma kassasi, savdosi va qarzdorlik hisoblari o‘z ish maydonida
            yuritiladi.
          </p>
        </div>
      </div>
      {account.verified && (
        <BillingPanel companyId={company.id} refresh={refresh} />
      )}
    </div>
  );
}
