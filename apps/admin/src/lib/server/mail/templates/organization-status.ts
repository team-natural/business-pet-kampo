// Tells a partner's members that ordering has stopped or resumed (DEV-09 §2-2-4). Sent per
// member, because a membership is a person and there is no shared company inbox to write to.
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";

export interface OrganizationStatusInput {
  to: string;
  name: string;
  organizationName: string;
}

export function renderOrganizationSuspended(input: OrganizationStatusInput, context: MailTemplateContext): MailMessage {
  const lines = [`${input.name} 様`, "", `${input.organizationName} 様とのお取引を一時停止させていただきました。`, "停止中はご発注を承れません。商品情報のご閲覧とログインは引き続きご利用いただけます。", "", "お心当たりがない場合、また再開をご希望の場合は、お問い合わせフォームよりご連絡ください。", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.name)} 様</p>`, `<p>${escapeHtml(input.organizationName)} 様とのお取引を一時停止させていただきました。<br>停止中はご発注を承れません。商品情報のご閲覧とログインは引き続きご利用いただけます。</p>`, "<p>お心当たりがない場合、また再開をご希望の場合は、お問い合わせフォームよりご連絡ください。</p>", "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.to, subject: "お取引一時停止のお知らせ", html, text: lines.join("\n") };
}

export function renderOrganizationResumed(input: OrganizationStatusInput, context: MailTemplateContext): MailMessage {
  const lines = [`${input.name} 様`, "", `${input.organizationName} 様とのお取引を再開いたしました。`, "これまでどおりご発注いただけます。", "", context.appName, context.appUrl];

  const html = [`<p>${escapeHtml(input.name)} 様</p>`, `<p>${escapeHtml(input.organizationName)} 様とのお取引を再開いたしました。<br>これまでどおりご発注いただけます。</p>`, "<hr>", `<p><a href="${escapeHtml(context.appUrl)}">${escapeHtml(context.appName)}</a></p>`].join("\n");

  return { to: input.to, subject: "お取引再開のお知らせ", html, text: lines.join("\n") };
}
