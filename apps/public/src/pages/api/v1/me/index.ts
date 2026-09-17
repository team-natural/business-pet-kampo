// 会員自身のアカウント情報。/api/v1/auth/me がセッションの確認なのに対し、こちらは編集も伴う。
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

// TODO(Phase C): PATCH。updateMemberSchema で検証する。メールアドレスの変更は確認メールを挟む
// （変更だけで受信先を差し替えられると乗っ取り経路になる）。
export async function PATCH({ cookies }: APIContext): Promise<Response> {
  try {
    await requireSession(cookies, createDb(env.DB));
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
