import { useEffect, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader, QueryError } from "@/components/finance-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { trpc } from "@/lib/trpc";
import { useCompanyPreferences } from "@/lib/companyPreferences";
import { CompanyTemplatePicker } from "@/components/CompanyTemplatePicker";
import {
  COMPANY_COLUMNS,
  COMPANY_MODULES,
  companyPreferencesSchema,
  defaultCompanyPreferences,
  type CompanyColumnKey,
  type CompanyModuleKey,
  type CompanyPreferences,
} from "@shared/companyPreferences";
import {
  Check,
  Columns3,
  Eye,
  History,
  RotateCcw,
  Save,
  Settings2,
  LayoutTemplate,
} from "lucide-react";
import { toast } from "sonner";

export default function CompanySettings() {
  const { user } = useAuth();
  const { query } = useCompanyPreferences();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<CompanyPreferences>(
    defaultCompanyPreferences
  );
  const [baseRevision, setBaseRevision] = useState<number | null>(null);
  const [tab, setTab] = useState<"columns" | "modules" | "templates">(() =>
    window.location.hash === "#shablonlar" ? "templates" : "columns"
  );
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if (query.data && baseRevision === null) {
      setDraft(query.data.preferences);
      setBaseRevision(query.data.latestRevision);
    }
  }, [query.data, baseRevision]);
  const dirty = query.data
    ? JSON.stringify(draft) !== JSON.stringify(query.data.preferences)
    : false;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = trpc.companyPreferences.save.useMutation({
    onSuccess: async data => {
      setDraft(data.preferences);
      setBaseRevision(data.latestRevision);
      setConflict(false);
      utils.companyPreferences.get.setData(undefined, data);
      await Promise.all([
        utils.companyPreferences.get.invalidate(),
        utils.companyPreferences.onboarding.status.invalidate(),
      ]);
      toast.success(
        "Firma sozlamalari saqlandi. Bugun va keyingi kunlarga qo‘llanadi."
      );
    },
    onError: error => {
      if (error.data?.code === "CONFLICT") setConflict(true);
      toast.error(error.message);
    },
  });
  if (user?.role !== "admin")
    return (
      <div className="rounded-xl border p-6">
        Firma sozlamalarini faqat rahbar boshqaradi.
      </div>
    );
  if (query.isError)
    return (
      <QueryError
        description={query.error.message}
        onRetry={() => void query.refetch()}
      />
    );
  const ready = baseRevision !== null && !query.isLoading;
  const columns = Object.entries(COMPANY_COLUMNS) as [
    CompanyColumnKey,
    (typeof COMPANY_COLUMNS)[CompanyColumnKey],
  ][];
  const modules = Object.entries(COMPANY_MODULES) as [
    CompanyModuleKey,
    (typeof COMPANY_MODULES)[CompanyModuleKey],
  ][];
  const invalid = !companyPreferencesSchema.safeParse(draft).success;
  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-8">
      <PageHeader
        eyebrow="Firma kabineti"
        title="Firma sozlamalari"
        description="Jadvallardagi nomlar va menyuni firmangizga moslang. Sozlamalar faqat shu firma uchun saqlanadi."
        action={
          <Button
            className="gap-2"
            disabled={!ready || !dirty || save.isPending || invalid || conflict}
            onClick={() =>
              save.mutate({
                preferences: draft,
                expectedRevision: baseRevision!,
              })
            }
          >
            <Save className="size-4" />
            {save.isPending ? "Saqlanmoqda…" : "Saqlash"}
          </Button>
        }
      />
      <div className="grid gap-3 md:grid-cols-3">
        {[
          {
            icon: Columns3,
            title: "Nomlar sizga mos",
            text: "Ustun nomi o‘zgaradi, hisoblash vazifasi saqlanadi.",
          },
          {
            icon: Eye,
            title: "Tartibli menyu",
            text: "Kerakli modullarni menyuda ko‘rsating yoki yashiring.",
          },
          {
            icon: History,
            title: "Oldingi davr saqlanadi",
            text: "Yangi nomlar bugun va keyingi sanalarda ko‘rinadi.",
          },
        ].map(({ icon: Icon, title, text }) => (
          <div key={title} className="flex gap-3 rounded-xl border bg-card p-4">
            <Icon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-semibold">{title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {text}
              </p>
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-3">
          <div
            className="flex gap-1"
            role="tablist"
            aria-label="Firma sozlamalari bo‘limlari"
          >
            {(
              [
                ["columns", "Ustun nomlari", Columns3],
                ["modules", "Modullar", Settings2],
                ["templates", "Faoliyat shablonlari", LayoutTemplate],
              ] as const
            ).map(([key, title, Icon]) => (
              <Button
                key={key}
                role="tab"
                aria-selected={tab === key}
                variant={tab === key ? "secondary" : "ghost"}
                className="gap-2"
                onClick={() => setTab(key)}
              >
                <Icon className="size-4" />
                {title}
              </Button>
            ))}
          </div>
          <span
            role="status"
            className="flex items-center gap-1.5 text-xs text-muted-foreground"
          >
            {!ready ? (
              "Yuklanmoqda…"
            ) : dirty ? (
              "Saqlanmagan o‘zgarishlar bor"
            ) : (
              <>
                <Check className="size-3.5 text-emerald-600" />
                Sozlamalar saqlangan
              </>
            )}
          </span>
        </div>
        {conflict && (
          <div
            role="alert"
            className="m-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm"
          >
            Boshqa oynada yangi sozlamalar saqlangan. Sizning o‘zgarishlaringiz
            saqlanmadi.{" "}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const result = await query.refetch();
                if (result.data) {
                  setDraft(result.data.preferences);
                  setBaseRevision(result.data.latestRevision);
                  setConflict(false);
                }
              }}
            >
              Yangi sozlamalarni olish
            </Button>
          </div>
        )}
        {tab === "templates" ? (
          <CompanyTemplatePicker
            dirty={dirty}
            onApplied={configuration => {
              setDraft(configuration.preferences);
              setBaseRevision(configuration.latestRevision);
              setConflict(false);
            }}
          />
        ) : (
          <fieldset disabled={!ready || save.isPending} className="min-w-0">
            {tab === "columns" ? (
              <div className="p-4 sm:p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold">Jadval sarlavhalari</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Faqat ko‘rinadigan nomni o‘zgartiring. Katakni bo‘sh
                      qoldirsangiz, asl nom ishlatiladi.
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() =>
                      setDraft(value => ({ ...value, labels: {} }))
                    }
                  >
                    <RotateCcw className="size-3.5" />
                    Asl nomlar
                  </Button>
                </div>
                {(["journal", "matrix"] as const).map(section => (
                  <section key={section} className="mb-7 last:mb-0">
                    <h4 className="mb-3 text-sm font-semibold">
                      {section === "journal"
                        ? "Kunlik jurnal"
                        : "Agent × Tovar"}
                    </h4>
                    <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                      {columns
                        .filter(
                          ([, definition]) => definition.section === section
                        )
                        .map(([key, definition]) => (
                          <div key={key} className="space-y-1.5">
                            <label
                              htmlFor={`column-${key}`}
                              className="text-sm font-medium"
                            >
                              {definition.label}
                            </label>
                            <Input
                              id={`column-${key}`}
                              value={draft.labels[key] ?? ""}
                              placeholder={definition.label}
                              maxLength={40}
                              aria-describedby={`hint-${key}`}
                              onChange={event => {
                                const label = event.target.value;
                                setDraft(value => {
                                  const labels = { ...value.labels };
                                  if (label.trim()) labels[key] = label;
                                  else delete labels[key];
                                  return { ...value, labels };
                                });
                              }}
                            />
                            <p
                              id={`hint-${key}`}
                              className="text-xs leading-5 text-muted-foreground"
                            >
                              {definition.hint}
                            </p>
                          </div>
                        ))}
                    </div>
                  </section>
                ))}
                {invalid && (
                  <p role="alert" className="mt-3 text-sm text-destructive">
                    Nomlar 1–40 belgidan iborat bo‘lsin va bitta jadvalda
                    takrorlanmasin.
                  </p>
                )}
                <div className="mt-6 rounded-lg border bg-muted/30 p-4">
                  <p className="mb-3 text-xs font-medium text-muted-foreground">
                    Agent × Tovar — sarlavhalar ko‘rinishi
                  </p>
                  <div className="flex gap-2 overflow-x-auto">
                    {columns
                      .filter(
                        ([, definition]) => definition.section === "matrix"
                      )
                      .map(([key, definition]) => (
                        <span
                          key={key}
                          className="rounded-md border bg-card px-3 py-2 text-xs font-medium whitespace-nowrap"
                        >
                          {draft.labels[key] ?? definition.label}
                        </span>
                      ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 sm:p-6">
                <h3 className="font-semibold">
                  Menyuda ko‘rsatiladigan modullar
                </h3>
                <p className="mt-1 mb-5 max-w-3xl text-sm leading-6 text-muted-foreground">
                  Yashirish menyuni soddalashtiradi; ma’lumotlar, hisob-kitob va
                  xodim ruxsatlari o‘zgarmaydi. Yashirilgan bo‘lim havola orqali
                  ochiladi. Agent × Tovar kartasini qayta yoqsangiz, oldingi
                  yozuvlari bilan yana ko‘rinadi.
                </p>
                <div className="grid gap-3 md:grid-cols-2">
                  {modules.map(([key, definition]) => (
                    <label
                      key={key}
                      htmlFor={`module-${key}`}
                      className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border p-4"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {definition.label}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {definition.description}
                        </p>
                      </div>
                      <Switch
                        id={`module-${key}`}
                        checked={!draft.hiddenModules.includes(key)}
                        onCheckedChange={checked =>
                          setDraft(value => ({
                            ...value,
                            hiddenModules: checked
                              ? value.hiddenModules.filter(id => id !== key)
                              : [...value.hiddenModules, key],
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <p className="mt-5 text-xs text-muted-foreground">
                  Kassa, mahsulotlar, qarzdorlik va firma sozlamalari doim
                  menyuda qoladi. To‘lov tizimlarini ulash va obuna huquqlari
                  alohida boshqariladi.
                </p>
              </div>
            )}
          </fieldset>
        )}
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        Saqlash faqat firma sozlamalarini yangilaydi. Moliyaviy yozuvlar, ombor
        qoldiqlari va Tezkor KEG amallari o‘zgarmaydi.
      </p>
    </div>
  );
}
