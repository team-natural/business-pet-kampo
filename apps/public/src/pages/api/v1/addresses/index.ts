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

// TODO(Phase C): POST。addressSchema で検証し、organization_id はセッションから入れる（body から
// 受け取らない）。isDefault を立てるときは既存の既定を同じ batch() で落とす。
export async function POST({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    requireActiveOrganization(await requireSession(cookies, db));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
