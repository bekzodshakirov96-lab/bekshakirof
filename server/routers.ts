import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME, SESSION_TTL_MS } from "@shared/const";
import type { User } from "../drizzle/schema";
import * as db from "./db";
import { hashPassword, signSession, verifyPassword } from "./_core/localAuth";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { agentsRouter } from "./routers/agents";
import { auditRouter } from "./routers/audit";
import { cashRouter } from "./routers/cash";
import { clientsRouter } from "./routers/clients";
import { containersRouter } from "./routers/containers";
import { dashboardRouter } from "./routers/dashboard";
import { debtsRouter } from "./routers/debts";
import { factoryRouter } from "./routers/factory";
import { importsRouter } from "./routers/imports";
import { kassaRouter } from "./routers/kassa";
import { fastKegRouter } from "./routers/fastKeg";
import { productsRouter } from "./routers/products";
import { stockRouter } from "./routers/stock";
import { transactionsRouter } from "./routers/transactions";
import { usersRouter } from "./routers/users";

/** passwordHash (bcrypt) hech qachon mijozga yuborilmasligi kerak — foydalanuvchi
 * qatori tRPC javobida qaytarilgan har bir joyda shu funksiya orqali tozalanadi. */
function toSafeUser(user: User): Omit<User, "passwordHash">;
function toSafeUser(user: User | null): Omit<User, "passwordHash"> | null;
function toSafeUser(user: User | null): Omit<User, "passwordHash"> | null {
  if (!user) return null;
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return safeUser;
}

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => toSafeUser(opts.ctx.user)),
    /** Tizimda hali birorta ham hisob yo'qligini bildiradi — shu holatda "register"
     * bir martalik boshlang'ich (rahbar) hisobni yaratish uchun ochiq bo'ladi. */
    needsSetup: publicProcedure.query(() => db.isFirstUser()),
    /** Faqat tizimda hali hech kim ro'yxatdan o'tmagan bo'lsa ishlaydi (bo'sh baza —
     * birinchi marta serverga o'rnatilganda). Undan keyin barcha hisoblar rahbar/
     * buxgalter tomonidan Foydalanuvchilar bo'limida yaratiladi, ochiq ro'yxatdan
     * o'tish yo'q. */
    register: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(1, "Ism kiritilishi shart.").max(180),
          email: z.string().trim().toLowerCase().email("Email noto‘g‘ri."),
          password: z.string().min(8, "Parol kamida 8 belgidan iborat bo‘lishi kerak."),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        // Atomik "mutex" — ikkita so'rov bir vaqtda kelsa ham, faqat bittasi
        // birinchi admin bo'lib qolishni yutadi (server/db.ts:claimFirstAdmin).
        if (!(await db.claimFirstAdmin())) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Ro‘yxatdan o‘tish yopiq. Yangi hisob uchun rahbar yoki buxgalterga murojaat qiling.",
          });
        }
        const existing = await db.getUserByEmail(input.email);
        if (existing) {
          throw new TRPCError({ code: "CONFLICT", message: "Bu email allaqachon ro‘yxatdan o‘tgan." });
        }
        const passwordHash = await hashPassword(input.password);
        const user = await db.createUser({
          name: input.name,
          email: input.email,
          passwordHash,
          role: "admin",
        });
        if (!user) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Foydalanuvchi yaratilmadi." });
        }
        const token = await signSession(user.id, user.tokenVersion, { expiresInMs: SESSION_TTL_MS });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
        // `token` mobil ilova (React Native) uchun — u cookie sifatida saqlay olmaydi,
        // shuning uchun Authorization: Bearer headeri orqali o'zi biriktirib yuboradi.
        return { success: true, user: toSafeUser(user), token } as const;
      }),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().trim().toLowerCase().email("Email noto‘g‘ri."),
          password: z.string().min(1, "Parolni kiriting."),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const user = await db.getUserByEmail(input.email);
        const invalidCredentialsError = new TRPCError({
          code: "UNAUTHORIZED",
          message: "Email yoki parol noto‘g‘ri.",
        });
        if (!user) throw invalidCredentialsError;
        const valid = await verifyPassword(input.password, user.passwordHash);
        if (!valid) throw invalidCredentialsError;
        await db.touchLastSignedIn(user.id);
        const token = await signSession(user.id, user.tokenVersion, { expiresInMs: SESSION_TTL_MS });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: SESSION_TTL_MS });
        return { success: true, user: toSafeUser(user), token } as const;
      }),
    /** Interfeys alifbosini (lotin/kirill) saqlaydi — tanlov foydalanuvchi hisobiga
     * bog'lanadi, shuning uchun boshqa qurilmada kirganda ham o'sha holatda qoladi. */
    setLanguage: publicProcedure
      .input(z.object({ language: z.enum(["latin", "cyrillic"]) }))
      .mutation(async ({ ctx, input }) => {
        if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED" });
        await db.setUserLanguage(ctx.user.id, input.language);
        return { success: true } as const;
      }),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // tokenVersion oshadi — shu orqali ushbu foydalanuvchining boshqa joyda
      // saqlangan/o'g'irlangan har qanday token nusxasi ham darhol bekor bo'ladi
      // (faqat joriy brauzerdagi cookie emas).
      if (ctx.user) {
        await db.incrementTokenVersion(ctx.user.id);
      }
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  dashboard: dashboardRouter,
  debts: debtsRouter,
  agents: agentsRouter,
  clients: clientsRouter,
  products: productsRouter,
  transactions: transactionsRouter,
  cash: cashRouter,
  kassa: kassaRouter,
  containers: containersRouter,
  imports: importsRouter,
  fastKeg: fastKegRouter,
  stock: stockRouter,
  factory: factoryRouter,
  users: usersRouter,
  audit: auditRouter,
});

export type AppRouter = typeof appRouter;
