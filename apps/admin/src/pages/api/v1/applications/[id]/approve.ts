// 承認。1 リクエストで Organization・初期 Member・Membership が生まれる、最も重い遷移。
// TODO(Phase C): approveApplicationSchema で検証し、applications の UPDATE +
// organizations / members / memberships / activity_log の INSERT を**1 つの batch()** にまとめる
// （DEV-05 §3）。org_code の重複は UNIQUE 制約が弾く。有効化案内メールは batch() の外で送る。
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
