// TODO(Phase C): 発注確定。ここが最低発注金額・発注単位の**確定判定**の場所で、画面側の表示は
// 判定ではない（DEV-06 §7）。
// - orders + order_items + payments の INSERT と cart_items の DELETE を 1 つの batch() にまとめる
// - 商品名・単価・税率はその場で解決した値を order_items にスナップショット保存する（DEV-07 §6-0）
// - 金額は body から受け取らず lib/commerce.ts の orderTotals で算出する
// - 配送先は自 Organization のものだけを受け付け、注文にスナップショット保存する
// - メール送信・決済 API 呼び出しは batch() の外、ctx.waitUntil() で行う
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { toErrorResponse } from "@app/server-kit/http";
import { requireOrderableOrganization, requireSession } from "$lib/server/auth/session";

export async function POST({ cookies }: APIContext): Promise<Response> {
  try {
    requireOrderableOrganization(await requireSession(cookies, createDb(env.DB)));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
