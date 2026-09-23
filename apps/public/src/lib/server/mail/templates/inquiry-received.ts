// The auto-reply a visitor gets after using the contact form (F-09-05). Body copy is Japanese;
// the code around it is not (DEV-05 §10).
import { inquiryTypeLabel } from "$lib/inquiry";
import type { MailMessage, MailTemplateContext } from "../send";

export interface InquiryReceivedInput {
  name: string;
  email: string;
  inquiryType: string | null;
  content: string;
}

// Escaped because the visitor typed all of it. The same string goes out as text too, where it
// needs no escaping — which is why the two bodies are built separately rather than stripped.
function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

export function renderInquiryReceived(input: InquiryReceivedInput, context: MailTemplateContext): MailMessage {
  const typeLabel = inquiryTypeLabel(input.inquiryType) ?? "指定なし";

  const lines = [`${input.name} 様`, "", "お問い合わせをお受けしました。内容を確認のうえ、担当者より順次ご連絡いたします。", "本メールは送信内容の控えです。ご返信いただく必要はありません。", "", "──────────", `種別：${typeLabel}`, `お名前：${input.name}`, `メールアドレス：${input.email}`, "", "お問い合わせ内容：", input.content, "──────────", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.name)} 様</p>`, "<p>お問い合わせをお受けしました。内容を確認のうえ、担当者より順次ご連絡いたします。<br>本メールは送信内容の控えです。ご返信いただく必要はありません。</p>", "<hr>", `<p>種別：${escapeHtml(typeLabel)}<br>お名前：${escapeHtml(input.name)}<br>メールアドレス：${escapeHtml(input.email)}</p>`, `<p>お問い合わせ内容：<br>${escapeHtml(input.content).replaceAll("\n", "<br>")}</p>`, "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.email, subject: "お問い合わせを受け付けました", html, text: lines.join("\n") };
}
