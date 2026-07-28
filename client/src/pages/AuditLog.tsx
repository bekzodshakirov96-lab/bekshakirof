import { EmptyState, PageHeader, PaginationBar, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { Lock, RotateCcw, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const ACTION_LABELS = {
  create: { label: "Yaratildi", className: "bg-emerald-50 text-emerald-700 hover:bg-emerald-50" },
  update: { label: "Tahrirlandi", className: "bg-amber-50 text-amber-700 hover:bg-amber-50" },
  delete: { label: "O‘chirildi", className: "bg-rose-50 text-rose-700 hover:bg-rose-50" },
} as const;

/** JSON matnni odam o'qiy oladigan "maydon: qiymat" ro'yxatiga aylantiradi. */
function summarizeJson(raw: string | null): string {
  if (!raw) return "—";
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.entries(parsed)
      .filter(([key]) => !["createdAt", "updatedAt", "sourceKey", "id"].includes(key))
      .map(([key, value]) => `${key}: ${value ?? "—"}`)
      .join(", ");
  } catch {
    return raw;
  }
}

/** Tahrirlashda faqat haqiqatan o'zgargan maydonlarni ajratib ko'rsatadi. */
function diffFields(before: string | null, after: string | null): string {
  if (!before || !after) return "";
  try {
    const b = JSON.parse(before) as Record<string, unknown>;
    const a = JSON.parse(after) as Record<string, unknown>;
    const changed = Object.keys({ ...b, ...a })
      .filter(key => !["createdAt", "updatedAt", "sourceKey"].includes(key))
      .filter(key => String(b[key] ?? "") !== String(a[key] ?? ""))
      .map(key => `${key}: ${b[key] ?? "—"} → ${a[key] ?? "—"}`);
    return changed.join(", ");
  } catch {
    return "";
  }
}

function PeriodLockCard() {
  const utils = trpc.useUtils();
  const lock = trpc.audit.periodLock.get.useQuery();
  const [draft, setDraft] = useState("");
  const setLock = trpc.audit.periodLock.set.useMutation({
    onSuccess: async () => {
      toast.success("Davr qulfi yangilandi");
      await utils.audit.periodLock.get.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const currentLock = lock.data?.lockDate ?? null;

  return (
    <SectionCard
      title="Davr qulfi"
      description="Belgilangan sana va undan oldingi barcha moliyaviy yozuvlar (savdo, kassa, qarz to‘lovlari) o‘zgartirilmaydi va o‘chirilmaydi — yopilgan oy hisobotlari keyin jimgina qayta yozilmasligi uchun."
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label>Qulflangan sana (shu kun ham kiradi)</Label>
          <Input
            className="finance-input w-48"
            type="date"
            value={draft || currentLock || ""}
            onChange={event => setDraft(event.target.value)}
          />
        </div>
        <Button
          className="gap-2"
          disabled={setLock.isPending || !(draft || currentLock)}
          onClick={() => setLock.mutate({ lockDate: draft || currentLock })}
        >
          <Lock className="size-4" />
          {setLock.isPending ? "Saqlanmoqda..." : "Qulflash"}
        </Button>
        {currentLock && (
          <Button
            variant="outline"
            className="gap-2 bg-card"
            disabled={setLock.isPending}
            onClick={() => { setDraft(""); setLock.mutate({ lockDate: null }); }}
          >
            <RotateCcw className="size-4" />
            Qulfni olib tashlash
          </Button>
        )}
      </div>
      <p className="mt-3 text-sm">
        {currentLock
          ? <span className="font-semibold text-rose-700 dark:text-rose-400">Hozirgi qulf: {currentLock} va undan oldingi kunlar yopiq.</span>
          : <span className="text-muted-foreground">Hozircha hech qanday davr qulflanmagan — barcha sanalar tahrirlanishi mumkin.</span>}
      </p>
    </SectionCard>
  );
}

export default function AuditLog() {
  const [tableName, setTableName] = useState("");
  const [action, setAction] = useState("");
  const [userId, setUserId] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);

  const options = trpc.audit.filterOptions.useQuery();
  const log = trpc.audit.list.useQuery({
    tableName: tableName || undefined,
    action: (action || undefined) as "create" | "update" | "delete" | undefined,
    userId: userId ? Number(userId) : undefined,
    from: fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : undefined,
    to: toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : undefined,
    page,
    pageSize: 50,
  });

  const rows = log.data?.items ?? [];

  function clearFilters() {
    setTableName(""); setAction(""); setUserId(""); setFromDate(""); setToDate(""); setPage(1);
  }

  if (log.error) {
    return <div className="mx-auto w-full max-w-[1600px]">
      <PageHeader eyebrow="Nazorat" title="O‘zgarishlar tarixi" description="Moliyaviy yozuvlar ustidagi barcha amallar tarixi." />
      <QueryError description={log.error.message} onRetry={() => log.refetch()} />
    </div>;
  }

  return <div className="mx-auto w-full max-w-[1600px]">
    <PageHeader
      eyebrow="Nazorat"
      title="O‘zgarishlar tarixi"
      description="Savdo, kassa va qarz to‘lovlari ustidagi har bir yaratish, tahrirlash va o‘chirish amali — kim, qachon va nimani o‘zgartirgani bilan. Bu yozuvlar hech qachon o‘chirilmaydi."
    />

    <PeriodLockCard />

    <SectionCard title="Amallar tarixi" description="Filtr orqali aniq foydalanuvchi, sana yoki amal turini toping" className="mt-5">
      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[200px_180px_200px_160px_160px_auto]">
        <select className="finance-input border px-3 text-muted-foreground" value={tableName} onChange={event => { setTableName(event.target.value); setPage(1); }}>
          <option value="">Barcha bo‘limlar</option>
          {(options.data?.tables ?? []).map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
        <select className="finance-input border px-3 text-muted-foreground" value={action} onChange={event => { setAction(event.target.value); setPage(1); }}>
          <option value="">Barcha amallar</option>
          <option value="create">Yaratildi</option>
          <option value="update">Tahrirlandi</option>
          <option value="delete">O‘chirildi</option>
        </select>
        <select className="finance-input border px-3 text-muted-foreground" value={userId} onChange={event => { setUserId(event.target.value); setPage(1); }}>
          <option value="">Barcha xodimlar</option>
          {(options.data?.users ?? []).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <Input type="date" className="finance-input" value={fromDate} onChange={event => { setFromDate(event.target.value); setPage(1); }} aria-label="Boshlanish sanasi" />
        <Input type="date" className="finance-input" value={toDate} onChange={event => { setToDate(event.target.value); setPage(1); }} aria-label="Tugash sanasi" />
        <Button variant="outline" className="gap-2 bg-card" onClick={clearFilters}><RotateCcw className="size-4" />Tozalash</Button>
      </div>

      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">
        {log.isLoading ? <TableLoading columns={6} /> : rows.length === 0 ? (
          <EmptyState description="Bu filtrlar bo‘yicha hali hech qanday amal qayd etilmagan." />
        ) : (
          <>
            <Table className="finance-table min-w-[1100px]">
              <TableHeader><TableRow>
                <TableHead className="w-40">Vaqt</TableHead>
                <TableHead className="w-32">Bo‘lim</TableHead>
                <TableHead className="w-28">Amal</TableHead>
                <TableHead className="w-40">Kim</TableHead>
                <TableHead>Tafsilot</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(row => {
                  const meta = ACTION_LABELS[row.action];
                  const changed = row.action === "update" ? diffFields(row.beforeData, row.afterData) : "";
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</TableCell>
                      <TableCell className="text-xs font-semibold text-foreground">{row.tableLabel} <span className="font-normal text-muted-foreground">#{row.recordId}</span></TableCell>
                      <TableCell><Badge className={`rounded-lg text-[10px] ${meta.className}`}>{meta.label}</Badge></TableCell>
                      <TableCell className="text-xs">{row.userName ?? "—"}</TableCell>
                      <TableCell className="max-w-[560px] text-xs text-muted-foreground">
                        {row.action === "update" ? (
                          <span className="break-words">{changed || "O‘zgarish topilmadi"}</span>
                        ) : row.action === "delete" ? (
                          <span className="break-words">{summarizeJson(row.beforeData)}</span>
                        ) : (
                          <span className="break-words">{summarizeJson(row.afterData)}</span>
                        )}
                        {row.reason && <div className="mt-1 font-medium text-amber-700 dark:text-amber-400">Sabab: {row.reason}</div>}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PaginationBar page={log.data?.page ?? 1} pageCount={log.data?.pageCount ?? 1} total={log.data?.total ?? 0} onChange={setPage} />
          </>
        )}
      </div>
    </SectionCard>

    <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
      <ShieldCheck className="size-4 text-emerald-600" />
      Bu tarix faqat qo‘shiladi — hech kim (jumladan rahbar ham) undagi yozuvni o‘zgartira yoki o‘chira olmaydi.
    </p>
  </div>;
}
