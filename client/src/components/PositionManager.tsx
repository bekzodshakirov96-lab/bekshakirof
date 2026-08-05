import { EmptyState, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { trpc } from "@/lib/trpc";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/**
 * Lavozimlar ma'lumotnomasini boshqarish oynasi — Xodimlar va Agentlar
 * sahifalarida bir xil ishlatiladi.
 *
 * Bu foydalanuvchi roli emas: lavozim faqat nom bo'lib, hech qanday ruxsat
 * bermaydi. Ruxsatlar `users.role` orqali boshqariladi.
 */
export function PositionManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const utils = trpc.useUtils();
  const list = trpc.positions.list.useQuery(undefined, { enabled: open });
  const [newName, setNewName] = useState("");
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  async function refresh() {
    await Promise.all([
      utils.positions.list.invalidate(),
      utils.positions.options.invalidate(),
      utils.employees.list.invalidate(),
      utils.agents.list.invalidate(),
    ]);
  }

  const create = trpc.positions.create.useMutation({
    onSuccess: async () => { toast.success("Lavozim qo‘shildi"); setNewName(""); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const update = trpc.positions.update.useMutation({
    onSuccess: async () => { toast.success("Saqlandi"); setEditing(null); await refresh(); },
    onError: error => toast.error(error.message),
  });
  const remove = trpc.positions.delete.useMutation({
    onSuccess: async () => { toast.success("Lavozim o‘chirildi"); await refresh(); },
    onError: error => toast.error(error.message),
  });

  const rows = list.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Lavozimlar</DialogTitle>
          <DialogDescription>
            Xodim va agentlarga biriktiriladigan lavozimlar. Bu foydalanuvchi roli emas — lavozim hech qanday ruxsat bermaydi.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label htmlFor="new-position">Yangi lavozim</Label>
            <Input
              id="new-position"
              className="finance-input"
              placeholder="Masalan: Supervayzer"
              value={newName}
              onChange={event => setNewName(event.target.value)}
              onKeyDown={event => {
                if (event.key === "Enter" && newName.trim().length >= 2) create.mutate({ name: newName.trim() });
              }}
            />
          </div>
          <Button disabled={newName.trim().length < 2 || create.isPending} onClick={() => create.mutate({ name: newName.trim() })}>
            <Plus className="mr-2 size-4" /> Qo‘shish
          </Button>
        </div>

        <div className="mt-2 max-h-[45vh] overflow-y-auto">
          {list.isLoading ? (
            <TableLoading columns={4} />
          ) : rows.length === 0 ? (
            <EmptyState title="Lavozim yo‘q" description="Yuqoridagi maydon orqali birinchi lavozimni qo‘shing." />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Lavozim</TableHead>
                  <TableHead className="text-right">Ishlatilmoqda</TableHead>
                  <TableHead>Holat</TableHead>
                  <TableHead className="text-right">Amal</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const usedBy = row.employeeCount + row.agentCount;
                  const isEditing = editing?.id === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-medium">
                        {isEditing ? (
                          <Input
                            className="finance-input h-9"
                            value={editing.name}
                            onChange={event => setEditing({ ...editing, name: event.target.value })}
                            onKeyDown={event => {
                              if (event.key === "Enter" && editing.name.trim().length >= 2) {
                                update.mutate({ id: row.id, name: editing.name.trim(), isActive: row.isActive });
                              }
                              if (event.key === "Escape") setEditing(null);
                            }}
                          />
                        ) : (
                          row.name
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {usedBy > 0 ? `${row.employeeCount} xodim · ${row.agentCount} agent` : "—"}
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => update.mutate({ id: row.id, name: row.name, isActive: !row.isActive })}
                          title={row.isActive ? "Nofaol qilish" : "Faol qilish"}
                        >
                          <Badge variant={row.isActive ? "default" : "secondary"}>{row.isActive ? "Faol" : "Nofaol"}</Badge>
                        </button>
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={editing.name.trim().length < 2 || update.isPending}
                              onClick={() => update.mutate({ id: row.id, name: editing.name.trim(), isActive: row.isActive })}
                            >
                              <Check className="size-4 text-emerald-600" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setEditing(null)}>
                              <X className="size-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button variant="ghost" size="icon" onClick={() => setEditing({ id: row.id, name: row.name })}>
                              <Pencil className="size-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={remove.isPending}
                              title={usedBy > 0 ? "Ishlatilayotgan lavozimni o‘chirib bo‘lmaydi" : "O‘chirish"}
                              onClick={() => remove.mutate({ id: row.id })}
                            >
                              <Trash2 className={`size-4 ${usedBy > 0 ? "text-muted-foreground" : "text-rose-600"}`} />
                            </Button>
                          </>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Lavozim tanlash ro'yxati — bo'sh qiymat "lavozim belgilanmagan" degani. */
export function PositionSelect({
  value,
  onChange,
  disabled,
}: {
  value: number | null;
  onChange: (positionId: number | null) => void;
  disabled?: boolean;
}) {
  const options = trpc.positions.options.useQuery();
  return (
    <select
      className="finance-input w-full border px-3"
      value={value != null ? String(value) : ""}
      disabled={disabled}
      onChange={event => onChange(event.target.value ? Number(event.target.value) : null)}
    >
      <option value="">Lavozim tanlanmagan</option>
      {(options.data ?? []).map(option => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}
