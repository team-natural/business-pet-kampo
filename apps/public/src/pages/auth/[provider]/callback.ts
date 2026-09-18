// SCR-08, the OAuth callback. A page route with no page (DEV-06 §1-2).
// TODO(Phase C): check `state`, exchange the code, match against social_accounts, issue a member
// session. Authenticating is not approval: an address with no approved application goes to the
// application flow instead (INTAKE §7).
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
