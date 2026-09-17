// 申請の取消（申請者本人）。ログインを伴わないため、取消トークンだけが本人性の根拠になる。
// TODO(Phase C): トークンを検証して withdrawn へ遷移させる。期限切れ・使用済み・不正・存在しない
// のすべてを同じ応答にする — 差が出ると申請の実在を確認できてしまう。
import { toErrorResponse } from "@app/server-kit/http";

export async function DELETE(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
