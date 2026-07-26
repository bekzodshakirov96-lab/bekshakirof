import { describe, expect, it } from "vitest";
import { canManageBusinessData, canManageRoles } from "./access";

describe("rol ruxsatlari", () => {
  it("rahbar va buxgalterga biznes ma’lumotlarini boshqarishga ruxsat beradi", () => {
    expect(canManageBusinessData("admin")).toBe(true);
    expect(canManageBusinessData("accountant")).toBe(true);
  });

  it("oddiy foydalanuvchini biznes ma’lumotlaridan cheklaydi", () => {
    expect(canManageBusinessData("user")).toBe(false);
    expect(canManageBusinessData("guest")).toBe(false);
  });

  it("rollarni faqat rahbar boshqarishi mumkinligini tekshiradi", () => {
    expect(canManageRoles("admin")).toBe(true);
    expect(canManageRoles("accountant")).toBe(false);
    expect(canManageRoles("user")).toBe(false);
  });
});

