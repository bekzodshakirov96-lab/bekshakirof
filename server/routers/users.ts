import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { users } from "../../drizzle/schema";
import { router } from "../_core/trpc";
import { ownerProcedure } from "../access";
import { requireDb } from "../db";

// The very first account ever registered (id = 1) is the permanent owner and
// can't be demoted or have its role changed by another admin.
const OWNER_USER_ID = 1;

export const usersRouter = router({
  list: ownerProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .orderBy(asc(users.name));
    return rows.map(row => ({
      ...row,
      isOwner: row.id === OWNER_USER_ID,
    }));
  }),
  setRole: ownerProcedure
    .input(z.object({ userId: z.number().int().positive(), role: z.enum(["user", "accountant"]) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi." });
      if (target.id === OWNER_USER_ID) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rahbar rolini o‘zgartirib bo‘lmaydi." });
      }
      await db.update(users).set({ role: input.role }).where(eq(users.id, input.userId));
      return { success: true };
    }),
});
