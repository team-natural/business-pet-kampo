// カート内容。明細の単価は保存値ではなく都度解決（取引先別価格 → 標準卸価格）— 保存すると
// 価格改定後のカートが古い単価のまま発注に進む（DEV-07 §6-0）。
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { listCartItems } from "$lib/server/services/cart";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);
    const organization = requireActiveOrganization(session);

    // TODO(Phase C): 単価・小計・税額・送料・合計を載せて返す（DEV-04 §5-5）。
    return jsonItem(await listCartItems(db, organization.id, session.memberId));
  } catch (error) {
    return toErrorResponse(error);
  }
}
