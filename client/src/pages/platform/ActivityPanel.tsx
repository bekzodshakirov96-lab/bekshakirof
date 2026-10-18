import { useEffect, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  History,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { AdminActivity } from "@shared/platform";
import { api, date, time, events, ErrorMessage } from "./ui";
import { ConsoleEmpty, EventIndicator } from "./console-ui";

export function ActivityPanel({
  onCompany,
}: {
  onCompany: (id: string) => void;
}) {
  const search = useSearch();
  const [, navigate] = useLocation();
  const rawPage = new URLSearchParams(search).get("page") ?? "1";
  const page =
    /^\d+$/.test(rawPage) && Number(rawPage) >= 1 && Number(rawPage) <= 100000
      ? Number(rawPage)
      : 1;
  useEffect(() => {
    if (search !== `page=${page}`)
      navigate(`/super-admin/tarix?page=${page}`, { replace: true });
  }, [search, page, navigate]);
  const history = useQuery({
    queryKey: ["platform", "activity", page],
    queryFn: () =>
      api<{ events: AdminActivity[]; total: number }>(
        `/admin/events?page=${page}`
      ),
    placeholderData: keepPreviousData,
    retry: false,
  });
  const total = history.data?.total ?? 0;
  const maxPage = Math.max(1, Math.ceil(total / 25));
  useEffect(() => {
    if (history.data && !history.isPlaceholderData && page > maxPage)
      navigate(`/super-admin/tarix?page=${maxPage}`, { replace: true });
  }, [history.data, history.isPlaceholderData, page, maxPage, navigate]);
  const [selected, setSelected] = useState<AdminActivity | null>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  function inspect(event: AdminActivity) {
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setSelected(event);
    setOpen(true);
  }
  return (
    <section aria-label="Platforma amallarining tarixi" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="flex items-center gap-2 text-muted-foreground">
          <History className="size-3.5" />
          Barcha firmalar bo‘yicha amallar
        </span>
        <span className="text-[11px] text-muted-foreground">
          Eng yangilari avval · Toshkent vaqti
        </span>
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 text-[11px] text-muted-foreground">
          <span aria-live="polite">
            {history.isPending
              ? "Amallar yuklanmoqda…"
              : history.isError
                ? "Tarix yuklanmadi"
                : `Jami ${total} ta amal`}
          </span>
          <span className="flex items-center gap-1.5" role="status">
            {history.isFetching ? (
              <>
                <Loader2 className="size-3 animate-spin motion-reduce:animate-none" />
                Yangilanmoqda
              </>
            ) : (
              <>
                <ShieldCheck className="size-3" />
                Amallar qaydnomasi
              </>
            )}
          </span>
        </div>
        {history.error ? (
          <div className="space-y-3 p-5">
            <ErrorMessage message={history.error.message} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => history.refetch()}
            >
              Qayta urinish
            </Button>
          </div>
        ) : history.isPending ? (
          <div
            className="space-y-1 px-4 py-3"
            role="status"
            aria-label="Amallar yuklanmoqda"
          >
            {[1, 2, 3, 4].map(key => (
              <div key={key} className="flex h-12 items-center gap-5 border-t">
                <span className="h-3 w-20 rounded bg-muted motion-safe:animate-pulse" />
                <span className="h-3 w-1/3 rounded bg-muted motion-safe:animate-pulse" />
              </div>
            ))}
          </div>
        ) : (
          history.data && (
            <>
              <div
                className="max-h-[65vh] overflow-auto"
                tabIndex={0}
                role="region"
                aria-label="Amallar tarixi jadvali"
                aria-busy={history.isPlaceholderData}
              >
                <table
                  className={cn(
                    "w-full min-w-[880px] text-left text-xs",
                    history.isPlaceholderData && "opacity-50"
                  )}
                >
                  <caption className="sr-only">
                    Platforma amali, firma, bajargan shaxs, sana va izoh
                  </caption>
                  <thead className="sticky top-0 z-10 border-b bg-muted text-[11px] text-muted-foreground">
                    <tr>
                      {[
                        "Sana / vaqt",
                        "Amal",
                        "Firma",
                        "Bajargan",
                        "Izoh",
                        "",
                      ].map((label, i) => (
                        <th
                          key={i}
                          scope="col"
                          className="whitespace-nowrap px-4 py-2.5 font-medium"
                        >
                          {label || (
                            <span className="sr-only">Amal tafsilotlari</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {history.data.events.map(event => (
                      <tr
                        key={event.id}
                        className={cn(
                          "hover:bg-muted/25",
                          open && selected?.id === event.id && "bg-primary/5"
                        )}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-[11px] tabular-nums">
                          <time
                            dateTime={new Date(event.createdAt).toISOString()}
                          >
                            {date(event.createdAt)}
                            <span className="mt-0.5 block text-[10px] text-muted-foreground">
                              {time(event.createdAt)}
                            </span>
                          </time>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            disabled={history.isPlaceholderData}
                            className="flex max-w-64 items-start gap-2 rounded text-left font-medium focus-visible:outline-2 focus-visible:outline-ring"
                            onClick={() => inspect(event)}
                          >
                            <span className="pt-0.5">
                              <EventIndicator action={event.action} />
                            </span>
                            <span>{events[event.action] ?? event.action}</span>
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          {event.companyId ? (
                            <button
                              disabled={history.isPlaceholderData}
                              className="block max-w-52 truncate rounded text-left hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                              onClick={() => onCompany(event.companyId!)}
                            >
                              {event.companyName ?? "Firma"}
                            </button>
                          ) : (
                            <span className="text-muted-foreground">
                              Platforma
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="block max-w-44 truncate text-muted-foreground"
                            title={event.actorName}
                          >
                            {event.actorName}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {event.reason ? (
                            <button
                              className="block max-w-60 truncate rounded text-left text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                              disabled={history.isPlaceholderData}
                              onClick={() => inspect(event)}
                              aria-label={`${events[event.action] ?? event.action} — to‘liq izohni ochish`}
                            >
                              {event.reason}
                            </button>
                          ) : (
                            <span className="text-muted-foreground/60">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground"
                            disabled={history.isPlaceholderData}
                            aria-label={`#${event.id} — amal tafsilotlari`}
                            onClick={() => inspect(event)}
                          >
                            <ArrowUpRight className="size-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!history.data.events.length && (
                <ConsoleEmpty
                  history
                  title="Hozircha amallar yo‘q"
                  description="Ro‘yxatdan o‘tish va administrator amallari shu yerda ko‘rinadi."
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 text-[11px] text-muted-foreground">
                <span>
                  {total
                    ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} / ${total} ta amal`
                    : "0 ta amal"}
                </span>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">
                    {page} / {maxPage} sahifa
                  </span>
                  <div className="flex gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label="Oldingi sahifa"
                      disabled={page === 1 || history.isPlaceholderData}
                      onClick={() =>
                        navigate(`/super-admin/tarix?page=${page - 1}`)
                      }
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-7"
                      aria-label="Keyingi sahifa"
                      disabled={page >= maxPage || history.isPlaceholderData}
                      onClick={() =>
                        navigate(`/super-admin/tarix?page=${page + 1}`)
                      }
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )
        )}
      </div>
      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Amal yoki izoh ustiga bosing — tafsilotlar o‘ng tomonda ochiladi. Firma
        nomi uning kartasini ochadi.
      </p>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="h-dvh w-full gap-0 bg-card p-0 sm:max-w-[520px] motion-reduce:animate-none motion-reduce:transition-none"
          onCloseAutoFocus={event => {
            if (trigger.current?.isConnected) {
              event.preventDefault();
              trigger.current.focus();
            }
          }}
        >
          <SheetHeader className="shrink-0 border-b px-5 pb-5 pt-6 sm:px-6">
            <p className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <History className="size-3.5" />
              AMAL TAFSILOTLARI
            </p>
            <SheetTitle className="pr-5 text-lg leading-snug tracking-tight">
              {selected
                ? (events[selected.action] ?? selected.action)
                : "Amal tafsilotlari"}
            </SheetTitle>
            <SheetDescription className="mt-1 text-xs">
              Qayd #{selected?.id} · Faqat ko‘rish uchun
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-6">
              <dl className="divide-y rounded-xl border px-4 text-xs">
                {[
                  [
                    "Sana / vaqt",
                    `${date(selected.createdAt)} · ${time(selected.createdAt)}`,
                  ],
                  ["Firma", selected.companyName ?? "Platforma"],
                  ["Firma kodi", selected.companySlug ?? "—"],
                  ["Bajargan", selected.actorName],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[100px_minmax(0,1fr)] gap-3 py-3"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-words font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
              <section>
                <h3 className="mb-3 text-xs font-semibold">Izoh</h3>
                <p className="whitespace-pre-wrap break-words rounded-xl border bg-muted/20 p-4 text-xs leading-relaxed">
                  {selected.reason || "Izoh yozilmagan."}
                </p>
              </section>
              <p className="text-[11px] text-muted-foreground">
                Sana va vaqt Toshkent bo‘yicha ko‘rsatilgan.
              </p>
            </div>
          )}
          <div className="mt-auto flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3 sm:px-6">
            <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Amallar qaydnomasi
            </span>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => setOpen(false)}
            >
              Yopish
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
