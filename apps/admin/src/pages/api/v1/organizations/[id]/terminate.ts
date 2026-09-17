// TODO(Phase C): 取引終了。終端状態なので確認ダイアログを必須にし、所属 Membership の suspended
// 化と保管期限の起点記録まで同じ batch() にまとめる（DEV-09 §2-2）。
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
