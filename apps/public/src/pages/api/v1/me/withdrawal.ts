// TODO(Phase C): 退会・取引終了の申し出。会員側で status を動かさない — 遷移は運営側の遷移関数
// だけが行い、ここは申し出の記録と通知に留める（DEV-09 §2-2）。
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { requireSession } from "$lib/server/auth/session";

export async function POST({ cookies }: APIContext): Promise<Response> {
  try {
    await requireSession(cookies, createDb(env.DB));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
