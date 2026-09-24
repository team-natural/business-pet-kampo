// Sent when an application is approved (F-02-06, F-10-01). It carries the activation link, which
// is how the first member gets a password — the row is created without one.
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface ApplicationApprovedInput {
  companyName: string;
  contactName: string;
  email: string;
  orgCode: string;
  activationUrl: string;
}

export function renderApplicationApproved(input: ApplicationApprovedInput, context: MailTemplateContext): MailMessage {
  const lines = [`${input.contactName} 様`, "", `${input.companyName} 様の新規取引のお申し込みを承認しました。`, `取引先コード：${input.orgCode}`, "", "下のリンクからパスワードを設定すると、ご利用を開始いただけます。", input.activationUrl, "（このリンクは 7 日間有効です）", "", "ログイン後は、御社の卸価格の確認とご発注が可能になります。", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.contactName)} 様</p>`, `<p>${escapeHtml(input.companyName)} 様の新規取引のお申し込みを承認しました。<br>取引先コード：${escapeHtml(input.orgCode)}</p>`, `<p>下のリンクからパスワードを設定すると、ご利用を開始いただけます。<br><a href="${escapeHtml(input.activationUrl)}">パスワードを設定する</a><br>（このリンクは 7 日間有効です）</p>`, "<p>ログイン後は、御社の卸価格の確認とご発注が可能になります。</p>", "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.email, subject: "新規取引のお申し込みを承認しました", html, text: lines.join("\n") };
}
