import { z } from "zod";

export type MatrixColumnKey = "product" | "stock" | "receipt" | "price" | "dailyPrice" | `agent:${number}`;
const columns = {
  product: { default: 250, min: 170 },
  stock: { default: 120, min: 90 },
  receipt: { default: 150, min: 125 },
  price: { default: 135, min: 110 },
  dailyPrice: { default: 130, min: 110 },
  agent: { default: 180, min: 112 },
};
export const MAX_MATRIX_COLUMN_WIDTH = 1600;
export function matrixColumnSize(key: MatrixColumnKey) {
  return columns[key.startsWith("agent:") ? "agent" : key as keyof typeof columns];
}
export function clampMatrixColumnWidth(key: MatrixColumnKey, width: number) {
  const size = matrixColumnSize(key);
  return Number.isFinite(width) ? Math.max(size.min, Math.min(MAX_MATRIX_COLUMN_WIDTH, Math.round(width))) : size.default;
}
export const matrixColumnWidthsSchema = z.record(
  z.string().regex(/^(product|stock|receipt|price|dailyPrice|agent:[1-9]\d{0,9})$/),
  z.number().int().min(80).max(MAX_MATRIX_COLUMN_WIDTH),
).refine(widths => Object.keys(widths).length <= 505 && Object.entries(widths).every(
  ([key, width]) => width >= matrixColumnSize(key as MatrixColumnKey).min,
), "Ustun kengligi ruxsat etilgan chegaradan tashqarida.");

export const matrixLayoutValueSchema = z.object({
  productOrder: z.array(z.number().int().positive()).max(2_000),
  visibleProductIds: z.array(z.number().int().positive()).max(2_000),
  agentOrder: z.array(z.number().int().positive()).min(1).max(500),
  // Optional for existing dated snapshots and older clients.
  columnWidths: matrixColumnWidthsSchema.optional(),
});
export type MatrixLayoutValue = z.infer<typeof matrixLayoutValueSchema>;
