// Tells the operator a trading partner has asked to close (F-12-01). Nothing has moved in D1 — the
// mail is the whole prompt to go and act, and the outstanding-order check runs on the admin side
// when they do (F-12-02, DEV-09 §2-2).
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface WithdrawalAlertInput {
  to: string;
  organizationName: string;
  orgCode: string;
  memberName: string;
  memberEmail: string;
  reason: string | null;
  adminUrl: string;
}

export function renderWithdrawalAlert(input: WithdrawalAlertInput, context: MailTemplateContext): MailMessage {
  const lines = ["退会・取引終了のお申し出が届きました。", "", `取引先：${input.organizationName}（${input.orgCode}）`, `申請者：${input.memberName}（${input.memberEmail}）`, "", ...(input.reason ? ["理由：", input.reason, ""] : []), "未完了のご発注・未入金が残っている場合、取引終了の操作は取引先画面で拒否されます。", "", "取引先画面：", input.adminUrl, "", context.appName];

  const html = ["<p>退会・取引終了のお申し出が届きました。</p>", `<p>取引先：${escapeHtml(input.organizationName)}（${escapeHtml(input.orgCode)}）<br>申請者：${escapeHtml(input.memberName)}（${escapeHtml(input.memberEmail)}）</p>`, ...(input.reason ? [`<p>理由：<br>${escapeHtml(input.reason)}</p>`] : []), "<p>未完了のご発注・未入金が残っている場合、取引終了の操作は取引先画面で拒否されます。</p>", `<p><a href="${escapeHtml(input.adminUrl)}">取引先画面を開く</a></p>`].join("\n");

  return { to: input.to, subject: `退会・取引終了のお申し出（${input.organizationName}）`, html, text: lines.join("\n") };
}
