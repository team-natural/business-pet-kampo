// The buyer's order confirmation (F-04-08). For a bank transfer this mail is also the payment
// instruction — the account, the deadline and the reference rule are all here, because it is the
// document the buyer forwards to their accounts department (D-039).
import { escapeHtml, type MailMessage, type MailTemplateContext } from "@app/server-kit/mail";
import { BANK_TRANSFER_FEE_BEARER, formatJapaneseDate, formatYen } from "$lib/commerce";
import { transferReferenceNote, type BankAccount } from "../../bank-account";

export interface OrderReceivedInput {
  to: string;
  contactName: string;
  orderNumber: string;
  total: number;
  paymentMethod: "credit_card" | "bank_transfer";
  paymentDueAt: string | null;
  // Null when the five account values are not configured; the block is then omitted rather than
  // half-printed (D-039).
  bankAccount: BankAccount | null;
  orderUrl: string;
}

function transferLines(input: OrderReceivedInput): string[] {
  if (input.paymentMethod !== "bank_transfer") return ["お支払いは、ご発注時のクレジットカード決済で承っております。"];

  const lines = ["下記の口座へお振込をお願いいたします。", ""];
  if (input.paymentDueAt) lines.push(`お振込期限：${formatJapaneseDate(input.paymentDueAt)}`);

  if (input.bankAccount) {
    const { bankName, branch, accountType, accountNumber, accountHolder } = input.bankAccount;
    lines.push(`銀行名：${bankName}`, `支店名：${branch}`, `口座種別：${accountType}`, `口座番号：${accountNumber}`, `口座名義：${accountHolder}`);
  } else {
    // Said plainly rather than silently omitted: the buyer needs to know a second mail is coming.
    lines.push("お振込先は別途ご連絡いたします。");
  }

  lines.push("", transferReferenceNote(input.orderNumber), `振込手数料は${BANK_TRANSFER_FEE_BEARER}のご負担にてお願いいたします。`);
  return lines;
}

export function renderOrderReceived(input: OrderReceivedInput, context: MailTemplateContext): MailMessage {
  const transfer = transferLines(input);

  const lines = [`${input.contactName} 様`, "", "ご発注ありがとうございます。下記の内容で承りました。", "", `注文番号：${input.orderNumber}`, `ご請求金額：${formatYen(input.total)}（税込）`, "", ...transfer, "", "ご発注内容：", input.orderUrl, "", context.appName];

  const html = [`<p>${escapeHtml(input.contactName)} 様</p>`, "<p>ご発注ありがとうございます。下記の内容で承りました。</p>", `<p>注文番号：${escapeHtml(input.orderNumber)}<br>ご請求金額：${escapeHtml(formatYen(input.total))}（税込）</p>`, `<p>${transfer.filter(Boolean).map(escapeHtml).join("<br>")}</p>`, `<p><a href="${escapeHtml(input.orderUrl)}">ご発注内容を確認する</a></p>`].join("\n");

  return { to: input.to, subject: `ご発注を承りました（${input.orderNumber}）`, html, text: lines.join("\n") };
}
