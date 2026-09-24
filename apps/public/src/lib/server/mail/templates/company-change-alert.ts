// Tells the operator a member has asked for their company details to change (F-05-03). Nothing
// has moved in D1 yet — the mail is the whole prompt to go and act, so it carries before/after.
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface CompanyChangeAlertInput {
  to: string;
  organizationName: string;
  orgCode: string;
  memberName: string;
  memberEmail: string;
  changes: { label: string; before: string; after: string }[];
  message: string | null;
  adminUrl: string;
}

export function renderCompanyChangeAlert(input: CompanyChangeAlertInput, context: MailTemplateContext): MailMessage {
  const changeLines = input.changes.map((change) => `${change.label}：${change.before || "（未設定）"} → ${change.after}`);

  const lines = ["会社情報の変更申請が届きました。", "", `取引先：${input.organizationName}（${input.orgCode}）`, `申請者：${input.memberName}（${input.memberEmail}）`, "", ...(changeLines.length > 0 ? ["変更希望：", ...changeLines, ""] : []), ...(input.message ? ["ご連絡事項：", input.message, ""] : []), "取引先画面：", input.adminUrl, "", context.appName];

  const html = ["<p>会社情報の変更申請が届きました。</p>", `<p>取引先：${escapeHtml(input.organizationName)}（${escapeHtml(input.orgCode)}）<br>申請者：${escapeHtml(input.memberName)}（${escapeHtml(input.memberEmail)}）</p>`, ...(changeLines.length > 0 ? [`<p>変更希望：<br>${changeLines.map(escapeHtml).join("<br>")}</p>`] : []), ...(input.message ? [`<p>ご連絡事項：<br>${escapeHtml(input.message)}</p>`] : []), `<p><a href="${escapeHtml(input.adminUrl)}">取引先画面を開く</a></p>`].join("\n");

  return { to: input.to, subject: `会社情報の変更申請（${input.organizationName}）`, html, text: lines.join("\n") };
}
