import { MetricCard, PageHeader, QueryError } from "@/components/finance-ui";
import { Input } from "@/components/ui/input";
import { formatMoney, localDateInputValue, sanitizeDecimalInput, sanitizeIntegerInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  Banknote,
  Landmark,
  Plus,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

const today = localDateInputValue;
const dateToTimestamp = (value: string) => new Date(`${value}T12:00:00`).getTime();

const INCOME_CATEGORIES = ["Приход кег", "Приход пет"];
const EXPENSE_CATEGORIES = ["Ойлик", "Обед", "Газ", "Расход"];

const CATEGORY_TYPE: Record<string, "income" | "expense"> = Object.fromEntries([
  ...INCOME_CATEGORIES.map(name => [name, "income" as const]),
  ...EXPENSE_CATEGORIES.map(name => [name, "expense" as const]),
]);
const JOURNAL_COLUMNS = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
const DRAFT_ROWS = 4;

type CashEntryRow = {
  id: number;
  type: "income" | "expense";
  category: string;
  agentId: number | null;
  description: string | null;
  cashAmount: number;
  terminalAmount: number;
  clickAmount: number;
};

type DraftRow = { agentId: string; reason: string; amounts: Record<string, string> };
const emptyDraftRow = (): DraftRow => ({ agentId: "", reason: "", amounts: Object.fromEntries(JOURNAL_COLUMNS.map(name => [name, ""])) });

const cellInputClass =
  "w-full min-w-[64px] rounded-md bg-transparent px-1.5 py-1 text-right tabular-nums outline-none transition-colors focus:bg-primary/5 focus:ring-1 focus:ring-primary/30";
const textInputClass =
  "w-full min-w-[110px] rounded-md bg-transparent px-1.5 py-1 outline-none transition-colors focus:bg-primary/5 focus:ring-1 focus:ring-primary/30";
const selectInputClass =
  "w-full min-w-[120px] rounded-md border-0 bg-transparent px-1.5 py-1 text-xs outline-none transition-colors focus:bg-primary/5 focus:ring-1 focus:ring-primary/30";

/**
 * Excel "Kunlik jurnal" A1:H16 diapazoniga aynan mos, to'g'ridan-to'g'ri
 * kataklarga yozib kiritiladigan setka: prixod/rasxod yozuvlari alohida
 * forma orqali emas, shu jadval kataklari orqali qo'shiladi/tahrirlanadi.
 */
function DailyJournalGrid({
  entries,
  date,
  onChanged,
}: {
  entries: CashEntryRow[];
  date: string;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const timestamp = dateToTimestamp(date);
  const agents = trpc.agents.options.useQuery();
  const agentList = agents.data ?? [];
  const [drafts, setDrafts] = useState<DraftRow[]>(() => Array.from({ length: DRAFT_ROWS }, emptyDraftRow));

  const invalidate = () =>
    Promise.all([
      utils.cash.byDate.invalidate({ date: timestamp }),
      utils.cash.summary.invalidate(),
      utils.kassa.daySummary.invalidate({ date: timestamp }),
      utils.dashboard.overview.invalidate(),
    ]).then(onChanged);

  const create = trpc.cash.create.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });
  const update = trpc.cash.update.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });
  const del = trpc.cash.delete.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });

  const sortedEntries = useMemo(() => [...entries].sort((a, b) => a.id - b.id), [entries]);
  const totals = useMemo(
    () => JOURNAL_COLUMNS.map(name => entries.filter(entry => entry.category === name).reduce((sum, entry) => sum + entry.cashAmount + entry.terminalAmount + entry.clickAmount, 0)),
    [entries],
  );

  function commitExistingAgent(entry: CashEntryRow, value: string) {
    const agentId = value ? Number(value) : null;
    if (agentId === entry.agentId) return;
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId,
      description: entry.description ?? undefined,
      cashAmount: entry.cashAmount, terminalAmount: entry.terminalAmount, clickAmount: entry.clickAmount,
    });
  }

  function commitExistingReason(entry: CashEntryRow, value: string) {
    const next = value.trim();
    if ((entry.description ?? "") === next) return;
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId: entry.agentId,
      description: next || undefined,
      cashAmount: entry.cashAmount, terminalAmount: entry.terminalAmount, clickAmount: entry.clickAmount,
    });
  }

  function commitExistingAmount(entry: CashEntryRow, value: string) {
    const amount = Math.round(Number(value || 0));
    const current = entry.cashAmount + entry.terminalAmount + entry.clickAmount;
    if (amount === current) return;
    if (amount <= 0) { del.mutate({ id: entry.id }); return; }
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId: entry.agentId,
      description: entry.description ?? undefined,
      cashAmount: amount, terminalAmount: 0, clickAmount: 0,
    });
  }

  function updateDraft(index: number, patch: Partial<DraftRow>) {
    setDrafts(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  const REASON_COL = JOURNAL_COLUMNS.length + 1;
  const totalJournalRows = sortedEntries.length + drafts.length;

  /** Strelkalar bilan katakdan katakka o'tish: ustun bo'ylab Yuqori/Past, qator
   * bo'ylab Chap/O'ng (faqat kursor matn chetida bo'lsa — aks holda oddiy
   * matn ichida yurish ustunroq). Mavjud yozuvlarda faqat bitta toifa
   * ustuni to'ldirilgani uchun bo'sh kataklar avtomatik o'tkazib yuboriladi. */
  function focusJournalCell(row: number, col: number, dRow: number, dCol: number) {
    let r = row;
    let c = col;
    const maxSteps = Math.max(totalJournalRows, REASON_COL + 1);
    for (let step = 0; step < maxSteps; step += 1) {
      r += dRow;
      c += dCol;
      if (r < 0 || r >= totalJournalRows || c < 0 || c > REASON_COL) return;
      const target = document.querySelector<HTMLElement>(`[data-journal-cell="${r}-${c}"]`);
      if (target) {
        target.focus();
        if (target instanceof HTMLInputElement) target.select();
        return;
      }
      if (dRow === 0) return;
    }
  }

  function onAmountKeyDown(event: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); focusJournalCell(row, col, 1, 0); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); focusJournalCell(row, col, -1, 0); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); focusJournalCell(row, col, 1, 0); return; }
    const input = event.currentTarget;
    if (event.key === "ArrowLeft" && input.selectionStart === 0) { event.preventDefault(); focusJournalCell(row, col, 0, -1); return; }
    if (event.key === "ArrowRight" && input.selectionStart === input.value.length) { event.preventDefault(); focusJournalCell(row, col, 0, 1); }
  }

  /**
   * Qator ichida Tab/klik bilan kataklar orasida yurish "qatordan chiqish" emas —
   * shuning uchun blur bo'lgan zahoti emas, fokus chinakam boshqa joyga
   * ko'chgani (document.activeElement shu qatorda emasligi) tasdiqlangandan
   * keyin commit qilinadi. relatedTarget'ga tayanish avtomatlashtirilgan va
   * ba'zi brauzer holatlarida ishonchsiz bo'lib, summa avval yozilganda
   * qatorni vaqtidan oldin bo'shatib yuborardi.
   */
  function commitDraftRow(index: number, event: React.FocusEvent<HTMLTableRowElement>) {
    const rowEl = event.currentTarget;
    window.setTimeout(() => {
      if (rowEl.contains(document.activeElement)) return;
      setDrafts(current => {
        const draft = current[index];
        const categoriesToCommit = JOURNAL_COLUMNS.filter(name => Math.round(Number(draft.amounts[name] || 0)) > 0);
        if (categoriesToCommit.length === 0) return current;
        for (const category of categoriesToCommit) {
          const type = CATEGORY_TYPE[category];
          create.mutate({
            entryDate: timestamp, type, category,
            agentId: type === "income" && draft.agentId ? Number(draft.agentId) : undefined,
            description: type === "expense" ? draft.reason.trim() || undefined : undefined,
            cashAmount: Math.round(Number(draft.amounts[category])), terminalAmount: 0, clickAmount: 0,
          });
        }
        return current.map((row, i) => (i === index ? emptyDraftRow() : row));
      });
    }, 0);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr className="bg-slate-50 text-xs font-semibold text-slate-500">
            <th className="whitespace-nowrap px-3 py-2 text-left">Агент</th>
            {JOURNAL_COLUMNS.map(name => <th key={name} className="whitespace-nowrap px-3 py-2 text-right">{name}</th>)}
            <th className="whitespace-nowrap px-3 py-2 text-left">Нимага расход</th>
            <th className="w-11" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sortedEntries.map((entry, rowIndex) => {
            const amount = entry.cashAmount + entry.terminalAmount + entry.clickAmount;
            return (
              <tr key={entry.id} className="text-xs">
                <td className="px-1 py-1">
                  {entry.type === "income" ? (
                    <div>
                      <select
                        key={`agent-${entry.id}-${entry.agentId ?? ""}`}
                        data-journal-cell={`${rowIndex}-0`}
                        defaultValue={entry.agentId != null ? String(entry.agentId) : ""}
                        className={selectInputClass}
                        onChange={event => commitExistingAgent(entry, event.target.value)}
                        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, 0, 1, 0); } }}
                      >
                        <option value="">Агент tanlanmagan</option>
                        {agentList.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                      </select>
                      {entry.agentId == null && entry.description ? (
                        <p className="truncate px-1.5 text-[10px] text-slate-400">{entry.description}</p>
                      ) : null}
                    </div>
                  ) : <span className="px-1.5 text-slate-300">—</span>}
                </td>
                {JOURNAL_COLUMNS.map((name, colOffset) => (
                  <td key={name} className="px-1 py-1">
                    {entry.category === name ? (
                      <input
                        key={`amount-${entry.id}-${amount}`}
                        type="text" inputMode="numeric"
                        data-journal-cell={`${rowIndex}-${colOffset + 1}`}
                        defaultValue={String(amount)}
                        className={`${cellInputClass} text-slate-900`}
                        onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                        onBlur={event => commitExistingAmount(entry, event.target.value)}
                        onKeyDown={event => onAmountKeyDown(event, rowIndex, colOffset + 1)}
                      />
                    ) : null}
                  </td>
                ))}
                <td className="px-1 py-1">
                  {entry.type === "expense" ? (
                    <input
                      key={`reason-${entry.id}-${entry.description ?? ""}`}
                      data-journal-cell={`${rowIndex}-${REASON_COL}`}
                      defaultValue={entry.description ?? ""}
                      placeholder="Нимага расход"
                      className={textInputClass}
                      onBlur={event => commitExistingReason(entry, event.target.value)}
                      onKeyDown={event => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        event.currentTarget.blur();
                        focusJournalCell(rowIndex, REASON_COL, 1, 0);
                      }}
                    />
                  ) : <span className="px-1.5 text-slate-300">—</span>}
                </td>
                <td className="px-1 py-1 text-right">
                  <button
                    type="button"
                    aria-label="O'chirish"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    onClick={() => del.mutate({ id: entry.id })}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {drafts.map((draft, index) => {
            const rowIndex = sortedEntries.length + index;
            return (
            <tr key={`draft-${index}`} className="bg-slate-50/40 text-xs" onBlur={event => commitDraftRow(index, event)}>
              <td className="px-1 py-1">
                <select
                  value={draft.agentId}
                  data-journal-cell={`${rowIndex}-0`}
                  className={selectInputClass}
                  onChange={event => updateDraft(index, { agentId: event.target.value })}
                  onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, 0, 1, 0); } }}
                >
                  <option value="">Агент tanlang</option>
                  {agentList.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </td>
              {JOURNAL_COLUMNS.map((name, colOffset) => (
                <td key={name} className="px-1 py-1">
                  <input
                    type="text" inputMode="numeric"
                    data-journal-cell={`${rowIndex}-${colOffset + 1}`}
                    value={draft.amounts[name]}
                    placeholder="0"
                    className={`${cellInputClass} text-slate-500`}
                    onChange={event => updateDraft(index, { amounts: { ...draft.amounts, [name]: sanitizeIntegerInput(event.target.value) } })}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, colOffset + 1)}
                  />
                </td>
              ))}
              <td className="px-1 py-1">
                <input
                  value={draft.reason}
                  data-journal-cell={`${rowIndex}-${REASON_COL}`}
                  placeholder="Нимага расход"
                  className={textInputClass}
                  onChange={event => updateDraft(index, { reason: event.target.value })}
                  onKeyDown={event => {
                    if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, 1, 0); return; }
                    if (event.key === "ArrowLeft" && event.currentTarget.selectionStart === 0) { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, 0, -1); return; }
                    if (event.key === "ArrowUp") { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, -1, 0); return; }
                    if (event.key === "ArrowDown") { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, 1, 0); }
                  }}
                />
              </td>
              <td />
            </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-slate-50/80 text-xs font-bold text-slate-900">
            <td className="whitespace-nowrap px-3 py-2">Jami</td>
            {totals.map((value, index) => <td key={JOURNAL_COLUMNS[index]} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(value)}</td>)}
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
      <div className="border-t border-slate-100 px-3 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline"
          onClick={() => setDrafts(prev => [...prev, emptyDraftRow()])}
        >
          <Plus className="size-3.5" /> Qator qo'shish
        </button>
      </div>
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

  const allEntries = prihodEntries.data ?? [];

  if (daySummary.error) {
    return <div className="mx-auto w-full max-w-[1500px]"><PageHeader eyebrow="Pul oqimi" title="КАССА" description="Kunlik jurnal va agentlar bo'yicha tezkor nazorat." /><QueryError description={daySummary.error.message} onRetry={() => daySummary.refetch()} /></div>;
  }

  const data = daySummary.data;
  const kassaQoldigi = data?.kassaQoldigi ?? 0;

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
        <DailyJournalGrid entries={allEntries} date={date} onChanged={() => prihodEntries.refetch()} />
      </div>

      <div className="mt-5 rounded-2xl border border-slate-100 bg-white p-5">
        <div className="mb-1 flex items-center gap-2"><Users className="size-4 text-primary" /><h3 className="text-sm font-bold text-slate-900">Агент x Товар</h3></div>
        <p className="mb-3 text-xs text-slate-400">Tab yoki ←/→ — qo‘shni katak, Enter/↑/↓ — shu ustunda keyingi/oldingi mahsulot.</p>
        <AgentProductMatrix date={date} />
      </div>
    </div>
  );
}
