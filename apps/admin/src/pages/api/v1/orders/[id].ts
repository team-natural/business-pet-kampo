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

// TODO(Phase C): PATCH。ステータス変更は遷移関数を通し、不正遷移は 409（InvalidStateTransitionError）
// で返す。金額列は受け取らない — 明細のスナップショットと食い違う（DEV-07 §6-0）。
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
