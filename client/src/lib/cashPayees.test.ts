import { describe, expect, it } from "vitest";
import { buildEmployeeOptions } from "./cashPayees";

const employees = [
  { id: 1, name: "Olim" },
  { id: 2, name: "Karim" },
];

describe("buildEmployeeOptions", () => {
  it("ro'yxat yopiq bo'lsa va kun yozuvlarida xodim bo'lmasa, hech kimni ko'rsatmaydi", () => {
    expect(buildEmployeeOptions(employees, [], false)).toEqual([]);
  });

  it("ro'yxat yopiq bo'lsa ham, yozuvda tanlangan xodimni qoldiradi", () => {
    const entries = [{ employeeId: 2, employeeName: "Karim" }];
    expect(buildEmployeeOptions(employees, entries, false)).toEqual([{ id: 2, name: "Karim" }]);
  });

  it("yopiq rejimda faqat ishlatilganlarini beradi — qolgan xodimlar chiqmaydi", () => {
    const entries = [{ employeeId: 1, employeeName: "Olim" }];
    const result = buildEmployeeOptions(employees, entries, false);
    expect(result.map(option => option.id)).toEqual([1]);
  });

  it("ochiq bo'lganda barcha xodimni faqat ismi bilan ko'rsatadi (lavozimsiz)", () => {
    expect(buildEmployeeOptions(employees, [], true)).toEqual([
      { id: 1, name: "Olim" },
      { id: 2, name: "Karim" },
    ]);
  });

  it("ochiq bo'lganda nofaol qilingan (ro'yxatda yo'q) xodimni oxiriga qo'shadi", () => {
    const entries = [{ employeeId: 9, employeeName: "Eski xodim" }];
    const result = buildEmployeeOptions(employees, entries, true);
    expect(result.map(option => option.id)).toEqual([1, 2, 9]);
    expect(result.at(-1)).toEqual({ id: 9, name: "Eski xodim" });
  });

  it("ochiq bo'lganda faol xodim ikki marta takrorlanmaydi", () => {
    const entries = [{ employeeId: 1, employeeName: "Olim" }];
    const result = buildEmployeeOptions(employees, entries, true);
    expect(result.map(option => option.id)).toEqual([1, 2]);
  });

  it("bir xodim bir necha qatorda uchrasa ham bir marta qaytadi", () => {
    const entries = [
      { employeeId: 2, employeeName: "Karim" },
      { employeeId: 2, employeeName: "Karim" },
    ];
    expect(buildEmployeeOptions(employees, entries, false)).toEqual([{ id: 2, name: "Karim" }]);
  });

  it("agentga tegishli qatorlarni (employeeId yo'q) e'tiborsiz qoldiradi", () => {
    const entries = [{ employeeId: null, employeeName: null }];
    expect(buildEmployeeOptions(employees, entries, false)).toEqual([]);
  });
});
