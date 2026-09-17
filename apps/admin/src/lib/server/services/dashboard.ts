// ADM-01 の 4 枚のカード（PRD-04 §4-3-1）。件数だけを返し、明細は各一覧画面が持つ。
import { applications, orders } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { eq, inArray, sql } from "drizzle-orm";

async function countOf(query: Promise<{ total: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.total ?? 0;
}

export async function getDashboardCounts(db: DbClient) {
  const [pendingApplications, confirmingOrders, awaitingPayment, awaitingShipment] = await Promise.all([
    countOf(
      db
        .select({ total: sql<number>`count(*)` })
        .from(applications)
        .where(inArray(applications.status, ["received", "reviewing", "needs_confirmation"])),
    ),
    countOf(
      db
        .select({ total: sql<number>`count(*)` })
        .from(orders)
        .where(eq(orders.status, "confirming")),
    ),
    countOf(
      db
        .select({ total: sql<number>`count(*)` })
        .from(orders)
        .where(inArray(orders.paymentStatus, ["unpaid", "awaiting_transfer"])),
    ),
    countOf(
      db
        .select({ total: sql<number>`count(*)` })
        .from(orders)
        .where(eq(orders.status, "preparing")),
    ),
  ]);

  return { pendingApplications, confirmingOrders, awaitingPayment, awaitingShipment };
}
