// Approval: the heaviest transition here, since one request creates the organization, the first
// member and the membership.
// TODO(Phase C): validate with approveApplicationSchema, then put the applications UPDATE and the
// organizations / members / memberships / activity_log INSERTs in one batch() (DEV-05 §3). The
// unique index rejects a duplicate org_code. The activation mail goes outside the batch().
import type { APIContext } from "astro";
import { toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";

export async function POST(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
