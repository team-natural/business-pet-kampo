// Confirms a new address (F-01-06). Sent to the **new** address, never the old one: the point is
// to prove whoever asked can receive mail there.
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface EmailChangeInput {
  name: string;
  newEmail: string;
  confirmUrl: string;
}

export function renderEmailChange(input: EmailChangeInput, context: MailTemplateContext): MailMessage {
  const lines = [`${input.name} 様`, "", "メールアドレスの変更を受け付けました。下のリンクを開くと、このアドレスが新しい連絡先として登録されます。", input.confirmUrl, "（このリンクは 24 時間有効です）", "", "リンクを開くまで、これまでのメールアドレスのままご利用いただけます。", "お心当たりがない場合は、このメールを破棄してください。", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.name)} 様</p>`, `<p>メールアドレスの変更を受け付けました。<br><a href="${escapeHtml(input.confirmUrl)}">このアドレスを登録する</a><br>（このリンクは 24 時間有効です）</p>`, "<p>リンクを開くまで、これまでのメールアドレスのままご利用いただけます。<br>お心当たりがない場合は、このメールを破棄してください。</p>", "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.newEmail, subject: "メールアドレス変更の確認", html, text: lines.join("\n") };
}
