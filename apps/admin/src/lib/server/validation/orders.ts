// 金額列は 1 つも含まない。合計を管理画面から書き換えられると、注文明細のスナップショットと
// 請求額が食い違う（DEV-07 §6-0）。
import { z } from "zod";

export const updateOrderSchema = z.object({
  notes: z.string().max(2000).optional(),
  // 配送情報。出荷への遷移とあわせて記録する。
  trackingNumber: z.string().max(64).optional(),
  shippedAt: z.iso.datetime().optional(),
});

export const confirmPaymentSchema = z.object({
  // 入金額。注文合計と一致しない入金は運用で判断するため、額を受け取って記録する。
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
