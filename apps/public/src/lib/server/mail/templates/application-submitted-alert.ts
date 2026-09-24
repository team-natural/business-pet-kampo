// Tells the operator an application is waiting (F-10-01). Addressed to MAIL_ADMIN_ALERTS, so it
// carries the details the reviewer needs to triage without opening the console.
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface ApplicationSubmittedAlertInput {
  to: string;
  publicId: string;
  companyName: string;
  contactName: string;
  email: string;
  phone: string;
  adminUrl: string;
}

export function renderApplicationSubmittedAlert(input: ApplicationSubmittedAlertInput, context: MailTemplateContext): MailMessage {
  const lines = ["新規取引のお申し込みが届きました。", "", `会社名：${input.companyName}`, `ご担当者：${input.contactName}`, `メールアドレス：${input.email}`, `電話番号：${input.phone}`, "", "審査画面：", input.adminUrl, "", context.appName];

  const html = ["<p>新規取引のお申し込みが届きました。</p>", `<p>会社名：${escapeHtml(input.companyName)}<br>ご担当者：${escapeHtml(input.contactName)}<br>メールアドレス：${escapeHtml(input.email)}<br>電話番号：${escapeHtml(input.phone)}</p>`, `<p><a href="${escapeHtml(input.adminUrl)}">審査画面を開く</a></p>`].join("\n");

  return { to: input.to, subject: `新規取引のお申し込み（${input.companyName}）`, html, text: lines.join("\n") };
}
