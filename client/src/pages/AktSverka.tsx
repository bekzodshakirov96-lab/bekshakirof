import { ClientStatementDialog } from "@/components/ClientStatementDialog";
import { EmptyState, PageHeader, QueryError, SectionCard } from "@/components/finance-ui";
import { Input } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { FileText, Search } from "lucide-react";
import { useState } from "react";

export default function AktSverka() {
  const [search, setSearch] = useState("");
  const [agentId, setAgentId] = useState("");
  const [statementClient, setStatementClient] = useState<{ id: number; name: string } | null>(null);
  const agents = trpc.agents.options.useQuery();
  const clients = trpc.debts.list.useQuery({
    search: search.trim() || undefined,
    agentId: agentId ? Number(agentId) : undefined,
    page: 1,
    pageSize: 50,
  });

  const items = clients.data?.items ?? [];

  if (clients.error) {
    return (
      <div className="mx-auto w-full max-w-[1200px]">
        <PageHeader eyebrow="Moliyaviy nazorat" title="Akt sverka" description="Mijoz bilan o‘zaro hisob-kitobni ko‘rish va PDF hujjat sifatida yuklab olish." />
        <QueryError description={clients.error.message} onRetry={() => clients.refetch()} />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader eyebrow="Moliyaviy nazorat" title="Akt sverka" description="Mijozni tanlang, so‘ng davr oralig‘ini belgilab o‘zaro hisob-kitob hujjatini ko‘ring yoki PDF sifatida yuklab oling." />

      <SectionCard title="Mijozni tanlang" description="Kod, nom yoki agent bo‘yicha qidiring">
        <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Kod yoki mijoz nomi..." className="finance-input pl-9" />
          </div>
          <select value={agentId} onChange={event => setAgentId(event.target.value)} className="finance-input border px-3 text-slate-600">
            <option value="">Barcha agentlar</option>
            {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </div>

        {clients.isLoading ? (
          <p className="py-8 text-center text-xs text-slate-400">Yuklanmoqda...</p>
        ) : items.length === 0 ? (
          <EmptyState description="Qidiruvni o‘zgartirib ko‘ring." />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {items.map(client => (
              <button
                key={client.id}
                type="button"
                onClick={() => setStatementClient({ id: client.id, name: client.name })}
                className="flex w-full items-center gap-3 rounded-xl border border-transparent bg-slate-50/70 p-3 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
              >
                <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-primary shadow-sm"><FileText className="size-4" /></div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">{client.name}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{client.code} • {client.agentName || "agentsiz"}</p>
                </div>
                <p className={`shrink-0 text-xs font-bold tabular-nums ${client.currentDebt > 0 ? "text-rose-600" : "text-emerald-600"}`}>{formatMoney(client.currentDebt)}</p>
              </button>
            ))}
          </div>
        )}
      </SectionCard>

      <ClientStatementDialog
        clientId={statementClient?.id ?? null}
        clientName={statementClient?.name}
        open={Boolean(statementClient)}
        onOpenChange={openState => !openState && setStatementClient(null)}
      />
    </div>
  );
}
