import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "./_core/trpc";

export const businessProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "accountant") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bu tizimdan faqat rahbar va buxgalter foydalanishi mumkin.",
    });
  }

  return next({ ctx });
});

export const ownerProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bu amal faqat rahbar uchun ruxsat etilgan.",
    });
  }

  return next({ ctx });
});

/** Rahbar, buxgalter yoki agent — Yangi savdo va Tezkor KEG savdosi uchun. Agent
 * o'z nomidan tashqari boshqa agent uchun yozuv kiritolmaydi (har bir prosedura
 * o'zi requireOwnAgent bilan tekshiradi). */
export const salesProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "accountant" && ctx.user.role !== "agent") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bu bo‘limdan faqat rahbar, buxgalter yoki agent foydalanishi mumkin.",
    });
  }

  return next({ ctx });
});

/** Rahbar, buxgalter yoki agent — mijozlarni ko'rish va yangi mijoz qo'shish uchun. */
export const clientsViewProcedure = salesProcedure;

/** Rahbar, buxgalter yoki agent — Qarzdorlik hisoboti va Akt sverkani faqat ko'rish uchun. */
export const debtsViewProcedure = salesProcedure;

/** Rahbar, buxgalter yoki sklad xodimi — Mahsulotlar va Sklad bo'limlarini boshqarish uchun
 * (narx/nom o'zgartirish, KEG sozlamalari, kirim/chiqim). */
export const skladProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (ctx.user.role !== "admin" && ctx.user.role !== "accountant" && ctx.user.role !== "sklad") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bu bo‘limdan faqat rahbar, buxgalter yoki sklad xodimi foydalanishi mumkin.",
    });
  }

  return next({ ctx });
});

/** Rahbar, buxgalter, sklad xodimi yoki agent — faqat mahsulotlar ro'yxatini ko'rish uchun
 * (agentga Yangi savdo/Tezkor KEG savatiga mahsulot tanlash uchun kerak). */
export const productsViewProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  if (
    ctx.user.role !== "admin" &&
    ctx.user.role !== "accountant" &&
    ctx.user.role !== "sklad" &&
    ctx.user.role !== "agent"
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Bu bo‘limdan faqat rahbar, buxgalter, sklad xodimi yoki agent foydalanishi mumkin.",
    });
  }

  return next({ ctx });
});

/** Agent rolidagi foydalanuvchi faqat o'z agentId'siga tegishli yozuv kirita olishini
 * ta'minlaydi. Rahbar/buxgalter uchun cheklovsiz — istalgan agent nomidan yoza oladi. */
export function requireOwnAgent(userRole: string, userAgentId: number | null, targetAgentId: number) {
  if (userRole !== "agent") return;
  if (userAgentId !== targetAgentId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Faqat o‘z nomingizdan yozuv kiritishingiz mumkin.",
    });
  }
}

export function canManageBusinessData(role: string) {
  return role === "admin" || role === "accountant";
}

export function canManageRoles(role: string) {
  return role === "admin";
}
