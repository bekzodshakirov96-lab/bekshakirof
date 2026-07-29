import { MetricCard, PageHeader, QueryError } from "@/components/finance-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/cashCategories";
import { formatMoney, localDateInputValue, sanitizeDecimalInput, sanitizeIntegerInput } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import {
  AlertTriangle,
  ArrowLeftRight,
  Banknote,
  Calculator,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Landmark,
  Plus,
  Smartphone,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

const today = localDateInputValue;
const dateToTimestamp = (value: string) => new Date(`${value}T12:00:00`).getTime();
function shiftDate(value: string, days: number): string {
  const shifted = new Date(dateToTimestamp(value));
  shifted.setDate(shifted.getDate() + days);
  return localDateInputValue(shifted);
}

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

type DraftRow = {
  agentId: string; reason: string; terminal: string; click: string;
  amounts: Record<string, string>;
  /** Har bir toifa uchun avtomatik saqlangandan keyingi cashEntries.id — bor bo'lsa,
   * keyingi o'zgarishlar yangi yozuv yaratmaydi, mavjudini yangilaydi. */
  entryIds: Record<string, number | null>;
};
const emptyDraftRow = (): DraftRow => ({
  agentId: "", reason: "", terminal: "", click: "",
  amounts: Object.fromEntries(JOURNAL_COLUMNS.map(name => [name, ""])),
  entryIds: Object.fromEntries(JOURNAL_COLUMNS.map(name => [name, null])),
});

const cellInputClass =
  "w-full min-w-[64px] rounded-md border border-transparent bg-muted/70 px-1.5 py-1.5 text-right tabular-nums outline-none transition-colors hover:border-border hover:bg-muted focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/25";
/** "Ойлик" ustuni ajratib turishi uchun — qolganlaridan qizg'ishroq. */
const cellInputClassHighlight =
  "w-full min-w-[64px] rounded-md border border-rose-100 bg-rose-50/70 px-1.5 py-1.5 text-right tabular-nums outline-none transition-colors hover:border-rose-300 hover:bg-rose-100 focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/25 dark:border-rose-400/25 dark:bg-rose-500/10 dark:hover:border-rose-400/40 dark:hover:bg-rose-500/20";
const HIGHLIGHT_CATEGORY = "Ойлик";
const textInputClass =
  "w-full min-w-[110px] rounded-md border border-transparent bg-muted/70 px-1.5 py-1.5 outline-none transition-colors hover:border-border hover:bg-muted focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/25";
const selectInputClass =
  "w-full min-w-[120px] cursor-pointer rounded-md border border-transparent bg-muted/70 px-1.5 py-1.5 text-xs outline-none transition-colors hover:border-border hover:bg-muted focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/25";
const emptyCellClass = "block px-1.5 py-1.5 text-right text-muted-foreground/35 select-none";
const emptyCellClassLeft = "block px-1.5 py-1.5 text-left text-muted-foreground/35 select-none";

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
  const openingBalanceQuery = trpc.cash.openingBalance.useQuery({ date: timestamp });
  const [drafts, setDrafts] = useState<DraftRow[]>(() => Array.from({ length: DRAFT_ROWS }, emptyDraftRow));
  /** `drafts` state ko'zguси — async avtomatik-saqlash funksiyalari React render
   * siklidan qat'i nazar har doim eng so'nggi qiymatni sinxron o'qishi uchun. */
  const draftsRef = useRef(drafts);
  const autoSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const invalidate = () =>
    Promise.all([
      utils.cash.byDate.invalidate({ date: timestamp }),
      utils.cash.summary.invalidate(),
      utils.cash.openingBalance.invalidate(),
      utils.kassa.daySummary.invalidate({ date: timestamp }),
      utils.dashboard.overview.invalidate(),
    ]).then(onChanged);

  const create = trpc.cash.create.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });
  const update = trpc.cash.update.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });
  const del = trpc.cash.delete.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });

  /** Qatorlar joyidan qo'zg'almasligi uchun: draft qatorida saqlanib turgan (entryIds'da
   * ko'rsatilgan) yozuvlar "sortedEntries" ro'yxatida qayta ko'rsatilmaydi — aks holda
   * saqlangan zahoti o'sha yozuv yuqoriga (entries bo'limiga) sakrab, draft qatori esa
   * bo'shab qolardi. */
  const activeDraftEntryIds = useMemo(() => {
    const ids = new Set<number>();
    for (const draft of drafts) {
      for (const id of Object.values(draft.entryIds)) {
        if (id) ids.add(id);
      }
    }
    return ids;
  }, [drafts]);
  const sortedEntries = useMemo(
    () => [...entries].filter(entry => !activeDraftEntryIds.has(entry.id)).sort((a, b) => a.id - b.id),
    [entries, activeDraftEntryIds],
  );
  const openingBalance = openingBalanceQuery.data?.openingBalance ?? 0;
  const dayNetCash = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.type === "income" ? entry.cashAmount : -entry.cashAmount), 0),
    [entries],
  );
  const closingBalance = openingBalance + dayNetCash;
  const totals = useMemo(
    () => JOURNAL_COLUMNS.map(name => entries.filter(entry => entry.category === name).reduce((sum, entry) => sum + entry.cashAmount + entry.terminalAmount + entry.clickAmount, 0)),
    [entries],
  );
  const terminalTotal = useMemo(() => entries.reduce((sum, entry) => sum + entry.terminalAmount, 0), [entries]);
  const clickTotal = useMemo(() => entries.reduce((sum, entry) => sum + entry.clickAmount, 0), [entries]);

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

  function commitExistingCash(entry: CashEntryRow, value: string) {
    const cashAmount = Math.round(Number(value || 0));
    if (cashAmount === entry.cashAmount) return;
    if (cashAmount + entry.terminalAmount + entry.clickAmount <= 0) { del.mutate({ id: entry.id }); return; }
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId: entry.agentId,
      description: entry.description ?? undefined,
      cashAmount, terminalAmount: entry.terminalAmount, clickAmount: entry.clickAmount,
    });
  }

  function commitExistingChannel(entry: CashEntryRow, channel: "terminal" | "click", value: string) {
    const amount = Math.round(Number(value || 0));
    const current = channel === "terminal" ? entry.terminalAmount : entry.clickAmount;
    if (amount === current) return;
    const terminalAmount = channel === "terminal" ? amount : entry.terminalAmount;
    const clickAmount = channel === "click" ? amount : entry.clickAmount;
    if (entry.cashAmount + terminalAmount + clickAmount <= 0) { del.mutate({ id: entry.id }); return; }
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId: entry.agentId,
      description: entry.description ?? undefined,
      cashAmount: entry.cashAmount, terminalAmount, clickAmount,
    });
  }

  function updateDraft(index: number, patch: Partial<DraftRow>) {
    const next = draftsRef.current.map((row, i) => (i === index ? { ...row, ...patch } : row));
    draftsRef.current = next;
    setDrafts(next);
  }

  /**
   * Bitta qatordagi hozirgi qiymatlarni bazaga yozadi: toifa summasi bo'lgan
   * har bir ustun uchun — birinchi marta bo'lsa yangi yozuv, keyingi safar
   * o'sha yozuvni yangilaydi (entryIds orqali kuzatiladi). Summa 0'ga
   * qaytarilsa, avval avtomatik saqlangan yozuv o'chiriladi.
   * `resetAfter` — qator butunlay tark etilganda (fokus chiqqanda) qatorni
   * bo'shatib, endi haqiqiy yozuv sifatida yuqorida ko'rinishini ta'minlaydi.
   */
  async function flushDraftRow(index: number, resetAfter: boolean) {
    const draft = draftsRef.current[index];
    if (!draft) return;
    const nextEntryIds = { ...draft.entryIds };
    let idsChanged = false;
    for (const category of JOURNAL_COLUMNS) {
      const amount = Math.round(Number(draft.amounts[category] || 0));
      const existingId = draft.entryIds[category];
      const type = CATEGORY_TYPE[category];
      try {
        if (amount <= 0) {
          if (existingId) {
            await del.mutateAsync({ id: existingId });
            nextEntryIds[category] = null;
            idsChanged = true;
          }
          continue;
        }
        const payload = {
          entryDate: timestamp, type, category,
          agentId: draft.agentId ? Number(draft.agentId) : undefined,
          description: type === "expense" ? draft.reason.trim() || undefined : undefined,
          cashAmount: amount,
          terminalAmount: Math.round(Number(draft.terminal || 0)),
          clickAmount: Math.round(Number(draft.click || 0)),
        };
        if (existingId) {
          await update.mutateAsync({ id: existingId, ...payload });
        } else {
          const result = await create.mutateAsync(payload);
          nextEntryIds[category] = result.id;
          idsChanged = true;
        }
      } catch {
        // xato bo'lsa ham (toast allaqachon ko'rsatildi), qolgan toifalarni saqlashda davom etamiz
      }
    }
    if (resetAfter) {
      updateDraft(index, emptyDraftRow());
    } else if (idsChanged) {
      updateDraft(index, { entryIds: nextEntryIds });
    }
  }

  /** Yozayotganda ~700ms jimlikdan keyin fonda avtomatik saqlaydi — brauzer
   * yopilsa yoki sana almashtirilsa ham, kiritilgan summa yo'qolib qolmasin. */
  function scheduleAutoSave(index: number) {
    if (autoSaveTimers.current[index]) clearTimeout(autoSaveTimers.current[index]);
    autoSaveTimers.current[index] = setTimeout(() => {
      delete autoSaveTimers.current[index];
      void flushDraftRow(index, false);
    }, 700);
  }

  /** Sana almashtirilishidan oldin: kutilayotgan avtomatik saqlashlarni
   * kechiktirmasdan bajarib, keyin yangi kun uchun bo'sh qatorlarga
   * o'tadi — eski kunning yozuvi yo'qolib qolmaydi va yangi kunga
   * tasodifan sizib o'tmaydi. */
  useEffect(() => {
    return () => {
      const count = draftsRef.current.length;
      for (let index = 0; index < count; index += 1) {
        if (autoSaveTimers.current[index]) { clearTimeout(autoSaveTimers.current[index]); delete autoSaveTimers.current[index]; }
        void flushDraftRow(index, true);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const TERMINAL_COL = JOURNAL_COLUMNS.length + 1;
  const CLICK_COL = JOURNAL_COLUMNS.length + 2;
  const REASON_COL = JOURNAL_COLUMNS.length + 3;
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
   * `resetAfter: false` — qator saqlangandan keyin bo'shatilmaydi, yozilgan
   * qiymatlar aynan o'sha katakda qolaveradi (yuqoriga "sakramaydi").
   */
  function commitDraftRow(index: number, event: React.FocusEvent<HTMLTableRowElement>) {
    const rowEl = event.currentTarget;
    window.setTimeout(() => {
      if (rowEl.contains(document.activeElement)) return;
      if (autoSaveTimers.current[index]) { clearTimeout(autoSaveTimers.current[index]); delete autoSaveTimers.current[index]; }
      void flushDraftRow(index, false);
    }, 0);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[1080px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-xs font-semibold tracking-wide text-muted-foreground">
            <th className="whitespace-nowrap px-3 py-2.5 text-left">Агент</th>
            {JOURNAL_COLUMNS.map(name => <th key={name} className={`whitespace-nowrap px-3 py-2.5 text-right ${name === HIGHLIGHT_CATEGORY ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : ""}`}>{name}</th>)}
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Терминал</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Click</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left">Нимага расход</th>
            <th className="w-11" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr className="border-b-2 border-sky-100 bg-sky-50/70 text-xs font-bold text-sky-900">
            <td colSpan={REASON_COL} className="px-3 py-2">Boshlang'ich qoldiq (naqd)</td>
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(openingBalance)}</td>
            <td />
          </tr>
          {sortedEntries.map((entry, rowIndex) => {
            return (
              <tr key={entry.id} className="text-xs even:bg-muted/40">
                <td className="px-1.5 py-1">
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
                      <p className="truncate px-1.5 pt-0.5 text-[10px] text-muted-foreground">{entry.description}</p>
                    ) : null}
                  </div>
                </td>
                {JOURNAL_COLUMNS.map((name, colOffset) => (
                  <td key={name} className={`px-1.5 py-1 ${name === HIGHLIGHT_CATEGORY ? "bg-rose-50/40 dark:bg-rose-500/8" : ""}`}>
                    {entry.category === name ? (
                      <input
                        key={`cash-${entry.id}-${entry.cashAmount}`}
                        type="text" inputMode="numeric"
                        data-journal-cell={`${rowIndex}-${colOffset + 1}`}
                        defaultValue={String(entry.cashAmount)}
                        className={`${name === HIGHLIGHT_CATEGORY ? cellInputClassHighlight : cellInputClass} font-semibold text-foreground`}
                        onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                        onBlur={event => commitExistingCash(entry, event.target.value)}
                        onKeyDown={event => onAmountKeyDown(event, rowIndex, colOffset + 1)}
                      />
                    ) : <span className={emptyCellClass}>—</span>}
                  </td>
                ))}
                <td className="px-1.5 py-1">
                  <input
                    key={`terminal-${entry.id}-${entry.terminalAmount}`}
                    type="text" inputMode="numeric"
                    data-journal-cell={`${rowIndex}-${TERMINAL_COL}`}
                    defaultValue={entry.terminalAmount ? String(entry.terminalAmount) : ""}
                    placeholder="0"
                    className={cellInputClass}
                    onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                    onBlur={event => commitExistingChannel(entry, "terminal", event.target.value)}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, TERMINAL_COL)}
                  />
                </td>
                <td className="px-1.5 py-1">
                  <input
                    key={`click-${entry.id}-${entry.clickAmount}`}
                    type="text" inputMode="numeric"
                    data-journal-cell={`${rowIndex}-${CLICK_COL}`}
                    defaultValue={entry.clickAmount ? String(entry.clickAmount) : ""}
                    placeholder="0"
                    className={cellInputClass}
                    onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                    onBlur={event => commitExistingChannel(entry, "click", event.target.value)}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, CLICK_COL)}
                  />
                </td>
                <td className="px-1.5 py-1">
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
                  ) : <span className={emptyCellClassLeft}>—</span>}
                </td>
                <td className="px-1 py-1 text-right">
                  <button
                    type="button"
                    aria-label="O'chirish"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
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
            <tr
              key={`draft-${index}`}
              className={`text-xs ${index === 0 ? "border-t-2 border-dashed border-border" : ""}`}
              onBlur={event => commitDraftRow(index, event)}
            >
              <td className="px-1.5 py-1">
                <select
                  value={draft.agentId}
                  data-journal-cell={`${rowIndex}-0`}
                  className={`${selectInputClass} ${draft.agentId ? "text-foreground" : "text-muted-foreground"}`}
                  onChange={event => { updateDraft(index, { agentId: event.target.value }); scheduleAutoSave(index); }}
                  onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, 0, 1, 0); } }}
                >
                  <option value="">Агент tanlang</option>
                  {agentList.map(agent => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
                </select>
              </td>
              {JOURNAL_COLUMNS.map((name, colOffset) => (
                <td key={name} className={`px-1.5 py-1 ${name === HIGHLIGHT_CATEGORY ? "bg-rose-50/40 dark:bg-rose-500/8" : ""}`}>
                  <input
                    type="text" inputMode="numeric"
                    data-journal-cell={`${rowIndex}-${colOffset + 1}`}
                    value={draft.amounts[name]}
                    placeholder="0"
                    className={`${name === HIGHLIGHT_CATEGORY ? cellInputClassHighlight : cellInputClass} text-muted-foreground`}
                    onChange={event => { updateDraft(index, { amounts: { ...draft.amounts, [name]: sanitizeIntegerInput(event.target.value) } }); scheduleAutoSave(index); }}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, colOffset + 1)}
                  />
                </td>
              ))}
              <td className="px-1.5 py-1">
                <input
                  type="text" inputMode="numeric"
                  data-journal-cell={`${rowIndex}-${TERMINAL_COL}`}
                  value={draft.terminal}
                  placeholder="0"
                  className={`${cellInputClass} text-muted-foreground`}
                  onChange={event => { updateDraft(index, { terminal: sanitizeIntegerInput(event.target.value) }); scheduleAutoSave(index); }}
                  onKeyDown={event => onAmountKeyDown(event, rowIndex, TERMINAL_COL)}
                />
              </td>
              <td className="px-1.5 py-1">
                <input
                  type="text" inputMode="numeric"
                  data-journal-cell={`${rowIndex}-${CLICK_COL}`}
                  value={draft.click}
                  placeholder="0"
                  className={`${cellInputClass} text-muted-foreground`}
                  onChange={event => { updateDraft(index, { click: sanitizeIntegerInput(event.target.value) }); scheduleAutoSave(index); }}
                  onKeyDown={event => onAmountKeyDown(event, rowIndex, CLICK_COL)}
                />
              </td>
              <td className="px-1.5 py-1">
                <input
                  value={draft.reason}
                  data-journal-cell={`${rowIndex}-${REASON_COL}`}
                  placeholder="Нимага расход"
                  className={textInputClass}
                  onChange={event => { updateDraft(index, { reason: event.target.value }); scheduleAutoSave(index); }}
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
          <tr className="border-t-2 border-border bg-muted/80 text-xs font-bold text-foreground">
            <td className="whitespace-nowrap px-3 py-2.5">Jami</td>
            {totals.map((value, index) => <td key={JOURNAL_COLUMNS[index]} className={`whitespace-nowrap px-3 py-2.5 text-right tabular-nums ${JOURNAL_COLUMNS[index] === HIGHLIGHT_CATEGORY ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : ""}`}>{formatMoney(value)}</td>)}
            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(terminalTotal)}</td>
            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(clickTotal)}</td>
            <td colSpan={2} />
          </tr>
          <tr className="border-t-2 border-sky-100 bg-sky-50/70 text-xs font-bold text-sky-900">
            <td colSpan={REASON_COL} className="px-3 py-2">Yakuniy qoldiq (naqd)</td>
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(closingBalance)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
      <div className="border-t border-border px-3 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary/5 hover:underline"
          onClick={() => { const next = [...draftsRef.current, emptyDraftRow()]; draftsRef.current = next; setDrafts(next); }}
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
  const dayPriceQuery = trpc.kassa.dayPrice.listForDay.useQuery({ date: timestamp });

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
  const setDayPrice = trpc.kassa.dayPrice.upsert.useMutation({
    onSuccess: () => Promise.all([invalidateMatrix(), utils.kassa.dayPrice.listForDay.invalidate({ date: timestamp })]),
    onError: error => toast.error(error.message),
  });
  const reorderProduct = trpc.products.reorder.useMutation({
    onSuccess: () => utils.products.list.invalidate(),
    onError: error => toast.error(error.message),
  });
  const createAgent = trpc.agents.create.useMutation({
    onSuccess: async () => {
      toast.success("Agent qo'shildi");
      setNewAgentName("");
      await utils.agents.options.invalidate();
    },
    onError: error => toast.error(error.message),
  });
  const createProduct = trpc.products.create.useMutation({
    onSuccess: async () => {
      toast.success("Mahsulot qo'shildi");
      setNewProductForm({ code: "", name: "", unit: "dona", price: "" });
      setNewProductOpen(false);
      await utils.products.list.invalidate();
    },
    onError: error => toast.error(error.message),
  });

  const agentList = agents.data ?? [];
  const productList = products.data ?? [];

  /** null = hammasi ko'rsatiladi (standart holat); tanlash boshlangandan keyin aniq to'plamga aylanadi. */
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<number> | null>(null);
  const visibleAgents = selectedAgentIds === null ? agentList : agentList.filter(agent => selectedAgentIds.has(agent.id));
  function toggleAgentVisible(agentId: number) {
    setSelectedAgentIds(prev => {
      const base = new Set(prev === null ? agentList.map(agent => agent.id) : prev);
      if (base.has(agentId)) base.delete(agentId); else base.add(agentId);
      return base;
    });
  }

  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const agentPickerRef = useRef<HTMLDivElement>(null);
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  useEffect(() => {
    if (!agentPickerOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (agentPickerRef.current && !agentPickerRef.current.contains(event.target as Node)) { setAgentPickerOpen(false); setNewAgentOpen(false); }
    }
    function handleEscape(event: KeyboardEvent) { if (event.key === "Escape") setAgentPickerOpen(false); }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [agentPickerOpen]);

  const [newProductOpen, setNewProductOpen] = useState(false);
  const [newProductForm, setNewProductForm] = useState({ code: "", name: "", unit: "dona", price: "" });
  const newProductRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!newProductOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (newProductRef.current && !newProductRef.current.contains(event.target as Node)) setNewProductOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [newProductOpen]);
  const canCreateProduct = newProductForm.code.trim() && newProductForm.name.trim() && newProductForm.unit.trim() && newProductForm.price.trim();
  const missingProductFields = [
    !newProductForm.code.trim() && "Kodi",
    !newProductForm.name.trim() && "Nomi",
    !newProductForm.unit.trim() && "O'lchov birligi",
    !newProductForm.price.trim() && "Narxi",
  ].filter((value): value is string => Boolean(value));
  const entryMap = useMemo(() => {
    const map = new Map<string, { id: number; quantity: string; amount: number }>();
    for (const row of takingRows.data ?? []) map.set(`${row.agentId}:${row.productId}`, row);
    return map;
  }, [takingRows.data]);
  const dayPriceByProduct = useMemo(() => new Map((dayPriceQuery.data ?? []).map(row => [row.productId, row.unitPrice])), [dayPriceQuery.data]);

  /** Bo'sh qoldirilsa yoki mahsulotning qat'iy narxi bilan bir xil kiritilsa,
   * kunlik narx bekor qilinadi va hisob-kitob yana doimiy narxga qaytadi. */
  function onDayPriceBlur(product: { id: number; price: number }, rawValue: string) {
    const trimmed = rawValue.trim();
    const value = trimmed === "" ? null : Math.round(Number(trimmed));
    const current = dayPriceByProduct.get(product.id) ?? null;
    if (value === current) return;
    if (value !== null && (Number.isNaN(value) || value <= 0)) return;
    setDayPrice.mutate({ date: timestamp, productId: product.id, unitPrice: value && value !== product.price ? value : null });
  }

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
    if (targetRow < 0 || targetRow >= productList.length || targetColumn < 0 || targetColumn >= visibleAgents.length) return;
    event.preventDefault();
    const target = document.querySelector<HTMLInputElement>(`[data-cash-matrix-cell="${targetRow}-${targetColumn}"]`);
    target?.focus();
    target?.select();
  }

  if (agents.isLoading || products.isLoading) return <p className="p-4 text-xs text-muted-foreground">Yuklanmoqda...</p>;
  if (agentList.length === 0) return <p className="p-4 text-xs text-muted-foreground">Faol agentlar topilmadi.</p>;
  if (productList.length === 0) return <p className="p-4 text-xs text-muted-foreground">Mahsulotlar topilmadi.</p>;

  const summaryByAgent = new Map((daySummary.data?.agentSummaries ?? []).map(row => [row.agentId, row]));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative" ref={agentPickerRef}>
          <Button
            type="button" variant="outline" size="sm" className="h-8 gap-1.5 bg-card text-xs font-semibold"
            onClick={() => setAgentPickerOpen(open => !open)}
          >
            <Users className="size-3.5" /> Agentlar ({visibleAgents.length}/{agentList.length})
          </Button>
          {agentPickerOpen && (
            <div className="absolute z-20 mt-1 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
              <div className="max-h-56 overflow-y-auto">
                {agentList.map(agent => (
                  <button
                    key={agent.id} type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => toggleAgentVisible(agent.id)}
                  >
                    <Checkbox checked={selectedAgentIds === null || selectedAgentIds.has(agent.id)} />
                    <span className="flex-1 truncate font-medium text-foreground">{agent.name}</span>
                  </button>
                ))}
              </div>
              <div className="border-t border-border p-2">
                {!newAgentOpen ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
                    onClick={() => setNewAgentOpen(true)}
                  >
                    <Plus className="size-3.5" /> Yangi agent qo'shish
                  </button>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <Input
                      autoFocus className="finance-input h-8 flex-1 text-xs" placeholder="Agent nomi"
                      value={newAgentName}
                      onChange={event => setNewAgentName(event.target.value)}
                      onKeyDown={event => { if (event.key === "Enter" && newAgentName.trim() && !createAgent.isPending) createAgent.mutate({ name: newAgentName.trim() }); }}
                    />
                    <Button
                      type="button" size="sm" className="h-8 px-2.5 text-xs"
                      disabled={!newAgentName.trim() || createAgent.isPending}
                      onClick={() => createAgent.mutate({ name: newAgentName.trim() })}
                    >
                      Qo'sh
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="relative" ref={newProductRef}>
          <Button
            type="button" variant="outline" size="sm" className="h-8 gap-1.5 bg-card text-xs font-semibold"
            onClick={() => setNewProductOpen(open => !open)}
          >
            <Plus className="size-3.5" /> Mahsulot qo'shish
          </Button>
          {newProductOpen && (
            <div className="absolute z-20 mt-1 w-64 space-y-2 rounded-xl border border-border bg-card p-3 shadow-xl">
              <Input className={`finance-input h-8 text-xs ${!newProductForm.code.trim() ? "border-rose-300" : ""}`} placeholder="Kodi" value={newProductForm.code} onChange={event => setNewProductForm(prev => ({ ...prev, code: event.target.value }))} />
              <Input className={`finance-input h-8 text-xs ${!newProductForm.name.trim() ? "border-rose-300" : ""}`} placeholder="Nomi" value={newProductForm.name} onChange={event => setNewProductForm(prev => ({ ...prev, name: event.target.value }))} />
              <Input className={`finance-input h-8 text-xs ${!newProductForm.unit.trim() ? "border-rose-300" : ""}`} placeholder="O'lchov birligi" value={newProductForm.unit} onChange={event => setNewProductForm(prev => ({ ...prev, unit: event.target.value }))} />
              <Input
                className={`finance-input h-8 text-xs ${!newProductForm.price.trim() ? "border-rose-300" : ""}`} type="text" inputMode="numeric" placeholder="Narxi"
                value={newProductForm.price}
                onChange={event => setNewProductForm(prev => ({ ...prev, price: sanitizeIntegerInput(event.target.value) }))}
              />
              {missingProductFields.length > 0 && !createProduct.isPending && (
                <p className="text-[11px] font-medium text-rose-600">To'ldirilmagan: {missingProductFields.join(", ")}</p>
              )}
              <Button
                type="button" size="sm" className="h-8 w-full text-xs"
                disabled={!canCreateProduct || createProduct.isPending}
                onClick={() => createProduct.mutate({ code: newProductForm.code.trim(), name: newProductForm.name.trim(), unit: newProductForm.unit.trim(), price: Math.round(Number(newProductForm.price || 0)) })}
              >
                Qo'shish
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border">
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="bg-muted text-xs font-semibold text-muted-foreground">
            <th className="sticky left-0 whitespace-nowrap bg-muted px-3 py-2 text-left">Товар</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Narxi</th>
            <th className="whitespace-nowrap px-3 py-2 text-right">Kunlik narx</th>
            {visibleAgents.map(agent => <th key={agent.id} className="whitespace-nowrap px-3 py-2 text-right">{agent.name}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {productList.map((product, rowIndex) => {
            const dayPrice = dayPriceByProduct.get(product.id) ?? null;
            return (
            <tr key={product.id}>
              <td className="sticky left-0 whitespace-nowrap bg-card px-3 py-1.5 font-medium text-foreground">
                <div className="flex items-center gap-1.5">
                  <div className="flex shrink-0 flex-col">
                    <button
                      type="button" aria-label="Yuqoriga surish"
                      className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-0"
                      disabled={rowIndex === 0}
                      onClick={() => reorderProduct.mutate({ id: product.id, direction: "up" })}
                    >
                      <ChevronUp className="size-3" />
                    </button>
                    <button
                      type="button" aria-label="Pastga surish"
                      className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-0"
                      disabled={rowIndex === productList.length - 1}
                      onClick={() => reorderProduct.mutate({ id: product.id, direction: "down" })}
                    >
                      <ChevronDown className="size-3" />
                    </button>
                  </div>
                  {product.name}
                </div>
              </td>
              <td className="whitespace-nowrap px-3 py-1.5 text-right text-muted-foreground">{formatMoney(product.price)}</td>
              <td className="px-2 py-1 text-right">
                <Input
                  className={`finance-input h-10 w-24 text-right ${dayPrice != null ? "font-bold text-amber-700" : ""}`}
                  type="text" inputMode="numeric"
                  defaultValue={dayPrice != null ? String(dayPrice) : ""}
                  key={`day-price-${product.id}-${dayPrice ?? ""}`}
                  placeholder={String(product.price)}
                  onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                  onBlur={event => onDayPriceBlur(product, event.target.value)}
                  onKeyDown={event => event.key === "Enter" && event.currentTarget.blur()}
                />
              </td>
              {visibleAgents.map((agent, columnIndex) => {
                const existing = entryMap.get(`${agent.id}:${product.id}`);
                return (
                  <td key={agent.id} className="px-2 py-1 text-right">
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
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-border bg-muted/80 text-xs font-bold text-foreground">
            <td className="sticky left-0 whitespace-nowrap bg-muted/80 px-3 py-2" colSpan={3}>Умумий</td>
            {visibleAgents.map(agent => (
              <td key={agent.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {formatMoney(summaryByAgent.get(agent.id)?.computedAmount ?? 0)}
              </td>
            ))}
          </tr>
          <tr className="bg-muted/80 text-xs font-bold text-foreground">
            <td className="sticky left-0 whitespace-nowrap bg-muted/80 px-3 py-2" colSpan={3}>
              Касса
              <span className="ml-1.5 font-normal text-muted-foreground">(Приход кег + Приход пет)</span>
            </td>
            {visibleAgents.map(agent => (
              <td key={agent.id} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                {formatMoney(summaryByAgent.get(agent.id)?.submittedAmount ?? 0)}
              </td>
            ))}
          </tr>
          <tr className="text-xs font-bold">
            <td className="sticky left-0 whitespace-nowrap bg-card px-3 py-2" colSpan={3}>Разница</td>
            {visibleAgents.map(agent => {
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
    </div>
  );
}

type PendingChannel = { today: number; cumulative: number };
const PENDING_CHANNELS: { key: "cash" | "terminal" | "click" | "transfer"; label: string; icon: typeof Banknote }[] = [
  { key: "cash", label: "Naqd", icon: Banknote },
  { key: "terminal", label: "Terminal", icon: Landmark },
  { key: "click", label: "Click", icon: Smartphone },
  { key: "transfer", label: "Перечисление", icon: ArrowLeftRight },
];

/**
 * Har kanal (Naqd/Terminal/Click/Перечисление) bo'yicha "kassaga kelishi kerak bo'lgan"
 * summa (savdo+qarz to'lovlaridan hisoblangan) va "haqiqatda tasdiqlangan" summa orasidagi
 * farqni ko'rsatadi — buxgalter biror to'lovni yozib qo'yib kassaga kiritmasa yoki
 * boshqa kanalga yozib qo'ysa ham, bu yerda darhol ko'rinadi (kutilgan tomon audit
 * qilingan yozuvlardan hisoblanadi, uni yashirib bo'lmaydi). `today` — shu kunning
 * o'zi, `cumulative` — davr boshidan buyon yig'ilib qolgan qoldiq (oldingi kundan
 * avtomatik "ko'chib" keladi). Naqd — mavjud "Приход кег/пет" orqali, qolgan uch
 * kanal — quyidagi kunlik tasdiqlash formasi orqali yopiladi.
 */
function PendingKassaPanel({
  timestamp,
  data,
  onSaved,
}: {
  timestamp: number;
  data: {
    pendingByChannel?: Record<"cash" | "terminal" | "click" | "transfer", PendingChannel>;
    channelConfirmed?: { terminal: number; click: number; transfer: number; note: string };
  } | undefined;
  onSaved: () => void;
}) {
  const [terminal, setTerminal] = useState("");
  const [click, setClick] = useState("");
  const [transfer, setTransfer] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setTerminal(data?.channelConfirmed ? String(data.channelConfirmed.terminal) : "");
    setClick(data?.channelConfirmed ? String(data.channelConfirmed.click) : "");
    setTransfer(data?.channelConfirmed ? String(data.channelConfirmed.transfer) : "");
    setNote(data?.channelConfirmed?.note ?? "");
  }, [timestamp, data?.channelConfirmed]);

  const upsert = trpc.kassa.channelConfirmation.upsert.useMutation({
    onSuccess: () => { toast.success("Tasdiqlandi"); onSaved(); },
    onError: error => toast.error(error.message),
  });

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2"><AlertTriangle className="size-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Kutilayotgan kassa</h3></div>
      <p className="mb-3 text-xs text-muted-foreground">
        Savdo/qarz to'lovlarida yozilgan summa bilan kassaga haqiqatda tasdiqlangan summa orasidagi farq — kanal qanday yozilishidan qat'i nazar darhol ko'rinadi.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {PENDING_CHANNELS.map(({ key, label, icon: Icon }) => {
          const row = data?.pendingByChannel?.[key];
          const today = row?.today ?? 0;
          const cumulative = row?.cumulative ?? 0;
          const flagged = cumulative > 0;
          return (
            <div
              key={key}
              className={`rounded-xl border p-3 ${flagged ? "border-rose-200 bg-rose-50/60 dark:border-rose-400/30 dark:bg-rose-500/10" : "border-emerald-200 bg-emerald-50/40 dark:border-emerald-400/25 dark:bg-emerald-500/10"}`}
            >
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><Icon className="size-3.5" />{label}</div>
              <div className="mt-1.5 text-sm font-bold text-foreground">Bugun: {formatMoney(today)}</div>
              <div className={`text-xs font-semibold ${flagged ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}`}>
                Jami qoldiq: {formatMoney(cumulative)}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[160px_160px_160px_1fr_auto]">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Terminal tasdiqlangan</label>
          <Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={terminal} onChange={event => setTerminal(sanitizeIntegerInput(event.target.value))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Click tasdiqlangan</label>
          <Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={click} onChange={event => setClick(sanitizeIntegerInput(event.target.value))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Перечисление tasdiqlangan</label>
          <Input className="finance-input" type="text" inputMode="numeric" placeholder="0" value={transfer} onChange={event => setTransfer(sanitizeIntegerInput(event.target.value))} />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Izoh</label>
          <Input className="finance-input" placeholder="Bank hisoboti/Click panel bo'yicha" value={note} onChange={event => setNote(event.target.value)} />
        </div>
        <Button
          disabled={upsert.isPending}
          onClick={() =>
            upsert.mutate({
              date: timestamp,
              terminalConfirmed: Math.round(Number(terminal || 0)),
              clickConfirmed: Math.round(Number(click || 0)),
              transferConfirmed: Math.round(Number(transfer || 0)),
              note: note || undefined,
            })
          }
        >
          {upsert.isPending ? "Saqlanmoqda..." : "Tasdiqlash"}
        </Button>
      </div>
    </div>
  );
}

/**
 * Kassani jismonan sanab, tizim hisoblagan qoldiq bilan solishtirish — kamomad/ortiqchani
 * shu yerda ko'rish uchun. `kassa.actualCash.upsert` yozadi, `daySummary` javobidagi
 * actualCash/actualCashNote/actualDiff orqali o'qiladi.
 */
function ActualCashCard({
  date,
  timestamp,
  kassaQoldigi,
  data,
  onSaved,
}: {
  date: string;
  timestamp: number;
  kassaQoldigi: number;
  data: { actualCash: number | null; actualCashNote: string; actualDiff: number | null } | undefined;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    setValue(data?.actualCash != null ? String(data.actualCash) : "");
    setNote(data?.actualCashNote ?? "");
  }, [timestamp, data?.actualCash, data?.actualCashNote]);

  const upsert = trpc.kassa.actualCash.upsert.useMutation({
    onSuccess: () => {
      toast.success("Haqiqiy naqd saqlandi");
      onSaved();
    },
    onError: error => toast.error(error.message),
  });

  const hasValue = data?.actualCash != null;
  const diff = data?.actualDiff ?? 0;

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-5">
      <div className="mb-1 flex items-center gap-2"><Calculator className="size-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Haqiqiy sanalgan naqd — {date}</h3></div>
      <p className="mb-3 text-xs text-muted-foreground">
        Kassadagi pulni jismonan sanab shu yerga kiriting — tizim hisoblangan qoldiq bilan
        ({formatMoney(kassaQoldigi)}) solishtirib, farqni (kamomad yoki ortiqcha) ko'rsatadi.
      </p>
      <div className="grid items-end gap-3 sm:grid-cols-[200px_1fr_auto]">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Sanalgan summa</label>
          <Input
            className="finance-input"
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={value}
            onChange={event => setValue(sanitizeIntegerInput(event.target.value))}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-muted-foreground">Izoh</label>
          <Input
            className="finance-input"
            placeholder="Ixtiyoriy"
            value={note}
            onChange={event => setNote(event.target.value)}
          />
        </div>
        <Button
          disabled={value === "" || upsert.isPending}
          onClick={() =>
            upsert.mutate({ date: timestamp, actualCash: Math.round(Number(value || 0)), note: note || undefined })
          }
        >
          {upsert.isPending ? "Saqlanmoqda..." : "Saqlash"}
        </Button>
      </div>
      {hasValue && (
        <div
          className={`mt-3 rounded-xl border p-3 text-sm font-semibold ${
            diff === 0
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-rose-200 bg-rose-50 text-rose-700"
          }`}
        >
          {diff === 0 ? "Mos keladi — farq yo'q." : `Farq: ${formatMoney(diff)} ${diff > 0 ? "(ortiqcha)" : "(kamomad)"}`}
        </div>
      )}
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

      <PendingKassaPanel
        timestamp={timestamp}
        data={data}
        onSaved={() => daySummary.refetch()}
      />

      <ActualCashCard
        date={date}
        timestamp={timestamp}
        kassaQoldigi={kassaQoldigi}
        data={data}
        onSaved={() => daySummary.refetch()}
      />

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-foreground">Kunlik jurnal</h3>
          <div className="flex items-center gap-1.5">
            <Button
              type="button" variant="outline" size="icon" className="size-8 bg-card"
              aria-label="Oldingi kun"
              onClick={() => setDate(prev => shiftDate(prev, -1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Input
              className="finance-input h-8 w-[150px] text-center"
              type="date" value={date}
              onChange={event => setDate(event.target.value)}
            />
            <Button
              type="button" variant="outline" size="icon" className="size-8 bg-card"
              aria-label="Keyingi kun"
              onClick={() => setDate(prev => shiftDate(prev, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              type="button" variant="outline" size="sm" className="h-8 bg-card text-xs font-semibold"
              onClick={() => setDate(today())}
            >
              Bugun
            </Button>
          </div>
        </div>
        <DailyJournalGrid entries={allEntries} date={date} onChanged={() => prihodEntries.refetch()} />
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <div className="mb-1 flex items-center gap-2"><Users className="size-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Агент x Товар</h3></div>
        <p className="mb-3 text-xs text-muted-foreground">Tab yoki ←/→ — qo‘shni katak, Enter/↑/↓ — shu ustunda keyingi/oldingi mahsulot.</p>
        <AgentProductMatrix date={date} />
      </div>
    </div>
  );
}
