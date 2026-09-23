// SCR-08, the OAuth start. A page route with no page (DEV-06 §1-2).
// TODO(Phase C): build the authorization URL with Arctic, put `state` and `code_verifier` in
// httpOnly cookies, and redirect. Only LINE, Google and Facebook are accepted.
import type { APIContext } from "astro";
import { NotFoundError, toErrorResponse } from "@app/server-kit/http";

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
