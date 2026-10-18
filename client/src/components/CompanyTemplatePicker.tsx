import { useEffect, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  companyColumnLabel,
  COMPANY_MODULES,
  type CompanyColumnKey,
} from "@shared/companyPreferences";
import {
  COMPANY_TEMPLATES,
  companyTemplatePreferences,
  type CompanyTemplateId,
} from "@shared/companyTemplates";
import { Check, LayoutTemplate, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Configuration = Awaited<
  ReturnType<
    ReturnType<typeof trpc.useUtils>["companyPreferences"]["get"]["fetch"]
  >
>;
export function CompanyTemplatePicker({
  dirty,
  onApplied,
}: {
  dirty: boolean;
  onApplied: (configuration: Configuration) => void;
}) {
  const utils = trpc.useUtils();
  const status = trpc.companyPreferences.onboarding.status.useQuery();
  const [selected, setSelected] = useState<CompanyTemplateId | null>(null);
  useEffect(() => {
    const appliedId = status.data?.template?.templateId;
    if (appliedId) setSelected(current => current ?? appliedId);
  }, [status.data?.template?.templateId]);
  const [requestKeys] = useState(
    () =>
      Object.fromEntries(
        COMPANY_TEMPLATES.map(template => [template.id, crypto.randomUUID()])
      ) as Record<CompanyTemplateId, string>
  );
  const apply = trpc.companyPreferences.onboarding.choose.useMutation({
    onSuccess: async result => {
      utils.companyPreferences.get.setData(undefined, result.configuration);
      onApplied(result.configuration);
      await Promise.all([
        utils.companyPreferences.get.invalidate(),
        utils.companyPreferences.onboarding.status.invalidate(),
      ]);
      toast.success(
        "Faoliyat shabloni saqlandi. Kabinet firmangizga moslandi."
      );
    },
    onError: error => {
      toast.error(error.message);
      void status.refetch();
    },
  });
  const definition = COMPANY_TEMPLATES.find(
    template => template.id === selected
  );
  const preview = selected ? companyTemplatePreferences(selected) : null;
  const eligible = status.data?.state === "eligible";
  const applied = status.data?.template;
  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <LayoutTemplate className="size-4" />
          Faoliyat turiga mos boshlang‘ich shablon
        </h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
          Yangi firma uchun mos nomlar va menyuni bir marta tanlang. Shablon
          mahsulot, agent, tranzaksiya yoki boshlang‘ich qoldiq yaratmaydi.
        </p>
      </div>
      {status.isError ? (
        <div role="alert" className="rounded-lg border p-3 text-sm">
          Shablon holatini yuklab bo‘lmadi.{" "}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void status.refetch()}
          >
            Qayta urinish
          </Button>
        </div>
      ) : status.isLoading ? (
        <p role="status" className="text-sm text-muted-foreground">
          Firma holati tekshirilmoqda…
        </p>
      ) : applied ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-500/25 bg-emerald-500/5 p-4 text-sm"
        >
          <p className="font-medium">
            Tanlangan:{" "}
            {
              COMPANY_TEMPLATES.find(
                template => template.id === applied.templateId
              )?.name
            }
          </p>
          <p className="mt-1 text-muted-foreground">
            Shablon {applied.appliedDate.split("-").reverse().join(".")} kuni
            qo‘llangan. Keyingi o‘zgarishlar uchun “Ustun nomlari” va “Modullar”
            bo‘limlaridan foydalaning.
          </p>
        </div>
      ) : !eligible ? (
        <div
          role="status"
          className="rounded-lg border bg-muted/30 p-4 text-sm"
        >
          Bu firmada yozuvlar yoki sozlamalar mavjud. Shablonlar bilan tanishish
          mumkin; ularni qo‘llash yopiq. Mavjud nomlar va menyuni alohida
          sozlashingiz mumkin.
        </div>
      ) : (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
          Firma hali bo‘sh. Quyidagi shablonlardan birini tanlab, oldindan
          ko‘ring va tasdiqlang.
        </div>
      )}
      <fieldset
        disabled={apply.isPending}
        className="grid gap-3 lg:grid-cols-3"
      >
        <legend className="sr-only">Faoliyat turini tanlang</legend>
        {COMPANY_TEMPLATES.map(template => (
          <label
            key={template.id}
            className={`cursor-pointer rounded-xl border p-4 transition-colors ${selected === template.id ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card hover:bg-muted/30"}`}
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="font-medium text-sm">{template.name}</span>
              <input
                type="radio"
                name="company-template"
                value={template.id}
                checked={selected === template.id}
                onChange={() => setSelected(template.id)}
                className="size-4 accent-primary"
              />
            </div>
            <p className="min-h-12 text-xs leading-5 text-muted-foreground">
              {template.description}
            </p>
            <p className="mt-4 border-t pt-3 text-xs font-medium">
              {template.focus}
            </p>
          </label>
        ))}
      </fieldset>
      {preview && definition && (
        <div className="rounded-xl border bg-muted/20 p-4 sm:p-5">
          <h4 className="mb-4 text-sm font-semibold">
            Oldindan ko‘rish: {definition.name}
          </h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                "agent_cash_keg",
                "agent_cash_pet",
                "salary",
                "supplier_payment",
                "product",
                "stock",
                "receipt",
                "dailyPrice",
              ] as CompanyColumnKey[]
            ).map(key => (
              <div
                key={key}
                className="rounded-lg border bg-card px-3 py-2 text-sm"
              >
                {companyColumnLabel(preview, key)}
              </div>
            ))}
          </div>
          <p className="mt-4 mb-2 text-xs font-medium text-muted-foreground">
            Menyuda ko‘rsatiladigan qo‘shimcha modullar
          </p>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(COMPANY_MODULES) as (keyof typeof COMPANY_MODULES)[])
              .filter(key => !preview.hiddenModules.includes(key))
              .map(key => (
                <Badge key={key} variant="secondary" className="gap-1">
                  <Check className="size-3" />
                  {COMPANY_MODULES[key].label}
                </Badge>
              ))}
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Kassa, mahsulotlar va qarzdorlik doim saqlanadi. Yashirilgan
            modullar o‘chirilmaydi va ruxsatlarni o‘zgartirmaydi. Ularni keyin
            menyuda yana ko‘rsatish mumkin.
          </p>
        </div>
      )}
      {eligible && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
          <p className="max-w-xl text-xs leading-5 text-muted-foreground">
            {dirty
              ? "Avval saqlanmagan ustun yoki modul o‘zgarishlarini bekor qiling. Shablon faqat boshlang‘ich bo‘sh firmaga qo‘llanadi."
              : "Tasdiqlash tanlangan nomlar va menyuni bugundan saqlaydi. Kassa va Tezkor KEG hisoblash qoidalari o‘zgarmaydi."}
          </p>
          <Button
            disabled={!selected || dirty || apply.isPending}
            className="gap-2"
            onClick={() =>
              selected &&
              apply.mutate({
                templateId: selected,
                requestKey: requestKeys[selected],
              })
            }
          >
            {apply.isPending && <Loader2 className="size-4 animate-spin" />}
            Shablonni qo‘llash
          </Button>
        </div>
      )}
    </div>
  );
}

export function CompanyOnboardingNotice({
  enabled,
  onOpen,
}: {
  enabled: boolean;
  onOpen: () => void;
}) {
  const status = trpc.companyPreferences.onboarding.status.useQuery(undefined, {
    enabled,
    staleTime: 60_000,
  });
  if (!enabled || status.data?.state !== "eligible") return null;
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
      <div>
        <p className="text-sm font-semibold">
          Yangi firmangizni faoliyat turiga moslang
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Ulgurji savdo, agentlar orqali tarqatish yoki ichimliklar uchun tayyor
          shablonni tanlang.
        </p>
      </div>
      <Button size="sm" className="gap-2" onClick={onOpen}>
        <LayoutTemplate className="size-4" />
        Shablon tanlash
      </Button>
    </div>
  );
}
