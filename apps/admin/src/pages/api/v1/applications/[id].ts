// `[id]` は申請の public_id（ULID）。
import type { APIContext } from "astro";
import { jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireAdminUser } from "$lib/server/auth/access";
import { getApplicationByPublicId } from "$lib/server/services/applications";

export async function GET(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return jsonItem(await getApplicationByPublicId(context.locals.db, context.params.id!));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH。審査担当者の記録・管理メモ・差し戻しを扱う。申請者が入力した列は
// 書き換えない。status を直接書かず、遷移は遷移関数（または approve / reject）を通す。
export async function PATCH(context: APIContext): Promise<Response> {
  try {
    await requireAdminUser(context);
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
