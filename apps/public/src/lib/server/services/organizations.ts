// The member-facing view of their own trading account. Writes that the operator must confirm are
// requests, not edits (PRD-03 F-05-03).
import { organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";

type OrganizationRow = typeof organizations.$inferSelect;

export function toPublicOrganization(row: OrganizationRow) {
  return {
    id: row.publicId,
    orgCode: row.orgCode,
    name: row.name,
    status: row.status,
    orderEnabled: row.orderEnabled === 1,
    billingPostalCode: row.billingPostalCode,
    billingAddress: row.billingAddress,
  };
}

export async function getOrganization(db: DbClient, organizationId: number) {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!row) throw new NotFoundError("取引先が見つかりません。");
  return toPublicOrganization(row);
}

// TODO(Phase C): requestCompanyChange / requestWithdrawal。
// - org_code は運営が採番したキーで、価格ファイルが参照している。**会員側から変更させない**（D-019）
// - status の遷移は admin 側の遷移関数だけが行う。会員側の申し出は activity_log と通知に落とす
