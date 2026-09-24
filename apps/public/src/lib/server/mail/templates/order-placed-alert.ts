// Tells the operator an order is waiting (F-10-01). For a bank transfer it also states the
// deadline, because that is the date the manual reconciliation is chased against (D-039).
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";
import { formatJapaneseDate, formatYen, paymentMethodLabel } from "$lib/commerce";

export interface OrderPlacedAlertInput {
  to: string;
  orderNumber: string;
  organizationName: string;
  orgCode: string;
  contactName: string;
  total: number;
  paymentMethod: string;
  paymentDueAt: string | null;
  adminUrl: string;
}

export function renderOrderPlacedAlert(input: OrderPlacedAlertInput, context: MailTemplateContext): MailMessage {
  const due = input.paymentDueAt ? [`お振込期限：${formatJapaneseDate(input.paymentDueAt)}`] : [];

  const lines = ["新しいご発注が届きました。", "", `注文番号：${input.orderNumber}`, `取引先：${input.organizationName}（${input.orgCode}）`, `ご担当者：${input.contactName}`, `金額：${formatYen(input.total)}（税込）`, `お支払い方法：${paymentMethodLabel(input.paymentMethod)}`, ...due, "", "受注画面：", input.adminUrl, "", context.appName];

  const html = ["<p>新しいご発注が届きました。</p>", `<p>注文番号：${escapeHtml(input.orderNumber)}<br>取引先：${escapeHtml(input.organizationName)}（${escapeHtml(input.orgCode)}）<br>ご担当者：${escapeHtml(input.contactName)}<br>金額：${escapeHtml(formatYen(input.total))}（税込）<br>お支払い方法：${escapeHtml(paymentMethodLabel(input.paymentMethod))}${due.length > 0 ? `<br>${escapeHtml(due[0]!)}` : ""}</p>`, `<p><a href="${escapeHtml(input.adminUrl)}">受注画面を開く</a></p>`].join("\n");

  return { to: input.to, subject: `新しいご発注（${input.orderNumber}）`, html, text: lines.join("\n") };
}
