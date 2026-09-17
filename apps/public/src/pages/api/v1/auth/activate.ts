// アカウント有効化（承認後の初回パスワード設定）。
// TODO(Phase C): 有効化トークンを検証し、members.password_hash を設定してセッションを発行する。
// トークンの検証失敗はすべて同じ応答にする。
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
