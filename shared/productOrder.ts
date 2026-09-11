export function moveProductId(ids: number[], id: number, targetId: number, placement: "before" | "after") {
  if (!ids.includes(id) || !ids.includes(targetId)) throw new Error("Mahsulot topilmadi.");
  if (id === targetId) return [...ids];
  const next = ids.filter(value => value !== id);
  next.splice(next.indexOf(targetId) + (placement === "after" ? 1 : 0), 0, id);
  return next;
}
