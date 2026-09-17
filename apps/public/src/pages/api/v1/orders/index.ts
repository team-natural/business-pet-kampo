// 発注履歴。自 Organization 分のみ — スコープはセッションから取り、クエリの WHERE に入る。
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { listOrders } from "$lib/server/services/orders";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    return jsonItem(await listOrders(db, organization.id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
