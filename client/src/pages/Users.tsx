import { useAuth } from "@/_core/hooks/useAuth";
import { EmptyState, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";

export default function Users() {
  const { user } = useAuth(); const utils = trpc.useUtils();
  const users = trpc.users.list.useQuery(undefined, { enabled: user?.role === "admin" });
  const setRole = trpc.users.setRole.useMutation({ onSuccess: async () => { toast.success("Foydalanuvchi roli yangilandi"); await utils.users.list.invalidate(); }, onError: error => toast.error(error.message) });
  if (user?.role !== "admin") return <div className="mx-auto max-w-xl rounded-3xl border bg-white p-10 text-center shadow-sm"><ShieldCheck className="mx-auto h-10 w-10 text-amber-500" /><h2 className="mt-4 text-xl font-bold">Faqat rahbar uchun</h2><p className="mt-2 text-sm text-slate-500">Foydalanuvchi rollarini faqat tizim rahbari boshqarishi mumkin.</p></div>;
  if (users.error) return <div className="mx-auto w-full max-w-[1250px]"><PageHeader eyebrow="Xavfsizlik" title="Foydalanuvchilar va rollar" description="Tizimga kirish huquqlari." /><QueryError description={users.error.message} onRetry={() => users.refetch()} /></div>;
  const rows = users.data ?? [];
  return <div className="mx-auto w-full max-w-[1250px]"><PageHeader eyebrow="Xavfsizlik" title="Foydalanuvchilar va rollar" description="Tizimga kirgan hisoblarni ko‘ring va ishonchli foydalanuvchilarga buxgalter huquqini bering." /><SectionCard title="Kirish huquqlari" description="Rahbar roli o‘zgartirilmaydi; buxgalter biznes ma’lumotlari bilan ishlaydi"><div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-slate-100">{users.isLoading ? <TableLoading columns={5} /> : rows.length === 0 ? <EmptyState title="Hali foydalanuvchi yo‘q" description="Buxgalter birinchi marta tizimga kirgach, shu ro‘yxatda paydo bo‘ladi." /> : <Table className="finance-table"><TableHeader><TableRow><TableHead>Foydalanuvchi</TableHead><TableHead>Email</TableHead><TableHead>Oxirgi kirish</TableHead><TableHead>Joriy rol</TableHead><TableHead className="w-56">Ruxsatni o‘zgartirish</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}><TableCell><div className="flex items-center gap-3"><Avatar className="h-9 w-9"><AvatarFallback className="bg-cyan-50 text-xs font-bold text-cyan-700">{row.name?.charAt(0).toUpperCase() || "U"}</AvatarFallback></Avatar><div><p className="font-semibold text-slate-900">{row.name || "Nomsiz foydalanuvchi"}</p>{row.isOwner ? <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">Tizim egasi</p> : null}</div></div></TableCell><TableCell>{row.email || "—"}</TableCell><TableCell className="text-slate-500">{formatDate(row.lastSignedIn)}</TableCell><TableCell><Badge className={row.role === "admin" ? "rounded-lg bg-violet-50 text-violet-700 hover:bg-violet-50" : row.role === "accountant" ? "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-100"}>{row.role === "admin" ? "Rahbar" : row.role === "accountant" ? "Buxgalter" : "Ruxsatsiz"}</Badge></TableCell><TableCell>{row.isOwner ? <span className="text-xs text-slate-400">Doimiy rahbar</span> : <select disabled={setRole.isPending} className="finance-input w-full border px-3 text-xs" value={row.role === "accountant" ? "accountant" : "user"} onChange={event => setRole.mutate({ userId: row.id, role: event.target.value as "user" | "accountant" })}><option value="user">Ruxsatsiz</option><option value="accountant">Buxgalter</option></select>}</TableCell></TableRow>)}</TableBody></Table>}</div></SectionCard>
    <div className="mt-5 flex items-start gap-3 rounded-2xl border border-slate-100 bg-white p-5">
      <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/5 text-primary"><UserPlus className="size-5" /></div>
      <div>
        <p className="text-sm font-bold text-slate-900">Yangi foydalanuvchi qanday qo‘shiladi?</p>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Bu yerdan hisob yaratib bo‘lmaydi — yangi xodim tizimdan chiqib, kirish oynasidagi <strong className="font-semibold text-slate-700">"Ro‘yxatdan o‘tish"</strong> bo‘limi orqali o‘zi ro‘yxatdan o‘tishi kerak. Ro‘yxatdan o‘tgach, u shu yerdagi ro‘yxatda paydo bo‘ladi va unga kerakli ruxsatni (Buxgalter) shu jadvaldan berishingiz mumkin.</p>
      </div>
    </div>
  </div>;
}
