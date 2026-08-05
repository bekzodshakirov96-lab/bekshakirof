/** Kassa kunlik jurnalidagi "kimga berildi" tanlovi uchun yordamchi mantiq. */

export type EmployeeOption = { id: number; name: string };
export type EmployeeSource = { id: number; name: string; position?: string | null };
/** Jurnaldagi yozuvdan faqat xodim biriktirmasi uchun kerak bo'lgan maydonlar. */
export type EmployeeUsage = { employeeId: number | null; employeeName: string | null };

/**
 * Tanlash ro'yxatiga tushadigan xodimlarni tayyorlaydi.
 *
 * Xodimlarga oylik har kuni berilmaydi, shuning uchun ro'yxat sukut bo'yicha
 * yopiq (`showAll = false`) — kundalik ishda faqat agentlar ko'rinadi.
 *
 * Yopiq bo'lsa ham, shu kunning yozuvlarida allaqachon tanlangan xodimlar
 * ro'yxatda qoladi: aks holda o'sha qatorlarning tanlovi bo'sh ko'rinib,
 * tahrirlashda xodim biriktirmasi jimgina yo'qolib ketishi mumkin edi.
 *
 * Ochiq bo'lganda esa nofaol qilingani uchun `employees` ro'yxatiga tushmagan,
 * lekin eski yozuvda ishlatilgan xodimlar oxiriga qo'shiladi.
 */
export function buildEmployeeOptions(
  employees: EmployeeSource[],
  entries: EmployeeUsage[],
  showAll: boolean,
): EmployeeOption[] {
  const used = new Map<number, string>();
  for (const entry of entries) {
    if (entry.employeeId != null && entry.employeeName) used.set(entry.employeeId, entry.employeeName);
  }

  if (!showAll) return Array.from(used.entries()).map(([id, name]) => ({ id, name }));

  const known = new Set(employees.map(employee => employee.id));
  return [
    ...employees.map(({ id, name, position }) => ({ id, name: position ? `${name} — ${position}` : name })),
    ...Array.from(used.entries())
      .filter(([id]) => !known.has(id))
      .map(([id, name]) => ({ id, name })),
  ];
}
