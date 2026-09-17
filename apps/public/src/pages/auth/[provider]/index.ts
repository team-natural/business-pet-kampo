// SCR-08 OAuth の開始。画面を持たないページルート（DEV-06 §1-2）。
// TODO(Phase C): Arctic で認可 URL を組み立て、state / code_verifier を httpOnly クッキーに置いて
// リダイレクトする。プロバイダは LINE / Google / Facebook の 3 つに限定する。
import type { APIContext } from "astro";
import { toErrorResponse } from "@app/server-kit/http";
import { NotFoundError } from "@app/server-kit/http";

const PROVIDERS = ["line", "google", "facebook"] as const;

export async function GET(context: APIContext): Promise<Response> {
  try {
    const provider = context.params.provider;
    // Allow-listed rather than passed through: an unknown provider must not reach the OAuth code.
    if (!PROVIDERS.includes(provider as (typeof PROVIDERS)[number])) throw new NotFoundError("対応していないログイン方法です。");

    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
