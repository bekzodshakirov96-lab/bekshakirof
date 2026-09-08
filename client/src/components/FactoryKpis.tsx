import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { PackageCheck, Send } from "lucide-react";
import { useState } from "react";

export function FactoryKpis() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const invalid = Boolean(fromDate && toDate && fromDate > toDate);
  const statement = trpc.factory.statement.useQuery({
    from: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
    to: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined,
  }, { enabled: !invalid });
  const rows = statement.data?.ledger ?? [];
  const ready = !invalid && !statement.isPending && !statement.isError;

  return (
    <section aria-label="Zavod harakatlari ko‘rsatkichlari" className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="mr-auto w-full xl:w-auto">
          <h3 className="font-semibold">Zavod harakatlari</h3>
          <p className="mt-1 text-xs text-muted-foreground">{fromDate || toDate ? "Tanlangan davr bo‘yicha" : "Barcha davr bo‘yicha"} · dona</p>
        </div>
        <label className="flex flex-col gap-1 text-xs">Boshlanish sanasi
          <Input type="date" className="mt-1 w-full sm:w-40" value={fromDate} max={toDate || undefined} onChange={e => setFromDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs">Tugash sanasi
          <Input type="date" className="mt-1 w-full sm:w-40" value={toDate} min={fromDate || undefined} onChange={e => setToDate(e.target.value)} />
        </label>
        <Button variant="outline" onClick={() => { setFromDate(""); setToDate(""); }}>Barcha davr</Button>
      </div>
      {invalid && <p role="alert" className="text-sm text-destructive">Boshlanish sanasi tugash sanasidan keyin bo‘lmasligi kerak.</p>}
      {statement.isError && !invalid && <div role="alert" className="flex items-center gap-3 text-destructive">Ko‘rsatkichlarni yuklab bo‘lmadi.<Button variant="outline" onClick={() => void statement.refetch()}>Qayta urinish</Button></div>}
      <div className="grid gap-3 sm:grid-cols-2" aria-live="polite" aria-busy={statement.isFetching}>
        {([
          { type: "filled_received", title: "Zavoddan kelgan to‘la KEG", Icon: PackageCheck, color: "text-emerald-600 dark:text-emerald-400" },
          { type: "tara_sent", title: "Zavodga yuborilgan bo‘sh tara", Icon: Send, color: "text-primary" },
        ] as const).map(({ type, title, Icon, color }) => {
          const matching = rows.filter(row => row.operationType === type);
          const byProduct = new Map<string, number>();
          for (const row of matching) {
            const name = row.productName ?? "Noma’lum KEG";
            byProduct.set(name, (byProduct.get(name) ?? 0) + row.quantity);
          }
          return <div key={type} className="rounded-2xl border border-border bg-card p-5">
            <div className="flex items-center justify-between gap-3"><h4 className="text-sm font-medium text-muted-foreground">{title}</h4><Icon className={`size-5 ${color}`} /></div>
            <p className={`my-3 text-3xl font-semibold tabular-nums ${color}`}>{ready ? formatNumber(matching.reduce((sum, row) => sum + row.quantity, 0), 0) : "—"}<span className="ml-2 text-sm font-normal text-muted-foreground">dona</span></p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{ready ? byProduct.size ? Array.from(byProduct, ([name, count]) => <span key={name}>{name}: <b className="text-foreground">{formatNumber(count, 0)}</b></span>) : "Bu davrda harakat yo‘q" : invalid ? "Sana oralig‘ini tekshiring" : statement.isError ? "Ma’lumot mavjud emas" : "Yuklanmoqda…"}</div>
            {type === "filled_received" && <p className="mt-2 text-xs text-muted-foreground">Brak o‘rniga kelgan KEGlar bu jamiga kirmaydi.</p>}
          </div>;
        })}
      </div>
    </section>
  );
}
