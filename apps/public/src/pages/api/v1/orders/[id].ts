// `[id]` は注文の public_id（ULID）。他社の注文は 403 ではなく 404 相当（NotFoundError）で返す —
// 区別すると id の実在を確認できてしまう。
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { getOrder } from "$lib/server/services/orders";

export async function GET({ cookies, params }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    return jsonItem(await getOrder(db, organization.id, params.id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}
