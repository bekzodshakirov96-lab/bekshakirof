import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Copy,
  History,
  Loader2,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Company, PlatformEvent } from "@shared/platform";
import {
  api,
  date,
  time,
  events,
  selectClass,
  Status,
  Field,
  Loading,
  ErrorMessage,
} from "./ui";

type Detail = { company: Company; events: PlatformEvent[] };
export function CompanyDetail({
  id,
  onClose,
  returnFocus,
}: {
  id: string | null;
  onClose: () => void;
  returnFocus?: () => void;
}) {
  const cache = useQueryClient();
  const detail = useQuery({
    queryKey: ["platform", "detail", id],
    queryFn: () => api<Detail>(`/admin/companies/${id}`),
    enabled: !!id,
    retry: false,
  });
  // Keep the current card visible during the closing animation, never across different IDs.
  const lastDetail = useRef<Detail | undefined>(undefined);
  useEffect(() => {
    if (detail.data) lastDetail.current = detail.data;
  }, [detail.data]);
  const shown = id ? detail.data : lastDetail.current;
  const company = shown?.company;
  const [tab, setTab] = useState("profile");
  const [action, setAction] = useState("extend");
  const [reason, setReason] = useState("");
  const [days, setDays] = useState(30);
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (id) {
      setReason("");
      setError("");
      setAction("extend");
      setDays(30);
      setTab("profile");
    }
  }, [id]);
  const valid =
    reason.trim().length >= 5 &&
    (action !== "extend" ||
      (Number.isInteger(days) && days >= 1 && days <= 366));
  return (
    <Sheet
      open={!!id}
      onOpenChange={open => {
        if (!open && !saving.current) onClose();
      }}
    >
      <SheetContent
        side="right"
        className="h-dvh w-full gap-0 bg-card p-0 sm:max-w-[580px] 2xl:max-w-[620px] motion-reduce:animate-none motion-reduce:transition-none"
        onCloseAutoFocus={event => {
          if (returnFocus) {
            event.preventDefault();
            returnFocus();
          }
        }}
        onEscapeKeyDown={event => {
          if (saving.current) event.preventDefault();
        }}
        onPointerDownOutside={event => {
          if (saving.current) event.preventDefault();
        }}
      >
        <SheetHeader className="shrink-0 border-b px-5 pb-5 pt-6 sm:px-6">
          <p className="mb-4 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <Building2 className="size-3.5" />
            FIRMA KARTASI
          </p>
          <div className="flex min-w-0 items-start gap-3 pr-5">
            <span className="grid size-11 shrink-0 place-items-center rounded-xl border bg-muted/50 text-base font-semibold text-muted-foreground">
              {company ? (
                company.name.trim().slice(0, 1).toUpperCase()
              ) : (
                <Building2 className="size-5" />
              )}
            </span>
            <div className="min-w-0">
              <SheetTitle className="break-words text-xl leading-snug tracking-tight">
                {company?.name ?? "Firma ma’lumotlari"}
              </SheetTitle>
              <SheetDescription className="mt-1 break-words text-xs">
                {company?.slug ?? "Ma’lumotlar yuklanmoqda"}
              </SheetDescription>
            </div>
          </div>
          {company && (
            <div className="mt-4 flex items-center gap-2">
              <Status company={company} />
              <span className="ml-auto text-[10px] text-muted-foreground">
                Qo‘shilgan: {date(company.createdAt)}
              </span>
            </div>
          )}
        </SheetHeader>
        {id && detail.isPending ? (
          <Loading />
        ) : id && detail.error ? (
          <div className="space-y-3 p-6">
            <ErrorMessage message={detail.error.message} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => detail.refetch()}
            >
              Qayta urinish
            </Button>
          </div>
        ) : (
          company && (
            <Tabs
              value={tab}
              onValueChange={setTab}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <div className="shrink-0 border-b px-5 pt-3 sm:px-6">
                <TabsList className="h-10 w-full justify-start gap-1 rounded-none bg-transparent p-0">
                  <TabsTrigger
                    value="profile"
                    className="h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-2 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    <UserRound className="mr-1 size-3.5" />
                    Ma’lumotlar
                  </TabsTrigger>
                  <TabsTrigger
                    value="access"
                    className="h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-2 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    <ShieldCheck className="mr-1 size-3.5" />
                    Kirish huquqi
                  </TabsTrigger>
                  <TabsTrigger
                    value="history"
                    className="h-10 flex-none rounded-none border-0 border-b-2 border-transparent px-2 text-xs shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                  >
                    <History className="mr-1 size-3.5" />
                    Tarix{" "}
                    <span className="ml-1 text-[10px] text-muted-foreground">
                      {shown?.events.length ?? 0}
                    </span>
                  </TabsTrigger>
                </TabsList>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
                <TabsContent value="profile" className="m-0 space-y-6">
                  <section>
                    <h3 className="mb-3 text-xs font-semibold">
                      Firma egasi va aloqa
                    </h3>
                    <dl className="divide-y rounded-xl border px-4 text-xs">
                      {[
                        ["Firma egasi", company.ownerName],
                        ["Email", company.email],
                        ["Telefon", company.phone || "Ko‘rsatilmagan"],
                      ].map(([label, value]) => (
                        <div
                          key={label}
                          className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-3"
                        >
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="break-words font-medium">{value}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                  <section>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold">
                        Foydalanish muddati
                      </h3>
                      <button
                        className="rounded text-[11px] text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() => setTab("access")}
                      >
                        Boshqarish
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border bg-muted/20 p-4">
                        <p className="text-[10px] text-muted-foreground">
                          Sinov tugaydi
                        </p>
                        <p className="mt-2 text-sm font-semibold tabular-nums">
                          {date(company.trialEnd)}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Boshlangan: {date(company.trialStart)}
                        </p>
                      </div>
                      <div className="rounded-xl border bg-muted/20 p-4">
                        <p className="text-[10px] text-muted-foreground">
                          Kirish muddati
                        </p>
                        <p className="mt-2 text-sm font-semibold tabular-nums">
                          {date(company.accessUntil)}
                        </p>
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Toshkent vaqti bo‘yicha
                        </p>
                      </div>
                    </div>
                  </section>
                  <section>
                    <h3 className="mb-3 text-xs font-semibold">
                      Firma identifikatsiyasi
                    </h3>
                    <dl className="space-y-4 text-xs">
                      <div>
                        <dt className="mb-1.5 text-[10px] text-muted-foreground">
                          Firma kodi
                        </dt>
                        <dd className="break-all font-mono text-[11px]">
                          {company.slug}
                        </dd>
                      </div>
                      <div>
                        <dt className="mb-1.5 text-[10px] text-muted-foreground">
                          Firma manzili
                        </dt>
                        <dd className="break-all">
                          {company.origin ?? "Hali tayyorlanmagan"}
                        </dd>
                      </div>
                      <div>
                        <dt className="mb-1.5 text-[10px] text-muted-foreground">
                          Firma ID
                        </dt>
                        <dd className="flex min-w-0 items-center gap-2">
                          <code className="break-all text-[10px] text-muted-foreground">
                            {company.id}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-6 shrink-0"
                            aria-label="Firma ID sini nusxalash"
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(company.id);
                                toast.success("Firma ID nusxalandi.");
                              } catch {
                                toast.error("ID ni belgilab nusxalang.");
                              }
                            }}
                          >
                            <Copy className="size-3" />
                          </Button>
                        </dd>
                      </div>
                    </dl>
                  </section>
                </TabsContent>
                <TabsContent value="access" className="m-0 space-y-5">
                  <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/20 p-4 text-xs">
                    <span className="text-muted-foreground">
                      Hozirgi kirish muddati
                    </span>
                    <span className="font-semibold tabular-nums">
                      {date(company.accessUntil)}
                    </span>
                  </div>
                  {["ready", "suspended"].includes(company.state) ? (
                    <form
                      onSubmit={async event => {
                        event.preventDefault();
                        if (saving.current || !valid) return;
                        saving.current = true;
                        setBusy(true);
                        setError("");
                        try {
                          await api(`/admin/companies/${company.id}`, {
                            action,
                            reason,
                            revision: company.revision,
                            ...(action === "extend" ? { days } : {}),
                          });
                          setReason("");
                          setAction("extend");
                          toast.success("Firma holati yangilandi.");
                          await cache.invalidateQueries({
                            queryKey: ["platform"],
                          });
                        } catch (err) {
                          setError((err as Error).message);
                          await detail.refetch();
                        } finally {
                          saving.current = false;
                          setBusy(false);
                        }
                      }}
                      className="space-y-4"
                    >
                      <h3 className="text-sm font-semibold">
                        Kirishni boshqarish
                      </h3>
                      {error && <ErrorMessage message={error} />}
                      <fieldset
                        disabled={busy}
                        className="space-y-4 disabled:opacity-70"
                      >
                        <Field label="Amal">
                          <select
                            className={selectClass}
                            value={action}
                            onChange={e => setAction(e.target.value)}
                          >
                            <option value="extend">
                              Kirish muddatini uzaytirish
                            </option>
                            {company.state === "ready" ? (
                              <option value="suspend">
                                Kirishni to‘xtatish
                              </option>
                            ) : (
                              <option value="resume">Kirishni tiklash</option>
                            )}
                          </select>
                        </Field>
                        {action === "extend" && (
                          <Field label="Qo‘shiladigan kun">
                            <Input
                              type="number"
                              min={1}
                              max={366}
                              required
                              value={days}
                              onChange={e => setDays(Number(e.target.value))}
                            />
                          </Field>
                        )}
                        <Field label="Sabab (tarixda saqlanadi)">
                          <Input
                            value={reason}
                            onChange={e => setReason(e.target.value)}
                            minLength={5}
                            maxLength={500}
                            required
                            placeholder="Amal sababini yozing"
                          />
                        </Field>
                        <p className="text-xs leading-relaxed text-muted-foreground">
                          {action === "extend"
                            ? "Bu amal faqat kirish muddatini uzaytiradi. Obuna to‘lovi yoki kassaga pul yozmaydi."
                            : action === "suspend"
                              ? "Firmaga kirish 15 soniya ichida to‘xtatiladi. Ma’lumotlar o‘chirilmaydi."
                              : "Kirish tiklanadi. Tugagan muddat avtomatik uzaytirilmaydi."}
                        </p>
                        {action === "extend" &&
                          Number.isInteger(days) &&
                          days >= 1 &&
                          days <= 366 && (
                            <p className="rounded-lg border bg-muted/20 p-3 text-xs">
                              Yangi kirish muddati:{" "}
                              <strong className="tabular-nums">
                                {date(
                                  Math.max(
                                    Date.now(),
                                    company.accessUntil ?? 0
                                  ) +
                                    days * 86400000
                                )}
                              </strong>
                            </p>
                          )}
                        <Button
                          className="w-full"
                          disabled={busy || !valid}
                          variant={
                            action === "suspend" ? "destructive" : "default"
                          }
                        >
                          {busy && <Loader2 className="size-4 animate-spin" />}
                          {action === "suspend"
                            ? "Kirishni to‘xtatish"
                            : "O‘zgarishni saqlash"}
                        </Button>
                      </fieldset>
                    </form>
                  ) : (
                    <div className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-4 text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                      {company.state === "pending_email"
                        ? "Firma egasi emailini tasdiqlashi kerak. Hozircha sinov muddati boshlanmagan."
                        : "Firma alohida baza va kabinet tayyorlash navbatida. Tayyorlash yakunlangach, sinov boshlanadi."}
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="history" className="m-0">
                  <h3 className="text-xs font-semibold">Amallar tarixi</h3>
                  <p className="mb-5 mt-1 text-[11px] text-muted-foreground">
                    Oxirgi 100 ta amal · Toshkent vaqti
                  </p>
                  {shown?.events.length ? (
                    <ol className="ml-1.5 border-l pl-5">
                      {shown.events.map(event => (
                        <li key={event.id} className="relative pb-6 last:pb-1">
                          <span className="absolute -left-[25px] top-1 size-2 rounded-full bg-muted-foreground/40 ring-4 ring-card" />
                          <p className="text-xs font-medium">
                            {events[event.action] ?? event.action}
                          </p>
                          <p className="mt-1 text-[10px] text-muted-foreground">
                            {date(event.createdAt)} {time(event.createdAt)} ·{" "}
                            {event.actorName}
                          </p>
                          {event.reason && (
                            <p className="mt-2 break-words rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                              {event.reason}
                            </p>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="rounded-xl border p-4 text-xs text-muted-foreground">
                      Hozircha amallar qayd etilmagan.
                    </p>
                  )}
                </TabsContent>
              </div>
            </Tabs>
          )
        )}
        <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t bg-muted/15 px-5 py-3 sm:px-6">
          <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <ShieldCheck className="size-3.5" />
            Platforma boshqaruvi
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={busy}
            onClick={onClose}
          >
            Yopish
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
