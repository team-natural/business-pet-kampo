// Commercial terms, in one place because they appear both in the cart maths and in the legal
// notice required by the Act on Specified Commercial Transactions (SCR-32). Writing them into the
// page instead makes the notice and the invoice disagree the first time one of them changes
// (D-024, BIZ-03 §3).
//
// Amounts are tax-exclusive yen, matching orders.subtotal / shipping_fee.

export const TAX_RATE = 0.1;

// Rounded once per tax rate, discarding the fraction (BIZ-03 §2, D-013).
export function taxFor(subtotal: number, rate: number = TAX_RATE): number {
  return Math.floor(subtotal * rate);
}

export const MINIMUM_ORDER_SUBTOTAL = 10_000;
export const SHIPPING_FEE = 1_000;
export const FREE_SHIPPING_THRESHOLD = 30_000;

export function shippingFeeFor(subtotal: number): number {
  return subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FEE;
}

export function meetsMinimumOrder(subtotal: number): boolean {
  return subtotal >= MINIMUM_ORDER_SUBTOTAL;
}

// Order totals, derived rather than stored twice: orders.subtotal/tax/shipping_fee/total are
// written from this function at checkout.
export function orderTotals(subtotal: number, rate: number = TAX_RATE) {
  const shippingFee = shippingFeeFor(subtotal);
  const tax = taxFor(subtotal + shippingFee, rate);
  return { subtotal, shippingFee, tax, total: subtotal + shippingFee + tax };
}

export const PAYMENT_METHODS = [
  { id: "credit_card", label: "クレジットカード決済", description: "発注確定時にお支払いいただきます。" },
  { id: "bank_transfer", label: "銀行振込", description: "ご入金確認後に出荷手配を行います。" },
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHODS)[number]["id"];

export const paymentMethodLabel = (id: string) => PAYMENT_METHODS.find((method) => method.id === id)?.label ?? id;

// Status display metadata. Colour alone never carries the meaning — the label ships with it
// (DEV-06 §9).
export const ORDER_STATUSES = [
  { id: "received", label: "受付済み", tone: "neutral" },
  { id: "confirming", label: "確認中", tone: "warning" },
  { id: "preparing", label: "出荷準備中", tone: "info" },
  { id: "shipped", label: "出荷済み", tone: "info" },
  { id: "completed", label: "完了", tone: "success" },
  { id: "cancelled", label: "キャンセル", tone: "danger" },
] as const;

export const PAYMENT_STATUSES = [
  { id: "unpaid", label: "未払い", tone: "warning" },
  { id: "awaiting_transfer", label: "入金待ち", tone: "warning" },
  { id: "processing", label: "処理中", tone: "info" },
  { id: "paid", label: "入金済み", tone: "success" },
  { id: "failed", label: "決済失敗", tone: "danger" },
  { id: "refunded", label: "返金済み", tone: "neutral" },
  { id: "partially_refunded", label: "一部返金", tone: "neutral" },
] as const;

export const APPLICATION_STATUSES = [
  { id: "received", label: "受付済み", tone: "neutral" },
  { id: "reviewing", label: "審査中", tone: "info" },
  { id: "needs_confirmation", label: "確認待ち", tone: "warning" },
  { id: "approved", label: "承認", tone: "success" },
  { id: "rejected", label: "否認", tone: "danger" },
  { id: "withdrawn", label: "取消", tone: "neutral" },
] as const;

export const ORGANIZATION_STATUSES = [
  { id: "active", label: "取引中", tone: "success" },
  { id: "suspended", label: "取引停止中", tone: "warning" },
  { id: "terminated", label: "取引終了", tone: "neutral" },
] as const;

type StatusMeta = { id: string; label: string; tone: string };

export const statusMeta = (statuses: readonly StatusMeta[], id: string): StatusMeta => statuses.find((status) => status.id === id) ?? { id, label: id, tone: "neutral" };

export const formatYen = (amount: number) => `${amount.toLocaleString("ja-JP")} 円`;
