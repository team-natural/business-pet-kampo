// 新規取引申請の受付。お問い合わせと同じく認証不要の書き込みで、濫用対策はエッジ（WAF レート
// 制限）に任せる。
// TODO(Phase C): createApplicationSchema で検証し、**agreedTermsVersion をサーバー側の現行版と
// 突き合わせてから**保存する（古いフォームからの再送を弾く — DEV-04 §6-1）。status は received
// でサーバーが決め打ちする。受付メールは ctx.waitUntil() で送る。
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
