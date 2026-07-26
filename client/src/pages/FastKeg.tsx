import { useAuth } from "@/_core/hooks/useAuth";
import { PageHeader, QueryError, SectionCard } from "@/components/finance-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/lib/format";
import { trpc } from "@/lib/trpc";
import { calculateFastKegRow, summarizeFastKegRows, type FastKegQuantities } from "../../../shared/fastKeg";
import {
  AlertTriangle,
  Banknote,
  Boxes,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  Eraser,
  Loader2,
  PackageCheck,
  RotateCcw,
  Save,
  Search,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type EntryValue = {
  keg30: string;
  keg50: string;
  returned30: string;
  returned50: string;
  cash: string;
  terminal: string;
  transfer: string;
};

type SaveFeedback = {
  kind: "success" | "error";
  title: string;
  detail: string;
  clients?: Array<{
    name: string;
    code?: string;
    saleAmount?: number;
    cash?: number;
    terminal?: number;
    transfer?: number;
    endingDebt?: number;
    endingKeg30Balance?: number;
    endingKeg50Balance?: number;
    reason?: string;
  }>;
};

const EMPTY_ENTRY: EntryValue = { keg30: "", keg50: "", returned30: "", returned50: "", cash: "", terminal: "", transfer: "" };

function createIdempotencyKey() {
  return `fk_${crypto.randomUUID().replaceAll("-", "")}`;
}

function inputDateValue(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function numeric(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : 0;
}

function quantitiesOf(value: EntryValue): FastKegQuantities {
  return {
    keg30: numeric(value.keg30),
    keg50: numeric(value.keg50),
    returned30: numeric(value.returned30),
    returned50: numeric(value.returned50),
    cash: numeric(value.cash),
    terminal: numeric(value.terminal),
    transfer: numeric(value.transfer),
  };
}

function hasValue(value: EntryValue) {
  const row = quantitiesOf(value);
  return row.keg30 + row.keg50 + row.returned30 + row.returned50 + row.cash + row.terminal + row.transfer > 0;
}

const entryFields: Array<{ key: keyof EntryValue; label: string; tone: string }> = [
  { key: "keg30", label: "KEG 30", tone: "focus-visible:ring-amber-400 bg-amber-50/55" },
  { key: "keg50", label: "KEG 50", tone: "focus-visible:ring-cyan-400 bg-cyan-50/55" },
  { key: "returned30", label: "Tara 30 qaytdi", tone: "focus-visible:ring-emerald-400 bg-emerald-50/55" },
  { key: "returned50", label: "Tara 50 qaytdi", tone: "focus-visible:ring-teal-400 bg-teal-50/55" },
  { key: "cash", label: "Наличные", tone: "focus-visible:ring-violet-400 bg-violet-50/55" },
  { key: "terminal", label: "Терминаль", tone: "focus-visible:ring-fuchsia-400 bg-fuchsia-50/55" },
  { key: "transfer", label: "Перечисление", tone: "focus-visible:ring-sky-400 bg-sky-50/55" },
];

export default function FastKeg() {
  const utils = trpc.useUtils();
  const { user } = useAuth();
  const isAgentRole = user?.role === "agent";
  const [agentId, setAgentId] = useState<number | null>(null);
  const [transactionDate, setTransactionDate] = useState(() => inputDateValue());
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const clientPickerRef = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Record<number, EntryValue>>({});
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);

  const setup = trpc.fastKeg.setup.useQuery();
  const clients = trpc.fastKeg.clientsByAgent.useQuery(
    { agentId: agentId ?? 1 },
    { enabled: Boolean(agentId) },
  );
  const draftInput = useMemo(
    () => ({ agentId: agentId ?? 1, clientIds: selectedIds.length > 0 ? selectedIds : [1] }),
    [agentId, selectedIds],
  );
  const draft = trpc.fastKeg.selectedDraft.useQuery(draftInput, {
    enabled: Boolean(agentId) && selectedIds.length > 0,
  });

  useEffect(() => {
    setSelectedIds([]);
    setEntries({});
    setSearch("");
    setSaveFeedback(null);
    setIdempotencyKey(createIdempotencyKey());
  }, [agentId]);

  useEffect(() => {
    if (isAgentRole && user?.agentId && agentId !== user.agentId) setAgentId(user.agentId);
  }, [isAgentRole, user?.agentId, agentId]);

  useEffect(() => {
    if (!clientPickerOpen) return;
    function handleOutsideClick(event: MouseEvent) {
      if (clientPickerRef.current && !clientPickerRef.current.contains(event.target as Node)) setClientPickerOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setClientPickerOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [clientPickerOpen]);

  const saveBatch = trpc.fastKeg.saveBatch.useMutation({
    onSuccess: async result => {
      if (result.duplicate) {
        toast.info(result.message);
        setSaveFeedback({
          kind: "success",
          title: "Ushbu to‘plam avval saqlangan",
          detail: `${result.message} Ma’lumotlar ikkinchi marta yozilmadi.`,
        });
      } else {
        toast.success(result.message);
        setSaveFeedback({
          kind: "success",
          title: "Tezkor KEG amallari saqlandi",
          detail: `${result.message} Barcha qatorlar bitta atomik operatsiyada yozildi.`,
          clients: result.rows.map(row => ({
            name: row.clientName,
            code: row.clientCode,
            saleAmount: row.saleAmount,
            cash: row.cash,
            terminal: row.terminal,
            transfer: row.transfer,
            endingDebt: row.endingDebt,
            endingKeg30Balance: row.endingKeg30Balance,
            endingKeg50Balance: row.endingKeg50Balance,
          })),
        });
      }
      setSelectedIds([]);
      setEntries({});
      setIdempotencyKey(createIdempotencyKey());
      await Promise.all([
        utils.fastKeg.clientsByAgent.invalidate(),
        utils.dashboard.invalidate(),
        utils.debts.invalidate(),
        utils.transactions.invalidate(),
        utils.containers.invalidate(),
      ]);
    },
    onError: error => {
      const detail = error.message || "KEG operatsiyalarini saqlab bo‘lmadi.";
      const failedClientName = detail.match(/^([^:]+):/)?.[1]?.trim();
      toast.error(detail);
      setSaveFeedback({
        kind: "error",
        title: "Hech bir qator saqlanmadi",
        detail: `${detail} To‘plam atomik bo‘lgani uchun boshqa mijozlar ma’lumotlari ham yozilmadi.`,
        clients: failedClientName
          ? [{ name: failedClientName, reason: detail }]
          : undefined,
      });
    },
  });

  const filteredClients = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("uz-Latn");
    if (!needle) return clients.data ?? [];
    return (clients.data ?? []).filter(client =>
      `${client.code} ${client.name} ${client.phone ?? ""}`.toLocaleLowerCase("uz-Latn").includes(needle),
    );
  }, [clients.data, search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const draftRows = draft.data ?? [];
  const keg30Product = setup.data?.products.keg30;
  const keg50Product = setup.data?.products.keg50;
  const pricingReady = Boolean(keg30Product && keg50Product);
  const pricing = {
    keg30Price: keg30Product?.price ?? 0,
    keg50Price: keg50Product?.price ?? 0,
    keg30UnitsPerItem: keg30Product?.unitsPerItem ?? 1,
    keg50UnitsPerItem: keg50Product?.unitsPerItem ?? 1,
  };

  const computedRows = draftRows.map(client => {
    const input = entries[client.id] ?? EMPTY_ENTRY;
    const quantities = quantitiesOf(input);
    const calculated = calculateFastKegRow(
      quantities,
      {
        currentDebt: client.currentDebt,
        currentKeg30Balance: client.keg30Balance,
        currentKeg50Balance: client.keg50Balance,
      },
      pricing,
    );
    return { client, input, quantities, ...calculated };
  });

  const activeComputedRows = computedRows.filter(row => hasValue(row.input));
  const summary = summarizeFastKegRows(
    computedRows.map(row => ({ ...row.quantities, saleAmount: row.saleAmount, endingDebt: row.endingDebt })),
  );
  const endingKeg30Total = computedRows.reduce((total, row) => total + row.endingKeg30Balance, 0);
  const endingKeg50Total = computedRows.reduce((total, row) => total + row.endingKeg50Balance, 0);
  const netKeg30Total = computedRows.reduce((total, row) => total + row.netKeg30, 0);
  const netKeg50Total = computedRows.reduce((total, row) => total + row.netKeg50, 0);
  const invalidRows = activeComputedRows.filter(
    row =>
      row.endingKeg30Balance < 0 ||
      row.endingKeg50Balance < 0 ||
      row.endingDebt < 0 ||
      ((row.quantities.keg30 > 0 || row.quantities.returned30 > 0) && !keg30Product) ||
      ((row.quantities.keg50 > 0 || row.quantities.returned50 > 0) && !keg50Product) ||
      (row.quantities.keg30 > 0 && Number(keg30Product?.price ?? 0) <= 0) ||
      (row.quantities.keg50 > 0 && Number(keg50Product?.price ?? 0) <= 0),
  );

  function validationReason(row: (typeof computedRows)[number]) {
    const reasons: string[] = [];
    if (row.endingKeg30Balance < 0) reasons.push("KEG 30 qaytishi mavjud qoldiqdan oshgan");
    if (row.endingKeg50Balance < 0) reasons.push("KEG 50 qaytishi mavjud qoldiqdan oshgan");
    if (row.endingDebt < 0) reasons.push("kassa qarz va yangi savdo yig‘indisidan oshgan");
    if ((row.quantities.keg30 > 0 || row.quantities.returned30 > 0) && !keg30Product) reasons.push("KEG 30 mahsulot sozlamasi topilmagan");
    if ((row.quantities.keg50 > 0 || row.quantities.returned50 > 0) && !keg50Product) reasons.push("KEG 50 mahsulot sozlamasi topilmagan");
    if (row.quantities.keg30 > 0 && Number(keg30Product?.price ?? 0) <= 0) reasons.push("KEG 30 narxi topilmagan");
    if (row.quantities.keg50 > 0 && Number(keg50Product?.price ?? 0) <= 0) reasons.push("KEG 50 narxi topilmagan");
    return reasons.join("; ");
  }

  function toggleClient(clientId: number) {
    setSelectedIds(current =>
      current.includes(clientId) ? current.filter(id => id !== clientId) : [...current, clientId],
    );
    setEntries(current => ({ ...current, [clientId]: current[clientId] ?? { ...EMPTY_ENTRY } }));
  }

  function toggleVisibleClients() {
    const visibleIds = filteredClients.map(client => client.id);
    const allSelected = visibleIds.length > 0 && visibleIds.every(id => selectedSet.has(id));
    if (allSelected) {
      setSelectedIds(current => current.filter(id => !visibleIds.includes(id)));
      return;
    }
    setSelectedIds(current => [...current, ...visibleIds.filter(id => !current.includes(id))]);
    setEntries(current => {
      const next = { ...current };
      for (const id of visibleIds) next[id] ??= { ...EMPTY_ENTRY };
      return next;
    });
  }

  function updateEntry(clientId: number, key: keyof EntryValue, value: string) {
    const safeValue = value.replace(/[^0-9]/g, "");
    setEntries(current => ({
      ...current,
      [clientId]: { ...(current[clientId] ?? EMPTY_ENTRY), [key]: safeValue },
    }));
  }

  function clearEntry(clientId: number) {
    setEntries(current => ({ ...current, [clientId]: { ...EMPTY_ENTRY } }));
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number) {
    if (!["Enter", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
    let targetRow = rowIndex;
    let targetColumn = columnIndex;
    if (event.key === "ArrowUp") targetRow -= 1;
    else if (event.key === "ArrowDown" || event.key === "Enter") targetRow += 1;
    else if (event.key === "ArrowLeft") targetColumn -= 1;
    else if (event.key === "ArrowRight") targetColumn += 1;
    if (targetColumn < 0 || targetColumn >= entryFields.length) return;
    event.preventDefault();
    const target = document.querySelector<HTMLInputElement>(
      `[data-fast-keg-cell="${targetRow}-${targetColumn}"]`,
    );
    target?.focus();
    target?.select();
  }

  function submitBatch() {
    if (!agentId) return toast.error("Avval agentni tanlang.");
    if (activeComputedRows.length === 0) return toast.error("Kamida bitta mijoz qatoriga qiymat kiriting.");
    if (invalidRows.length > 0) {
      const detail = "Qizil qatorlarda ortiqcha tara qaytarish, manfiy qarz yoki narxi topilmagan KEG bor.";
      setSaveFeedback({
        kind: "error",
        title: "Jadvaldagi xatolarni tuzating",
        detail: `${detail} Saqlash boshlanmadi va hech bir mijoz ma’lumoti yozilmadi.`,
        clients: invalidRows.map(row => ({
          name: row.client.name,
          code: row.client.code,
          reason: validationReason(row),
        })),
      });
      return toast.error(detail);
    }
    saveBatch.mutate({
      idempotencyKey,
      transactionDate: new Date(`${transactionDate}T00:00:00.000Z`).getTime(),
      agentId,
      rows: activeComputedRows.map(row => ({ clientId: row.client.id, ...row.quantities })),
    });
  }

  if (setup.isError) {
    return <QueryError description={setup.error.message} onRetry={() => setup.refetch()} />;
  }

  return (
    <div className="mx-auto max-w-[1880px]">
      <PageHeader
        eyebrow="Tezkor ommaviy kiritish"
        title="Tezkor KEG savdosi"
        description="Agent mijozlarini bir marta tanlang — KEG, tara va kassani ketma-ket kiriting; savdo, qoldiq tara va qarzni tizim avtomatik hisoblaydi."
        action={
          <Button
            onClick={submitBatch}
            disabled={saveBatch.isPending || activeComputedRows.length === 0 || invalidRows.length > 0}
            className="h-11 rounded-xl bg-gradient-to-r from-cyan-700 to-emerald-600 px-5 shadow-lg shadow-cyan-950/10"
          >
            {saveBatch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {activeComputedRows.length} ta qatorni saqlash
          </Button>
        }
      />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="KEG 30 qoldig‘i" value={`${endingKeg30Total} dona`} helper={`O‘zgarish: ${netKeg30Total >= 0 ? "+" : ""}${netKeg30Total} • sotildi: ${summary.keg30}`} icon={PackageCheck} tone="amber" />
        <SummaryCard label="KEG 50 qoldig‘i" value={`${endingKeg50Total} dona`} helper={`O‘zgarish: ${netKeg50Total >= 0 ? "+" : ""}${netKeg50Total} • sotildi: ${summary.keg50}`} icon={RotateCcw} tone="green" />
        <SummaryCard label="Jami to‘lov" value={formatMoney(summary.cash + summary.terminal + summary.transfer)} helper={`Наличные: ${formatMoney(summary.cash)} • Терминаль: ${formatMoney(summary.terminal)} • Перечисление: ${formatMoney(summary.transfer)}`} icon={Banknote} tone="violet" />
        <SummaryCard label="Yakuniy qarzlar" value={formatMoney(summary.endingDebt)} helper={`${selectedIds.length} ta mijoz bo‘yicha`} icon={CircleDollarSign} tone="rose" />
      </div>

      {!pricingReady && !setup.isLoading ? (
        <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <strong>KEG mahsulot sozlamasi to‘liq emas.</strong> Mahsulotlar bo‘limida KEG 30 va KEG 50 turini hamda narxini belgilang.
        </div>
      ) : null}

      {saveFeedback ? (
        <div
          className={`mb-5 rounded-2xl border px-4 py-3 shadow-sm ${
            saveFeedback.kind === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-950"
              : "border-rose-200 bg-rose-50 text-rose-950"
          }`}
          role={saveFeedback.kind === "error" ? "alert" : "status"}
        >
          <div className="flex items-start gap-3">
            {saveFeedback.kind === "success" ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            )}
            <div>
              <p className="font-semibold">{saveFeedback.title}</p>
              <p className="mt-0.5 text-sm opacity-85">{saveFeedback.detail}</p>
            </div>
          </div>
          {saveFeedback.clients?.length ? (
            <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
              {saveFeedback.clients.map((client, index) => (
                <div
                  key={`${client.code ?? client.name}-${index}`}
                  className={`rounded-xl border px-3 py-2 ${
                    saveFeedback.kind === "success"
                      ? "border-emerald-200/80 bg-white/75"
                      : "border-rose-200/80 bg-white/75"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-bold">
                      {client.name}
                      {client.code ? <span className="ml-2 text-xs font-medium opacity-60">{client.code}</span> : null}
                    </p>
                    {saveFeedback.kind === "success" ? (
                      <Badge className="bg-emerald-700">Saqlandi</Badge>
                    ) : (
                      <Badge variant="destructive">Xatoli qator</Badge>
                    )}
                  </div>
                  {saveFeedback.kind === "success" ? (
                    <p className="mt-1 text-xs opacity-75">
                      Savdo: {formatMoney(client.saleAmount ?? 0)} • To‘lov: {formatMoney((client.cash ?? 0) + (client.terminal ?? 0) + (client.transfer ?? 0))} •
                      Yakuniy qarz: {formatMoney(client.endingDebt ?? 0)} • Tara 30/50: {client.endingKeg30Balance ?? 0}/{client.endingKeg50Balance ?? 0}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs opacity-75">{client.reason}</p>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="min-w-0 space-y-5">
        <SectionCard
          title="Agent va mijozlar"
          description="Avval agentni tanlang, so‘ng qidirib bir nechta mijozni belgilang"
          action={
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5">
              <CalendarDays className="h-4 w-4 shrink-0 text-cyan-700" />
              <div>
                <Label htmlFor="fast-keg-date" className="text-[10px] text-slate-500">Operatsiya sanasi</Label>
                <Input id="fast-keg-date" type="date" value={transactionDate} onChange={event => setTransactionDate(event.target.value)} className="h-6 border-0 p-0 text-sm font-bold shadow-none focus-visible:ring-0" />
              </div>
            </div>
          }
        >
          <div className="grid gap-3 sm:grid-cols-[260px_1fr]">
            <div>
              <Label className="text-[11px] text-slate-500">Agent</Label>
              <Select
                value={agentId ? String(agentId) : undefined}
                onValueChange={value => setAgentId(Number(value))}
                disabled={isAgentRole}
              >
                <SelectTrigger className="mt-1 h-10 w-full rounded-xl disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-500"><SelectValue placeholder="Agentni tanlang" /></SelectTrigger>
                <SelectContent>{(setup.data?.agents ?? []).map(agent => <SelectItem key={agent.id} value={String(agent.id)}>{agent.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="relative" ref={clientPickerRef}>
              <Label className="text-[11px] text-slate-500">Mijoz qidirish</Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={event => { setSearch(event.target.value); setClientPickerOpen(true); }}
                  onFocus={() => setClientPickerOpen(true)}
                  placeholder={agentId ? "Kod yoki mijoz nomi..." : "Avval agentni tanlang"}
                  className="h-10 rounded-xl pl-9"
                  disabled={!agentId}
                />
                {selectedIds.length > 0 ? (
                  <Badge className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-cyan-700 px-2">{selectedIds.length} ta tanlandi</Badge>
                ) : null}
              </div>

              {clientPickerOpen && agentId ? (
                <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                    <button onClick={toggleVisibleClients} className="flex items-center gap-2 text-left text-xs font-semibold text-slate-600 hover:text-slate-900">
                      <Checkbox checked={filteredClients.length > 0 && filteredClients.every(client => selectedSet.has(client.id))} /> Ko‘rinayotganlarning barchasini tanlash
                    </button>
                    <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setClientPickerOpen(false)}>Tayyor</button>
                  </div>
                  {clients.isError ? (
                    <div className="p-3"><QueryError description={clients.error.message} onRetry={() => clients.refetch()} /></div>
                  ) : (
                    <ScrollArea className="max-h-[320px]">
                      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-1.5 p-2">
                        {clients.isLoading ? <div className="col-span-full py-8 text-center text-xs text-slate-400"><Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />Mijozlar yuklanmoqda...</div> : null}
                        {!clients.isLoading && filteredClients.length === 0 ? <div className="col-span-full py-8 text-center text-xs text-slate-400">Mijoz topilmadi.</div> : null}
                        {filteredClients.map(client => {
                          const selected = selectedSet.has(client.id);
                          const order = selectedIds.indexOf(client.id) + 1;
                          return <button key={client.id} onClick={() => toggleClient(client.id)} className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all ${selected ? "border-cyan-200 bg-cyan-50/70" : "border-transparent hover:border-slate-200 hover:bg-slate-50"}`}><Checkbox checked={selected} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-slate-800">{client.name}</p><p className="mt-0.5 truncate text-[10px] text-slate-400">{client.code} • qarz {formatMoney(client.currentDebt)}</p></div>{selected ? <Badge className="h-6 min-w-6 shrink-0 justify-center rounded-lg bg-cyan-700 px-1.5">{order}</Badge> : null}</button>;
                        })}
                      </div>
                    </ScrollArea>
                  )}
                </div>
              ) : null}
            </div>
          </div>

          {!agentId ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500"><UsersRound className="h-3.5 w-3.5 shrink-0 text-slate-400" />Avval agentni tanlang — faqat shu agentga tegishli mijozlar ochiladi.</div>
          ) : null}
        </SectionCard>

        <Card className="overflow-hidden rounded-2xl border-slate-200/70 bg-white shadow-[0_8px_30px_rgba(27,52,76,0.07)]">
            <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-slate-900">Ketma-ket KEG kiritish jadvali</h3><p className="mt-1 text-xs text-slate-400">Tab yoki ←/→ — qo‘shni katak, Enter/↑/↓ — shu ustundagi keyingi yoki oldingi mijoz.</p></div>{selectedIds.length > 0 ? <Button variant="outline" size="sm" onClick={() => { setSelectedIds([]); setEntries({}); }} className="h-9 rounded-xl"><Eraser className="mr-2 h-4 w-4" />Jadvalni tozalash</Button> : null}</div>
            {draft.isError ? <QueryError description={draft.error.message} onRetry={() => draft.refetch()} /> : !agentId ? <div className="flex min-h-24 items-center justify-center px-6 text-center text-xs text-slate-400">Jadval agent va mijozlar tanlangach to‘ldiriladi.</div> : selectedIds.length === 0 ? <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center"><div className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700"><Boxes className="h-5 w-5" /></div><p className="mt-3 text-sm font-bold text-slate-800">Mijozlarni tanlang</p><p className="mt-1 max-w-md text-xs leading-5 text-slate-400">Yuqoridagi ro‘yxatdan mijozlarni belgilasangiz, ular tanlash tartibida shu jadvalga avtomatik joylashadi.</p></div> : draft.isLoading ? <div className="flex min-h-40 items-center justify-center text-sm text-slate-400"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Qarz va tara qoldiqlari yuklanmoqda...</div> : (
              <div className="overflow-x-auto overscroll-x-contain">
                <Table className="min-w-[1890px]">
                  <TableHeader><TableRow className="bg-slate-50/80"><TableHead className="sticky left-0 z-20 w-12 bg-slate-50 text-center">№</TableHead><TableHead className="sticky left-12 z-20 min-w-[210px] bg-slate-50">Mijoz</TableHead><TableHead className="min-w-[130px] text-right">Hozirgi qarz</TableHead><TableHead className="min-w-[105px] bg-amber-50/70 text-center text-amber-800">KEG 30</TableHead><TableHead className="min-w-[105px] bg-cyan-50/70 text-center text-cyan-800">KEG 50</TableHead><TableHead className="min-w-[115px] bg-emerald-50/70 text-center text-emerald-800">Tara 30</TableHead><TableHead className="min-w-[115px] bg-teal-50/70 text-center text-teal-800">Tara 50</TableHead><TableHead className="min-w-[130px] bg-violet-50/70 text-center text-violet-800">Наличные</TableHead><TableHead className="min-w-[130px] bg-fuchsia-50/70 text-center text-fuchsia-800">Терминаль</TableHead><TableHead className="min-w-[140px] bg-sky-50/70 text-center text-sky-800">Перечисление</TableHead><TableHead className="min-w-[130px] text-right">Savdo</TableHead><TableHead className="min-w-[120px] text-right">Qoldiq 30</TableHead><TableHead className="min-w-[120px] text-right">Qoldiq 50</TableHead><TableHead className="min-w-[140px] text-right">Yakuniy qarz</TableHead><TableHead className="w-14" /></TableRow></TableHeader>
                  <TableBody>{computedRows.map((row, rowIndex) => {
                    const missingProduct =
                      ((row.quantities.keg30 > 0 || row.quantities.returned30 > 0) && !keg30Product) ||
                      ((row.quantities.keg50 > 0 || row.quantities.returned50 > 0) && !keg50Product);
                    const missingPrice =
                      (row.quantities.keg30 > 0 && Number(keg30Product?.price ?? 0) <= 0) ||
                      (row.quantities.keg50 > 0 && Number(keg50Product?.price ?? 0) <= 0);
                    const invalid = row.endingKeg30Balance < 0 || row.endingKeg50Balance < 0 || row.endingDebt < 0 || missingProduct || missingPrice;
                    return <TableRow key={row.client.id} className={invalid ? "bg-rose-50/50" : hasValue(row.input) ? "bg-emerald-50/20" : ""}><TableCell className="sticky left-0 z-10 bg-inherit text-center text-xs font-bold text-slate-400">{rowIndex + 1}</TableCell><TableCell className="sticky left-12 z-10 bg-inherit"><p className="max-w-[190px] truncate text-xs font-bold text-slate-900">{row.client.name}</p><p className="mt-0.5 text-[10px] text-slate-400">{row.client.code}</p>{missingProduct ? <p className="mt-1 text-[10px] font-semibold text-rose-600">KEG mahsuloti topilmadi</p> : missingPrice ? <p className="mt-1 text-[10px] font-semibold text-rose-600">KEG narxi topilmadi</p> : null}</TableCell><TableCell className="text-right text-xs font-semibold text-rose-600">{formatMoney(row.client.currentDebt)}</TableCell>{entryFields.map((field, columnIndex) => <TableCell key={field.key} className="p-2"><Input data-fast-keg-cell={`${rowIndex}-${columnIndex}`} aria-label={`${row.client.name}: ${field.label}`} inputMode="numeric" value={row.input[field.key]} onChange={event => updateEntry(row.client.id, field.key, event.target.value)} onKeyDown={event => handleInputKeyDown(event, rowIndex, columnIndex)} onFocus={event => event.currentTarget.select()} placeholder="0" className={`h-9 rounded-lg border-transparent text-center text-sm font-bold tabular-nums ${field.tone}`} /></TableCell>)}<TableCell className="text-right text-xs font-bold text-slate-700">{formatMoney(row.saleAmount)}</TableCell><TableCell className={`text-right text-xs font-bold ${row.endingKeg30Balance < 0 ? "text-rose-600" : "text-amber-700"}`}>{row.endingKeg30Balance}</TableCell><TableCell className={`text-right text-xs font-bold ${row.endingKeg50Balance < 0 ? "text-rose-600" : "text-cyan-700"}`}>{row.endingKeg50Balance}</TableCell><TableCell className={`text-right text-xs font-bold ${row.endingDebt < 0 ? "text-rose-600" : "text-slate-900"}`}>{formatMoney(row.endingDebt)}</TableCell><TableCell><Button variant="ghost" size="icon" onClick={() => clearEntry(row.client.id)} title="Qatorni tozalash" className="h-8 w-8 rounded-lg text-slate-400 hover:text-rose-600"><X className="h-4 w-4" /></Button></TableCell></TableRow>;
                  })}</TableBody>
                </Table>
              </div>
            )}
            {selectedIds.length > 0 ? <div className="flex flex-col gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-xs text-slate-500">{invalidRows.length > 0 ? <><X className="h-4 w-4 text-rose-600" /><span className="font-semibold text-rose-700">{invalidRows.length} ta qatorni tuzatish kerak</span></> : <><CheckCircle2 className="h-4 w-4 text-emerald-600" /><span>{activeComputedRows.length} ta to‘ldirilgan qator saqlashga tayyor</span></>}</div><Button onClick={submitBatch} disabled={saveBatch.isPending || activeComputedRows.length === 0 || invalidRows.length > 0} className="h-10 rounded-xl bg-slate-950 px-5 hover:bg-slate-800">{saveBatch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Operatsiyalarni saqlash</Button></div> : null}
          </Card>
      </div>
    </div>
  );
}

function SummaryCard({ label, value, helper, icon: Icon, tone }: { label: string; value: string; helper: string; icon: typeof Boxes; tone: "amber" | "green" | "violet" | "rose" }) {
  const colors = { amber: "bg-amber-50 text-amber-700", green: "bg-emerald-50 text-emerald-700", violet: "bg-violet-50 text-violet-700", rose: "bg-rose-50 text-rose-700" };
  return <Card className="rounded-2xl border-slate-200/70 shadow-sm"><CardContent className="flex items-start gap-3 p-4"><div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${colors[tone]}`}><Icon className="h-5 w-5" /></div><div className="min-w-0"><p className="text-[11px] font-semibold text-slate-500">{label}</p><p className="mt-0.5 truncate text-lg font-bold text-slate-950">{value}</p><p className="mt-0.5 whitespace-normal break-words text-[10px] leading-4 text-slate-400">{helper}</p></div></CardContent></Card>;
}
