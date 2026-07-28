import { asc, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { users } from "../../drizzle/schema";
import { router } from "../_core/trpc";
import { hashPassword } from "../_core/localAuth";
import { ownerProcedure } from "../access";
import { logAudit } from "../auditLog";
import { createUser, getUserByEmail, requireDb } from "../db";

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
        agentId: users.agentId,
        lastSignedIn: users.lastSignedIn,
      })
      .from(users)
      .orderBy(asc(users.name));
    return rows.map(row => ({
      ...row,
      isOwner: row.id === OWNER_USER_ID,
    }));
  }),
  /** Rahbar yoki buxgalter yangi xodim uchun login (email) va parolni to'g'ridan-to'g'ri shu yerda
   * yaratadi — xodim keyin shu email/parol bilan tizimga kiradi. Joriy sessiyaga (adminning
   * o'ziga) hech qanday ta'sir qilmaydi. */
  create: ownerProcedure
    .input(
      z
        .object({
          name: z.string().trim().min(1, "Ism kiritilishi shart.").max(180),
          email: z.string().trim().toLowerCase().email("Email noto‘g‘ri."),
          password: z.string().min(8, "Parol kamida 8 belgidan iborat bo‘lishi kerak."),
          role: z.enum(["user", "accountant", "agent", "sklad"]).default("user"),
          agentId: z.number().int().positive().optional(),
        })
        .refine(value => value.role !== "agent" || value.agentId !== undefined, {
          message: "Agent rolidagi xodim uchun agent tanlanishi shart.",
          path: ["agentId"],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const existing = await getUserByEmail(input.email);
      if (existing) throw new TRPCError({ code: "CONFLICT", message: "Bu email allaqachon ro‘yxatdan o‘tgan." });
      const passwordHash = await hashPassword(input.password);
      const created = await createUser({
        name: input.name,
        email: input.email,
        passwordHash,
        role: input.role,
        agentId: input.role === "agent" ? input.agentId ?? null : null,
      });
      if (!created) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Foydalanuvchi yaratilmadi." });
      // passwordHash tarixga hech qachon yozilmaydi.
      const db = await requireDb();
      await logAudit(db, {
        tableName: "users",
        recordId: created.id,
        action: "create",
        userId: ctx.user.id,
        after: { name: input.name, email: input.email, role: input.role, agentId: input.role === "agent" ? input.agentId ?? null : null },
      });
      return { success: true, id: created.id };
    }),
  setRole: ownerProcedure
    .input(
      z
        .object({
          userId: z.number().int().positive(),
          role: z.enum(["user", "accountant", "agent", "sklad"]),
          agentId: z.number().int().positive().optional(),
        })
        .refine(value => value.role !== "agent" || value.agentId !== undefined, {
          message: "Agent rolidagi xodim uchun agent tanlanishi shart.",
          path: ["agentId"],
        }),
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [target] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Foydalanuvchi topilmadi." });
      if (target.id === OWNER_USER_ID) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Rahbar rolini o‘zgartirib bo‘lmaydi." });
      }
      return db.transaction(async tx => {
        await tx
          .update(users)
          .set({ role: input.role, agentId: input.role === "agent" ? input.agentId ?? null : null })
          .where(eq(users.id, input.userId));
        await logAudit(tx, {
          tableName: "users",
          recordId: input.userId,
          action: "update",
          userId: ctx.user.id,
          before: { email: target.email, role: target.role, agentId: target.agentId },
          after: { email: target.email, role: input.role, agentId: input.role === "agent" ? input.agentId ?? null : null },
        });
        return { success: true };
      });
    }),
});
