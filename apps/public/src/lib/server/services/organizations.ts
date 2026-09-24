// The member-facing view of their own trading account. Writes that the operator must confirm are
// requests, not edits (PRD-03 F-05-03).
import { organizations } from "@app/schema";
import { activityLogInsert } from "@app/schema/activity-log";
import type { DbClient } from "@app/schema/client";
import { NotFoundError, ValidationError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";
import type { CompanyChangeRequestInput } from "../validation/me";

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

// TODO(S13): requestWithdrawal. Only the admin-side transition function moves `status`; a
// member's request lands in activity_log and a notification, exactly as the change request below.

// The fields a member may ask to have changed. `orgCode` is absent by construction: the operator
// assigns it and the price files key off it, so it is writable from no member-side path (D-019).
const CHANGE_LABELS: Record<keyof Omit<CompanyChangeRequestInput, "message">, string> = {
  name: "会社名",
  billingPostalCode: "請求先郵便番号",
  billingAddress: "請求先住所",
};

export interface CompanyChangeRequest {
  organizationPublicId: string;
  organizationName: string;
  orgCode: string;
  memberName: string;
  memberEmail: string;
  // Only the fields that actually differ from what is stored, as label / before / after.
  changes: { label: string; before: string; after: string }[];
  message: string | null;
}

// Nothing on `organizations` moves here. Every field on SCR-14 is contract data the operator
// re-checks before it takes effect (D-035), so the member's submission becomes an audit entry and
// a notification — the edit itself happens in ADM-15.
export async function requestCompanyChange(db: DbClient, organizationId: number, member: { id: number; name: string; email: string }, input: CompanyChangeRequestInput): Promise<CompanyChangeRequest> {
  const [row] = await db.select().from(organizations).where(eq(organizations.id, organizationId)).limit(1);
  if (!row) throw new NotFoundError("取引先が見つかりません。");

  const current: Record<keyof typeof CHANGE_LABELS, string> = { name: row.name, billingPostalCode: row.billingPostalCode ?? "", billingAddress: row.billingAddress ?? "" };
  const changes = (Object.keys(CHANGE_LABELS) as (keyof typeof CHANGE_LABELS)[]).filter((field) => input[field] !== undefined && input[field] !== current[field]).map((field) => ({ label: CHANGE_LABELS[field], before: current[field], after: input[field]! }));

  // A request with nothing in it would still mail the operator and still be logged, which trains
  // them to ignore the notification.
  if (changes.length === 0 && !input.message) throw new ValidationError({ name: ["変更したい内容を入力してください。"] });

  await activityLogInsert(db, {
    logName: "organization",
    description: `${row.name} から会社情報の変更申請がありました。`,
    subjectType: "Organization",
    subjectId: row.id,
    event: "company_change_requested",
    // Member-initiated, so it must say so: the default is AdminUser (DEV-07 §4-2).
    causerType: "Member",
    causerId: member.id,
    organizationId: row.id,
    properties: { changes, message: input.message ?? null },
  });

  return { organizationPublicId: row.publicId, organizationName: row.name, orgCode: row.orgCode, memberName: member.name, memberEmail: member.email, changes, message: input.message ?? null };
}
