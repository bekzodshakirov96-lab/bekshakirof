/** One queue per draft row: autosave, blur and unmount share the same IDs. */
export function createCashDraftSaver<Row extends { entryIds: Record<string, number | null> }, Payload>(options: {
  categories: string[];
  getRow: (index: number) => Row | undefined;
  payload: (row: Row, category: string) => Payload | null;
  setEntryId: (index: number, category: string, id: number | null) => void;
  create: (payload: Payload) => Promise<{ id: number }>;
  update: (id: number, payload: Payload) => Promise<unknown>;
  remove: (id: number) => Promise<unknown>;
  refresh: () => Promise<unknown>;
}) {
  const pending = new Map<number, Promise<void>>();
  return (index: number): Promise<void> => {
    const task = (pending.get(index) ?? Promise.resolve()).catch(() => {}).then(async () => {
      // Read after the previous save, including edits made while it was pending.
      const row = options.getRow(index);
      if (!row) return;
      let changed = false;
      for (const category of options.categories) {
        const id = options.getRow(index)?.entryIds[category];
        const payload = options.payload(row, category);
        try {
          if (payload === null) {
            if (id) {
              await options.remove(id);
              options.setEntryId(index, category, null);
              changed = true;
            }
          } else if (id) {
            await options.update(id, payload);
            changed = true;
          } else {
            const created = await options.create(payload);
            // Publish each ID before refreshing queries or saving another cell.
            options.setEntryId(index, category, created.id);
            changed = true;
          }
        } catch {
          // Mutation handlers report errors. Keep successful IDs and unsaved input.
        }
      }
      if (changed) await options.refresh().catch(() => {});
    });
    pending.set(index, task);
    void task.finally(() => { if (pending.get(index) === task) pending.delete(index); }).catch(() => {});
    return task;
  };
}
