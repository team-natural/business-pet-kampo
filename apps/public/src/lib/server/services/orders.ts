// The member-facing view of an order. Everything shown here comes from the order's own snapshot
// columns — re-reading packages/content would rewrite past totals at the next price revision
// (DEV-07 §6-0).
import { orderItems, orders } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { and, desc, eq } from "drizzle-orm";

type OrderRow = typeof orders.$inferSelect;
type OrderItemRow = typeof orderItems.$inferSelect;

export function toPublicOrder(row: OrderRow) {
  return {
    id: row.publicId,
    orderNumber: row.orderNumber,
    status: row.status,
    paymentStatus: row.paymentStatus,
    paymentMethod: row.paymentMethod,
    subtotal: row.subtotal,
    tax: row.tax,
    shippingFee: row.shippingFee,
    total: row.total,
    // Read from the order, never recomputed from the constant: changing the term must not move the
    // deadline of an order the buyer has already been told about (D-040).
    paymentDueAt: row.paymentDueAt,
    notes: row.notes,
    placedAt: row.placedAt,
  };
}

export function toPublicOrderItem(row: OrderItemRow) {
  return {
    productSlug: row.productSlug,
    name: row.productNameSnapshot,
    code: row.productCodeSnapshot,
    unitPrice: row.unitPriceSnapshot,
    taxRate: row.taxRateSnapshot,
    quantity: row.quantity,
    subtotal: row.subtotal,
  };
}

export async function listOrders(db: DbClient, organizationId: number) {
  const rows = await db.select().from(orders).where(eq(orders.organizationId, organizationId)).orderBy(desc(orders.id));
  return rows.map(toPublicOrder);
}

// For the completion screen, which is reached with an order number in the query string. Scoped to
// the organization, so a guessed number from another company is simply absent rather than refused
// — the distinction would confirm the order exists (DEV-02 §3-1).
export async function findOrderByNumber(db: DbClient, organizationId: number, orderNumber: string) {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.organizationId, organizationId), eq(orders.orderNumber, orderNumber)))
    .limit(1);

  return row ? toPublicOrder(row) : null;
}

export async function getOrder(db: DbClient, organizationId: number, publicId: string) {
  const [row] = await db
    .select()
    .from(orders)
    .where(and(eq(orders.organizationId, organizationId), eq(orders.publicId, publicId)))
    .limit(1);

  if (!row) throw new NotFoundError("ご発注が見つかりません。");

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, row.id)).orderBy(orderItems.id);
  return { order: toPublicOrder(row), items: items.map(toPublicOrderItem), shippingAddress: JSON.parse(row.shippingAddressSnapshot) as Record<string, string> };
}

// TODO(Phase C): checkout. One batch() for the orders + order_items + payments INSERTs and the
// cart_items DELETE, with the resolved product name and unit price snapshotted onto the line
// (DEV-05 §3). Mail goes outside the batch(), through ctx.waitUntil().
