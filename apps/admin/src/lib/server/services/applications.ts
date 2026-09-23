// Reviewing new trading applications (ADM-12 / ADM-13). DEV-09 §2 is the source of truth for the
// state machine.
import { applications, organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { likeContains } from "@app/schema/query";
import { NotFoundError } from "@app/server-kit/http";
import { and, desc, eq, sql } from "drizzle-orm";

export type ApplicationStatus = "received" | "reviewing" | "needs_confirmation" | "approved" | "rejected" | "withdrawn";

// DEV-09 §2-1's table, as written. approved / rejected / withdrawn are terminal; applying again
// creates a new row.
const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  received: ["reviewing", "withdrawn"],
  reviewing: ["needs_confirmation", "approved", "rejected", "withdrawn"],
  needs_confirmation: ["reviewing", "rejected", "withdrawn"],
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

// TODO(Phase C): transitionApplication / approveApplication / rejectApplication。
// - approval is one batch(): the applications UPDATE plus the organizations / members /
//   memberships / activity_log INSERTs. A partial failure must not leave an organization with no
//   member in it (DEV-05 §3)
// - org_code is assigned at approval and never changes afterwards — the price files reference it
//   (D-019)
// - notification mail goes outside the batch(), through ctx.waitUntil()
