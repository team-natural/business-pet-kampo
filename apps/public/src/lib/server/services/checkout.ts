// Placing the order. This is where the minimum-order and order-unit rules are actually decided —
// what the cart screen shows is display, not a decision (DEV-06 §7).
//
// Everything that must not half-happen goes in one db.batch(): the order, its lines, the payment
// row and the emptying of the cart. D1 has no interactive transaction, so a batch is the only way
// to make them one unit (DEV-07 §11-2) — and a cart cleared without an order, or an order with no
// lines, is the failure that costs a customer.
import { cartItems, orderItems, orders, payments, shippingAddresses } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { BadRequestError, ConflictError } from "@app/server-kit/http";
import { and, eq, sql } from "drizzle-orm";
import { MINIMUM_ORDER_SUBTOTAL, bankTransferDueAt, formatYen } from "$lib/commerce";
import { getCart, type ProductResolver } from "./cart";
import { getAddress, toPublicAddress } from "./addresses";
import type { CheckoutInput } from "../validation/checkout";

export interface CheckoutScope {
  organizationId: number;
  memberId: number;
}

export interface PlacedOrder {
  publicId: string;
  orderNumber: string;
  total: number;
  paymentMethod: "credit_card" | "bank_transfer";
  paymentDueAt: string | null;
}

// `YYYYMMDD` in JST: the number is read aloud and typed into a transfer form by people in Japan,
// so the date that matters is theirs, not UTC's (D-041).
function orderNumberDate(placedAt: Date): string {
  const jst = new Date(placedAt.getTime() + 9 * 60 * 60 * 1000);
  return `${jst.getUTCFullYear()}${String(jst.getUTCMonth() + 1).padStart(2, "0")}${String(jst.getUTCDate()).padStart(2, "0")}`;
}

// Numbered inside the INSERT rather than by reading MAX() first: two orders placed in the same
// second would otherwise both read the same maximum and take the same number. The UNIQUE index on
// order_number is the backstop (D-041).
function nextOrderNumber(datePart: string) {
  return sql<string>`(select ${datePart} || '-' || printf('%03d', ifnull(max(cast(substr(order_number, 10) as integer)), 0) + 1) from orders where order_number like ${`${datePart}-%`})`;
}

export async function placeOrder(db: DbClient, scope: CheckoutScope, input: CheckoutInput, resolveProducts: ProductResolver): Promise<PlacedOrder> {
  const cart = await getCart(db, scope, resolveProducts);

  // Refused here, not merely hidden on the cart screen: the screen is a hint, this is the rule.
  if (cart.lines.length === 0) throw new ConflictError("カートが空です。");
  if (cart.unavailable.length > 0) throw new ConflictError("現在お取り扱いのない商品がカートに残っています。削除してからお進みください。");
  if (!cart.meetsMinimum) throw new ConflictError(`最低発注金額は税抜 ${formatYen(MINIMUM_ORDER_SUBTOTAL)} です。`);

  // Scoped to this organization, so another company's address cannot be ordered to. getAddress
  // answers 404 rather than 403 for someone else's (DEV-02 §3-1).
  const address = await getAddress(db, scope.organizationId, input.shippingAddressId);

  const placedAt = new Date();
  const now = placedAt.toISOString();
  const publicId = ulid();
  const paymentStatus = input.paymentMethod === "bank_transfer" ? "awaiting_transfer" : "unpaid";
  const paymentDueAt = input.paymentMethod === "bank_transfer" ? bankTransferDueAt(placedAt) : null;

  // The id is not available until the insert runs, and D1 cannot hand it back mid-batch — so the
  // children point at the order through its pre-minted public_id (the S4 approval does the same).
  const orderId = sql<number>`(select id from orders where public_id = ${publicId})`;

  await db.batch([
    db.insert(orders).values({
      publicId,
      organizationId: scope.organizationId,
      memberId: scope.memberId,
      orderNumber: nextOrderNumber(orderNumberDate(placedAt)),
      status: "received",
      paymentStatus,
      subtotal: cart.totals.subtotal,
      tax: cart.totals.tax,
      shippingFee: cart.totals.shippingFee,
      total: cart.totals.total,
      // Snapshotted, not referenced: deleting the address later must not rewrite where this order
      // was sent (DEV-07 §6-2).
      shippingAddressSnapshot: JSON.stringify(toPublicAddress(address)),
      paymentMethod: input.paymentMethod,
      paymentDueAt,
      notes: input.notes ?? null,
      placedAt: now,
      updatedAt: now,
    }),
    // The name, code, unit price and tax rate are frozen here. Re-reading packages/content on the
    // history screen would rewrite every past order at the next price revision (DEV-07 §6-0).
    ...cart.lines.map((line) =>
      db.insert(orderItems).values({
        orderId,
        productSlug: line.slug,
        productNameSnapshot: line.name,
        productCodeSnapshot: line.code,
        unitPriceSnapshot: line.unitPrice,
        taxRateSnapshot: String(line.taxRate),
        quantity: line.quantity,
        subtotal: line.subtotal,
        updatedAt: now,
      }),
    ),
    db.insert(payments).values({
      organizationId: scope.organizationId,
      orderId,
      method: input.paymentMethod,
      status: paymentStatus,
      amount: cart.totals.total,
      updatedAt: now,
    }),
    // Last, and inside the batch: a cart emptied without an order is the one outcome a buyer
    // cannot recover from on their own.
    db.delete(cartItems).where(and(eq(cartItems.organizationId, scope.organizationId), eq(cartItems.memberId, scope.memberId))),
  ]);

  const [placed] = await db.select({ orderNumber: orders.orderNumber }).from(orders).where(eq(orders.publicId, publicId)).limit(1);
  // The batch reported success, so this can only be missing if something outside this code removed
  // it — worth failing loudly rather than mailing a confirmation with a blank number.
  if (!placed) throw new BadRequestError("ご発注を確定できませんでした。時間をおいて、もう一度お試しください。");

  return { publicId, orderNumber: placed.orderNumber, total: cart.totals.total, paymentMethod: input.paymentMethod, paymentDueAt };
}

// The addresses the checkout screen offers, default first. Kept here so the page and the service
// agree on what "selectable" means.
export async function listCheckoutAddresses(db: DbClient, organizationId: number) {
  const rows = await db.select().from(shippingAddresses).where(eq(shippingAddresses.organizationId, organizationId));
  return rows.map(toPublicAddress).sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
}
