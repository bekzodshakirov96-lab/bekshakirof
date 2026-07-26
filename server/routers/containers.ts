import { desc, eq, sql } from "drizzle-orm";
import { agents, clients, containerMovements } from "../../drizzle/schema";
import { businessProcedure } from "../access";
import { containerLabel, normalizeContainerType } from "../containerAccounting";
import { requireDb } from "../db";
import { router } from "../_core/trpc";

export const containersRouter = router({
  list: businessProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({
        id: containerMovements.id,
        movementDate: containerMovements.movementDate,
        agentName: agents.name,
        clientName: clients.name,
        containerType: containerMovements.containerType,
        movementType: containerMovements.movementType,
        quantity: containerMovements.quantity,
        note: containerMovements.note,
      })
      .from(containerMovements)
      .leftJoin(agents, eq(containerMovements.agentId, agents.id))
      .leftJoin(clients, eq(containerMovements.clientId, clients.id))
      .orderBy(desc(containerMovements.movementDate), desc(containerMovements.id))
      .limit(500);
    // Older rows stored the raw enum ("keg_30") instead of the display label — normalize
    // for a consistent "KEG 30" look regardless of which era a row was written in.
    return rows.map(row => {
      const type = normalizeContainerType(row.containerType);
      return type ? { ...row, containerType: containerLabel(type) } : row;
    });
  }),
  balances: businessProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({
        clientId: clients.id,
        clientName: clients.name,
        agentName: agents.name,
        containerType: containerMovements.containerType,
        issued:
          sql<number>`sum(case when ${containerMovements.movementType} = 'issued' then ${containerMovements.quantity} else 0 end)`.mapWith(
            Number,
          ),
        returned:
          sql<number>`sum(case when ${containerMovements.movementType} = 'returned' then ${containerMovements.quantity} else 0 end)`.mapWith(
            Number,
          ),
        balance:
          sql<number>`sum(case when ${containerMovements.movementType} = 'issued' then ${containerMovements.quantity} else -${containerMovements.quantity} end)`.mapWith(
            Number,
          ),
      })
      .from(containerMovements)
      .leftJoin(clients, eq(containerMovements.clientId, clients.id))
      .leftJoin(agents, eq(containerMovements.agentId, agents.id))
      .groupBy(clients.id, clients.name, agents.name, containerMovements.containerType);

    // `containerType` has historically been written both as the raw enum ("keg_30") and as
    // the display label ("KEG 30") depending on which code path inserted the row — merge rows
    // for the same client that only differ by that formatting so balances aren't split in two.
    const merged = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const type = normalizeContainerType(row.containerType);
      if (!type) continue;
      const key = `${row.clientId}:${type}`;
      const existing = merged.get(key);
      if (existing) {
        existing.issued += row.issued;
        existing.returned += row.returned;
        existing.balance += row.balance;
      } else {
        merged.set(key, { ...row, containerType: containerLabel(type) });
      }
    }
    return Array.from(merged.values()).sort((a, b) => b.balance - a.balance);
  }),
});
