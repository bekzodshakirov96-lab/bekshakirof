import { MetricCard, PageHeader, QueryError } from "@/components/finance-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, localDateInputValue, sanitizeDecimalInput, sanitizeIntegerInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  Banknote,
  CheckCircle2,
  Landmark,
  Plus,
  Scale,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const today = localDateInputValue;
const dateToTimestamp = (value: string) => new Date(`${value}T12:00:00`).getTime();

const INCOME_CATEGORIES = ["Приход кег", "Приход пет"];
const EXPENSE_CATEGORIES = ["Ойлик", "Обед", "Газ", "Расход"];

function QuickEntryForm({
  type,
  date,
  onSaved,
}: {
  type: "income" | "expense";
  date: string;
  onSaved: () => void;
}) {
  const utils = trpc.useUtils();
  const agents = trpc.agents.options.useQuery();
  const options = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const [category, setCategory] = useState(options[0]);
  const [agentId, setAgentId] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [terminalAmount, setTerminalAmount] = useState("");
  const [clickAmount, setClickAmount] = useState("");
  const [description, setDescription] = useState("");
  const [showSplit, setShowSplit] = useState(false);

  const create = trpc.cash.create.useMutation({
    onSuccess: async () => {
      toast.success(type === "income" ? "Приход qo'shildi" : "Расход qo'shildi");
      setCashAmount(""); setTerminalAmount(""); setClickAmount(""); setDescription(""); setShowSplit(false);
      await Promise.all([
        utils.cash.byDate.invalidate({ date: dateToTimestamp(date) }),
        utils.cash.categories.invalidate({ type }),
        utils.cash.summary.invalidate(),
        utils.kassa.daySummary.invalidate({ date: dateToTimestamp(date) }),
        utils.dashboard.overview.invalidate(),
      ]);
      onSaved();
    },
    onError: error => toast.error(error.message),
  });

  const total = Number(cashAmount || 0) + Number(terminalAmount || 0) + Number(clickAmount || 0);
  const canSave = category.trim().length > 0 && total > 0 && !create.isPending;

  function submit() {
    if (!canSave) return;
    create.mutate({
      entryDate: dateToTimestamp(date),
      type,
      category: category.trim(),
      agentId: agentId ? Number(agentId) : undefined,
      description: description || undefined,
      cashAmount: Math.round(Number(cashAmount || 0)),
      terminalAmount: Math.round(Number(terminalAmount || 0)),
      clickAmount: Math.round(Number(clickAmount || 0)),
    });
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap gap-2">
        <select
          className="finance-input h-9 min-w-[140px] border px-2"
          value={category}
          onChange={event => setCategory(event.target.value)}
        >
          {options.map(name => <option key={name} value={name}>{name}</option>)}
        </select>
        <select
          className="finance-input h-9 min-w-[130px] border px-2"
          value={agentId}
          onChange={event => setAgentId(event.target.value)}
        >
          <option value="">Agentsiz</option>
          {(agents.data ?? []).map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
        </select>
        <Input
          className="finance-input w-36"
          type="text"
          inputMode="numeric"
          placeholder="Summa (naqd)"
          value={cashAmount}
          onChange={event => setCashAmount(sanitizeIntegerInput(event.target.value))}
          onKeyDown={event => event.key === "Enter" && submit()}
        />
        {!showSplit ? (
          <Button variant="outline" type="button" className="h-9 bg-white text-xs" onClick={() => setShowSplit(true)}>
            + Терминаль/CLIK
          </Button>
        ) : (
          <>
            <Input className="finance-input w-32" type="text" inputMode="numeric" placeholder="Терминаль" value={terminalAmount} onChange={event => setTerminalAmount(sanitizeIntegerInput(event.target.value))} />
            <Input className="finance-input w-32" type="text" inputMode="numeric" placeholder="CLIK" value={clickAmount} onChange={event => setClickAmount(sanitizeIntegerInput(event.target.value))} />
          </>
        )}
        <Input
          className="finance-input min-w-[140px] flex-1"
          placeholder="Клиент / izoh (ixtiyoriy)"
          value={description}
          onChange={event => setDescription(event.target.value)}
          onKeyDown={event => event.key === "Enter" && submit()}
        />
        <Button type="button" disabled={!canSave} onClick={submit} className="h-9 gap-1.5 text-xs font-semibold">
          <Plus className="size-3.5" />
          {create.isPending ? "Saqlanmoqda..." : "Qo'shish"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Excel "Kunlik jurnal" A1:H16 diapazoniga mos: har bir yozuv — alohida qator
 * (Клиент yoki Нимага расход ustunida izoh, mos toifa ustunida summasi),
 * 16-qator — Jami.
 */
function DailyJournalGrid({
  entries,
  onDeleted,
}: {
  entries: Array<{ id: number; type: "income" | "expense"; category: string; description: string | null; cashAmount: number; terminalAmount: number; clickAmount: number }>;
  onDeleted: () => void;
}) {
  const utils = trpc.useUtils();
  const del = trpc.cash.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.cash.byDate.invalidate(), utils.cash.summary.invalidate(), utils.kassa.daySummary.invalidate(), utils.dashboard.overview.invalidate()]);
      onDeleted();
    },
    onError: error => toast.error(error.message),
  });

  const columns = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.id - b.id), [entries]);
  const totals = useMemo(
    () => columns.map(name => entries.filter(entry => entry.category === name).reduce((sum, entry) => sum + entry.cashAmount + entry.terminalAmount + entry.clickAmount, 0)),
    [entries],
  );

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
            <th className="whitespace-nowrap px-3 py-2 text-left">Клиент</th>
            {columns.map(name => <th key={name} className="whitespace-nowrap px-3 py-2 text-right">{name}</th>)}
            <th className="whitespace-nowrap px-3 py-2 text-left">Нимага расход</th>
            <th className="w-11" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedEntries.length === 0 ? (
            <tr><td colSpan={columns.length + 3} className="px-3 py-4 text-center text-xs text-slate-400">Bugun hali yozuv qo'shilmagan.</td></tr>
          ) : sortedEntries.map(entry => {
            const amount = entry.cashAmount + entry.terminalAmount + entry.clickAmount;
            return (
              <tr key={entry.id} className="text-xs">
                <td className="max-w-40 truncate whitespace-nowrap px-3 py-2 text-slate-700">{entry.type === "income" ? entry.description || "—" : ""}</td>
                {columns.map(name => (
                  <td key={name} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-900">
                    {entry.category === name ? formatMoney(amount) : ""}
                  </td>
                ))}
                <td className="max-w-40 truncate whitespace-nowrap px-3 py-2 text-slate-700">{entry.type === "expense" ? entry.description || "—" : ""}</td>
                <td className="px-1 py-1 text-right">
                  <button
                    type="button"
                    aria-label="O'chirish"
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    onClick={() => del.mutate({ id: entry.id })}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50/80 text-xs font-bold text-slate-900">
            <td className="whitespace-nowrap px-3 py-2">Jami</td>
            {totals.map((value, index) => <td key={columns[index]} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(value)}</td>)}
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Excel'dagi Агент x Товар matritsasi: har ustun - agent, har qator - mahsulot, pastda Умумий/Касса/Разница. */
function AgentProductMatrix({ date }: { date: string }) {
  const utils = trpc.useUtils();
  const timestamp = dateToTimestamp(date);
  const agents = trpc.agents.options.useQuery();
  const products = trpc.products.list.useQuery({});
  const takingRows = trpc.kassa.agentTaking.listForDay.useQuery({ date: timestamp });
  const daySummary = trpc.kassa.daySummary.useQuery({ date: timestamp });

  const invalidateMatrix = () =>
    Promise.all([
      utils.kassa.agentTaking.listForDay.invalidate({ date: timestamp }),
      utils.kassa.daySummary.invalidate({ date: timestamp }),
      utils.dashboard.overview.invalidate(),
    ]);

  const addProduct = trpc.kassa.agentTaking.addProduct.useMutation({
    onSuccess: invalidateMatrix,
    onError: error => toast.error(error.message),
  });
  const updateQuantity = trpc.kassa.agentTaking.updateQuantity.useMutation({
    onSuccess: invalidateMatrix,
    onError: error => toast.error(error.message),
  });
  const removeProduct = trpc.kassa.agentTaking.remove.useMutation({
    onSuccess: invalidateMatrix,
    onError: error => toast.error(error.message),
  });
  const submitCash = trpc.kassa.agentCashSubmission.upsert.useMutation({
    onSuccess: async () => {
      toast.success("Касса saqlandi");
      await Promise.all([utils.kassa.daySummary.invalidate({ date: timestamp }), utils.dashboard.overview.invalidate()]);
    },
    onError: error => toast.error(error.message),
  });

  const agentList = agents.data ?? [];
  const productList = products.data ?? [];
  const entryMap = useMemo(() => {
    const map = new Map<string, { id: number; quantity: string; amount: number }>();
    for (const row of takingRows.data ?? []) map.set(`${row.agentId}:${row.productId}`, row);
    return map;
  }, [takingRows.data]);

  function onCellBlur(agentId: number, productId: number, rawValue: string) {
    const key = `${agentId}:${productId}`;
    const existing = entryMap.get(key);
    const quantity = Number(rawValue);
    if (!rawValue || Number.isNaN(quantity) || quantity <= 0) {
      if (existing) removeProduct.mutate({ id: existing.id });
      return;
    }
    if (existing) {
      if (quantity !== Number(existing.quantity)) updateQuantity.mutate({ id: existing.id, quantity });
    } else {
      addProduct.mutate({ date: timestamp, agentId, productId, quantity });
    }
  }

  function onCellKeyDown(event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    if (!["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    let targetRow = rowIndex;
    let targetColumn = columnIndex;
    if (event.key === "ArrowUp") targetRow -= 1;
    else if (event.key === "ArrowDown" || event.key === "Enter") targetRow += 1;
    else if (event.key === "ArrowLeft") targetColumn -= 1;
    else if (event.key === "ArrowRight") targetColumn += 1;
    if (targetRow < 0 || targetRow >= productList.length || targetColumn < 0 || targetColumn >= agentList.length) return;
    event.preventDefault();
    const target = document.querySelector<HTMLInputElement>(`[data-cash-matrix-cell="${targetRow}-${targetColumn}"]`);
    target?.focus();
    target?.select();
  }

  if (agents.isLoading || products.isLoading) return <p className="p-4 text-xs text-slate-400">Yuklanmoqda...</p>;
  if (agentList.length === 0) return <p className="p-4 text-xs text-slate-400">Faol agentlar topilmadi.</p>;
  if (productList.length === 0) return <p className="p-4 text-xs text-slate-400">Mahsulotlar topilmadi.</p>;

  const summaryByAgent = new Map((daySummary.data?.agentSummaries ?? []).map(row => [row.agentId, row]));

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
            <th className="sticky left-0 whitespace-nowrap bg-slate-50 px-3 py-2 text-left">Товар</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Narxi</th>
            {agentList.map(agent => <th key={agent.id} className="whitespace-nowrap px-3 py-2 text-right">{agent.name}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {productList.map((product, rowIndex) => (
            <tr key={product.id}>
              <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-1.5 font-medium text-slate-800">{product.name}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-400">{formatMoney(product.price)}</td>
              {agentList.map((agent, columnIndex) => {
                const existing = entryMap.get(`${agent.id}:${product.id}`);
                return (
                  <td key={agent.id} className="px-2 py-1">
                    <Input
                      className="finance-input h-10 w-20 text-right"
                      type="text" inputMode="decimal"
                      defaultValue={existing ? String(Number(existing.quantity)) : ""}
                      key={`${agent.id}:${product.id}:${existing?.quantity ?? ""}`}
                      data-cash-matrix-cell={`${rowIndex}-${columnIndex}`}
                      onChange={event => { event.target.value = sanitizeDecimalInput(event.target.value); }}
                      onBlur={event => onCellBlur(agent.id, product.id, event.target.value)}
                      onKeyDown={event => onCellKeyDown(event, rowIndex, columnIndex)}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-700">
            <td className="sticky left-0 whitespace-nowrap bg-slate-50/80 px-3 py-2" colSpan={2}>Умумий</td>
            {agentList.map(agent => (
              <td key={agent.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {formatMoney(summaryByAgent.get(agent.id)?.computedAmount ?? 0)}
              </td>
            ))}
          </tr>
          <tr className="bg-slate-50/80 text-xs font-bold text-slate-700">
            <td className="sticky left-0 whitespace-nowrap bg-slate-50/80 px-3 py-2" colSpan={2}>Касса</td>
            {agentList.map(agent => {
              const row = summaryByAgent.get(agent.id);
              return (
                <td key={agent.id} className="px-2 py-1.5">
                  <Input
                    className="finance-input h-10 w-24 text-right"
                    type="text" inputMode="numeric"
                    defaultValue={row?.submittedAmount ?? ""}
                    key={`kassa:${agent.id}:${row?.submittedAmount ?? ""}`}
                    placeholder="0"
                    onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                    onBlur={event => {
                      const value = event.target.value;
                      const amount = Number(value);
                      if (value === "" || Number.isNaN(amount) || amount === (row?.submittedAmount ?? 0)) return;
                      submitCash.mutate({ date: timestamp, agentId: agent.id, submittedAmount: Math.round(amount) });
                    }}
                  />
                </td>
              );
            })}
          </tr>
          <tr className="text-xs font-bold">
            <td className="sticky left-0 whitespace-nowrap bg-white px-3 py-2" colSpan={2}>Разница</td>
            {agentList.map(agent => {
              const row = summaryByAgent.get(agent.id);
              const farq = row?.farq ?? 0;
              return (
                <td key={agent.id} className={`whitespace-nowrap px-3 py-2 text-right tabular-nums ${farq === 0 ? "text-emerald-600" : "text-rose-600"}`}>
                  {farq === 0 ? "Mos" : formatMoney(farq)}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

export default function Cash() {
  const [date, setDate] = useState(today());
  const timestamp = dateToTimestamp(date);
  const daySummary = trpc.kassa.daySummary.useQuery({ date: timestamp });
  const prihodEntries = trpc.cash.byDate.useQuery({ date: timestamp });
  const cashSummary = trpc.cash.summary.useQuery();
  const utils = trpc.useUtils();

  const [actualCash, setActualCash] = useState("");
  const [actualNote, setActualNote] = useState("");
  const upsertActual = trpc.kassa.actualCash.upsert.useMutation({
    onSuccess: async () => {
      toast.success("Haqiqiy kassa saqlandi");
      setActualCash(""); setActualNote("");
      await utils.kassa.daySummary.invalidate({ date: timestamp });
    },
    onError: error => toast.error(error.message),
  });

  const allEntries = prihodEntries.data ?? [];

  if (daySummary.error) {
    return <div className="mx-auto w-full max-w-[1500px]"><PageHeader eyebrow="Pul oqimi" title="КАССА" description="Kunlik jurnal va agentlar bo'yicha tezkor nazorat." /><QueryError description={daySummary.error.message} onRetry={() => daySummary.refetch()} /></div>;
  }

  const data = daySummary.data;
  const kassaQoldigi = data?.kassaQoldigi ?? 0;
  const actualDiff = data?.actualDiff ?? null;

  return (
    <div className="mx-auto w-full max-w-[1500px]">
      <PageHeader
        eyebrow="Pul oqimi"
        title="КАССА"
        description="Kunlik jurnal va agentlar bo'yicha tezkor nazorat."
        action={<Input className="finance-input h-10 w-44" type="date" value={date} onChange={event => setDate(event.target.value)} />}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Naqd pul" value={formatMoney(cashSummary.data?.cashBalance, true)} helper="Umumiy qoldiq" icon={Banknote} tone="amber" />
        <MetricCard label="Jami Приход" value={formatMoney(data?.jamiPrihod, true)} helper="Tanlangan kun" icon={Banknote} tone="green" />
        <MetricCard label="Jami Расход" value={formatMoney(data?.jamiRasxod, true)} helper="Tanlangan kun" icon={Banknote} tone="rose" />
        <MetricCard label="Қолдиқ" value={formatMoney(kassaQoldigi, true)} helper="Приход - Расход" icon={Landmark} tone="cyan" />
        <MetricCard
          label="Muammoli agentlar"
          value={String(data?.problemAgentCount ?? 0)}
          helper={`Jami farq: ${formatMoney(data?.agentFarqTotal ?? 0, true)}`}
          icon={Users}
          tone={data && data.problemAgentCount > 0 ? "rose" : "green"}
        />
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-5">
        <h3 className="mb-3 text-sm font-bold text-slate-900">Kunlik jurnal</h3>
        <DailyJournalGrid entries={allEntries} onDeleted={() => prihodEntries.refetch()} />

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center gap-2"><Banknote className="size-4 text-emerald-600" /><h4 className="text-xs font-bold text-slate-700">Приход</h4></div>
            <QuickEntryForm type="income" date={date} onSaved={() => prihodEntries.refetch()} />
          </div>
          <div>
            <div className="mb-2 flex items-center gap-2"><Banknote className="size-4 text-rose-600" /><h4 className="text-xs font-bold text-slate-700">Расход</h4></div>
            <QuickEntryForm type="expense" date={date} onSaved={() => prihodEntries.refetch()} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4">
          <div className="space-y-1.5"><Label>Haqiqiy kassa (sanoq)</Label><Input className="finance-input w-44" type="text" inputMode="numeric" placeholder={data?.actualCash != null ? String(data.actualCash) : "Kiriting"} value={actualCash} onChange={event => setActualCash(sanitizeIntegerInput(event.target.value))} /></div>
          <div className="min-w-[160px] flex-1 space-y-1.5"><Label>Izoh</Label><Input className="finance-input" value={actualNote} onChange={event => setActualNote(event.target.value)} placeholder={data?.actualCashNote || "Ixtiyoriy"} /></div>
          <Button type="button" disabled={!actualCash || upsertActual.isPending} onClick={() => upsertActual.mutate({ date: timestamp, actualCash: Math.round(Number(actualCash)), note: actualNote || undefined })}>
            {upsertActual.isPending ? "Saqlanmoqda..." : "Saqlash"}
          </Button>
          {actualDiff !== null && (
            <div className={`flex items-center gap-2 rounded-xl border p-3 text-sm font-semibold ${actualDiff === 0 ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
              {actualDiff === 0 ? <CheckCircle2 className="size-4" /> : <Scale className="size-4" />}
              {actualDiff === 0 ? "Kassa mos" : `Farq: ${formatMoney(Math.abs(actualDiff))} ${actualDiff > 0 ? "ortiqcha" : "kam"}`}
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-5">
        <div className="mb-1 flex items-center gap-2"><Users className="size-4 text-primary" /><h3 className="text-sm font-bold text-slate-900">Агент x Товар</h3></div>
        <p className="mb-3 text-xs text-slate-400">Tab yoki ←/→ — qo‘shni katak, Enter/↑/↓ — shu ustunda keyingi/oldingi mahsulot.</p>
        <AgentProductMatrix date={date} />
      </div>
    </div>
  );
}
