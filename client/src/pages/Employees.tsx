import { useAuth } from "@/_core/hooks/useAuth";
import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { BriefcaseBusiness, HandCoins, Pencil, Plus, Search, Trash2, UserCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type EmployeeStatus = "all" | "active" | "inactive";

/** Ko'p uchraydigan lavozimlar — tanlashni tezlashtirish uchun taklif sifatida
 * ko'rsatiladi, lekin maydon erkin matn (yangi lavozim ham yozish mumkin). */
const POSITION_SUGGESTIONS = ["Gruzchik", "Dostavchik", "Supervayzer", "Omborchi", "Buxgalter", "Haydovchi"];

const emptyForm = { name: "", position: "", phone: "", note: "" };

export default function Employees() {
  const { user } = useAuth();
  const canManage = user?.role === "admin";
  const utils = trpc.useUtils();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<EmployeeStatus>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<
    { id: number; name: string; position: string; phone: string; note: string; isActive: boolean } | null
  >(null);
  const [deleting, setDeleting] = useState<{ id: number; name: string } | null>(null);
  const [historyFor, setHistoryFor] = useState<{ id: number; name: string } | null>(null);

  const employees = trpc.employees.list.useQuery({ search: search || undefined, status });
  const payments = trpc.employees.payments.useQuery(
    { employeeId: historyFor?.id ?? 0 },
    { enabled: historyFor != null },
  );

  async function refresh() {
    await Promise.all([utils.employees.list.invalidate(), utils.employees.options.invalidate()]);
  }

  const create = trpc.employees.create.useMutation({
    onSuccess: async () => { toast.success("Xodim qo‘shildi"); setCreateOpen(false); setForm(emptyForm); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const update = trpc.employees.update.useMutation({
    onSuccess: async () => { toast.success("Saqlandi"); setEditing(null); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.employees.delete.useMutation({
    onSuccess: async () => { toast.success("Xodim o‘chirildi"); setDeleting(null); await refresh(); },
    onError: error => toast.error(error.message),
  });

  const rows = employees.data?.items ?? [];

  return (
    <div className="mx-auto w-full max-w-[1200px]">
      <PageHeader
        eyebrow="Xodimlar bazasi"
        title="Xodimlar"
        description="Oylik oladigan xodimlar va ularga kassadan to‘langan oyliklar hisobi."
        action={
          canManage ? (
            <Button onClick={() => { setForm(emptyForm); setCreateOpen(true); }}>
              <Plus className="mr-2 size-4" /> Yangi xodim
            </Button>
          ) : undefined
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <MetricCard label="Faol xodimlar" value={String(employees.data?.activeCount ?? 0)} helper="Hozir ishlayotganlar" icon={UserCheck} tone="cyan" />
        <MetricCard label="Jami to‘langan oylik" value={formatMoney(employees.data?.totalPaid ?? 0, true)} helper="Butun davr bo‘yicha" icon={HandCoins} tone="green" />
        <MetricCard label="Ro‘yxatdagi xodimlar" value={String(rows.length)} helper="Filtrga mos keluvchilar" icon={BriefcaseBusiness} tone="blue" />
      </div>

      <SectionCard title="Xodimlar ro‘yxati" description="Qidiruv va holat bo‘yicha filter">
        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="finance-input pl-9" placeholder="Ism, lavozim yoki telefon..." value={search} onChange={event => setSearch(event.target.value)} />
          </div>
          <select className="finance-input w-full border px-3" value={status} onChange={event => setStatus(event.target.value as EmployeeStatus)}>
            <option value="all">Barcha holatlar</option>
            <option value="active">Faol</option>
            <option value="inactive">Nofaol</option>
          </select>
        </div>

        {employees.isLoading ? (
          <TableLoading />
        ) : employees.isError ? (
          <QueryError description={employees.error.message} onRetry={() => employees.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState title="Ma’lumot topilmadi" description="Filterni o‘zgartiring yoki yangi xodim qo‘shing." />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Xodim</TableHead>
                  <TableHead>Lavozim</TableHead>
                  <TableHead>Telefon</TableHead>
                  <TableHead className="text-right">Olingan oylik</TableHead>
                  <TableHead className="text-right">To‘lovlar</TableHead>
                  <TableHead>Oxirgi to‘lov</TableHead>
                  <TableHead>Holat</TableHead>
                  {canManage && <TableHead className="text-right">Amal</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => (
                  <TableRow key={row.id}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell>{row.position || "—"}</TableCell>
                    <TableCell>{row.phone || "—"}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatMoney(row.paidAmount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.paymentCount > 0 ? (
                        <Button variant="ghost" size="sm" className="h-8" onClick={() => setHistoryFor({ id: row.id, name: row.name })}>
                          {row.paymentCount} ta
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>{row.lastPaidAt ? formatDate(row.lastPaidAt) : "—"}</TableCell>
                    <TableCell>
                      <Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? "Faol" : "Nofaol"}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() =>
                            setEditing({
                              id: row.id,
                              name: row.name,
                              position: row.position ?? "",
                              phone: row.phone ?? "",
                              note: row.note ?? "",
                              isActive: row.isActive,
                            })
                          }
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleting({ id: row.id, name: row.name })}>
                          <Trash2 className="size-4 text-rose-600" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </SectionCard>

      {/* Yangi xodim */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Yangi xodim</DialogTitle>
            <DialogDescription>Oylik oladigan xodimni ro‘yxatga qo‘shing.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>Ism-familiya</Label><Input className="finance-input" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
            <div className="space-y-2">
              <Label>Lavozim</Label>
              <Input className="finance-input" list="employee-positions" placeholder="Masalan: Gruzchik" value={form.position} onChange={event => setForm({ ...form, position: event.target.value })} />
              <datalist id="employee-positions">{POSITION_SUGGESTIONS.map(item => <option key={item} value={item} />)}</datalist>
            </div>
            <div className="space-y-2"><Label>Telefon</Label><Input className="finance-input" value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></div>
            <div className="space-y-2"><Label>Izoh</Label><Textarea className="finance-input" value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Bekor qilish</Button>
            <Button
              disabled={form.name.trim().length < 2 || create.isPending}
              onClick={() => create.mutate({ name: form.name, position: form.position || undefined, phone: form.phone || undefined, note: form.note || undefined })}
            >
              {create.isPending ? "Saqlanmoqda..." : "Qo‘shish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Tahrirlash */}
      <Dialog open={editing != null} onOpenChange={open => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xodimni tahrirlash</DialogTitle>
            <DialogDescription>Ma’lumotlarni yangilang yoki xodimni nofaol qiling.</DialogDescription>
          </DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-2"><Label>Ism-familiya</Label><Input className="finance-input" value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></div>
              <div className="space-y-2">
                <Label>Lavozim</Label>
                <Input className="finance-input" list="employee-positions" value={editing.position} onChange={event => setEditing({ ...editing, position: event.target.value })} />
              </div>
              <div className="space-y-2"><Label>Telefon</Label><Input className="finance-input" value={editing.phone} onChange={event => setEditing({ ...editing, phone: event.target.value })} /></div>
              <div className="space-y-2"><Label>Izoh</Label><Textarea className="finance-input" value={editing.note} onChange={event => setEditing({ ...editing, note: event.target.value })} /></div>
              <div className="space-y-2">
                <Label>Holat</Label>
                <select className="finance-input w-full border px-3" value={editing.isActive ? "active" : "inactive"} onChange={event => setEditing({ ...editing, isActive: event.target.value === "active" })}>
                  <option value="active">Faol</option>
                  <option value="inactive">Nofaol</option>
                </select>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Bekor qilish</Button>
            <Button
              disabled={!editing || editing.name.trim().length < 2 || update.isPending}
              onClick={() => editing && update.mutate({ id: editing.id, name: editing.name, position: editing.position || null, phone: editing.phone || null, note: editing.note || null, isActive: editing.isActive })}
            >
              {update.isPending ? "Saqlanmoqda..." : "Saqlash"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* O'chirish tasdiqlash */}
      <Dialog open={deleting != null} onOpenChange={open => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Xodimni o‘chirish</DialogTitle>
            <DialogDescription>
              <span className="font-semibold text-foreground">{deleting?.name}</span> ro‘yxatdan o‘chiriladi. Oylik to‘lovi
              yozilgan xodimni o‘chirib bo‘lmaydi — uni nofaol qilib qo‘ying.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>Bekor qilish</Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => deleting && remove.mutate({ id: deleting.id })}>
              {remove.isPending ? "O‘chirilmoqda..." : "O‘chirish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* To'lovlar tarixi */}
      <Dialog open={historyFor != null} onOpenChange={open => !open && setHistoryFor(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{historyFor?.name} — oylik to‘lovlari</DialogTitle>
            <DialogDescription>Kassadan berilgan oyliklar tarixi.</DialogDescription>
          </DialogHeader>
          {payments.isLoading ? (
            <TableLoading />
          ) : (payments.data ?? []).length === 0 ? (
            <EmptyState title="To‘lov yo‘q" description="Bu xodimga hali oylik yozilmagan." />
          ) : (
            <div className="max-h-[50vh] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Sana</TableHead>
                    <TableHead>Izoh</TableHead>
                    <TableHead className="text-right">Summa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(payments.data ?? []).map(row => (
                    <TableRow key={row.id}>
                      <TableCell>{formatDate(row.entryDate)}</TableCell>
                      <TableCell>{row.description || "—"}</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(row.cashAmount + row.terminalAmount + row.clickAmount + row.transferAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
