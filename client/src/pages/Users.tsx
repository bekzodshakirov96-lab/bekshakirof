import { useAuth } from "@/_core/hooks/useAuth";
import { EmptyState, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { Eye, EyeOff, ShieldCheck, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type RoleValue = "user" | "accountant" | "agent" | "sklad";

const roleLabels: Record<RoleValue, string> = {
  user: "Ruxsatsiz",
  accountant: "Buxgalter",
  agent: "Agent",
  sklad: "Sklad xodimi",
};

const emptyForm = { name: "", email: "", password: "", role: "user" as RoleValue, agentId: "" as number | "" };

export default function Users() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const users = trpc.users.list.useQuery(undefined, { enabled: user?.role === "admin" });
  const agentOptions = trpc.agents.options.useQuery(undefined, { enabled: user?.role === "admin" });
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [showPassword, setShowPassword] = useState(false);
  const [roleDraft, setRoleDraft] = useState<Record<number, RoleValue>>({});

  const setRole = trpc.users.setRole.useMutation({
    onSuccess: async () => { toast.success("Foydalanuvchi roli yangilandi"); await utils.users.list.invalidate(); },
    onError: error => toast.error(error.message),
  });
  const createUser = trpc.users.create.useMutation({
    onSuccess: async () => {
      toast.success("Foydalanuvchi yaratildi. Login va parolni unga yetkazing.");
      setCreateOpen(false);
      setForm(emptyForm);
      await utils.users.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  if (user?.role !== "admin") {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border bg-white p-10 text-center shadow-sm">
        <ShieldCheck className="mx-auto h-10 w-10 text-amber-500" />
        <h2 className="mt-4 text-xl font-bold">Faqat rahbar uchun</h2>
        <p className="mt-2 text-sm text-slate-500">Foydalanuvchi rollarini faqat tizim rahbari boshqarishi mumkin.</p>
      </div>
    );
  }

  if (users.error) {
    return (
      <div className="mx-auto w-full max-w-[1250px]">
        <PageHeader eyebrow="Xavfsizlik" title="Foydalanuvchilar va rollar" description="Tizimga kirish huquqlari." />
        <QueryError description={users.error.message} onRetry={() => users.refetch()} />
      </div>
    );
  }

  const rows = users.data ?? [];
  const canSubmit =
    form.name.trim() && form.email.trim() && form.password.trim().length >= 8 && (form.role !== "agent" || form.agentId !== "");

  return (
    <div className="mx-auto w-full max-w-[1250px]">
      <PageHeader
        eyebrow="Xavfsizlik"
        title="Foydalanuvchilar va rollar"
        description="Yangi xodim uchun login (email) va parol yarating, so‘ng unga kerakli ruxsatni bering."
        action={<Button onClick={() => setCreateOpen(true)} className="gap-2"><UserPlus className="size-4" />Yangi foydalanuvchi</Button>}
      />

      <SectionCard title="Kirish huquqlari" description="Rahbar roli o‘zgartirilmaydi; buxgalter biznes ma’lumotlari bilan ishlaydi">
        <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-slate-100">
          {users.isLoading ? (
            <TableLoading columns={5} />
          ) : rows.length === 0 ? (
            <EmptyState title="Hali foydalanuvchi yo‘q" description="Yuqoridagi «Yangi foydalanuvchi» tugmasi orqali birinchi hisobni yarating." />
          ) : (
            <Table className="finance-table">
              <TableHeader>
                <TableRow>
                  <TableHead>Foydalanuvchi</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Oxirgi kirish</TableHead>
                  <TableHead>Joriy rol</TableHead>
                  <TableHead className="w-56">Ruxsatni o‘zgartirish</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9"><AvatarFallback className="bg-cyan-50 text-xs font-bold text-cyan-700">{row.name?.charAt(0).toUpperCase() || "U"}</AvatarFallback></Avatar>
                        <div>
                          <p className="font-semibold text-slate-900">{row.name || "Nomsiz foydalanuvchi"}</p>
                          {row.isOwner ? <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Tizim egasi</p> : null}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>{row.email || "—"}</TableCell>
                    <TableCell className="text-slate-500">{formatDate(row.lastSignedIn)}</TableCell>
                    <TableCell>
                      <Badge className={row.role === "admin" ? "rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-50" : row.role === "accountant" ? "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : row.role === "agent" ? "rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-50" : row.role === "sklad" ? "rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-50" : "rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-100"}>
                        {row.role === "admin" ? "Rahbar" : roleLabels[row.role as RoleValue] ?? "Ruxsatsiz"}
                        {row.role === "agent" && row.agentId ? ` · ${agentOptions.data?.find(a => a.id === row.agentId)?.name ?? ""}` : ""}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {row.isOwner ? (
                        <span className="text-xs text-slate-400">Doimiy rahbar</span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <select
                            disabled={setRole.isPending}
                            className="finance-input w-full border px-3 text-xs"
                            value={roleDraft[row.id] ?? (row.role === "admin" ? "user" : (row.role as RoleValue))}
                            onChange={event => {
                              const nextRole = event.target.value as RoleValue;
                              if (nextRole === "agent") {
                                setRoleDraft(prev => ({ ...prev, [row.id]: "agent" }));
                                return;
                              }
                              setRoleDraft(prev => { const next = { ...prev }; delete next[row.id]; return next; });
                              setRole.mutate({ userId: row.id, role: nextRole });
                            }}
                          >
                            <option value="user">Ruxsatsiz</option>
                            <option value="accountant">Buxgalter</option>
                            <option value="agent">Agent</option>
                            <option value="sklad">Sklad xodimi</option>
                          </select>
                          {(roleDraft[row.id] === "agent" || (!roleDraft[row.id] && row.role === "agent")) && (
                            <select
                              disabled={setRole.isPending}
                              className="finance-input w-40 border px-3 text-xs"
                              value={row.role === "agent" ? row.agentId ?? "" : ""}
                              onChange={event => {
                                const agentId = Number(event.target.value);
                                if (!agentId) return;
                                setRole.mutate({ userId: row.id, role: "agent", agentId });
                                setRoleDraft(prev => { const next = { ...prev }; delete next[row.id]; return next; });
                              }}
                            >
                              <option value="">Agentni tanlang</option>
                              {(agentOptions.data ?? []).map(agent => (
                                <option key={agent.id} value={agent.id}>{agent.name}</option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SectionCard>

      <Dialog open={createOpen} onOpenChange={open => { setCreateOpen(open); if (!open) { setForm(emptyForm); setShowPassword(false); } }}>
        <DialogContent className="rounded-2xl sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Yangi foydalanuvchi yaratish</DialogTitle>
            <DialogDescription>Login (email) va parolni siz belgilaysiz — yaratgach, shu ma’lumotlarni xodimga yetkazing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2"><Label>Ism</Label><Input className="finance-input" value={form.name} onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))} /></div>
            <div className="space-y-2"><Label>Email (login)</Label><Input className="finance-input" type="email" value={form.email} onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))} /></div>
            <div className="space-y-2">
              <Label>Parol</Label>
              <div className="relative">
                <Input
                  className="finance-input pr-10"
                  type={showPassword ? "text" : "password"}
                  value={form.password}
                  onChange={event => setForm(prev => ({ ...prev, password: event.target.value }))}
                  placeholder="Kamida 8 belgi"
                />
                <button
                  type="button"
                  aria-label={showPassword ? "Parolni yashirish" : "Parolni ko‘rsatish"}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                  onClick={() => setShowPassword(current => !current)}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Ruxsat</Label>
              <select
                className="finance-input w-full border px-3 text-sm"
                value={form.role}
                onChange={event => setForm(prev => ({ ...prev, role: event.target.value as RoleValue, agentId: "" }))}
              >
                <option value="user">Ruxsatsiz (keyinroq belgilanadi)</option>
                <option value="accountant">Buxgalter</option>
                <option value="agent">Agent</option>
                <option value="sklad">Sklad xodimi</option>
              </select>
            </div>
            {form.role === "agent" && (
              <div className="space-y-2">
                <Label>Qaysi agent nomidan</Label>
                <select
                  className="finance-input w-full border px-3 text-sm"
                  value={form.agentId}
                  onChange={event => setForm(prev => ({ ...prev, agentId: event.target.value ? Number(event.target.value) : "" }))}
                >
                  <option value="">Agentni tanlang</option>
                  {(agentOptions.data ?? []).map(agent => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Bekor qilish</Button>
            <Button
              disabled={!canSubmit || createUser.isPending}
              onClick={() => createUser.mutate({ ...form, agentId: form.agentId === "" ? undefined : form.agentId })}
            >
              {createUser.isPending ? "Yaratilmoqda..." : "Yaratish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
