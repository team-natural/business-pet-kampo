// パスワード再設定の要求。
// TODO(Phase C): member_password_reset_tokens に発行する（有効期限 60 分 — DEV-07 §5-3）。
// **存在しないアドレスでも同じ応答・同じ所要時間で返す。** 差が出ると会員かどうかを問い合わせられる
// （ログインの burnPasswordVerification と同じ理由）。
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
