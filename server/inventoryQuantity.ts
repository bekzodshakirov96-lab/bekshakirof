import { z } from "zod";

/** Match the ledger DECIMAL(18,3) precision before computing money or stock. */
export const stockQuantity = z.number().finite().positive().max(1_000_000)
  .refine(value => Number(value.toFixed(3)) === value, "Miqdor 3 tagacha kasr bilan kiritiladi");
