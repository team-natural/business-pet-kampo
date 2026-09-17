// TODO(Phase C): PATCH / DELETE。どちらも getAddress で自 Organization のものだけを引いてから
// 書き込む（存在確認と認可を 1 回のクエリで済ませる）。
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { requireActiveOrganization, requireSession } from "$lib/server/auth/session";
import { getAddress } from "$lib/server/services/addresses";

async function guard({ cookies, params }: APIContext) {
  const db = createDb(env.DB);
  const organization = requireActiveOrganization(await requireSession(cookies, db));
  await getAddress(db, organization.id, params.id!);
}

export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await guard(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(context: APIContext): Promise<Response> {
  try {
    await guard(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
