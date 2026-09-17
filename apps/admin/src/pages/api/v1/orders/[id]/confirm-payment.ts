// TODO(Phase C): 銀行振込の入金確認（消込）。payments と orders.payment_status の更新、
// activity_log の INSERT を 1 つの batch() にまとめる（DEV-09 §2-6）。
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
