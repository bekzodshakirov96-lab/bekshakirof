import { useAuth } from "@/_core/hooks/useAuth";
import { ClientStatementDialog } from "@/components/ClientStatementDialog";
import { DebtBadge, EmptyState, PageHeader, PaginationBar, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, sanitizeIntegerInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { FileText, Pencil, Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function Clients() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState(""); const [agentId, setAgentId] = useState(""); const [clientType, setClientType] = useState(""); const [debtOnly, setDebtOnly] = useState(false); const [page, setPage] = useState(1); const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", agentId: "", phone: "", address: "", clientType: "", openingDebt: "" });
  const [statementClient, setStatementClient] = useState<{ id: number; name: string } | null>(null);
  const [editClient, setEditClient] = useState<{
    id: number; code: string; name: string; agentId: string; phone: string; address: string; clientType: string; openingDebt: string; isActive: boolean;
  } | null>(null);
  const isAgentRole = user?.role === "agent";
  const canCreateClient = user?.role === "admin" || user?.role === "accountant" || isAgentRole;
  const canEditClient = user?.role === "admin";
  const agents = trpc.agents.options.useQuery();
  const clients = trpc.clients.list.useQuery({ search: search || undefined, agentId: agentId ? Number(agentId) : undefined, type: clientType ? (clientType as "keg" | "savdo") : undefined, debtOnly, page, pageSize: 25 });
  const create = trpc.clients.create.useMutation({ onSuccess: async () => { toast.success("Mijoz qo‘shildi"); setOpen(false); setForm({ code: "", name: "", agentId: "", phone: "", address: "", clientType: "", openingDebt: "" }); await utils.clients.list.invalidate(); }, onError: error => toast.error(error.message) });
  const update = trpc.clients.update.useMutation({ onSuccess: async () => { toast.success("Mijoz yangilandi"); setEditClient(null); await utils.clients.list.invalidate(); }, onError: error => toast.error(error.message) });
  const rows = clients.data?.items ?? [];
  if (clients.error) return <div className="mx-auto w-full max-w-[1600px]"><PageHeader eyebrow="Hamkorlar bazasi" title="Mijozlar katalogi" description="Mijozlar ro‘yxati va qarz holati." /><QueryError description={clients.error.message} onRetry={() => clients.refetch()} /></div>;
  return <div className="mx-auto w-full max-w-[1600px]">
    <PageHeader eyebrow="Hamkorlar bazasi" title="Mijozlar katalogi" description="Mijoz kodi, agent, aloqa ma’lumotlari va joriy qarz holatini boshqaring." action={canCreateClient ? <Button onClick={() => { setForm(prev => ({ ...prev, agentId: isAgentRole && user?.agentId ? String(user.agentId) : prev.agentId })); setOpen(true); }} className="h-10 rounded-xl bg-slate-900 text-xs font-semibold hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"><Plus className="mr-2 h-4 w-4" /> Yangi mijoz</Button> : undefined} />
    <SectionCard title="Mijozlar ro‘yxati" description="Qidiruv, agent va qarzdorlik bo‘yicha filter">
      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_170px_170px]">
        <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="finance-input pl-9" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Kod, nom yoki telefon..." /></div>
        <select className="finance-input border px-3 text-muted-foreground" value={agentId} onChange={event => { setAgentId(event.target.value); setPage(1); }}><option value="">Barcha agentlar</option>{(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select>
        <select className="finance-input border px-3 text-muted-foreground" value={clientType} onChange={event => { setClientType(event.target.value); setPage(1); }}><option value="">Barcha turlar</option><option value="keg">KEG mijozlar</option><option value="savdo">Savdo mijozlari</option></select>
        <label className="flex h-10 items-center gap-2 rounded-xl border border-border bg-card px-3 text-xs font-semibold text-muted-foreground"><input type="checkbox" checked={debtOnly} onChange={event => { setDebtOnly(event.target.checked); setPage(1); }} className="h-4 w-4 accent-primary" /> Faqat qarzdorlar</label>
      </div>
      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">{clients.isLoading ? <TableLoading columns={10} /> : rows.length === 0 ? <EmptyState /> : <><Table className="finance-table min-w-[1100px]"><TableHeader><TableRow><TableHead>Kod</TableHead><TableHead>Mijoz</TableHead><TableHead>Turi</TableHead><TableHead>Agent</TableHead><TableHead>Telefon</TableHead><TableHead>Manzil</TableHead><TableHead className="text-right">Jami savdo</TableHead><TableHead className="text-right">Joriy qarz</TableHead><TableHead>Holat</TableHead><TableHead className="w-10" /></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}><TableCell className="font-mono text-xs font-semibold text-primary">{row.code}</TableCell><TableCell><div><p className="font-semibold text-foreground">{row.name}</p>{!row.isActive ? <Badge variant="secondary" className="mt-1 text-[10px]">Nofaol</Badge> : null}</div></TableCell><TableCell>{row.clientType === "keg" ? <Badge className="rounded-lg bg-cyan-50 text-cyan-700 hover:bg-cyan-50">KEG</Badge> : row.clientType === "savdo" ? <Badge className="rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-50">Savdo</Badge> : <span className="text-muted-foreground">—</span>}</TableCell><TableCell>{row.agentName || "—"}</TableCell><TableCell>{row.phone || "—"}</TableCell><TableCell className="max-w-56 truncate" title={row.address || ""}>{row.address || "—"}</TableCell><TableCell className="text-right font-semibold tabular-nums">{formatMoney(row.totalSales)}</TableCell><TableCell className={`text-right font-bold tabular-nums ${row.currentDebt > 0 ? "text-rose-700" : "text-emerald-700"}`}>{formatMoney(row.currentDebt)}</TableCell><TableCell><DebtBadge value={row.currentDebt} /></TableCell><TableCell><div className="flex items-center gap-1">{canEditClient && <button type="button" aria-label="Tahrirlash" title="Tahrirlash" className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary" onClick={() => setEditClient({ id: row.id, code: row.code, name: row.name, agentId: row.agentId ? String(row.agentId) : "", phone: row.phone ?? "", address: row.address ?? "", clientType: row.clientType ?? "", openingDebt: String(row.openingDebt), isActive: row.isActive })}><Pencil className="size-4" /></button>}<button type="button" aria-label="Akt sverka" title="Akt sverka" className="rounded-lg p-1.5 text-muted-foreground hover:bg-primary/10 hover:text-primary" onClick={() => setStatementClient({ id: row.id, name: row.name })}><FileText className="size-4" /></button></div></TableCell></TableRow>)}</TableBody></Table><PaginationBar page={clients.data?.page ?? 1} pageCount={clients.data?.pageCount ?? 1} total={clients.data?.total ?? 0} onChange={setPage} /></>}</div>
    </SectionCard>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="rounded-2xl sm:max-w-xl"><DialogHeader><DialogTitle>Yangi mijoz qo‘shish</DialogTitle><DialogDescription>Mijoz va unga biriktirilgan agent ma’lumotlarini kiriting.</DialogDescription></DialogHeader><div className="grid gap-4 py-2 sm:grid-cols-2"><div className="space-y-2"><Label>Mijoz kodi</Label><Input className="finance-input" value={form.code} onChange={event => setForm({ ...form, code: event.target.value })} /></div><div className="space-y-2"><Label>Mijoz nomi</Label><Input className="finance-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div><div className="space-y-2"><Label>Agent</Label><select className="finance-input w-full border px-3 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground" value={form.agentId} disabled={isAgentRole} onChange={event => setForm({ ...form, agentId: event.target.value })}><option value="">Tanlang</option>{(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></div><div className="space-y-2"><Label>Mijoz turi</Label><select className="finance-input w-full border px-3" value={form.clientType} onChange={event => setForm({ ...form, clientType: event.target.value })}><option value="">Tanlang</option><option value="keg">KEG mijozi</option><option value="savdo">Savdo mijozi</option></select></div><div className="space-y-2"><Label>Telefon</Label><Input className="finance-input" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></div><div className="space-y-2 sm:col-span-2"><Label>Manzil</Label><Input className="finance-input" value={form.address} onChange={event => setForm({ ...form, address: event.target.value })} /></div><div className="space-y-2"><Label>Boshlang‘ich qarz</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={form.openingDebt} onChange={event => setForm({ ...form, openingDebt: sanitizeIntegerInput(event.target.value) })} /></div></div><DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Bekor qilish</Button><Button disabled={!form.code.trim() || form.name.trim().length < 2 || !form.clientType || create.isPending} onClick={() => create.mutate({ code: form.code, name: form.name, agentId: form.agentId ? Number(form.agentId) : undefined, phone: form.phone || undefined, address: form.address || undefined, clientType: form.clientType as "keg" | "savdo", openingDebt: Math.round(Number(form.openingDebt || 0)) })}>{create.isPending ? "Saqlanmoqda..." : "Mijozni saqlash"}</Button></DialogFooter></DialogContent></Dialog>
    <ClientStatementDialog clientId={statementClient?.id ?? null} clientName={statementClient?.name} open={Boolean(statementClient)} onOpenChange={openState => !openState && setStatementClient(null)} />
    <Dialog open={Boolean(editClient)} onOpenChange={openState => !openState && setEditClient(null)}>
      <DialogContent className="rounded-2xl sm:max-w-xl">
        <DialogHeader><DialogTitle>Mijozni tahrirlash</DialogTitle><DialogDescription>Mijoz va unga biriktirilgan agent ma’lumotlarini yangilang.</DialogDescription></DialogHeader>
        {editClient && (
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2"><Label>Mijoz kodi</Label><Input className="finance-input" value={editClient.code} onChange={event => setEditClient({ ...editClient, code: event.target.value })} /></div>
            <div className="space-y-2"><Label>Mijoz nomi</Label><Input className="finance-input" value={editClient.name} onChange={event => setEditClient({ ...editClient, name: event.target.value })} /></div>
            <div className="space-y-2">
              <Label>Agent</Label>
              <select className="finance-input w-full border px-3" value={editClient.agentId} onChange={event => setEditClient({ ...editClient, agentId: event.target.value })}>
                <option value="">Biriktirilmagan</option>
                {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Mijoz turi</Label>
              <select className="finance-input w-full border px-3" value={editClient.clientType} onChange={event => setEditClient({ ...editClient, clientType: event.target.value })}>
                <option value="">Tasniflanmagan</option>
                <option value="keg">KEG mijozi</option>
                <option value="savdo">Savdo mijozi</option>
              </select>
            </div>
            <div className="space-y-2"><Label>Telefon</Label><Input className="finance-input" value={editClient.phone} onChange={event => setEditClient({ ...editClient, phone: event.target.value })} /></div>
            <div className="space-y-2 sm:col-span-2"><Label>Manzil</Label><Input className="finance-input" value={editClient.address} onChange={event => setEditClient({ ...editClient, address: event.target.value })} /></div>
            <div className="space-y-2"><Label>Boshlang‘ich qarz</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={editClient.openingDebt} onChange={event => setEditClient({ ...editClient, openingDebt: sanitizeIntegerInput(event.target.value) })} /></div>
            <label className="flex h-10 items-center gap-2 self-end rounded-xl border border-border bg-card px-3 text-xs font-semibold text-muted-foreground">
              <input type="checkbox" checked={editClient.isActive} onChange={event => setEditClient({ ...editClient, isActive: event.target.checked })} className="h-4 w-4 accent-primary" /> Faol mijoz
            </label>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setEditClient(null)}>Bekor qilish</Button>
          <Button
            disabled={!editClient || !editClient.code.trim() || editClient.name.trim().length < 2 || update.isPending}
            onClick={() => editClient && update.mutate({
              id: editClient.id,
              code: editClient.code,
              name: editClient.name,
              agentId: editClient.agentId ? Number(editClient.agentId) : null,
              phone: editClient.phone || null,
              address: editClient.address || null,
              clientType: editClient.clientType ? (editClient.clientType as "keg" | "savdo") : null,
              openingDebt: Math.round(Number(editClient.openingDebt || 0)),
              isActive: editClient.isActive,
            })}
          >
            {update.isPending ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}
