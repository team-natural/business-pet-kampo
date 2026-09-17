// 新規取引申請の審査（ADM-12 / ADM-13）。状態遷移は DEV-09 §2 が正本。
import { applications, organizations } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { and, desc, eq, like, sql } from "drizzle-orm";

export type ApplicationStatus = "received" | "reviewing" | "needs_confirmation" | "approved" | "rejected" | "withdrawn";

// DEV-09 §2-1 の遷移表そのまま。approved / rejected / withdrawn は終端で、再申請は新しい行になる。
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

// reviewer_id と organization_id は内部の整数。公開キーが要る画面には別途解決して渡す。
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

  const where = and(options.status ? eq(applications.status, options.status) : undefined, options.keyword ? like(applications.companyName, `%${options.keyword}%`) : undefined);

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

// org_code の重複は UNIQUE 制約が弾くが、採番画面の入力時点でも確認する（ADM-13）。
export async function isOrgCodeTaken(db: DbClient, orgCode: string): Promise<boolean> {
  const [row] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.orgCode, orgCode)).limit(1);
  return row !== undefined;
}

// TODO(Phase C): transitionApplication / approveApplication / rejectApplication。
// - 承認は applications の UPDATE + organizations / members / memberships の INSERT +
//   activity_log の INSERT を**1 つの batch()** にまとめる。途中で失敗して「取引先はできたが所属
//   Member がいない」状態を作らない（DEV-05 §3）
// - org_code は承認時に採番する。以後変更しない（価格ファイルの参照キー — D-019）
// - 通知メールは batch() の外、ctx.waitUntil() で送る
