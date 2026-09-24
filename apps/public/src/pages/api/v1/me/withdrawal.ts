// The member asking to close the account (F-12-01). Nothing here moves a `status` — the operator's
// transition function owns that, and it refuses outright while orders or payments are outstanding
// (F-12-02, DEV-09 §2-2). This route records the request and notifies.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { NotFoundError, ValidationError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { ZodError, flattenError } from "zod";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { notifyWithdrawalRequested } from "$lib/server/mail/organizations";
import { getMemberByPublicId } from "$lib/server/services/members";
import { requestWithdrawal } from "$lib/server/services/organizations";
import { withdrawalSchema } from "$lib/server/validation/me";

export async function POST({ request, cookies, locals }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    const member = await getMemberByPublicId(db, session.memberPublicId);
    if (!member) throw new NotFoundError("アカウントが見つかりません。");

    const input = withdrawalSchema.parse(await request.json());
    const requested = await requestWithdrawal(db, organization.id, member, input);

    // The audit entry is already committed, so a failed notification must not turn the member's
    // 200 into a 500 — notifyWithdrawalRequested never throws.
    locals.cfContext?.waitUntil(notifyWithdrawalRequested(env, requested));

    return jsonItem({ requested: true });
  } catch (error) {
    if (error instanceof ZodError) return toErrorResponse(new ValidationError(flattenError(error).fieldErrors));
    return toErrorResponse(error);
  }
}
