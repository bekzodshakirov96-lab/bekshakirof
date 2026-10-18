import { useEffect, useState, type CSSProperties } from "react";
import {
  Palette,
  ImagePlus,
  RotateCcw,
  Save,
  Trash2,
  Loader2,
} from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CompanyBrandMark } from "./CompanyBrandMark";
import { trpc } from "@/lib/trpc";
import { prepareCompanyLogo, useCompanyBranding } from "@/lib/companyBranding";
import { companyBrandVariables } from "@/lib/companyBrandColors";
import {
  companyBrandFieldsSchema,
  defaultCompanyBranding,
  type CompanyBranding,
  type CompanyBrandingSave,
} from "@shared/companyBranding";
import { toast } from "sonner";

export function CompanyBrandingSettings() {
  const { query } = useCompanyBranding();
  const utils = trpc.useUtils();
  const [draft, setDraft] = useState<CompanyBranding>(defaultCompanyBranding);
  const [revision, setRevision] = useState<number | null>(null);
  const [logo, setLogo] = useState<CompanyBrandingSave["logo"]>({
    action: "keep",
  });
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [darkPreview, setDarkPreview] = useState(false);
  useEffect(() => {
    if (query.data && revision === null) {
      setDraft(query.data.branding);
      setRevision(query.data.revision);
    }
  }, [query.data, revision]);
  const dirty =
    !!query.data &&
    (JSON.stringify(draft) !== JSON.stringify(query.data.branding) ||
      logo.action !== "keep");
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const save = trpc.companyBranding.save.useMutation({
    onSuccess: data => {
      utils.companyBranding.get.setData(undefined, data);
      setDraft(data.branding);
      setRevision(data.revision);
      setLogo({ action: "keep" });
      setConflict(false);
      setError("");
      toast.success("Firma ko‘rinishi saqlandi.");
      void utils.companyBranding.get.invalidate();
    },
    onError: err => {
      setError(err.message);
      if (err.data?.code === "CONFLICT") setConflict(true);
    },
  });
  if (query.isError)
    return (
      <div role="alert" className="p-6">
        <p>{query.error.message}</p>
        <Button variant="outline" onClick={() => query.refetch()}>
          Qayta urinish
        </Button>
      </div>
    );
  const ready = revision !== null && !query.isLoading;
  const busy = save.isPending || processing;
  const parsed = companyBrandFieldsSchema.safeParse({
    name: draft.name,
    tagline: draft.tagline,
    color: draft.color,
  });
  const previewLogo =
    logo.action === "replace"
      ? `data:image/png;base64,${logo.base64}`
      : logo.action === "remove"
        ? null
        : draft.logoUrl;
  return (
    <div className="grid gap-7 p-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,.85fr)]">
      <form
        className="space-y-5"
        onSubmit={event => {
          event.preventDefault();
          if (!ready || busy || !parsed.success || conflict) return;
          save.mutate({
            expectedRevision: revision!,
            branding: parsed.data,
            logo,
          });
        }}
      >
        <div>
          <h3 className="text-base font-semibold">Firma nomi va ko‘rinishi</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            Bu sozlama faqat sizning firmangiz uchun. Xodimlar ham saqlangan
            nom, logotip va rangni ko‘radi.
          </p>
        </div>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
          >
            {error}
            {conflict && (
              <Button
                type="button"
                variant="outline"
                className="mt-2"
                onClick={async () => {
                  const r = await query.refetch();
                  if (r.data) {
                    setDraft(r.data.branding);
                    setRevision(r.data.revision);
                    setLogo({ action: "keep" });
                    setConflict(false);
                    setError("");
                  }
                }}
              >
                Yangi sozlamalarni olish
              </Button>
            )}
          </div>
        )}
        <fieldset disabled={!ready || busy} className="min-w-0 space-y-5">
          <label className="grid gap-2 text-sm font-medium">
            Firma nomi
            <Input
              value={draft.name}
              maxLength={80}
              required
              onChange={e => setDraft({ ...draft, name: e.target.value })}
              autoComplete="organization"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Nom ostidagi yozuv
            <Input
              value={draft.tagline}
              maxLength={80}
              onChange={e => setDraft({ ...draft, tagline: e.target.value })}
              placeholder="Masalan, savdo va xizmatlar"
            />
          </label>
          <div className="space-y-2">
            <p className="text-sm font-medium">Firma logotipi</p>
            <div className="flex flex-wrap items-center gap-3">
              <CompanyBrandMark
                name={draft.name}
                logoUrl={previewLogo}
                className="size-14"
              />
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium focus-within:ring-2 focus-within:ring-ring">
                <ImagePlus className="size-4" />
                Rasm tanlash
                <input
                  className="sr-only"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={!ready || busy}
                  onChange={async event => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setProcessing(true);
                    setError("");
                    try {
                      const base64 = await prepareCompanyLogo(file);
                      setLogo({ action: "replace", base64 });
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setProcessing(false);
                    }
                  }}
                />
              </label>
              {previewLogo && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setLogo({ action: "remove" })}
                >
                  <Trash2 className="mr-1 size-4" />
                  Logotipni olib tashlash
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPG yoki WebP · 5 MB gacha. Rasm avtomatik kichraytiriladi.
            </p>
          </div>
          <div className="space-y-3">
            <label
              htmlFor="company-brand-color"
              className="text-sm font-medium"
            >
              Saytning asosiy rangi
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="company-brand-color"
                type="color"
                aria-label="Asosiy rangni tanlash"
                value={draft.color ?? "#285BD4"}
                className="h-10 w-14 cursor-pointer rounded-md border p-1"
                onChange={e => setDraft({ ...draft, color: e.target.value })}
              />
              <Input
                aria-label="Rang kodi"
                value={draft.color ?? ""}
                placeholder="Standart rang"
                maxLength={7}
                className="w-40 font-mono"
                onChange={e =>
                  setDraft({ ...draft, color: e.target.value || null })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setDraft({ ...draft, color: null })}
              >
                <RotateCcw className="mr-1 size-4" />
                Standart rang
              </Button>
            </div>
            <div className="flex gap-2" aria-label="Tayyor ranglar">
              {[
                "#285BD4",
                "#0F766E",
                "#7C3AED",
                "#BE185D",
                "#B45309",
                "#334155",
              ].map(color => (
                <button
                  key={color}
                  type="button"
                  aria-label={`${color} rangini tanlash`}
                  aria-pressed={draft.color === color}
                  className="size-7 rounded-full border-2 border-white shadow-sm outline-offset-2 focus-visible:outline-2"
                  style={{ backgroundColor: color }}
                  onClick={() => setDraft({ ...draft, color })}
                />
              ))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Rang menyu, fon va tugmalarga moslanadi. Kirim, chiqim va xato
              ranglari o‘z ma’nosini saqlaydi.
            </p>
          </div>
          {!parsed.success && (
            <p role="alert" className="text-sm text-destructive">
              {parsed.error.issues[0]?.message}
            </p>
          )}
          <Button
            type="submit"
            disabled={!dirty || !parsed.success || conflict}
            className="gap-2"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            {processing
              ? "Rasm tayyorlanmoqda…"
              : save.isPending
                ? "Saqlanmoqda…"
                : "Ko‘rinishni saqlash"}
          </Button>
        </fieldset>
      </form>
      <div className="min-w-0 space-y-3">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Palette className="size-4" />
            Oldindan ko‘rish
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setDarkPreview(!darkPreview)}
          >
            {darkPreview ? "Yorug‘ ko‘rinish" : "Tungi ko‘rinish"}
          </Button>
        </div>
        <div
          style={
            companyBrandVariables(
              draft.color ?? "#285BD4",
              darkPreview
            ) as CSSProperties
          }
          className="overflow-hidden rounded-xl border bg-background text-foreground shadow-sm"
        >
          <div
            className="flex items-center gap-3 border-b p-4"
            style={{ backgroundColor: "var(--company-sidebar)" }}
          >
            <CompanyBrandMark
              name={draft.name || "Firma"}
              logoUrl={previewLogo}
            />
            <div className="min-w-0">
              <p data-no-translit className="truncate text-sm font-semibold">
                {draft.name || "Firma nomi"}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {draft.tagline || " "}
              </p>
            </div>
          </div>
          <div className="space-y-4 p-5">
            <div className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium">Boshqaruv paneli</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Firma kabinetining yangi ko‘rinishi
              </p>
              <div className="mt-4 h-2 w-3/4 rounded-full bg-primary" />
            </div>
            <span className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Namuna tugma
            </span>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Ko‘rinish saqlangandan keyin shu firmaning barcha foydalanuvchilariga
          qo‘llanadi.
        </p>
      </div>
    </div>
  );
}
