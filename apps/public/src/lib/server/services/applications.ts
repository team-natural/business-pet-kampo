// New trading applications. The visitor-facing half: apps/admin owns the review (ADM-12/13).
import { applications } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";

type ApplicationRow = typeof applications.$inferSelect;

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

// TODO(Phase C): createApplication / withdrawApplication.
// - do not store the posted agreedTermsVersion as given: compare it with the server's current
//   constant first (DEV-04 §6-1). A mismatch is a resubmitted stale form and is refused
// - `status` is server-set to `received`
// - withdrawal involves no login, so the URL token is the only evidence of who is asking. Expired,
//   used and forged all answer identically, so nothing confirms an application exists
// - the acknowledgement mail goes outside the batch(), through ctx.waitUntil()
