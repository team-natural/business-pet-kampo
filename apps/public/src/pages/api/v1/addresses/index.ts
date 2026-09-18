import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { listAddresses } from "$lib/server/services/addresses";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    return jsonItem(await listAddresses(db, organization.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): POST. Validate with addressSchema and take organization_id from the session,
// never from the body. Setting isDefault clears the previous default in the same batch().
export async function POST({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    requireActiveOrganization(await requireSession(cookies, db));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
