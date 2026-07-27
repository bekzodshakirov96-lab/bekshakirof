import { useAuth } from "@/_core/hooks/useAuth";
import { EmptyState, MetricCard, PageHeader, QueryError, SectionCard, TableLoading } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney, sanitizeIntegerInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { PackageCheck, Pencil, Plus, Search } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type ContainerType = "" | "keg_30" | "keg_50";
type ProductDraft = {
  id?: number;
  code: string;
  name: string;
  unit: string;
  price: string;
  containerType: ContainerType;
  containerUnitsPerItem: string;
};
const emptyDraft: ProductDraft = { code: "", name: "", unit: "dona", price: "", containerType: "", containerUnitsPerItem: "1" };

function containerLabel(value: ContainerType | null) {
  if (value === "keg_30") return "KEG 30";
  if (value === "keg_50") return "KEG 50";
  return "Tara biriktirilmagan";
}

export default function Products() {
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<ProductDraft | null>(null);
  const products = trpc.products.list.useQuery({ search: search || undefined });
  const updatePrice = trpc.products.updatePrice.useMutation();
  const renameProduct = trpc.products.rename.useMutation();
  const updateContainer = trpc.products.updateContainerMeta.useMutation();
  const create = trpc.products.create.useMutation();
  const rows = products.data ?? [];
  const isSaving = updatePrice.isPending || renameProduct.isPending || updateContainer.isPending || create.isPending;
  const draftBlockingReasons: string[] = [];
  if (draft) {
    if (!draft.code.trim()) draftBlockingReasons.push("Mahsulot kodi kiritilmagan");
    if (!draft.name.trim()) draftBlockingReasons.push("Mahsulot nomi kiritilmagan");
    if (Number(draft.price) < 0) draftBlockingReasons.push("Narx manfiy bo‘lishi mumkin emas");
  }

  async function submit() {
    if (!draft) return;
    const price = Math.round(Number(draft.price || 0));
    try {
      let productId = draft.id;
      if (draft.id) {
        await Promise.all([
          updatePrice.mutateAsync({ id: draft.id, price }),
          renameProduct.mutateAsync({ id: draft.id, name: draft.name }),
        ]);
      }
      else {
        const result = await create.mutateAsync({ code: draft.code, name: draft.name, unit: draft.unit, price });
        productId = result.id;
      }
      if (user?.role === "admin" && productId) {
        await updateContainer.mutateAsync({
          id: productId,
          containerType: draft.containerType || null,
          containerUnitsPerItem: Math.max(1, Math.round(Number(draft.containerUnitsPerItem || 1))),
        });
      }
      toast.success(draft.id ? "Mahsulot sozlamalari yangilandi" : "Mahsulot qo‘shildi");
      setDraft(null);
      await utils.products.list.invalidate();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Mahsulotni saqlab bo‘lmadi.");
    }
  }

  if (products.error) return <div className="mx-auto w-full max-w-[1450px]"><PageHeader eyebrow="Assortiment" title="Mahsulotlar ro‘yxati" description="Mahsulot katalogi va narxlar." /><QueryError description={products.error.message} onRetry={() => products.refetch()} /></div>;
  return <div className="mx-auto w-full max-w-[1450px]">
    <PageHeader eyebrow="Assortiment" title="Mahsulotlar ro‘yxati" description="Mahsulot kodi, narxi va KEG tara hisobini boshqaring." action={<Button onClick={() => setDraft({ ...emptyDraft })} className="h-10 rounded-xl bg-slate-900 text-xs font-semibold hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"><Plus className="mr-2 size-4" />Yangi mahsulot</Button>} />
    <div className="mb-5 grid gap-4 sm:grid-cols-2"><MetricCard label="Faol mahsulotlar" value={rows.filter(row => row.isActive).length.toString()} helper="Assortimentdagi pozitsiyalar" icon={PackageCheck} tone="cyan" /><MetricCard label="KEG mahsulotlari" value={rows.filter(row => row.containerType).length.toString()} helper="Avtomatik tara hisobida" icon={PackageCheck} tone="green" /></div>
    <SectionCard title="Mahsulot katalogi" description="Kod yoki nom bo‘yicha qidiring"><div className="mb-4 max-w-md"><div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Mahsulotni qidiring..." className="finance-input pl-9" /></div></div><div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl border-t border-border">{products.isLoading ? <TableLoading columns={7} /> : rows.length === 0 ? <EmptyState /> : <Table className="finance-table min-w-[900px]"><TableHeader><TableRow><TableHead>Kod</TableHead><TableHead>Mahsulot nomi</TableHead><TableHead>O‘lchov</TableHead><TableHead>Tara hisobi</TableHead><TableHead className="text-right">Narx</TableHead><TableHead>Holat</TableHead><TableHead className="w-28 text-right">Amal</TableHead></TableRow></TableHeader><TableBody>{rows.map(row => <TableRow key={row.id}><TableCell className="font-mono text-xs font-semibold text-primary">{row.code}</TableCell><TableCell className="font-semibold text-foreground">{row.name}</TableCell><TableCell>{row.unit}</TableCell><TableCell>{row.containerType ? <Badge className="rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-50">{containerLabel(row.containerType)} × {row.containerUnitsPerItem}</Badge> : <span className="text-xs text-muted-foreground">Biriktirilmagan</span>}</TableCell><TableCell className="text-right text-sm font-bold tabular-nums">{formatMoney(row.price)}</TableCell><TableCell><Badge className={row.isActive ? "rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-50" : "rounded-lg bg-muted text-muted-foreground hover:bg-muted"}>{row.isActive ? "Faol" : "Nofaol"}</Badge></TableCell><TableCell className="text-right"><Button size="sm" variant="outline" className="h-8 rounded-lg" onClick={() => setDraft({ id: row.id, code: row.code, name: row.name, unit: row.unit, price: String(row.price), containerType: (row.containerType ?? "") as ContainerType, containerUnitsPerItem: String(row.containerUnitsPerItem ?? 1) })}><Pencil className="mr-1.5 size-3.5" />Sozlash</Button></TableCell></TableRow>)}</TableBody></Table>}</div></SectionCard>
    <Dialog open={Boolean(draft)} onOpenChange={open => !open && setDraft(null)}><DialogContent className="rounded-2xl sm:max-w-md"><DialogHeader><DialogTitle>{draft?.id ? "Mahsulotni sozlash" : "Yangi mahsulot"}</DialogTitle><DialogDescription>{draft?.id ? "Nomi, narxi va tara hisobini yangilang. Nom o‘zgarsa, barcha bo‘limlarda (savdo, kassa hisobotlari) yangilanadi." : "Mahsulotning katalog ma’lumotlarini kiriting."}</DialogDescription></DialogHeader>{draft ? <div className="space-y-4 py-2">{!draft.id ? <div className="space-y-2"><Label>Mahsulot kodi</Label><Input className={`finance-input ${!draft.code.trim() ? "border-rose-300 focus-visible:ring-rose-200" : ""}`} value={draft.code} onChange={event => setDraft({ ...draft, code: event.target.value })} /></div> : null}<div className="space-y-2"><Label>Mahsulot nomi</Label><Input className={`finance-input ${!draft.name.trim() ? "border-rose-300 focus-visible:ring-rose-200" : ""}`} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>{!draft.id ? <div className="space-y-2"><Label>O‘lchov birligi</Label><Input className="finance-input" value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value })} /></div> : null}<div className="space-y-2"><Label>Narx, so‘m</Label><Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={draft.price} onChange={event => setDraft({ ...draft, price: sanitizeIntegerInput(event.target.value) })} /></div>{user?.role === "admin" && <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4"><p className="mb-3 text-sm font-semibold text-foreground">Avtomatik tara hisobi</p><div className="space-y-3"><div className="space-y-2"><Label>Tara turi</Label><select className="finance-input w-full border px-3" value={draft.containerType} onChange={event => setDraft({ ...draft, containerType: event.target.value as ContainerType })}><option value="">Tara biriktirilmagan</option><option value="keg_30">Rozlivnoy KEG 30</option><option value="keg_50">Rozlivnoy KEG 50</option></select></div>{draft.containerType && <div className="space-y-2"><Label>1 mahsulot birligiga tara soni</Label><Input className="finance-input" type="text" inputMode="numeric" value={draft.containerUnitsPerItem} onChange={event => setDraft({ ...draft, containerUnitsPerItem: sanitizeIntegerInput(event.target.value) })} /><p className="text-xs text-muted-foreground">Masalan, 1 dona mahsulot sotilganda mijozga nechta KEG berilgan hisoblanadi.</p></div>}</div></div>}{draftBlockingReasons.length > 0 && !isSaving && <ul className="text-xs font-medium text-rose-600">{draftBlockingReasons.map(item => <li key={item}>{item}</li>)}</ul>}</div> : null}<DialogFooter><Button variant="outline" onClick={() => setDraft(null)}>Bekor qilish</Button><Button disabled={!draft || !draft.code.trim() || !draft.name.trim() || Number(draft.price) < 0 || isSaving} onClick={submit}>{isSaving ? "Saqlanmoqda..." : "Saqlash"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
