// パスワード再設定の実行。
// TODO(Phase C): トークンを検証し、used_at を立てるのとパスワード更新を同じ batch() にまとめる
// （片方だけ成功するとトークンが再利用できてしまう）。成功時は既存セッションを全て失効させる。
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
