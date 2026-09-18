// Not one amount column. A total editable from the admin screen would disagree with the line
// snapshots the order was charged from (DEV-07 §6-0).
import { z } from "zod";

export const updateOrderSchema = z.object({
  notes: z.string().max(2000).optional(),
  // Shipment details, recorded together with the transition to shipped.
  trackingNumber: z.string().max(64).optional(),
  shippedAt: z.iso.datetime().optional(),
});

export const confirmPaymentSchema = z.object({
  // The amount received. A transfer that does not match the order total is an operational call,
  // so the figure is recorded rather than rejected.
  amount: z.number().int().nonnegative(),
  paidAt: z.iso.datetime().optional(),
  memo: z.string().max(1000).optional(),
});

export const cancelOrderSchema = z.object({
  reason: z.string().min(1).max(2000),
  refund: z.enum(["none", "full", "partial"]).default("none"),
  refundAmount: z.number().int().nonnegative().optional(),
});

export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type ConfirmPaymentInput = z.infer<typeof confirmPaymentSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
