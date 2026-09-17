// 取引先管理（ADM-14〜16）。状態遷移は DEV-09 §2-2 が正本。
import { memberships, members, organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { and, desc, eq, like, sql } from "drizzle-orm";

export type OrganizationStatus = "active" | "suspended" | "terminated";

// terminated は終端。再取引は新規の申請からやり直す（DEV-09 §2-2）。
const TRANSITIONS: Record<OrganizationStatus, OrganizationStatus[]> = {
  active: ["suspended", "terminated"],
  suspended: ["active", "terminated"],
  terminated: [],
};

export function allowedTransitions(status: OrganizationStatus): OrganizationStatus[] {
  return TRANSITIONS[status] ?? [];
}

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
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export async function listOrganizations(db: DbClient, options: { status?: OrganizationStatus; keyword?: string; page?: number; perPage?: number } = {}) {
  const perPage = Math.min(Math.max(options.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
  const page = Math.max(options.page ?? 1, 1);

  const where = and(options.status ? eq(organizations.status, options.status) : undefined, options.keyword ? like(organizations.name, `%${options.keyword}%`) : undefined);

  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(organizations)
      .where(where)
      .orderBy(desc(organizations.id))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db
      .select({ total: sql<number>`count(*)` })
      .from(organizations)
      .where(where),
  ]);

  return { items: rows.map(toPublicOrganization), page, perPage, total: counted?.total ?? 0 };
}

export async function findOrganizationRow(db: DbClient, publicId: string): Promise<OrganizationRow> {
  const [row] = await db.select().from(organizations).where(eq(organizations.publicId, publicId)).limit(1);
  if (!row) throw new NotFoundError("取引先が見つかりません。");
  return row;
}

export async function getOrganizationByPublicId(db: DbClient, publicId: string) {
  return toPublicOrganization(await findOrganizationRow(db, publicId));
}

// ADM-16 は参照専用。Member の作成・編集・削除は持たせない（Member は別系統のアカウント）。
export async function listOrganizationMembers(db: DbClient, organizationId: number) {
  const rows = await db
    .select({
      id: members.publicId,
      name: members.name,
      email: members.email,
      memberStatus: members.status,
      membershipStatus: memberships.status,
      joinedAt: memberships.joinedAt,
    })
    .from(memberships)
    .innerJoin(members, eq(memberships.memberId, members.id))
    .where(eq(memberships.organizationId, organizationId))
    .orderBy(desc(memberships.id));

  return rows;
}

// ADM-15 は取引先別の卸価格を**参照表示するだけ**で、編集経路を持たない（D-019）。価格は
// packages/content/prices/*.md が正本で、org_code で結びつく。
export async function priceFileHint(row: OrganizationRow): Promise<string> {
  return `packages/content/prices/*.md（orgCode: ${row.orgCode}）`;
}

// TODO(Phase C): transitionOrganization / updateOrganization。
// - 遷移は上の TRANSITIONS を通す単一関数だけが status を書く
// - terminated への遷移では所属 Membership を suspended にし、保管期限の起点を記録する（DEV-09 §2-2）
// - **停止しても進行中のセッションは消さない**（仕様）。発注の拒否は毎リクエストの
//   requireActiveOrganization（apps/public）が担う
