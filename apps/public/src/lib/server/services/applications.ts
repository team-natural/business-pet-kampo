// New trading applications. The visitor-facing half: apps/admin owns the review (ADM-12/13).
import { applications } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { ulid } from "@app/schema/ulid";
import { verifyToken } from "@app/server-kit/auth";
import { ConflictError, NotFoundError } from "@app/server-kit/http";
import { and, eq, inArray } from "drizzle-orm";
import { CURRENT_TERMS_VERSION } from "$lib/terms-version";
import type { CreateApplicationInput } from "../validation/applications";

type ApplicationRow = typeof applications.$inferSelect;

// Long enough that an applicant who leaves the mail unread over a holiday can still use it, short
// enough that a forwarded inbox does not carry a live link indefinitely.
export const WITHDRAWAL_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

// The states an applicant may withdraw from (DEV-09 §2-1-2). The full matrix lives in
// apps/admin's applications.ts — this is the one row of it the public side can reach, and the two
// must not drift: an applicant must never be able to withdraw something already approved.
const WITHDRAWABLE_FROM = ["received", "reviewing", "needs_confirmation"] as const;

// The applicant sees their own submission back; the reviewer's memo and id stay internal.
export function toPublicApplication(row: ApplicationRow) {
  return {
    id: row.publicId,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    status: row.status,
    appliedAt: row.appliedAt,
  };
}

export async function getApplicationByPublicId(db: DbClient, publicId: string) {
  const [row] = await db.select().from(applications).where(eq(applications.publicId, publicId)).limit(1);
  if (!row) throw new NotFoundError("お申し込みが見つかりません。");
  return row;
}

export async function createApplication(db: DbClient, input: CreateApplicationInput) {
  // The posted version is compared, never stored as given (DEV-04 §6-1). A stale form would
  // otherwise record consent to wording nobody can reconstruct.
  if (input.agreedTermsVersion !== CURRENT_TERMS_VERSION) {
    throw new ConflictError("利用規約が更新されています。最新の内容をご確認のうえ、もう一度お申し込みください。");
  }

  const now = new Date().toISOString();
  const [row] = await db
    .insert(applications)
    .values({
      publicId: ulid(),
      companyName: input.companyName,
      corporateNumber: input.corporateNumber ?? null,
      businessType: input.businessType ?? null,
      industry: input.industry ?? null,
      postalCode: input.postalCode,
      address: input.address,
      representativeName: input.representativeName,
      contactName: input.contactName,
      contactDepartment: input.contactDepartment ?? null,
      phone: input.phone,
      email: input.email,
      website: input.website ?? null,
      sns: input.sns ?? null,
      hasPhysicalStore: input.hasPhysicalStore ?? 0,
      plannedSalesChannels: input.plannedSalesChannels ?? null,
      desiredProducts: input.desiredProducts ?? null,
      desiredPaymentMethod: input.desiredPaymentMethod ?? null,
      notes: input.notes ?? null,
      agreedToTerms: input.agreedToTerms,
      // The server's constant, not the posted value — they are equal by the check above, and this
      // makes that impossible to undo by editing the insert alone.
      agreedTermsVersion: CURRENT_TERMS_VERSION,
      // Server-set: an applicant must not be able to arrive pre-approved.
      status: "received",
      appliedAt: now,
      updatedAt: now,
    })
    .returning();

  return row!;
}

// Returns nothing either way. Expired, already-withdrawn, forged and unknown all take the same
// path, because a difference in the answer confirms that an application exists (DEV-04 §5-3).
//
// Not recorded in activity_log: the actor holds no account row to attribute it to, and withdrawal
// is outside DEV-05 §9-1's required list. The row's own `status` and `reviewed_at` carry it.
export async function withdrawApplication(db: DbClient, secret: string | undefined, publicId: string, token: string): Promise<void> {
  const subject = await verifyToken(secret, "application-withdrawal", token);
  // The token names the application; the URL must not be able to redirect it at another one.
  if (!subject || subject !== publicId) return;

  const now = new Date().toISOString();
  // The status filter is in the WHERE clause rather than read-then-compare: an approved
  // application cannot be withdrawn, and a concurrent approval cannot slip between the two.
  await db
    .update(applications)
    .set({ status: "withdrawn", reviewedAt: now, updatedAt: now })
    .where(and(eq(applications.publicId, publicId), inArray(applications.status, [...WITHDRAWABLE_FROM])));
}
