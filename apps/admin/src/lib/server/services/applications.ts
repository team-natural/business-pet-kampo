// Reviewing new trading applications (ADM-12 / ADM-13). DEV-09 §2 is the source of truth for the
// state machine.
import { applications, members, memberships, organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { likeContains } from "@app/schema/query";
import { ulid } from "@app/schema/ulid";
import { ConflictError, InvalidStateTransitionError, NotFoundError } from "@app/server-kit/http";
import { and, desc, eq, sql } from "drizzle-orm";
import type { AdminUser } from "./admin-users";
import { activityLogInsert } from "./activity-log";
import type { ApproveApplicationInput, RejectApplicationInput, ReviewApplicationInput } from "../validation/applications";

export type ApplicationStatus = "received" | "reviewing" | "needs_confirmation" | "approved" | "rejected" | "withdrawn";

// DEV-09 §2-1's table, as written. approved / rejected / withdrawn are terminal; applying again
// creates a new row.
const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  received: ["reviewing", "withdrawn"],
  reviewing: ["needs_confirmation", "approved", "rejected", "withdrawn"],
  // approved is reachable from here (GOV-01 D-034). The matrix in DEV-09 §2-1-2 used to forbid it,
  // which left a sent-back application with no way forward: returning to `reviewing` is the
  // applicant's move, and the MVP has no resubmit flow for them to make it with.
  needs_confirmation: ["reviewing", "approved", "rejected", "withdrawn"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function allowedTransitions(status: ApplicationStatus): ApplicationStatus[] {
  return TRANSITIONS[status] ?? [];
}

type ApplicationRow = typeof applications.$inferSelect;

// reviewer_id and organization_id are internal integers. A screen that needs one of them gets the
// referenced row's public key instead.
export function toPublicApplication(row: ApplicationRow) {
  return {
    id: row.publicId,
    companyName: row.companyName,
    corporateNumber: row.corporateNumber,
    businessType: row.businessType,
    industry: row.industry,
    postalCode: row.postalCode,
    address: row.address,
    representativeName: row.representativeName,
    contactName: row.contactName,
    contactDepartment: row.contactDepartment,
    phone: row.phone,
    email: row.email,
    website: row.website,
    sns: row.sns,
    hasPhysicalStore: row.hasPhysicalStore === 1,
    plannedSalesChannels: row.plannedSalesChannels,
    desiredProducts: row.desiredProducts,
    desiredPaymentMethod: row.desiredPaymentMethod,
    notes: row.notes,
    agreedTermsVersion: row.agreedTermsVersion,
    status: row.status,
    reviewMemo: row.reviewMemo,
    appliedAt: row.appliedAt,
    reviewedAt: row.reviewedAt,
  };
}

const DEFAULT_PER_PAGE = 20;
const MAX_PER_PAGE = 100;

export async function listApplications(db: DbClient, options: { status?: ApplicationStatus; keyword?: string; page?: number; perPage?: number } = {}) {
  const perPage = Math.min(Math.max(options.perPage ?? DEFAULT_PER_PAGE, 1), MAX_PER_PAGE);
  const page = Math.max(options.page ?? 1, 1);

  const where = and(options.status ? eq(applications.status, options.status) : undefined, options.keyword ? likeContains(applications.companyName, options.keyword) : undefined);

  const [rows, [counted]] = await Promise.all([
    db
      .select()
      .from(applications)
      .where(where)
      .orderBy(desc(applications.id))
      .limit(perPage)
      .offset((page - 1) * perPage),
    db
      .select({ total: sql<number>`count(*)` })
      .from(applications)
      .where(where),
  ]);

  return { items: rows.map(toPublicApplication), page, perPage, total: counted?.total ?? 0 };
}

export async function findApplicationRow(db: DbClient, publicId: string): Promise<ApplicationRow> {
  const [row] = await db.select().from(applications).where(eq(applications.publicId, publicId)).limit(1);
  if (!row) throw new NotFoundError("申請が見つかりません。");
  return row;
}

export async function getApplicationByPublicId(db: DbClient, publicId: string) {
  return toPublicApplication(await findApplicationRow(db, publicId));
}

// The unique index rejects a duplicate org_code anyway; this checks it while it is still being
// typed on ADM-13.
export async function isOrgCodeTaken(db: DbClient, orgCode: string): Promise<boolean> {
  const [row] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.orgCode, orgCode)).limit(1);
  return row !== undefined;
}

// members.email is unique across the whole table, so an address already in use would fail the
// approval's batch halfway. Checked first so the reviewer gets told which field to fix.
export async function isEmailRegistered(db: DbClient, email: string): Promise<boolean> {
  const [row] = await db.select({ id: members.id }).from(members).where(eq(members.email, email)).limit(1);
  return row !== undefined;
}

// The only writer of `status`, which is what keeps the legal moves reviewable in one place
// (DEV-09 §3-1). approve and reject go through it too, from inside their own batch.
function assertTransition(from: ApplicationStatus, to: ApplicationStatus): void {
  if (!allowedTransitions(from).includes(to)) throw new InvalidStateTransitionError("Application", from, to);
}

