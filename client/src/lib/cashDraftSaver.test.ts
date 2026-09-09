import { describe, expect, it, vi } from "vitest";
import { createCashDraftSaver } from "./cashDraftSaver";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  type Row = { amounts: Record<string, number>; entryIds: Record<string, number | null>; note: string };
  type Payload = { category: string; amount: number; note: string };
  const rows: Row[] = [
    { amounts: { income: 10000, salary: 0 }, entryIds: { income: null, salary: null }, note: "Original" },
    { amounts: { income: 20000, salary: 0 }, entryIds: { income: null, salary: null }, note: "Other row" },
  ];
  const records = new Map<number, Payload>();
  let nextId = 1;
  const create = vi.fn(async (payload: Payload) => {
    const id = nextId++;
    records.set(id, payload);
    return { id };
  });
  const update = vi.fn(async (id: number, payload: Payload) => { records.set(id, payload); });
  const remove = vi.fn(async (id: number) => { records.delete(id); });
  const refresh = vi.fn(async () => {});
  const save = createCashDraftSaver({
    categories: ["income", "salary"],
    getRow: index => rows[index],
    payload: (row, category) => row.amounts[category] > 0 ? { category, amount: row.amounts[category], note: row.note } : null,
    setEntryId: (index, category, id) => { rows[index] = { ...rows[index], entryIds: { ...rows[index].entryIds, [category]: id } }; },
    create, update, remove, refresh,
  });
  return { rows, records, create, update, remove, refresh, save };
}

describe("cash draft saves", () => {
  it("creates once when autosave, blur and unmount overlap during a slow request", async () => {
    const state = setup();
    const started = deferred();
    const response = deferred();
    const create = state.create.getMockImplementation()!;
    state.create.mockImplementationOnce(async payload => { started.resolve(); await response.promise; return create(payload); });
    const autosave = state.save(0);
    await started.promise;
    const blur = state.save(0);
    const unmount = state.save(0);
    expect(state.create).toHaveBeenCalledTimes(1);
    response.resolve();
    await Promise.all([autosave, blur, unmount]);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.records.size).toBe(1);
    expect(state.rows[0].entryIds.income).toBe(1);
    expect(state.update.mock.calls.every(([id]) => id === 1)).toBe(true);
  });

  it("saves the latest amount and note after an edit made during an earlier save", async () => {
    const state = setup();
    const started = deferred();
    const response = deferred();
    const create = state.create.getMockImplementation()!;
    state.create.mockImplementationOnce(async payload => { started.resolve(); await response.promise; return create(payload); });
    const first = state.save(0);
    await started.promise;
    state.rows[0] = { ...state.rows[0], amounts: { income: 15000, salary: 4000 }, note: "Updated" };
    const second = state.save(0);
    response.resolve();
    await Promise.all([first, second]);
    expect(Array.from(state.records.values())).toEqual([
      { category: "income", amount: 15000, note: "Updated" },
      { category: "salary", amount: 4000, note: "Updated" },
    ]);
    expect(state.rows[0].note).toBe("Updated");
  });

  it("remembers successful IDs before refresh, even if refresh fails", async () => {
    const state = setup();
    state.refresh.mockImplementationOnce(async () => {
      expect(state.rows[0].entryIds.income).toBe(1);
      throw new Error("Refresh offline");
    });
    await state.save(0);
    await state.save(0);
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.records.size).toBe(1);
  });

  it("keeps successful category IDs when a later category fails", async () => {
    const state = setup();
    state.rows[0].amounts.salary = 5000;
    const create = state.create.getMockImplementation()!;
    state.create.mockImplementationOnce(create).mockRejectedValueOnce(new Error("Write failed"));
    await state.save(0);
    expect(state.rows[0].entryIds).toEqual({ income: 1, salary: null });
    await state.save(0);
    expect(state.records.size).toBe(2);
    expect(state.create.mock.calls.filter(([p]) => p.category === "income")).toHaveLength(1);
  });

  it("can save another row while the first row is waiting", async () => {
    const state = setup();
    const started = deferred();
    const response = deferred();
    const create = state.create.getMockImplementation()!;
    state.create.mockImplementationOnce(async payload => { started.resolve(); await response.promise; return create(payload); });
    const first = state.save(0);
    await started.promise;
    await state.save(1);
    expect(state.records.size).toBe(1);
    expect(state.rows[1].entryIds.income).toBe(1);
    response.resolve();
    await first;
    expect(state.rows[0].entryIds.income).toBe(2);
  });

  it("clears a saved amount without recreating it on a queued blur", async () => {
    const state = setup();
    await state.save(0);
    state.rows[0] = { ...state.rows[0], amounts: { income: 0, salary: 0 } };
    await Promise.all([state.save(0), state.save(0)]);
    expect(state.records.size).toBe(0);
    expect(state.rows[0].entryIds.income).toBeNull();
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.remove).toHaveBeenCalledTimes(1);
  });
});
