// Sending the application back for more information: reviewing -> needs_confirmation.
//
// No applicant-facing resubmit flow exists in the MVP, so the operator collects the answer off-site
// and then approves or rejects from here directly (GOV-01 D-034).
import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { transitionApplication } from "$lib/server/services/applications";

export async function POST(context: APIContext): Promise<Response> {
  try {
    const admin = await requireAdminUser(context);
    return jsonItem(await transitionApplication(context.locals.db, context.params.public_id!, "needs_confirmation", admin));
  } catch (error) {
    return toErrorResponse(error);
  }
}
