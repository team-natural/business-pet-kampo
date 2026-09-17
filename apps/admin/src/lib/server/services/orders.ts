// 受注管理（ADM-17 / ADM-18）。状態遷移は DEV-09 §2-5・§2-6 が正本。
import { orderItems, orders, organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { and, desc, eq, sql } from "drizzle-orm";

export type OrderStatus = "received" | "confirming" | "preparing" | "shipped" | "completed" | "cancelled";

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  received: ["confirming", "preparing", "cancelled"],
  confirming: ["preparing", "cancelled"],
  preparing: ["shipped", "cancelled"],
  shipped: ["completed"],
  completed: [],
  cancelled: [],
};

export function allowedTransitions(status: OrderStatus): OrderStatus[] {
  return TRANSITIONS[status] ?? [];
}

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
    notes: row.notes,
    placedAt: row.placedAt,
  };
}

// 商品名・単価は注文時のスナップショット。Markdown を読み直すと過去の注文金額が変わる（DEV-07 §6-0）。
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

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export async function listOrders(db: DbClient, options: { status?: OrderStatus; organizationId?: number; page?: number; perPage?: number } = {}) {
  const perPage = Math.min(Math.max(options.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
  const page = Math.max(options.page ?? 1, 1);

  const where = and(options.status ? eq(orders.status, options.status) : undefined, options.organizationId ? eq(orders.organizationId, options.organizationId) : undefined);

  const [rows, [counted]] = await Promise.all([
    db
      .select({ order: orders, organizationName: organizations.name, orgCode: organizations.orgCode })
      .from(orders)
      .innerJoin(organizations, eq(orders.organizationId, organizations.id))
      .where(where)
      .orderBy(desc(orders.id))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db
      .select({ total: sql<number>`count(*)` })
      .from(orders)
      .where(where),
  ]);

  return {
    items: rows.map((row) => ({ ...toPublicOrder(row.order), organizationName: row.organizationName, orgCode: row.orgCode })),
    page,
    perPage,
    total: counted?.total ?? 0,
  };
}

export async function findOrderRow(db: DbClient, publicId: string): Promise<OrderRow> {
  const [row] = await db.select().from(orders).where(eq(orders.publicId, publicId)).limit(1);
  if (!row) throw new NotFoundError("受注が見つかりません。");
  return row;
}

export async function getOrderByPublicId(db: DbClient, publicId: string) {
  const row = await findOrderRow(db, publicId);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, row.id)).orderBy(orderItems.id);

  return {
    order: toPublicOrder(row),
    items: items.map(toPublicOrderItem),
    shippingAddress: JSON.parse(row.shippingAddressSnapshot) as Record<string, string>,
  };
}

// TODO(Phase C): transitionOrder / confirmPayment / cancelOrder。
// - status と payment_status はそれぞれ単一の遷移関数だけが書く（DEV-09）
// - 入金確認は payments と orders.payment_status を同じ batch() で更新し、activity_log も同梱する
// - キャンセルは返金状況まで含めて 1 トランザクション。金額は再計算せずスナップショットを使う
