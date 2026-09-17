// TODO(Phase C): 取引停止（DEV-09 §2-2）。**進行中のセッションは失効させない** — 発注の拒否は
// apps/public の requireActiveOrganization が毎リクエスト行う。
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
