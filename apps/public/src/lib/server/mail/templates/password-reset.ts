// The password reset link (F-01-04). Sent only to an address that belongs to an active account —
// the endpoint answers the same either way, but no mail goes to an address that has none.
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface PasswordResetInput {
  name: string;
  email: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export function renderPasswordReset(input: PasswordResetInput, context: MailTemplateContext): MailMessage {
  const lines = [`${input.name} 様`, "", "パスワード再設定のお手続きを受け付けました。下のリンクから新しいパスワードを設定してください。", input.resetUrl, `（このリンクは ${input.expiresInMinutes} 分間有効です）`, "", "お心当たりがない場合は、このメールを破棄してください。パスワードは変更されません。", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.name)} 様</p>`, `<p>パスワード再設定のお手続きを受け付けました。<br><a href="${escapeHtml(input.resetUrl)}">新しいパスワードを設定する</a><br>（このリンクは ${input.expiresInMinutes} 分間有効です）</p>`, "<p>お心当たりがない場合は、このメールを破棄してください。パスワードは変更されません。</p>", "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.email, subject: "パスワード再設定のご案内", html, text: lines.join("\n") };
}
