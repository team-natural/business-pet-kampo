// The acknowledgement an applicant gets after submitting (F-02-02). It carries the withdrawal
// link, which is the only way back to an application that has no login behind it (DEV-04 §5-3).
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface ApplicationReceivedInput {
  companyName: string;
  contactName: string;
  email: string;
  withdrawalUrl: string;
}

export function renderApplicationReceived(input: ApplicationReceivedInput, context: MailTemplateContext): MailMessage {
  const lines = [`${input.contactName} 様`, "", `${input.companyName} 様からの新規取引のお申し込みをお受けしました。`, "内容を確認のうえ、数営業日以内に審査の結果をご連絡します。", "", "お申し込みを取り消す場合は、次のリンクからお手続きください。", input.withdrawalUrl, "（このリンクは 30 日間有効です）", "", "本メールは送信専用です。ご不明な点はサイトのお問い合わせフォームからご連絡ください。", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.contactName)} 様</p>`, `<p>${escapeHtml(input.companyName)} 様からの新規取引のお申し込みをお受けしました。<br>内容を確認のうえ、数営業日以内に審査の結果をご連絡します。</p>`, `<p>お申し込みを取り消す場合は、次のリンクからお手続きください。<br><a href="${escapeHtml(input.withdrawalUrl)}">お申し込みを取り消す</a><br>（このリンクは 30 日間有効です）</p>`, "<p>本メールは送信専用です。ご不明な点はサイトのお問い合わせフォームからご連絡ください。</p>", "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.email, subject: "新規取引のお申し込みを受け付けました", html, text: lines.join("\n") };
}