// Assigning a reviewer and moving to `reviewing`, or sending the application back for more
// information. Neither creates anything, so neither needs the approval's batch.
export async function transitionApplication(db: DbClient, publicId: string, to: Extract<ApplicationStatus, "reviewing" | "needs_confirmation">, admin: AdminUser) {
  const row = await findApplicationRow(db, publicId);
  assertTransition(row.status, to);

  const [updated] = await db.batch([
    db
      .update(applications)
      .set({
        status: to,
        // Taking on the review is what records the reviewer; an unreviewed application has none.
        reviewerId: row.reviewerId ?? admin.id,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(applications.id, row.id))
      .returning(),
    activityLogInsert(db, {
      logName: "application",
      description: `Application ${row.status} -> ${to}`,
      subjectType: "Application",
      subjectId: row.id,
      event: `application.${to}`,
      causerId: admin.id,
      properties: { from: row.status, to },
    }),
  ]);

  return toPublicApplication(updated[0]!);
}

// The reviewer's own columns. Never touches `status` — that is the transition functions' alone
// (DEV-09 §3-1).
export async function updateReview(db: DbClient, publicId: string, input: ReviewApplicationInput, admin: AdminUser) {
  const row = await findApplicationRow(db, publicId);

  const [updated] = await db
    .update(applications)
    .set({ reviewMemo: input.reviewMemo ?? null, reviewerId: row.reviewerId ?? admin.id, updatedAt: new Date().toISOString() })
    .where(eq(applications.id, row.id))
    .returning();

  return toPublicApplication(updated!);
}

export interface ApprovalResult {
  application: ReturnType<typeof toPublicApplication>;
  organizationPublicId: string;
  orgCode: string;
  memberPublicId: string;
  memberEmail: string;
}

// The heaviest transition in the app: one request creates the organization, its first member and
// the membership joining them.
//
// All of it is one batch() — D1 runs a batch as a single transaction (DEV-05 §3). Executed as
// separate statements, a failure partway through would leave an organization nobody belongs to,
// and the applicant would be approved with no way in.
export async function approveApplication(db: DbClient, publicId: string, input: ApproveApplicationInput, admin: AdminUser): Promise<ApprovalResult> {
  const row = await findApplicationRow(db, publicId);
  assertTransition(row.status, "approved");

  // Checked here for a readable error; the unique index is what actually guarantees it, including
  // against a second approval racing this one (DEV-07 §5-2).
  if (await isOrgCodeTaken(db, input.orgCode)) {
    throw new ConflictError("この取引先コードは既に使われています。別のコードを指定してください。");
  }
  if (await isEmailRegistered(db, input.initialMemberEmail)) {
    throw new ConflictError("このメールアドレスの会員が既に存在します。");
  }

  const now = new Date().toISOString();
  const organizationPublicId = ulid();
  const memberPublicId = ulid();

  // D1 cannot hand a generated id back to a later statement in the same batch, and it has no
  // interactive transactions — so the later rows reach the earlier ones through subqueries on the
  // public ids minted above. Splitting this into two batches would be the easy way out and would
  // reopen exactly the gap the batch exists to close.
  const organizationId = sql<number>`(select id from organizations where public_id = ${organizationPublicId})`;
  const memberId = sql<number>`(select id from members where public_id = ${memberPublicId})`;

  await db.batch([
    db.insert(organizations).values({ publicId: organizationPublicId, orgCode: input.orgCode, name: row.companyName, status: "active", orderEnabled: 1, applicationId: row.id, updatedAt: now }),
    db
      .insert(members)
      // No password: the member sets one through the activation link (F-01-05). A row with a null
      // hash cannot be logged into — login burns a verification and refuses it (DEV-02 §7).
      .values({ publicId: memberPublicId, name: input.initialMemberName, email: input.initialMemberEmail, passwordHash: null, status: "active", updatedAt: now }),
    db.insert(memberships).values({ memberId, organizationId, role: "client_user", status: "active", joinedAt: now, updatedAt: now }),
    db
      .update(applications)
      .set({ status: "approved", reviewerId: row.reviewerId ?? admin.id, organizationId, reviewedAt: now, updatedAt: now })
      .where(eq(applications.id, row.id)),
    activityLogInsert(db, {
      logName: "application",
      description: `Application approved as ${input.orgCode}`,
      subjectType: "Application",
      subjectId: row.id,
      event: "application.approved",
      causerId: admin.id,
      organizationId,
      properties: { from: row.status, to: "approved", orgCode: input.orgCode },
    }),
  ]);

  return { application: toPublicApplication(await findApplicationRow(db, publicId)), organizationPublicId, orgCode: input.orgCode, memberPublicId, memberEmail: input.initialMemberEmail };
}

export async function rejectApplication(db: DbClient, publicId: string, input: RejectApplicationInput, admin: AdminUser) {
  const row = await findApplicationRow(db, publicId);
  assertTransition(row.status, "rejected");

  const now = new Date().toISOString();
  const [updated] = await db.batch([
    db
      .update(applications)
      .set({ status: "rejected", reviewerId: row.reviewerId ?? admin.id, reviewedAt: now, updatedAt: now })
      .where(eq(applications.id, row.id))
      .returning(),
    activityLogInsert(db, {
      logName: "application",
      description: "Application rejected",
      subjectType: "Application",
      subjectId: row.id,
      event: "application.rejected",
      causerId: admin.id,
      // The reason is in the log because the applicant is told it and nothing else stores it.
      properties: { from: row.status, to: "rejected", reason: input.reason },
    }),
  ]);

  return toPublicApplication(updated[0]!);
}
