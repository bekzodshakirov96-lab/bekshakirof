import { MetricCard, PageHeader, QueryError } from "@/components/finance-ui";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/cashCategories";
import { createCashDraftSaver } from "@/lib/cashDraftSaver";
import { buildEmployeeOptions } from "@/lib/cashPayees";
import { groupJournalEntries, journalCellTotal } from "@/lib/cashJournalGroups";
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
const DEBT_COLUMN = "Qarz";
const CASH_COLUMNS = [...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES];
const JOURNAL_COLUMNS = [...CASH_COLUMNS, DEBT_COLUMN];
const DRAFT_ROWS = 4;

/**
 * Kunlik jurnalda xodimlar ro'yxati ochiqmi — brauzerda eslab qolinadi.
 *
 * Xodimlarga oylik har kuni berilmaydi, shuning uchun ular sukut bo'yicha
 * yashirin: tanlash ro'yxatida faqat agentlar turadi va kundalik ish
 * chalg'imaydi. Kerak bo'lganda "Ходимлар" tugmasi bilan ochiladi.
 */
const SHOW_EMPLOYEES_KEY = "nokdaun.cash.showEmployees";
function readShowEmployees(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(SHOW_EMPLOYEES_KEY) === "1";
}

type CashEntryRow = {
  id: number;
  type: "income" | "expense";
  category: string;
  agentId: number | null;
  agentName: string | null;
  employeeId: number | null;
  employeeName: string | null;
  description: string | null;
  cashAmount: number;
  terminalAmount: number;
  clickAmount: number;
  transferAmount: number;
};

/** Qarz — faqat jurnal qaydi; pul harakati va mijoz qarziga kirmaydi. */
type JournalDebtRow = Omit<CashEntryRow, "type"> & { type: "memo"; amount: number };
type JournalRow = CashEntryRow | JournalDebtRow;
const journalRowKey = (entry: JournalRow) => `${entry.type === "memo" ? "debt" : "cash"}:${entry.id}`;

/**
 * "Ойлик" qatorida pul agentga ham, oylik oladigan xodimga ham berilishi mumkin.
 * Ikkalasi bitta tanlovda ko'rsatilgani uchun qiymatlar prefiks bilan farqlanadi:
 * `a:12` — agent, `e:3` — xodim.
 */
type Payee = { agentId: number | null; employeeId: number | null };
const payeeToValue = (payee: Payee) =>
  payee.employeeId != null ? `e:${payee.employeeId}` : payee.agentId != null ? `a:${payee.agentId}` : "";
function payeeFromValue(value: string): Payee {
  if (value.startsWith("e:")) return { agentId: null, employeeId: Number(value.slice(2)) };
  if (value.startsWith("a:")) return { agentId: Number(value.slice(2)), employeeId: null };
  return { agentId: null, employeeId: null };
}

