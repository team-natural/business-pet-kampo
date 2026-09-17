// 審査側が書ける列だけ。申請者が入力した列は書き換えない — 申請内容は申請者のものであり、
// 直したくなったら差し戻す（needs_confirmation）。
import { applications } from "@app/schema";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const reviewApplicationSchema = createInsertSchema(applications, {
  reviewMemo: (schema) => schema.max(2000),
}).pick({ reviewMemo: true });

export const approveApplicationSchema = z.object({
  // 運営が採番する取引先コード。採番後は変更しない（価格ファイルの参照キー — D-019）。
  orgCode: z
    .string()
    .min(3)
    .max(20)
    .regex(/^[A-Z0-9-]+$/, "取引先コードは英大文字・数字・ハイフンで入力してください。"),
  // 初期 Member の宛先。承認と同じ batch() で作られる（DEV-05 §3）。
  initialMemberName: z.string().min(1).max(100),
  initialMemberEmail: z.email().max(255),
});

export const rejectApplicationSchema = z.object({
  reason: z.string().min(1).max(2000),
});

export type ReviewApplicationInput = z.infer<typeof reviewApplicationSchema>;
export type ApproveApplicationInput = z.infer<typeof approveApplicationSchema>;
export type RejectApplicationInput = z.infer<typeof rejectApplicationSchema>;
