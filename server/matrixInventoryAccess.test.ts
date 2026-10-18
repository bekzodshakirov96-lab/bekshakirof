import { describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const database = vi.hoisted(() => ({ read: vi.fn(() => { throw new Error("Must not reach database"); }) }));
vi.mock("./db", () => ({ requireDb: database.read }));
import { matrixInventoryRouter } from "./routers/matrixInventory";

const caller = (role: string | null) => matrixInventoryRouter.createCaller({ user: role ? { id: 1, role } : null, req: { headers: {} }, res: {} } as TrpcContext);
describe("inventory authorization before database access", () => {
  it("requires owner approval for opening stock and rejects agent/anonymous writes", async () => {
    await expect(caller("accountant").activate({ productId: 1, date: Date.now(), openingQuantity: 100 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller("agent").receipt({ productId: 1, date: Date.now(), quantity: 10, requestKey: "cd7d0c42-b609-4ea5-8bc5-4cfbf15c2f30" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(null).setCell({ productId: 1, agentId: 1, date: Date.now(), quantity: 10, expectedQuantity: 0, expectedVersion: 0, requestKey: "cd7d0c42-b609-4ea5-8bc5-4cfbf15c2f30" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(database.read).not.toHaveBeenCalled();
  });
  it("rejects malformed quantities and unkeyed receipts even for an owner", async () => {
    await expect(caller("admin").setCell({ productId: 1, agentId: 1, date: Date.now(), quantity: 0.0001, expectedQuantity: 0, expectedVersion: 0, requestKey: "cd7d0c42-b609-4ea5-8bc5-4cfbf15c2f30" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(caller("admin").receipt({ productId: 1, date: Date.now(), quantity: 10, requestKey: "bad-key" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(database.read).not.toHaveBeenCalled();
  });
});
