import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { getOrderByPublicId } from "$lib/server/services/orders";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getOrderByPublicId(context.locals.db, context.params.id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH は配送情報と管理メモのみ。ステータスの遷移は 1 遷移 1 ルートのサブルート
// （/confirm・/prepare・/ship・/complete）で受け、不正遷移は 409 で返す（DEV-04 §5-7、DEV-09 §2-5）。
// 金額列は受け取らない — 明細のスナップショットと食い違う（DEV-07 §6-0）。
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
