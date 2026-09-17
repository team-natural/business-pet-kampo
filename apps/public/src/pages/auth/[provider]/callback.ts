// SCR-08 OAuth のコールバック。画面を持たないページルート（DEV-06 §1-2）。
// TODO(Phase C): state を照合し、トークン交換 → social_accounts の突き合わせ → Member セッション発行。
// **認証成功だけで取引先として承認しない** — 未承認のアドレスは申請フローへ送る（INTAKE §7）。
import type { APIContext } from "astro";
import { NotFoundError, toErrorResponse } from "@app/server-kit/http";

const PROVIDERS = ["line", "google", "facebook"] as const;

export async function GET(context: APIContext): Promise<Response> {
  try {
    const provider = context.params.provider;
    if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) throw new NotFoundError("対応していないログイン方法です。");

    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
