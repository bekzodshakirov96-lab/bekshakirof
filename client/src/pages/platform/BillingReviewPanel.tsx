import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { billingMoney, type BillingReview } from "@shared/billing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConsoleSection } from "./console-ui";
import { api, ErrorMessage, Loading } from "./ui";

export function BillingReviewPanel() {
  const cache = useQueryClient();
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<BillingReview | null>(null);
  const [outcome, setOutcome] = useState<"paid" | "cancelled">("cancelled");
  const [reference, setReference] = useState("");
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["platform", "billing-review", page],
    queryFn: () => api<{ items: BillingReview[]; total: number }>(`/admin/billing/review?page=${page}`),
    retry: false,
  });
  return <ConsoleSection title="Tekshirilishi kerak bo‘lgan to‘lovlar"
    subtitle="Boshlangan, ammo muddati o‘tib ham yakuniy javob kelmagan buyurtmalar">
    <div className="space-y-4 p-5 text-sm">
      <p className="text-muted-foreground">Muddati o‘tishi pul to‘lanmaganini bildirmaydi. Avval Payme yoki Click kabinetida tranzaksiyaning yakuniy holatini tekshiring. Noaniq holatni bekor qilmang.</p>
      {query.isPending ? <Loading /> : query.error ? <ErrorMessage message={query.error.message} />
        : !query.data?.items.length ? <p>Tekshirishni kutayotgan buyurtma yo‘q.</p>
        : query.data.items.map(order => <div key={order.id} className="space-y-2 rounded-lg border p-3">
          <p className="font-medium">{order.companyName} · {billingMoney(order.amountTiyin)}</p>
          <p className="break-all text-xs text-muted-foreground">{order.provider} · {order.mode === "test" ? "Sinov" : "Haqiqiy"} · Tranzaksiya: {order.externalId}</p>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => {
            setSelected(order); setReference(""); setVerified(false); setOutcome("cancelled"); setError("");
          }}>Natijani qayd etish</Button>
        </div>)}
      {(query.data?.total ?? 0) > 20 && <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>Oldingi</Button>
        <span>{page} / {Math.ceil((query.data?.total ?? 0) / 20)}</span>
        <Button variant="outline" size="sm" disabled={page * 20 >= (query.data?.total ?? 0) || busy} onClick={() => setPage(page + 1)}>Keyingi</Button>
      </div>}
      {selected && <form className="space-y-4 rounded-lg border p-4" onSubmit={async e => {
        e.preventDefault(); setBusy(true); setError("");
        try {
          await api("/admin/billing/reconcile", {
            id: selected.id, transactionId: selected.transactionId, externalId: selected.externalId,
            mode: selected.mode, outcome, reference, providerVerified: verified,
          });
          setSelected(null);
          await cache.invalidateQueries({ queryKey: ["platform"] });
        } catch (err) { setError((err as Error).message); }
        finally { setBusy(false); }
      }}>
        <p className="font-medium">{selected.companyName} · {billingMoney(selected.amountTiyin)}</p>
        <label className="grid gap-2">Provayderdagi yakuniy holat
          <select className="rounded-md border bg-background p-2" value={outcome} disabled={busy}
            onChange={e => { setOutcome(e.target.value as typeof outcome); setVerified(false); }}>
            <option value="cancelled">Bekor qilingan — yangi to‘lovga ruxsat berish</option>
            <option value="paid">To‘langan — obunani faollashtirish</option>
          </select>
        </label>
        <label className="grid gap-2">Tasdiqlash manbasi
          <Input value={reference} disabled={busy} required minLength={5} maxLength={300}
            placeholder="Provayder hisoboti yoki murojaat raqami" onChange={e => setReference(e.target.value)} />
        </label>
        <label className="flex items-start gap-2">
          <input type="checkbox" required checked={verified} disabled={busy} onChange={e => setVerified(e.target.checked)} />
          Tranzaksiya raqami, summa va yakuniy holatni provayderda tekshirdim.
        </label>
        <p className="text-xs text-muted-foreground">Amal va tasdiqlash manbasi tarixda saqlanadi. Firma kassasiga yozuv kiritilmaydi.</p>
        {error && <ErrorMessage message={error} />}
        <div className="flex gap-2">
          <Button size="sm" disabled={busy || !verified || reference.trim().length < 5}>Natijani saqlash</Button>
          <Button size="sm" variant="outline" type="button" disabled={busy} onClick={() => setSelected(null)}>Yopish</Button>
        </div>
      </form>}
    </div>
  </ConsoleSection>;
}
