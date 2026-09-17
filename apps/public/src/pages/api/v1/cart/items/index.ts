// TODO(Phase C): カートへの追加。addCartItemSchema で形を検証したうえで、**商品が実在するかを
// catalog 側で確認する** — product_slug に外部キーは無く、この確認だけが歯止めになる（D-017）。
// 数量は商品の orderUnit の倍数でなければ拒否する。
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
