import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { AlertTriangle, CheckCircle2, FileCheck2, FileSpreadsheet, FileUp, History, RefreshCcw, Rows3 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const allowedExtensions = [".xlsx", ".xlsm", ".xls"];

function readFileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Faylni o‘qib bo‘lmadi."));
    reader.readAsDataURL(file);
  });
}

export default function ImportExcel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const utils = trpc.useUtils();
  const history = trpc.imports.history.useQuery();
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<File | null>(null);
  const [reading, setReading] = useState(false);
  const upload = trpc.imports.upload.useMutation({
    onSuccess: async result => {
      toast.success("Excel ma’lumotlari muvaffaqiyatli import qilindi");
      setSelected(null);
      await Promise.all([
        utils.imports.history.invalidate(),
        utils.dashboard.overview.invalidate(),
        utils.agents.list.invalidate(),
        utils.clients.list.invalidate(),
        utils.products.list.invalidate(),
        utils.transactions.list.invalidate(),
        utils.cash.list.invalidate(),
        utils.debts.list.invalidate(),
      ]);
      if (result.errorRows > 0) toast.warning(`${result.errorRows} ta qatorda xatolik aniqlandi.`);
    },
    onError: error => toast.error(error.message),
  });

  const validateAndSelect = (file?: File) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!allowedExtensions.some(extension => lower.endsWith(extension))) {
      toast.error("Faqat .xlsx, .xlsm yoki .xls fayl tanlang."); return;
    }
    if (file.size > 30 * 1024 * 1024) { toast.error("Fayl hajmi 30 MB dan oshmasligi kerak."); return; }
    setSelected(file);
  };

  const handleUpload = async () => {
    if (!selected) return;
    setReading(true);
    try {
      const base64 = await readFileAsBase64(selected);
      upload.mutate({ fileName: selected.name, base64 });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Faylni tayyorlashda xatolik yuz berdi.");
    } finally { setReading(false); }
  };

  const latest = history.data?.[0];
  const busy = reading || upload.isPending;

  if (history.error) return <div className="mx-auto w-full max-w-[1350px]"><PageHeader eyebrow="Ma’lumotlarni yangilash" title="Excel import" description="Excel importi va yuklash tarixi." /><QueryError description={history.error.message} onRetry={() => history.refetch()} /></div>;

  return <div className="mx-auto w-full max-w-[1350px]">
    <PageHeader eyebrow="Ma’lumotlarni yangilash" title="Excel import" description="Dastlabki yoki yangilangan Excel faylini istalgan vaqtda yuklang. Tizim mavjud qatorlarni yangilaydi va dublikat yaratmaydi." />
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Oxirgi qo‘shilgan" value={(latest?.addedRows ?? 0).toLocaleString("uz-UZ")} helper="Yangi qatorlar" icon={FileCheck2} tone="green" />
      <MetricCard label="Yangilangan" value={(latest?.updatedRows ?? 0).toLocaleString("uz-UZ")} helper="Mavjud qatorlar" icon={RefreshCcw} tone="blue" />
      <MetricCard label="O‘tkazib yuborilgan" value={(latest?.skippedRows ?? 0).toLocaleString("uz-UZ")} helper="O‘zgarishsiz qatorlar" icon={Rows3} tone="amber" />
      <MetricCard label="Xatoli qatorlar" value={(latest?.errorRows ?? 0).toLocaleString("uz-UZ")} helper="Tekshirish talab etiladi" icon={AlertTriangle} tone="rose" />
    </div>

    <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <SectionCard title="Excel faylini yuklash" description="Qarzdorlik_Hisoboti.xlsm shabloni va uning yangilangan nusxalari qo‘llab-quvvatlanadi">
        <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" className="hidden" onChange={event => validateAndSelect(event.target.files?.[0])} />
        <button type="button" onClick={() => inputRef.current?.click()} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); validateAndSelect(event.dataTransfer.files?.[0]); }} className={`group flex min-h-64 w-full flex-col items-center justify-center rounded-3xl border-2 border-dashed px-6 text-center transition ${dragging ? "border-primary bg-cyan-50" : "border-slate-200 bg-slate-50/70 hover:border-cyan-300 hover:bg-cyan-50/40"}`}>
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white text-primary shadow-sm ring-1 ring-slate-100 transition group-hover:-translate-y-1"><FileSpreadsheet className="h-7 w-7" /></div>
          <p className="mt-5 text-sm font-bold text-slate-900">Faylni shu yerga tashlang yoki tanlash uchun bosing</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">.XLSX, .XLSM yoki .XLS • maksimal hajm 30 MB</p>
        </button>
        {selected ? <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-cyan-100 bg-cyan-50/60 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-white text-emerald-600 shadow-sm"><FileCheck2 className="h-5 w-5" /></div><div><p className="text-sm font-bold text-slate-900">{selected.name}</p><p className="text-xs text-slate-500">{(selected.size / 1024 / 1024).toFixed(2)} MB</p></div></div><Button disabled={busy} onClick={handleUpload} className="rounded-xl bg-primary text-xs font-semibold"><FileUp className="mr-2 h-4 w-4" />{busy ? "Import qilinmoqda..." : "Importni boshlash"}</Button></div> : null}
        {busy ? <div className="mt-4"><div className="mb-2 flex items-center justify-between text-xs font-medium text-slate-500"><span>Fayl tekshirilmoqda va ma’lumotlar yangilanmoqda</span><span>Iltimos, kuting</span></div><Progress value={reading ? 25 : 70} className="h-2" /></div> : null}
      </SectionCard>

      <SectionCard title="Import qanday ishlaydi?" description="Takroriy yuklash xavfsizligi">
        <div className="space-y-4">
          {[
            ["1", "Fayl tekshiriladi", "Varaqlar va ustunlar shablonga mosligi aniqlanadi."],
            ["2", "Ma’lumotlar solishtiriladi", "Kod va biznes kalitlari bo‘yicha mavjud yozuvlar topiladi."],
            ["3", "Dublikat yaratilmaydi", "Yangi yozuv qo‘shiladi, mavjud yozuv esa yangilanadi."],
            ["4", "Natija saqlanadi", "Qo‘shilgan, yangilangan va xatoli qatorlar tarixga yoziladi."],
          ].map(([number, title, description]) => <div key={number} className="flex gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-slate-900 text-xs font-bold text-white">{number}</div><div><p className="text-sm font-bold text-slate-900">{title}</p><p className="mt-1 text-xs leading-5 text-slate-500">{description}</p></div></div>)}
        </div>
      </SectionCard>
    </div>

    <SectionCard title="Import tarixi" description="Oxirgi 50 ta yuklash va ularning natijalari" className="mt-5" action={<History className="h-4 w-4 text-slate-400" />}>
      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-slate-100">{history.isLoading ? <TableLoading columns={7} /> : (history.data ?? []).length === 0 ? <EmptyState title="Import tarixi bo‘sh" description="Birinchi Excel faylini yuklaganingizdan keyin natija shu yerda ko‘rinadi." /> : <Table className="finance-table min-w-[900px]"><TableHeader><TableRow><TableHead>Fayl</TableHead><TableHead>Sana va vaqt</TableHead><TableHead>Holat</TableHead><TableHead className="text-right">Qo‘shildi</TableHead><TableHead className="text-right">Yangilandi</TableHead><TableHead className="text-right">O‘tkazildi</TableHead><TableHead className="text-right">Xatolar</TableHead></TableRow></TableHeader><TableBody>{(history.data ?? []).map(row => <TableRow key={row.id}><TableCell><div className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-emerald-600" /><span className="max-w-72 truncate font-semibold text-slate-900" title={row.fileName}>{row.fileName}</span></div></TableCell><TableCell className="whitespace-nowrap text-slate-500">{formatDateTime(row.createdAt)}</TableCell><TableCell>{row.status === "completed" ? <Badge className="rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50"><CheckCircle2 className="mr-1 h-3 w-3" /> Yakunlandi</Badge> : row.status === "failed" ? <Badge className="rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-50">Xatolik</Badge> : <Badge className="rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-50">Jarayonda</Badge>}</TableCell><TableCell className="text-right font-semibold tabular-nums text-emerald-700">{row.addedRows}</TableCell><TableCell className="text-right font-semibold tabular-nums text-blue-700">{row.updatedRows}</TableCell><TableCell className="text-right tabular-nums text-slate-500">{row.skippedRows}</TableCell><TableCell className="text-right font-semibold tabular-nums text-rose-700">{row.errorRows}</TableCell></TableRow>)}</TableBody></Table>}</div>
    </SectionCard>
  </div>;
}
