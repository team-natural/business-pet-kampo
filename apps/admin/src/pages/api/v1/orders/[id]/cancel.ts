// TODO(Phase C): キャンセルと返金状況の更新。返金額は明細のスナップショットから算出し、
// 再計算のために packages/content を読み直さない（DEV-07 §6-0）。
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
