// Trading partners (ADM-14〜16). DEV-09 §2-2 is the source of truth for the state machine.
import { memberships, members, organizations, shippingAddresses } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { likeContains } from "@app/schema/query";
import { ConflictError, InvalidStateTransitionError, NotFoundError } from "@app/server-kit/http";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AdminUser } from "./admin-users";
import { listOutstandingOrders } from "./orders";
import { activityLogInsert } from "@app/schema/activity-log";
import type { UpdateOrganizationInput } from "../validation/organizations";

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

  const where = and(options.status ? eq(organizations.status, options.status) : undefined, options.keyword ? likeContains(organizations.name, options.keyword) : undefined);

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

// Who gets told when trading stops or resumes (DEV-09 §2-2-4). Read before the transition, not
// after: terminating suspends every membership in the same batch, so afterwards this is empty.
export async function listActiveMemberContacts(db: DbClient, organizationId: number) {
  return db
    .select({ email: members.email, name: members.name })
    .from(memberships)
    .innerJoin(members, eq(memberships.memberId, members.id))
    .where(and(eq(memberships.organizationId, organizationId), eq(memberships.status, "active"), eq(members.status, "active")));
}

// Shipping addresses are the organization's, not a member's, so they belong on this screen
// (F-07-06). Read-only here: the member maintains them from their own mypage.
export async function listShippingAddresses(db: DbClient, organizationId: number) {
  return db.select({ id: shippingAddresses.publicId, recipientName: shippingAddresses.recipientName, postalCode: shippingAddresses.postalCode, address: shippingAddresses.address, phone: shippingAddresses.phone, isDefault: shippingAddresses.isDefault }).from(shippingAddresses).where(eq(shippingAddresses.organizationId, organizationId)).orderBy(desc(shippingAddresses.isDefault), desc(shippingAddresses.id));
}

// The operator's own columns. `status` is absent by construction — only transitionOrganization
// writes it — and so is `org_code`, which never changes once assigned (D-019).
export async function updateOrganization(db: DbClient, publicId: string, input: UpdateOrganizationInput, admin: AdminUser) {
  const row = await findOrganizationRow(db, publicId);

  const [updated] = await db.batch([
    db
      .update(organizations)
      .set({
        name: input.name ?? row.name,
        billingPostalCode: input.billingPostalCode ?? row.billingPostalCode,
        billingAddress: input.billingAddress ?? row.billingAddress,
        memo: input.memo ?? row.memo,
        // Only meaningful while active: a suspended partner is already refused by
        // requireActiveOrganization regardless of this flag.
        orderEnabled: input.orderEnabled ?? row.orderEnabled,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(organizations.id, row.id))
      .returning(),
    activityLogInsert(db, {
      logName: "organization",
      description: `Organization updated (${row.orgCode})`,
      subjectType: "Organization",
      subjectId: row.id,
      event: "organization.updated",
      causerId: admin.id,
      organizationId: row.id,
      properties: { orderEnabled: input.orderEnabled ?? row.orderEnabled },
    }),
  ]);

  return toPublicOrganization(updated[0]!);
}

// The only writer of `status` (DEV-09 §3-1). Suspension and termination both reach into other
// tables, so each transition is one batch() — a partner marked terminated whose members are still
// active would keep ordering.
export async function transitionOrganization(db: DbClient, publicId: string, to: OrganizationStatus, admin: AdminUser, reason?: string) {
  const row = await findOrganizationRow(db, publicId);
  if (!allowedTransitions(row.status).includes(to)) {
    throw new InvalidStateTransitionError("Organization", row.status, to);
  }

  // Termination is refused while goods are still owed to the partner or money is still owed to us
  // (F-12-02). It is a terminal state — there is no way back out (DEV-09 §2-2-2) — so an order
  // stranded by it can never be delivered or collected, and the numbers are named here because
  // "there are outstanding orders" leaves the operator nothing to chase.
  if (to === "terminated") {
    const outstanding = await listOutstandingOrders(db, row.id);
    if (outstanding.length > 0) {
      const numbers = outstanding.map((order) => order.orderNumber).join("、");
      throw new ConflictError(`未完了のご発注または未入金が残っているため取引を終了できません（${numbers}）。先に発注と入金の処理を完了またはキャンセルしてください。`);
    }
  }

  const now = new Date().toISOString();
  const update = db
    .update(organizations)
    .set({
      status: to,
      // order_enabled tracks the status rather than being set by hand: an operator who resumed a
      // partner but left the flag off would have produced a partner who can log in and not order,
      // with nothing on screen explaining why (DEV-09 §2-2-4).
      orderEnabled: to === "active" ? 1 : 0,
      // Stamped once, on the way into terminated. §10's deletion batch counts from here.
      terminatedAt: to === "terminated" ? now : row.terminatedAt,
      updatedAt: now,
    })
    .where(eq(organizations.id, row.id))
    .returning();

  const log = activityLogInsert(db, {
    logName: "organization",
    description: `Organization ${row.status} -> ${to} (${row.orgCode})`,
    subjectType: "Organization",
    subjectId: row.id,
    event: `organization.${to}`,
    causerId: admin.id,
    organizationId: row.id,
    properties: reason ? { from: row.status, to, reason } : { from: row.status, to },
  });

  // Written as two whole batches rather than one array built with push(): drizzle types a batch as
  // a tuple, and a conditionally grown array loses the per-statement result types.
  //
  // Terminating ends every membership with it. Left active, the rows would still satisfy
  // requireActiveOrganization's membership half if the organization check were ever relaxed.
  const [updated] = to === "terminated" ? await db.batch([update, log, db.update(memberships).set({ status: "suspended", leftAt: now, updatedAt: now }).where(eq(memberships.organizationId, row.id))]) : await db.batch([update, log]);

  return toPublicOrganization(updated[0]!);
}
