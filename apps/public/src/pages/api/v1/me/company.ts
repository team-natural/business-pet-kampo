import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { NotFoundError, ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { notifyCompanyChangeRequested } from "$lib/server/mail/organizations";
import { getMemberByPublicId } from "$lib/server/services/members";
import { getOrganization, requestCompanyChange } from "$lib/server/services/organizations";
import { companyChangeRequestSchema } from "$lib/server/validation/me";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const organization = requireActiveOrganization(await requireSession(cookies, db));

    return jsonItem(await getOrganization(db, organization.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// Nothing on `organizations` changes here: the fields on SCR-14 are contract data the operator
// re-checks first, so this records a request and notifies them (F-05-03, D-035). org_code is
// writable from no member-side path at all (D-019).
export async function PATCH({ request, cookies, locals }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    const member = await getMemberByPublicId(db, session.memberPublicId);
    if (!member) throw new NotFoundError("アカウントが見つかりません。");

    const input = companyChangeRequestSchema.parse(await request.json());
    const requested = await requestCompanyChange(db, organization.id, member, input);

    // The audit entry is already committed, so a failed notification must not turn the member's
    // 200 into a 500 — notifyCompanyChangeRequested never throws.
    locals.cfContext?.waitUntil(notifyCompanyChangeRequested(env, requested));

    return jsonItem({ changes: requested.changes });
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
