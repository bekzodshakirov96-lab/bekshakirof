import {
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Clock3,
  Info,
  Users,
  Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  accessLabels,
  type AccessState,
  type AdminOverview,
} from "@shared/platform";
import { date, time, events } from "./ui";
import {
  AccessIndicator,
  CompanyAvatar,
  ConsoleEmpty,
  ConsoleSection,
  EventIndicator,
  accessDots,
} from "./console-ui";

export function OverviewPanel({
  data,
  onCompany,
  onCompanies,
  onHistory,
}: {
  data: AdminOverview;
  onCompany: (id: string) => void;
  onCompanies: (state?: "all" | AccessState, expiring?: boolean) => void;
  onHistory: () => void;
}) {
  const count = (key: AccessState) =>
    data.stats.find(item => item.state === key)?.total ?? 0;
  const total = data.stats.reduce((sum, item) => sum + item.total, 0);
  const metrics = [
    {
      label: "Jami firmalar",
      value: total,
      note: `Shu oy +${data.registeredThisMonth} ta`,
      icon: Building2,
      action: () => onCompanies(),
    },
    {
      label: "Bepul sinovda",
      value: count("trialing"),
      note: `${count("extended")} ta muddat uzaytirilgan`,
      icon: Users,
      action: () => onCompanies("trialing"),
    },
    {
      label: "Tayyorlash navbatida",
      value: count("provisioning"),
      note: "Email tasdiqlangan",
      icon: Clock3,
      action: () => onCompanies("provisioning"),
    },
    {
      label: "7 kunda muddati tugaydi",
      value: data.expiringTotal,
      note: "Kirish muddati bo‘yicha",
      icon: CalendarDays,
      action: () => onCompanies("all", true),
    },
  ];
  return (
    <div className="space-y-5">
      <section
        aria-label="Platforma ko‘rsatkichlari"
        className="grid grid-cols-2 divide-x overflow-hidden rounded-xl border bg-card lg:grid-cols-4"
      >
        {metrics.map((metric, index) => (
          <button
            key={metric.label}
            onClick={metric.action}
            className={cn(
              "group min-w-0 px-4 py-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-5",
              index > 1 && "border-t lg:border-t-0"
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <metric.icon className="hidden size-3.5 shrink-0 sm:block" />
                {metric.label}
              </span>
              <ArrowUpRight className="size-3 shrink-0 text-muted-foreground/40 group-hover:text-foreground" />
            </div>
            <p className="mt-3 text-[28px] font-semibold leading-none tracking-tight tabular-nums">
              {metric.value}
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground">
              {metric.note}
            </p>
          </button>
        ))}
      </section>
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1.7fr)_minmax(280px,1fr)]">
        <div className="min-w-0 space-y-5">
          <ConsoleSection
            title="Yangi firmalar"
            subtitle="Oxirgi ro‘yxatdan o‘tgan 5 ta firma"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground"
                onClick={() => onCompanies()}
              >
                Barchasi <ArrowRight className="size-3" />
              </Button>
            }
          >
            {data.recent.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[490px] text-left text-xs">
                  <caption className="sr-only">
                    Yangi firmalar, holati va ro‘yxatdan o‘tgan sanasi
                  </caption>
                  <thead className="border-b bg-muted/40 text-[11px] text-muted-foreground">
                    <tr>
                      {["Firma", "Holat", "Qo‘shilgan"].map(label => (
                        <th
                          scope="col"
                          key={label}
                          className="px-4 py-2 font-medium"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {data.recent.map(company => (
                      <tr key={company.id} className="hover:bg-muted/25">
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => onCompany(company.id)}
                            className="flex max-w-72 items-center gap-2.5 rounded text-left focus-visible:outline-2 focus-visible:outline-ring"
                          >
                            <CompanyAvatar name={company.name} />
                            <span className="min-w-0">
                              <span className="block truncate text-[13px] font-medium">
                                {company.name}
                              </span>
                              <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                                {company.ownerName}
                              </span>
                            </span>
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <AccessIndicator company={company} />
                        </td>
                        <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-muted-foreground tabular-nums">
                          {date(company.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ConsoleEmpty
                title="Hali firma yo‘q"
                description="Ro‘yxatdan o‘tgan firmalar shu yerda ko‘rinadi."
              />
            )}
          </ConsoleSection>
          <ConsoleSection
            title="Oxirgi faollik"
            subtitle="Eng yangi 6 ta platforma amali"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px] text-muted-foreground"
                onClick={onHistory}
              >
                Tarix <ArrowRight className="size-3" />
              </Button>
            }
          >
            {data.activity.length ? (
              <ol className="divide-y">
                {data.activity.map(event => (
                  <li
                    key={event.id}
                    className="flex items-start gap-3 px-4 py-3"
                  >
                    <span className="pt-1">
                      <EventIndicator action={event.action} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium">
                        {events[event.action] ?? event.action}
                      </p>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                        {event.companyId && (
                          <button
                            className="rounded text-left hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                            onClick={() => onCompany(event.companyId!)}
                          >
                            {event.companyName ?? "Firma"}
                          </button>
                        )}
                        <span>{event.actorName}</span>
                      </div>
                    </div>
                    <time
                      dateTime={new Date(event.createdAt).toISOString()}
                      className="shrink-0 text-right text-[10px] text-muted-foreground tabular-nums"
                    >
                      {date(event.createdAt)}
                      <span className="mt-1 block">
                        {time(event.createdAt)}
                      </span>
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <ConsoleEmpty
                history
                title="Hozircha amallar yo‘q"
                description="Ro‘yxatdan o‘tish va boshqaruv amallari shu yerda ko‘rinadi."
              />
            )}
          </ConsoleSection>
        </div>
        <div className="min-w-0 space-y-5">
          <ConsoleSection
            title="Kirish muddatlari"
            subtitle="Keyingi 7 kun ichida tugaydiganlar"
            action={
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground tabular-nums">
                {data.expiringTotal}
              </span>
            }
          >
            {data.expiring.length ? (
              <>
                <div className="divide-y">
                  {data.expiring.map(company => (
                    <button
                      key={company.id}
                      onClick={() => onCompany(company.id)}
                      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium">
                          {company.name}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          {date(company.accessUntil)}
                        </span>
                      </span>
                      <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
                        {Math.max(
                          1,
                          Math.ceil(
                            ((company.accessUntil ?? data.asOf) - data.asOf) /
                              86400000
                          )
                        )}{" "}
                        kun
                      </span>
                    </button>
                  ))}
                </div>
                <div className="border-t px-4 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-full text-[11px] text-muted-foreground"
                    onClick={() => onCompanies("all", true)}
                  >
                    Barchasini ko‘rish <ArrowRight className="size-3" />
                  </Button>
                </div>
              </>
            ) : (
              <ConsoleEmpty
                title="Yaqin muddatlar yo‘q"
                description="Keyingi 7 kunda muddati tugaydigan faol firma yo‘q."
              />
            )}
          </ConsoleSection>
          <ConsoleSection
            title="Firmalar holati"
            subtitle={`${total} ta firma bo‘yicha taqsimot`}
          >
            <div
              className="flex h-1.5 gap-0.5 overflow-hidden bg-muted"
              aria-hidden="true"
            >
              {(Object.keys(accessLabels) as AccessState[]).map(key => (
                <span
                  key={key}
                  className={accessDots[key]}
                  style={{
                    width: `${total ? (count(key) / total) * 100 : 0}%`,
                  }}
                />
              ))}
            </div>
            <div className="py-1">
              {(Object.keys(accessLabels) as AccessState[]).map(key => (
                <button
                  key={key}
                  onClick={() => onCompanies(key)}
                  className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      accessDots[key]
                    )}
                  />
                  <span className="flex-1 text-muted-foreground">
                    {accessLabels[key]}
                  </span>
                  <span className="font-medium tabular-nums">{count(key)}</span>
                  <ArrowRight className="ml-2 size-3 text-muted-foreground/40" />
                </button>
              ))}
            </div>
          </ConsoleSection>
          <div className="flex items-start gap-2.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <p>
              Bir oylik sinov firma tayyor bo‘lgach boshlanadi. Oylik narxni
              “Obuna va tarif” bo‘limida boshqarishingiz mumkin.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
