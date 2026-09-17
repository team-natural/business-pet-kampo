// ADM-01 の 4 枚のカード（PRD-04 §4-3-1）。件数だけを返し、明細は各一覧画面が持つ。
import { applications, orders } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { eq, inArray, sql } from "drizzle-orm";

async function countWhere(db: DbClient, query: Promise<{ total: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.total ?? 0;
}

export async function getDashboardCounts(db: DbClient) {
  const [pendingApplications, confirmingOrders, awaitingPayment, awaitingShipment] = await Promise.all([
    countWhere(
      db,
      db
        .select({ total: sql<number>`count(*)` })
        .from(applications)
        .where(inArray(applications.status, ["received", "reviewing", "needs_confirmation"])),
    ),
    countWhere(
      db,
      db
        .select({ total: sql<number>`count(*)` })
        .from(orders)
        .where(eq(orders.status, "confirming")),
    ),
    countWhere(
      db,
      db
        .select({ total: sql<number>`count(*)` })
        .from(orders)
        .where(inArray(orders.paymentStatus, ["unpaid", "awaiting_transfer"])),
    ),
    countWhere(
      db,
      db
        .select({ total: sql<number>`count(*)` })
        .from(orders)
        .where(eq(orders.status, "preparing")),
    ),
  ]);

  return { pendingApplications, confirmingOrders, awaitingPayment, awaitingShipment };
}
