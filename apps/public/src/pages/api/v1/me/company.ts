import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { getOrganization } from "$lib/server/services/organizations";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const organization = requireActiveOrganization(await requireSession(cookies, db));

    return jsonItem(await getOrganization(db, organization.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH. Fields the operator must confirm become a change request rather than an
// immediate edit (F-05-03). org_code is never writable from the member side by any path — the
// price files reference it (D-019).
export async function PATCH({ cookies }: APIContext): Promise<Response> {
  try {
    requireActiveOrganization(await requireSession(cookies, createDb(env.DB)));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