type DraftRow = {
  agentId: string; reason: string; terminal: string; click: string; transfer: string;
  debtAmount: string; debtReason: string; debtId: number | null;
  amounts: Record<string, string>;
  /** Har bir toifa uchun avtomatik saqlangandan keyingi cashEntries.id — bor bo'lsa,
   * keyingi o'zgarishlar yangi yozuv yaratmaydi, mavjudini yangilaydi. */
  entryIds: Record<string, number | null>;
};
const emptyDraftRow = (): DraftRow => ({
  agentId: "", reason: "", terminal: "", click: "", transfer: "",
  debtAmount: "", debtReason: "", debtId: null,
  amounts: Object.fromEntries(CASH_COLUMNS.map(name => [name, ""])),
  entryIds: Object.fromEntries(CASH_COLUMNS.map(name => [name, null])),
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

function JournalDetails({ title, trigger, children }: { title: string; trigger: React.ReactElement; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>{trigger}</PopoverTrigger>
    <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] bg-card" aria-label={title}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold">{title}</span>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Yopish</Button>
      </div>
      <div className="max-h-[min(60vh,calc(var(--radix-popover-content-available-height)-5rem))] space-y-3 overflow-y-auto">{children}</div>
    </PopoverContent>
  </Popover>;
}

/** Katakdagi tahrirlash va saqlash o'zgarishsiz; uzun izoh alohida o'qiladi. */
function ExpandableJournalNote({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div
          title="Izohni to‘liq o‘qish uchun bosing (F2)"
          onClick={event => {
            if (!(event.target instanceof HTMLInputElement)) return;
            setText(event.target.value);
            setOpen(true);
          }}
          onChangeCapture={event => {
            if (event.target instanceof HTMLInputElement) setText(event.target.value);
          }}
          onKeyDownCapture={event => {
            if (event.key !== "F2" || !(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            setText(event.target.value);
            setOpen(true);
          }}
        >
          {children}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-[min(28rem,calc(100vw-2rem))] p-4"
        aria-label="Izoh — to‘liq izoh"
        onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="text-sm font-semibold">Izoh</span>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>Yopish</Button>
        </div>
        <p className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed [overflow-wrap:anywhere]">
          {text || "Izoh kiritilmagan."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Excel "Kunlik jurnal" A1:H16 diapazoniga aynan mos, to'g'ridan-to'g'ri
 * kataklarga yozib kiritiladigan setka: prixod/rasxod yozuvlari alohida
 * forma orqali emas, shu jadval kataklari orqali qo'shiladi/tahrirlanadi.
 */
function DailyJournalGrid({
  entries,
  date,
  showEmployees,
  onChanged,
}: {
  entries: CashEntryRow[];
  date: string;
  /** Xodimlar tanlash ro'yxatida ko'rinsinmi (sukut bo'yicha yo'q). */
  showEmployees: boolean;
  onChanged: () => void;
}) {
  const utils = trpc.useUtils();
  const timestamp = dateToTimestamp(date);
  const debtEntries = trpc.cash.journalDebt.byDate.useQuery({ date: timestamp });
  const journalEntries = useMemo<JournalRow[]>(() => [
    ...entries,
    ...(debtEntries.data ?? []).map(entry => ({
      ...entry, type: "memo" as const, category: DEBT_COLUMN,
      cashAmount: 0, terminalAmount: 0, clickAmount: 0, transferAmount: 0,
    })),
  ], [entries, debtEntries.data]);
  const agents = trpc.agents.options.useQuery();
  const agentList = agents.data ?? [];
  /** Faolsizlantirilgan agentga tegishli eski yozuv bo'lsa ham, uning ismi tanlash
   * katakchasida to'g'ri ko'rinishi uchun — "Агент tanlanmagan" bo'lib qolmasin
   * (agentList faqat faol agentlarni o'z ichiga oladi). */
  const agentOptions = useMemo(() => {
    const known = new Set(agentList.map(agent => agent.id));
    const extra = new Map<number, string>();
    for (const entry of journalEntries) {
      if (entry.agentId && !known.has(entry.agentId) && entry.agentName) extra.set(entry.agentId, entry.agentName);
    }
    return [...agentList, ...Array.from(extra.entries()).map(([id, name]) => ({ id, name }))];
  }, [agentList, journalEntries]);
  const employees = trpc.employees.options.useQuery();
  const employeeList = employees.data ?? [];
  const employeeOptions = useMemo(
    () => buildEmployeeOptions(employeeList, journalEntries, showEmployees),
    [employeeList, journalEntries, showEmployees],
  );
  const openingBalanceQuery = trpc.cash.openingBalance.useQuery({ date: timestamp });
  const [drafts, setDrafts] = useState<DraftRow[]>(() => Array.from({ length: DRAFT_ROWS }, emptyDraftRow));
  /** `drafts` state ko'zguси — async avtomatik-saqlash funksiyalari React render
   * siklidan qat'i nazar har doim eng so'nggi qiymatni sinxron o'qishi uchun. */
  const draftsRef = useRef(drafts);
  const autoSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const debtSaveTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  const pendingDebtSaves = useRef<Record<number, Promise<void>>>({});
  const existingDebtSaves = useRef(new Map<number, { entry: JournalDebtRow; pending: Promise<void>; deleted?: boolean }>());

  const invalidate = () =>
    Promise.all([
      utils.cash.byDate.invalidate({ date: timestamp }),
      utils.cash.openingBalance.invalidate(),
      utils.kassa.daySummary.invalidate({ date: timestamp }),
      utils.dashboard.overview.invalidate(),
    ]).then(onChanged);

  const create = trpc.cash.create.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });
  const update = trpc.cash.update.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });
  const del = trpc.cash.delete.useMutation({ onSuccess: invalidate, onError: error => toast.error(error.message) });
  // Draft IDs must be recorded before a query refresh can show these records.
  const draftCreate = trpc.cash.create.useMutation({ onError: error => toast.error(error.message) });
  const draftUpdate = trpc.cash.update.useMutation({ onError: error => toast.error(error.message) });
  const draftDelete = trpc.cash.delete.useMutation({ onError: error => toast.error(error.message) });
  const invalidateDebt = () => Promise.all([
    utils.cash.journalDebt.byDate.invalidate({ date: timestamp }),
    utils.cash.journalDebt.report.invalidate(),
  ]);
  const createDebt = trpc.cash.journalDebt.create.useMutation({ onSuccess: invalidateDebt, onError: error => toast.error(error.message) });
  const updateDebt = trpc.cash.journalDebt.update.useMutation({ onSuccess: invalidateDebt, onError: error => toast.error(error.message) });
  const deleteDebt = trpc.cash.journalDebt.delete.useMutation({ onSuccess: invalidateDebt, onError: error => toast.error(error.message) });

  /** Qatorlar joyidan qo'zg'almasligi uchun: draft qatorida saqlanib turgan (entryIds'da
   * ko'rsatilgan) yozuvlar "sortedEntries" ro'yxatida qayta ko'rsatilmaydi — aks holda
   * saqlangan zahoti o'sha yozuv yuqoriga (entries bo'limiga) sakrab, draft qatori esa
   * bo'shab qolardi. */
  const activeDraftEntryIds = useMemo(() => {
    const ids = new Set<string>();
    for (const draft of drafts) {
      for (const id of Object.values(draft.entryIds)) {
        if (id) ids.add(`cash:${id}`);
      }
      if (draft.debtId) ids.add(`debt:${draft.debtId}`);
    }
    return ids;
  }, [drafts]);
  const sortedEntries = useMemo(
    () => journalEntries.filter(entry => !activeDraftEntryIds.has(journalRowKey(entry))).sort((a, b) => a.id - b.id),
    [journalEntries, activeDraftEntryIds],
  );
  const groupedEntries = useMemo(() => groupJournalEntries(sortedEntries), [sortedEntries]);
  const openingBalance = openingBalanceQuery.data?.openingBalance ?? 0;
  const dayNetCash = useMemo(
    () => entries.reduce((sum, entry) => sum + (entry.type === "income" ? entry.cashAmount : -entry.cashAmount), 0),
    [entries],
  );
  const closingBalance = openingBalance + dayNetCash;
  const totals = useMemo(
    () => JOURNAL_COLUMNS.map(name => name === DEBT_COLUMN
      ? (debtEntries.data ?? []).reduce((sum, entry) => sum + entry.amount, 0)
      : entries.filter(entry => entry.category === name).reduce((sum, entry) => sum + entry.cashAmount + entry.terminalAmount + entry.clickAmount, 0)),
    [entries, debtEntries.data],
  );
  const terminalTotal = useMemo(() => entries.reduce((sum, entry) => sum + entry.terminalAmount, 0), [entries]);
  const clickTotal = useMemo(() => entries.reduce((sum, entry) => sum + entry.clickAmount, 0), [entries]);
  const transferTotal = useMemo(() => entries.reduce((sum, entry) => sum + entry.transferAmount, 0), [entries]);

  function saveExistingDebt(entry: JournalDebtRow, patch: Partial<JournalDebtRow>) {
    let state = existingDebtSaves.current.get(entry.id);
    if (!state) {
      state = { entry, pending: Promise.resolve() };
      existingDebtSaves.current.set(entry.id, state);
    }
    state.entry = { ...state.entry, ...patch };
    const current = state;
    current.pending = current.pending.catch(() => {}).then(async () => {
      if (current.deleted) return;
      const value = current.entry;
      if (value.amount <= 0) { await deleteDebt.mutateAsync({ id: value.id }); current.deleted = true; return; }
      await updateDebt.mutateAsync({
        id: value.id, entryDate: timestamp, amount: value.amount,
        agentId: value.agentId, employeeId: value.employeeId, description: value.description,
      });
    }).catch(() => {});
  }

  function commitExistingAgent(entry: JournalRow, value: string) {
    const { agentId, employeeId } = payeeFromValue(value);
    if (entry.type === "memo") {
      saveExistingDebt(entry, { agentId, employeeId });
      return;
    }
    if (agentId === entry.agentId && employeeId === entry.employeeId) return;
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId, employeeId,
      description: entry.description ?? undefined,
      cashAmount: entry.cashAmount, terminalAmount: entry.terminalAmount, clickAmount: entry.clickAmount, transferAmount: entry.transferAmount,
    });
  }

  function commitExistingReason(entry: JournalRow, value: string) {
    const next = value.trim();
    if (entry.type === "memo") {
      saveExistingDebt(entry, { description: next || null });
      return;
    }
    if ((entry.description ?? "") === next) return;
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId: entry.agentId,
      description: next || undefined,
      cashAmount: entry.cashAmount, terminalAmount: entry.terminalAmount, clickAmount: entry.clickAmount, transferAmount: entry.transferAmount,
    });
  }

  function commitExistingCash(entry: JournalRow, value: string) {
    const cashAmount = Math.round(Number(value || 0));
    if (entry.type === "memo") {
      saveExistingDebt(entry, { amount: cashAmount });
      return;
    }
    if (cashAmount === entry.cashAmount) return;
    if (cashAmount + entry.terminalAmount + entry.clickAmount + entry.transferAmount <= 0) { del.mutate({ id: entry.id }); return; }
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId: entry.agentId,
      description: entry.description ?? undefined,
      cashAmount, terminalAmount: entry.terminalAmount, clickAmount: entry.clickAmount, transferAmount: entry.transferAmount,
    });
  }

  function commitExistingChannel(entry: CashEntryRow, channel: "terminal" | "click" | "transfer", value: string) {
    const amount = Math.round(Number(value || 0));
    const current = channel === "terminal" ? entry.terminalAmount : channel === "click" ? entry.clickAmount : entry.transferAmount;
    if (amount === current) return;
    const terminalAmount = channel === "terminal" ? amount : entry.terminalAmount;
    const clickAmount = channel === "click" ? amount : entry.clickAmount;
    const transferAmount = channel === "transfer" ? amount : entry.transferAmount;
    if (entry.cashAmount + terminalAmount + clickAmount + transferAmount <= 0) { del.mutate({ id: entry.id }); return; }
    update.mutate({
      id: entry.id, entryDate: timestamp, type: entry.type, category: entry.category, agentId: entry.agentId,
      description: entry.description ?? undefined,
      cashAmount: entry.cashAmount, terminalAmount, clickAmount, transferAmount,
    });
  }

  function updateDraft(index: number, patch: Partial<DraftRow>) {
    const next = draftsRef.current.map((row, i) => (i === index ? { ...row, ...patch } : row));
    draftsRef.current = next;
    setDrafts(next);
  }

  const [flushDraftRow] = useState(() => createCashDraftSaver({
    categories: CASH_COLUMNS,
    getRow: (index: number) => draftsRef.current[index],
    setEntryId: (index, category, id) => {
      const current = draftsRef.current[index];
      if (current) updateDraft(index, { entryIds: { ...current.entryIds, [category]: id } });
    },
    payload: (draft, category) => {
      const cashAmount = Math.round(Number(draft.amounts[category] || 0));
      const terminalAmount = Math.round(Number(draft.terminal || 0));
      const clickAmount = Math.round(Number(draft.click || 0));
      const transferAmount = Math.round(Number(draft.transfer || 0));
      const hasIncomeCash = INCOME_CATEGORIES.some(name => Math.round(Number(draft.amounts[name] || 0)) > 0);
      const isFallback = category === INCOME_CATEGORIES[0] && !hasIncomeCash
        && (terminalAmount > 0 || clickAmount > 0 || transferAmount > 0);
      if (cashAmount <= 0 && !isFallback) return null;
      const payee = payeeFromValue(draft.agentId);
      return {
        entryDate: timestamp, type: CATEGORY_TYPE[category], category,
        agentId: payee.agentId ?? undefined, employeeId: payee.employeeId ?? undefined,
        description: draft.reason.trim() || undefined,
        cashAmount, terminalAmount, clickAmount, transferAmount,
      };
    },
    create: payload => draftCreate.mutateAsync(payload),
    update: (id, payload) => draftUpdate.mutateAsync({ id, ...payload }),
    remove: id => draftDelete.mutateAsync({ id }),
    refresh: invalidate,
  }));

  function flushDebtRow(index: number): Promise<void> {
    // Qarz saqlash navbati pul kataklarining saqlashidan mustaqil.
    const pending = (pendingDebtSaves.current[index] ?? Promise.resolve()).catch(() => {}).then(async () => {
      const draft = draftsRef.current[index];
      if (!draft) return;
      const amount = Math.round(Number(draft.debtAmount || 0));
      if (amount <= 0) {
        if (draft.debtId) {
          await deleteDebt.mutateAsync({ id: draft.debtId });
          updateDraft(index, { debtId: null });
        }
        return;
      }
      const payload = { entryDate: timestamp, amount, ...payeeFromValue(draft.agentId), description: draft.debtReason.trim() || null };
      if (draft.debtId) await updateDebt.mutateAsync({ id: draft.debtId, ...payload });
      else {
        const result = await createDebt.mutateAsync(payload);
        updateDraft(index, { debtId: result.id });
      }
    }).catch(() => { /* Xato toast'da ko'rsatiladi; kiritilgan qiymatlar saqlanadi. */ });
    pendingDebtSaves.current[index] = pending;
    return pending;
  }

  function scheduleDebtSave(index: number) {
    if (debtSaveTimers.current[index]) clearTimeout(debtSaveTimers.current[index]);
    debtSaveTimers.current[index] = setTimeout(() => {
      delete debtSaveTimers.current[index];
      void flushDebtRow(index);
    }, 700);
  }

  /** Yozayotganda ~700ms jimlikdan keyin fonda avtomatik saqlaydi — brauzer
   * yopilsa yoki sana almashtirilsa ham, kiritilgan summa yo'qolib qolmasin. */
  function scheduleAutoSave(index: number) {
    if (autoSaveTimers.current[index]) clearTimeout(autoSaveTimers.current[index]);
    autoSaveTimers.current[index] = setTimeout(() => {
      delete autoSaveTimers.current[index];
      void flushDraftRow(index);
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
        if (debtSaveTimers.current[index]) clearTimeout(debtSaveTimers.current[index]);
        void flushDebtRow(index);
        if (autoSaveTimers.current[index]) { clearTimeout(autoSaveTimers.current[index]); delete autoSaveTimers.current[index]; }
        void flushDraftRow(index);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const TERMINAL_COL = JOURNAL_COLUMNS.length + 1;
  const CLICK_COL = JOURNAL_COLUMNS.length + 2;
  const TRANSFER_COL = JOURNAL_COLUMNS.length + 3;
  const DEBT_REASON_COL = JOURNAL_COLUMNS.length + 4;
  const REASON_COL = JOURNAL_COLUMNS.length + 5;
  const totalJournalRows = groupedEntries.length + drafts.length;

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
   * Qator saqlangandan keyin bo'shatilmaydi, yozilgan
   * qiymatlar aynan o'sha katakda qolaveradi (yuqoriga "sakramaydi").
   */
  function commitDraftRow(index: number, event: React.FocusEvent<HTMLTableRowElement>) {
    if ((event.target as HTMLElement).closest("[data-debt-cell]")) {
      if (debtSaveTimers.current[index]) { clearTimeout(debtSaveTimers.current[index]); delete debtSaveTimers.current[index]; }
      void flushDebtRow(index);
      return;
    }
    const rowEl = event.currentTarget;
    window.setTimeout(() => {
      if (rowEl.contains(document.activeElement)) return;
      if (autoSaveTimers.current[index]) { clearTimeout(autoSaveTimers.current[index]); delete autoSaveTimers.current[index]; }
      void flushDraftRow(index);
    }, 0);
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-border">
      {debtEntries.isError && <div role="alert" className="px-3 py-2 text-sm text-destructive">Qarz qaydlarini yuklab bo‘lmadi. <button type="button" className="underline" onClick={() => debtEntries.refetch()}>Qayta urinish</button></div>}
      <table className="w-full min-w-[1320px] text-sm">
        <thead>
          <tr className="border-b border-border bg-muted text-xs font-semibold tracking-wide text-muted-foreground">
            <th className="whitespace-nowrap px-3 py-2.5 text-left">Агент</th>
            {JOURNAL_COLUMNS.map(name => <th key={name} title={name === DEBT_COLUMN ? "Faqat qayd — kassa qoldig‘iga ta’sir qilmaydi" : undefined} className={`whitespace-nowrap px-3 py-2.5 text-right ${name === HIGHLIGHT_CATEGORY ? "bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" : ""}`}>{name}</th>)}
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Терминал</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Click</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-right">Перечисление</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left">Qarz izohi</th>
            <th className="whitespace-nowrap px-3 py-2.5 text-left">Izoh</th>
            <th className="w-11" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          <tr className="border-b-2 border-sky-100 bg-sky-50/70 text-xs font-bold text-sky-900">
            <td colSpan={REASON_COL} className="px-3 py-2">Boshlang'ich qoldiq (naqd)</td>
            <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{formatMoney(openingBalance)}</td>
            <td />
          </tr>
          {groupedEntries.map((group, rowIndex) => {
            const entry = group.entries[0];
            if (group.entries.length > 1) {
              const payeeName = entry.employeeName ?? entry.agentName ?? "Agent";
              const cashEntries = group.entries.filter((item): item is CashEntryRow => item.type !== "memo");
              const numberInput = (item: JournalRow, field: "amount" | "terminal" | "click" | "transfer", col?: number) => {
                const value = field === "amount" ? (item.type === "memo" ? item.amount : item.cashAmount)
                  : item[`${field}Amount`];
                return <input
                  key={`${journalRowKey(item)}-${field}-${value}`}
                  type="text" inputMode="numeric" defaultValue={String(value)}
                  aria-label={`${item.category} — ${field === "amount" ? "summa" : field} #${item.id}`}
                  data-journal-cell={col == null ? undefined : `${rowIndex}-${col}`}
                  className={`${field === "amount" && item.category === HIGHLIGHT_CATEGORY ? cellInputClassHighlight : cellInputClass} font-semibold`}
                  onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                  onBlur={event => field === "amount" ? commitExistingCash(item, event.target.value)
                    : item.type !== "memo" && commitExistingChannel(item, field, event.target.value)}
                  onKeyDown={event => {
                    if (col != null) onAmountKeyDown(event, rowIndex, col);
                    else if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
                  }}
                />;
              };
              const amountCell = (items: JournalRow[], field: "amount" | "terminal" | "click" | "transfer", title: string, col: number) => {
                if (!items.length) return <span className={emptyCellClass}>—</span>;
                if (items.length === 1) return numberInput(items[0], field, col);
                return <JournalDetails title={`${payeeName} · ${title}`} trigger={
                  <button type="button" data-journal-cell={`${rowIndex}-${col}`}
                    aria-label={`${title}: ${items.length} ta yozuvni ko‘rish`}
                    className={`${title === HIGHLIGHT_CATEGORY ? cellInputClassHighlight : cellInputClass} font-semibold underline decoration-dotted underline-offset-4`}>
                    {journalCellTotal(items, field === "amount" ? "amount" : `${field}Amount`).toLocaleString("en-US")}
                  </button>
                }>
                  {items.map(item => <div key={journalRowKey(item)} className="space-y-1">
                    <label className="block text-xs text-muted-foreground">{item.category} · #{item.id}</label>
                    {numberInput(item, field)}
                    {item.description && <p className="whitespace-pre-wrap break-words text-xs">{item.description}</p>}
                  </div>)}
                </JournalDetails>;
              };
              const notesCell = (type: "cash" | "memo", title: string, col: number) => {
                const items = group.entries.filter(item => type === "memo" ? item.type === "memo" : item.type !== "memo");
                if (!items.length) return <span className={emptyCellClassLeft}>—</span>;
                return <JournalDetails title={`${payeeName} · ${title}`} trigger={
                  <button type="button" data-journal-cell={`${rowIndex}-${col}`}
                    className={`${textInputClass} block max-w-[180px] truncate text-left`} aria-label={`${title} — to‘liq izoh`}>
                    {items.map(item => item.description).filter(Boolean).join("; ") || title}
                  </button>
                }>
                  {items.map(item => <div key={journalRowKey(item)} className="space-y-2 border-b border-border pb-3 last:border-0">
                    <span className="text-xs text-muted-foreground">{item.category} · #{item.id} · {formatMoney(item.type === "memo" ? item.amount : item.cashAmount)}</span>
                    <p className="whitespace-pre-wrap break-words text-sm [overflow-wrap:anywhere]">{item.description || "Izoh kiritilmagan."}</p>
                    <details>
                      <summary className="cursor-pointer text-xs text-primary">Izohni tahrirlash</summary>
                      <textarea key={`${journalRowKey(item)}-${item.description}`} rows={3}
                        aria-label={`${title} #${item.id}`} defaultValue={item.description ?? ""}
                        maxLength={1000} className={`${textInputClass} mt-2 resize-y whitespace-pre-wrap`}
                        onBlur={event => commitExistingReason(item, event.target.value)} />
                    </details>
                  </div>)}
                </JournalDetails>;
              };
              const manageEntries = <JournalDetails title={`${payeeName} · yozuvlar`} trigger={
                <button type="button" aria-label={`${payeeName} yozuvlarini tahrirlash`} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"><ChevronDown className="size-4" /></button>
              }>
                {group.entries.map(item => <div key={journalRowKey(item)} className="space-y-2 rounded-lg border border-border p-2">
                  <p className="text-xs font-medium">{item.category} · #{item.id} · {formatMoney(item.type === "memo" ? item.amount : item.cashAmount)}</p>
                  <div className="flex items-center gap-2">
                    <select key={`${journalRowKey(item)}-${payeeToValue(item)}`} defaultValue={payeeToValue(item)}
                      aria-label={`Yozuv agenti #${item.id}`} className={selectInputClass}
                      onChange={event => commitExistingAgent(item, event.target.value)}>
                      <option value="">Агент tanlanmagan</option>
                      <optgroup label="Агентлар">{agentOptions.map(agent => <option key={agent.id} value={`a:${agent.id}`}>{agent.name}</option>)}</optgroup>
                      {employeeOptions.length > 0 && <optgroup label="Ходимлар">{employeeOptions.map(employee => <option key={employee.id} value={`e:${employee.id}`}>{employee.name}</option>)}</optgroup>}
                    </select>
                    <button type="button" aria-label={`${item.category} #${item.id} — o‘chirish`}
                      className="shrink-0 rounded p-2 text-destructive hover:bg-destructive/10"
                      onClick={() => item.type === "memo" ? saveExistingDebt(item, { amount: 0 }) : del.mutate({ id: item.id })}><Trash2 className="size-4" /></button>
                  </div>
                </div>)}
              </JournalDetails>;
              return <tr key={group.key} className="text-xs even:bg-muted/40">
                <td className="px-3 py-2 font-medium"><span tabIndex={0} data-journal-cell={`${rowIndex}-0`} className="block min-w-[110px]"
                  onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, 0, 1, 0); } }}>{payeeName}</span></td>
                {JOURNAL_COLUMNS.map((name, index) => <td key={name} className={`px-1.5 py-1 ${name === HIGHLIGHT_CATEGORY ? "bg-rose-50/40 dark:bg-rose-500/8" : ""}`}>
                  {amountCell(group.entries.filter(item => item.category === name), "amount", name, index + 1)}
                </td>)}
                <td className="px-1.5 py-1">{amountCell(cashEntries, "terminal", "Терминал", TERMINAL_COL)}</td>
                <td className="px-1.5 py-1">{amountCell(cashEntries, "click", "Click", CLICK_COL)}</td>
                <td className="px-1.5 py-1">{amountCell(cashEntries, "transfer", "Перечисление", TRANSFER_COL)}</td>
                <td className="px-1.5 py-1">{notesCell("memo", "Qarz izohi", DEBT_REASON_COL)}</td>
                <td className="px-1.5 py-1">{notesCell("cash", "Izoh", REASON_COL)}</td>
                <td className="px-1 py-1">{manageEntries}</td>
              </tr>;
            }
            return (
              <tr key={journalRowKey(entry)} className="text-xs even:bg-muted/40">
                <td className="px-1.5 py-1">
                  <div>
                    <select
                      key={`agent-${entry.id}-${entry.agentId ?? ""}-${entry.employeeId ?? ""}`}
                      data-journal-cell={`${rowIndex}-0`}
                      defaultValue={payeeToValue(entry)}
                      className={selectInputClass}
                      onChange={event => commitExistingAgent(entry, event.target.value)}
                      onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, 0, 1, 0); } }}
                    >
                      <option value="">Агент tanlanmagan</option>
                      <optgroup label="Агентлар">
                        {agentOptions.map(agent => <option key={`a-${agent.id}`} value={`a:${agent.id}`}>{agent.name}</option>)}
                      </optgroup>
                      {/* Oylik oladigan xodimlar — "Ойлик" rasxodi kimga berilganini
                          shu yerda belgilanadi (agentlar foiz oladi, ular yuqorida). */}
                      {employeeOptions.length > 0 && (
                        <optgroup label="Ходимлар">
                          {employeeOptions.map(employee => <option key={`e-${employee.id}`} value={`e:${employee.id}`}>{employee.name}</option>)}
                        </optgroup>
                      )}
                    </select>
                    {entry.type !== "memo" && entry.agentId == null && entry.employeeId == null && entry.description ? (
                      <p className="truncate px-1.5 pt-0.5 text-[10px] text-muted-foreground">{entry.description}</p>
                    ) : null}
                  </div>
                </td>
                {JOURNAL_COLUMNS.map((name, colOffset) => (
                  <td key={name} className={`px-1.5 py-1 ${name === HIGHLIGHT_CATEGORY ? "bg-rose-50/40 dark:bg-rose-500/8" : ""}`}>
                    {entry.category === name ? (
                      <input
                        key={entry.type === "memo" ? journalRowKey(entry) : `cash-${entry.id}-${entry.cashAmount}`}
                        type="text" inputMode="numeric"
                        aria-label={entry.type === "memo" ? "Qarz summasi" : undefined}
                        data-journal-cell={`${rowIndex}-${colOffset + 1}`}
                        defaultValue={String(entry.type === "memo" ? entry.amount : entry.cashAmount)}
                        className={`${name === HIGHLIGHT_CATEGORY ? cellInputClassHighlight : cellInputClass} font-semibold text-foreground`}
                        onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                        onBlur={event => commitExistingCash(entry, event.target.value)}
                        onKeyDown={event => onAmountKeyDown(event, rowIndex, colOffset + 1)}
                      />
                    ) : <span className={emptyCellClass}>—</span>}
                  </td>
                ))}
                <td className="px-1.5 py-1">
                  {entry.type === "memo" ? <span className={emptyCellClass}>—</span> : <input
                    key={`terminal-${entry.id}-${entry.terminalAmount}`}
                    type="text" inputMode="numeric"
                    data-journal-cell={`${rowIndex}-${TERMINAL_COL}`}
                    defaultValue={entry.terminalAmount ? String(entry.terminalAmount) : ""}
                    placeholder="0"
                    className={cellInputClass}
                    onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                    onBlur={event => commitExistingChannel(entry, "terminal", event.target.value)}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, TERMINAL_COL)}
                  />}
                </td>
                <td className="px-1.5 py-1">
                  {entry.type === "memo" ? <span className={emptyCellClass}>—</span> : <input
                    key={`click-${entry.id}-${entry.clickAmount}`}
                    type="text" inputMode="numeric"
                    data-journal-cell={`${rowIndex}-${CLICK_COL}`}
                    defaultValue={entry.clickAmount ? String(entry.clickAmount) : ""}
                    placeholder="0"
                    className={cellInputClass}
                    onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                    onBlur={event => commitExistingChannel(entry, "click", event.target.value)}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, CLICK_COL)}
                  />}
                </td>
                <td className="px-1.5 py-1">
                  {entry.type === "memo" ? <span className={emptyCellClass}>—</span> : <input
                    key={`transfer-${entry.id}-${entry.transferAmount}`}
                    type="text" inputMode="numeric"
                    data-journal-cell={`${rowIndex}-${TRANSFER_COL}`}
                    defaultValue={entry.transferAmount ? String(entry.transferAmount) : ""}
                    placeholder="0"
                    className={cellInputClass}
                    onChange={event => { event.target.value = sanitizeIntegerInput(event.target.value); }}
                    onBlur={event => commitExistingChannel(entry, "transfer", event.target.value)}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, TRANSFER_COL)}
                  />}
                </td>
                <td className="px-1.5 py-1">
                  {entry.type === "memo" ? <input
                    key={`debt-reason-${entry.id}`}
                    data-journal-cell={`${rowIndex}-${DEBT_REASON_COL}`}
                    defaultValue={entry.description ?? ""}
                    placeholder="Qarz kimga berilgan?"
                    aria-label="Qarz kimga berilgan — izoh"
                    maxLength={1000}
                    className={textInputClass}
                    onBlur={event => commitExistingReason(entry, event.target.value)}
                    onKeyDown={event => onAmountKeyDown(event, rowIndex, DEBT_REASON_COL)}
                  /> : <span className={emptyCellClassLeft}>—</span>}
                </td>
                <td className="px-1.5 py-1">
                  {entry.type !== "memo" ? (
                    <ExpandableJournalNote>
                    <input
                      key={`reason-${entry.id}-${entry.description ?? ""}`}
                      data-journal-cell={`${rowIndex}-${REASON_COL}`}
                      defaultValue={entry.description ?? ""}
                      placeholder="Izoh"
                      aria-label="Izoh"
                      maxLength={1000}
                      className={textInputClass}
                      onBlur={event => commitExistingReason(entry, event.target.value)}
                      onKeyDown={event => {
                        if (event.key !== "Enter") return;
                        event.preventDefault();
                        event.currentTarget.blur();
                        focusJournalCell(rowIndex, REASON_COL, 1, 0);
                      }}
                    />
                    </ExpandableJournalNote>
                  ) : <span className={emptyCellClassLeft}>—</span>}
                </td>
                <td className="px-1 py-1 text-right">
                  <button
                    type="button"
                    aria-label="O'chirish"
                    className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-rose-50 hover:text-rose-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
                    onClick={() => entry.type === "memo" ? saveExistingDebt(entry, { amount: 0 }) : del.mutate({ id: entry.id })}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
          {drafts.map((draft, index) => {
            const rowIndex = groupedEntries.length + index;
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
                  onChange={event => { updateDraft(index, { agentId: event.target.value }); scheduleAutoSave(index); scheduleDebtSave(index); }}
                  onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, 0, 1, 0); } }}
                >
                  <option value="">Агент tanlang</option>
                  <optgroup label="Агентлар">
                    {agentList.map(agent => <option key={`a-${agent.id}`} value={`a:${agent.id}`}>{agent.name}</option>)}
                  </optgroup>
                  {employeeOptions.length > 0 && (
                    <optgroup label="Ходимлар">
                      {employeeOptions.map(employee => (
                        <option key={`e-${employee.id}`} value={`e:${employee.id}`}>{employee.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </td>
              {JOURNAL_COLUMNS.map((name, colOffset) => (
                <td key={name} data-debt-cell={name === DEBT_COLUMN ? "true" : undefined} className={`px-1.5 py-1 ${name === HIGHLIGHT_CATEGORY ? "bg-rose-50/40 dark:bg-rose-500/8" : ""}`}>
                  <input
                    type="text" inputMode="numeric"
                    aria-label={name === DEBT_COLUMN ? "Qarz summasi" : undefined}
                    data-journal-cell={`${rowIndex}-${colOffset + 1}`}
                    value={name === DEBT_COLUMN ? draft.debtAmount : draft.amounts[name]}
                    placeholder="0"
                    className={`${name === HIGHLIGHT_CATEGORY ? cellInputClassHighlight : cellInputClass} text-muted-foreground`}
                    onChange={event => {
                      if (name === DEBT_COLUMN) {
                        updateDraft(index, { debtAmount: sanitizeIntegerInput(event.target.value) }); scheduleDebtSave(index);
                      } else {
                        updateDraft(index, { amounts: { ...draft.amounts, [name]: sanitizeIntegerInput(event.target.value) } }); scheduleAutoSave(index);
                      }
                    }}
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
                  type="text" inputMode="numeric"
                  data-journal-cell={`${rowIndex}-${TRANSFER_COL}`}
                  value={draft.transfer}
                  placeholder="0"
                  className={`${cellInputClass} text-muted-foreground`}
                  onChange={event => { updateDraft(index, { transfer: sanitizeIntegerInput(event.target.value) }); scheduleAutoSave(index); }}
                  onKeyDown={event => onAmountKeyDown(event, rowIndex, TRANSFER_COL)}
                />
              </td>
              <td className="px-1.5 py-1" data-debt-cell="true">
                <input
                  value={draft.debtReason}
                  data-journal-cell={`${rowIndex}-${DEBT_REASON_COL}`}
                  placeholder="Qarz kimga berilgan?"
                  aria-label="Qarz kimga berilgan — izoh"
                  maxLength={1000}
                  className={textInputClass}
                  onChange={event => { updateDraft(index, { debtReason: event.target.value }); scheduleDebtSave(index); }}
                  onKeyDown={event => onAmountKeyDown(event, rowIndex, DEBT_REASON_COL)}
                />
              </td>
              <td className="px-1.5 py-1">
                <ExpandableJournalNote>
                <input
                  value={draft.reason}
                  data-journal-cell={`${rowIndex}-${REASON_COL}`}
                  placeholder="Izoh"
                  aria-label="Izoh"
                  maxLength={1000}
                  className={textInputClass}
                  onChange={event => { updateDraft(index, { reason: event.target.value }); scheduleAutoSave(index); }}
                  onKeyDown={event => {
                    if (event.key === "Enter") { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, 1, 0); return; }
                    if (event.key === "ArrowLeft" && event.currentTarget.selectionStart === 0) { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, 0, -1); return; }
                    if (event.key === "ArrowUp") { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, -1, 0); return; }
                    if (event.key === "ArrowDown") { event.preventDefault(); focusJournalCell(rowIndex, REASON_COL, 1, 0); }
                  }}
                />
                </ExpandableJournalNote>
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
            <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(transferTotal)}</td>
            <td colSpan={3} />
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

/** Excel'dagi Агент x Товар matritsasi: har ustun - agent, har qator - mahsulot, pastda Умумий/Касса/Разница.
 * O'z sanasini alohida boshqaradi — "Kunlik jurnal"dagi sanadan mustaqil, chunki ba'zida
 * boshqa kundagi agent-tovar taqsimotini ko'rish kerak bo'ladi, jurnalni almashtirmasdan. */
function AgentProductMatrix() {
  const [date, setDate] = useState(today());
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

  /** Faolsizlantirilgan agentning shu kundagi haqiqiy yozuvlari (tovar olib ketgani,
   * kassaga topshirgani) bo'lsa, uning ustuni butunlay ko'rinmay qolmasligi uchun —
   * agentList faqat faol agentlarni o'z ichiga oladi, lekin daySummary.agentSummaries
   * (Приход кег/пет va tovar olish yozuvlaridan) faollik holatidan qat'i nazar keladi. */
  const historicalAgents = useMemo(() => {
    const known = new Set(agentList.map(agent => agent.id));
    return (daySummary.data?.agentSummaries ?? [])
      .filter((row): row is typeof row & { agentId: number } => row.agentId !== null && !known.has(row.agentId))
      .map(row => ({ id: row.agentId, name: row.agentName }));
  }, [agentList, daySummary.data]);

  /** null = hammasi ko'rsatiladi (standart holat); tanlash boshlangandan keyin aniq to'plamga aylanadi. */
  const [selectedAgentIds, setSelectedAgentIds] = useState<Set<number> | null>(null);
  const visibleAgents = [
    ...(selectedAgentIds === null ? agentList : agentList.filter(agent => selectedAgentIds.has(agent.id))),
    ...historicalAgents,
  ];
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

  const header = (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><Users className="size-4 text-primary" /><h3 className="text-sm font-bold text-foreground">Агент x Товар</h3></div>
        <p className="mt-1 text-xs text-muted-foreground">Tab yoki ←/→ — qo‘shni katak, Enter/↑/↓ — shu ustunda keyingi/oldingi mahsulot.</p>
      </div>
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
  );

  if (agents.isLoading || products.isLoading) return <div>{header}<p className="p-4 text-xs text-muted-foreground">Yuklanmoqda...</p></div>;
  if (visibleAgents.length === 0) return <div>{header}<p className="p-4 text-xs text-muted-foreground">Faol agentlar topilmadi.</p></div>;
  if (productList.length === 0) return <div>{header}<p className="p-4 text-xs text-muted-foreground">Mahsulotlar topilmadi.</p></div>;

  const summaryByAgent = new Map((daySummary.data?.agentSummaries ?? []).map(row => [row.agentId, row]));

  return (
    <div>
      {header}
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
  const [showEmployees, setShowEmployees] = useState(readShowEmployees);
  function toggleShowEmployees() {
    setShowEmployees(prev => {
      const next = !prev;
      window.localStorage.setItem(SHOW_EMPLOYEES_KEY, next ? "1" : "0");
      return next;
    });
  }
  const timestamp = dateToTimestamp(date);
  const daySummary = trpc.kassa.daySummary.useQuery({ date: timestamp });
  const prihodEntries = trpc.cash.byDate.useQuery({ date: timestamp });

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
            <Button
              type="button" variant="outline" size="sm"
              className={`h-8 text-xs font-semibold ${showEmployees ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15" : "bg-card"}`}
              aria-pressed={showEmployees}
              title={showEmployees ? "Ходимларни рўйхатдан яшириш" : "Ходимларни рўйхатда кўрсатиш"}
              onClick={toggleShowEmployees}
            >
              <Users className="mr-1.5 size-3.5" />
              Ходимлар
            </Button>
          </div>
        </div>
        <DailyJournalGrid
          key={date}
          entries={allEntries}
          date={date}
          showEmployees={showEmployees}
          onChanged={() => prihodEntries.refetch()}
        />
      </div>

      <div className="mt-5 rounded-2xl border border-border bg-card p-5">
        <AgentProductMatrix />
      </div>
    </div>
  );
}
