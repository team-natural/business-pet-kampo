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

// TODO(Phase C): PATCH。運営確認が必要な項目は即時反映せず変更申請として扱う（F-05-03）。
// org_code はどの経路でも会員側から変更させない（価格ファイルの参照キー — D-019）。
export async function PATCH({ cookies }: APIContext): Promise<Response> {
  try {
    requireActiveOrganization(await requireSession(cookies, createDb(env.DB)));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
