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

export function canManageBusinessData(role: string) {
  return role === "admin" || role === "accountant";
}

export function canManageRoles(role: string) {
  return role === "admin";
}
