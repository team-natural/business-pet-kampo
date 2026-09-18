// The member's own account. /api/v1/auth/me answers "is this session valid"; this one also edits.
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import { createDb } from "@app/schema/client";
import { NotFoundError, jsonItem, toErrorResponse } from "@app/server-kit/http";
import { requireSession } from "$lib/server/auth/session";
import { getMemberByPublicId, toPublicMember } from "$lib/server/services/members";

export async function GET({ cookies }: APIContext): Promise<Response> {
  try {
    const db = createDb(env.DB);
    const session = await requireSession(cookies, db);

    const member = await getMemberByPublicId(db, session.memberPublicId);
    if (!member) throw new NotFoundError("アカウントが見つかりません。");

    return jsonItem(toPublicMember(member));
  } catch (error) {
    return toErrorResponse(error);
  }
}

// TODO(Phase C): PATCH, validated with updateMemberSchema. An email change goes through a
// confirmation mail — letting one request redirect where notices land is an account-takeover path.
export async function PATCH({ cookies }: APIContext): Promise<Response> {
  try {
    await requireSession(cookies, createDb(env.DB));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
