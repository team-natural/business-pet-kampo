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

// TODO(Phase C): 発注確定（checkout）。orders + order_items + payments の INSERT と cart_items の
// DELETE を 1 つの batch() にまとめ、商品名・単価はその場で解決した値をスナップショット保存する
// （DEV-05 §3）。メール送信は batch() の外、ctx.waitUntil() で行う。
