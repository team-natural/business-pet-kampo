// Only the columns the reviewer owns. What the applicant typed is theirs; when it needs changing,
// send it back (needs_confirmation) rather than editing it for them.
import { applications } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const reviewApplicationSchema = createInsertSchema(applications, {
  reviewMemo: (schema) => schema.max(2000),
}).pick({ reviewMemo: true });

export const approveApplicationSchema = z.object({
  // The operator-assigned partner code. Never changes once assigned — the price files reference
  // it (D-019).
  orgCode: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, "取引先コードは英大文字・数字・ハイフンで入力してください。"),
  // The first member's details, created in the same batch() as the approval (DEV-05 §3).
  initialMemberName: z.string().min(1).max(100),
  initialMemberEmail: z.email().max(255),
});

export const rejectApplicationSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type ReviewApplicationInput = z.infer<typeof reviewApplicationSchema>;
export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;
export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;
