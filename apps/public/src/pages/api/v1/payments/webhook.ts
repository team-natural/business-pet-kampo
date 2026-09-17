// 決済サービスからの通知。セッションは無く、**署名検証が唯一の認証**である（DEV-10 §2）。
// TODO(Phase C):
// - 署名を検証してから body を解釈する。検証前に JSON を信用しない
// - payment_event_logs.provider_event_id の UNIQUE 違反を「処理済み」として 200 で返す。
//   これが冪等性の実体で、再送のたびに決済状態を二重更新しないための仕組み（DEV-07 §6-5）
// - 未知のイベント種別は無視して 200。再送され続ける状態を作らない
import { toErrorResponse } from "@app/server-kit/http";

export async function POST(): Promise<Response> {
  try {
    return new Response("Not implemented", { status: 501 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
