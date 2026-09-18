// Trading partners (ADM-14〜16). DEV-09 §2-2 is the source of truth for the state machine.
import { memberships, members, organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { and, desc, eq, like, sql } from "drizzle-orm";

export type OrganizationStatus = "active" | "suspended" | "terminated";

// `terminated` is terminal: trading again starts from a new application (DEV-09 §2-2).
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

// ADM-16 is read-only. No create, edit or delete for members — they are a separate account system.
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

// TODO(Phase C): transitionOrganization / updateOrganization。
// - ADM-15 shows the per-organization prices read-only and has no edit path (D-019). The source
//   of truth is packages/content/prices/*.md, joined by org_code
// - one transition function writes `status`, validating against the TRANSITIONS map above
// - moving to `terminated` suspends the memberships and records the retention clock (DEV-09 §2-2)
// - suspending does not drop live sessions, by design. Refusing the order is the job of
//   requireActiveOrganization in apps/public, on every request
