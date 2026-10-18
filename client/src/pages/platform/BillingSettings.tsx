import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { billingMoney, type BillingView } from "@shared/billing";
import { api, ErrorMessage, Loading } from "./ui";
import { ConsoleSection } from "./console-ui";
import { toast } from "sonner";

export function BillingSettings() {
  const cache = useQueryClient();
  const [edit, setEdit] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [previousId, setPreviousId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["platform", "billing-settings"],
    queryFn: () =>
      api<Pick<BillingView, "price" | "mode" | "providers">>("/admin/billing"),
    retry: false,
  });
  const data = query.data;
  return (
    <div className="max-w-3xl space-y-5">
      <ConsoleSection
        title="Oylik obuna narxi"
        subtitle="Barcha firmalar uchun yagona tarif · UZS"
      >
        <div className="space-y-4 p-5">
          {query.isPending ? (
            <Loading />
          ) : query.error ? (
            <ErrorMessage message={query.error.message} />
          ) : (
            <>
              <p className="text-3xl font-semibold tabular-nums">
                {data?.price
                  ? billingMoney(data.price.amountTiyin)
                  : "Belgilanmagan"}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  / oy
                </span>
              </p>
              <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                Narxni istalgan payt o‘zgartirishingiz mumkin. Yangi narx yangi
                buyurtmalarga qo‘llanadi. Oldin yaratilgan buyurtmalar o‘z
                summasida qoladi; to‘lov tarixi o‘zgarmaydi.
              </p>
              {!edit ? (
                <Button
                  size="sm"
                  onClick={() => {
                    setPreviousId(data?.price?.id ?? null);
                    setAmount(
                      data?.price ? String(data.price.amountTiyin / 100) : ""
                    );
                    setReason("");
                    setError("");
                    setEdit(true);
                  }}
                >
                  Narxni {data?.price ? "o‘zgartirish" : "belgilash"}
                </Button>
              ) : (
                <form
                  className="space-y-4 rounded-lg border p-4"
                  onSubmit={async e => {
                    e.preventDefault();
                    setBusy(true);
                    setError("");
                    try {
                      await api("/admin/billing/price", {
                        amountSom: Number(amount),
                        previousId,
                        reason,
                      });
                      setEdit(false);
                      toast.success("Yangi obuna narxi saqlandi.");
                      await cache.invalidateQueries({ queryKey: ["platform"] });
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="grid gap-2 text-xs">
                    Oylik narx (so‘m)
                    <Input
                      type="number"
                      min="1"
                      max="1000000000"
                      step="1"
                      required
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <label className="grid gap-2 text-xs">
                    O‘zgartirish sababi
                    <Input
                      required
                      minLength={5}
                      maxLength={300}
                      value={reason}
                      onChange={e => setReason(e.target.value)}
                      placeholder="Masalan, yangi tarif tasdiqlandi"
                    />
                  </label>
                  {error && <ErrorMessage message={error} />}
                  <div className="flex gap-2">
                    <Button size="sm" disabled={busy}>
                      Saqlash
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => setEdit(false)}
                    >
                      Bekor qilish
                    </Button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </ConsoleSection>
      <ConsoleSection
        title="To‘lov xizmatlari"
        subtitle="Maxfiy kalitlar faqat server muhitida sozlanadi"
      >
        <div className="divide-y px-5 text-xs">
          {["payme", "click"].map(provider => (
            <div
              className="flex items-center justify-between py-4"
              key={provider}
            >
              <span className="font-medium">
                {provider === "payme" ? "Payme" : "Click"}
              </span>
              <span className="text-muted-foreground">
                {data?.providers[provider as "payme" | "click"]
                ? "Rekvizitlar sozlangan"
                  : "Sozlanmagan"}
              </span>
            </div>
          ))}
          <p className="py-4 text-muted-foreground">
            Rejim:{" "}
            {data?.mode === "live"
              ? "Haqiqiy to‘lov"
              : data?.mode === "test"
                ? "Sinov"
                : "O‘chiq"}
            . Narx o‘zgarishi audit tarixiga yoziladi. Narxni belgilash to‘lov
            xizmatlarini avtomatik yoqmaydi.
          </p>
        </div>
      </ConsoleSection>
    </div>
  );
}
