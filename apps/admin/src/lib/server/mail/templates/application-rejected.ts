// Sent when an application is rejected (F-02-07). The reason is included because the applicant is
// entitled to it and nothing else tells them — no column stores it, only the audit log.
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface ApplicationRejectedInput {
  companyName: string;
  contactName: string;
  email: string;
  reason: string;
}

export function renderApplicationRejected(input: ApplicationRejectedInput, context: MailTemplateContext): MailMessage {
  const lines = [`${input.contactName} 様`, "", `${input.companyName} 様よりお申し込みいただいた新規取引について、今回はお見送りとさせていただきました。`, "", "理由：", input.reason, "", "ご不明な点は、サイトのお問い合わせフォームからご連絡ください。", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.contactName)} 様</p>`, `<p>${escapeHtml(input.companyName)} 様よりお申し込みいただいた新規取引について、今回はお見送りとさせていただきました。</p>`, `<p>理由：<br>${escapeHtml(input.reason).replaceAll("\n", "<br>")}</p>`, "<p>ご不明な点は、サイトのお問い合わせフォームからご連絡ください。</p>", "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.email, subject: "新規取引のお申し込みについて", html, text: lines.join("\n") };
}
