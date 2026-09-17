// New trading applications. The visitor-facing half: apps/admin owns the review (ADM-12/13).
import { applications } from "@app/schema";
import type { DbClient } from "@app/schema/client";
import { NotFoundError } from "@app/server-kit/http";
import { eq } from "drizzle-orm";

type ApplicationRow = typeof applications.$inferSelect;

// The applicant sees their own submission back; the reviewer's memo and id stay internal.
export function toPublicApplication(row: ApplicationRow) {
  return {
    id: row.publicId,
    companyName: row.companyName,
    contactName: row.contactName,
    email: row.email,
    status: row.status,
    appliedAt: row.appliedAt,
  };
}

export async function getApplicationByPublicId(db: DbClient, publicId: string) {
  const [row] = await db.select().from(applications).where(eq(applications.publicId, publicId)).limit(1);
  if (!row) throw new NotFoundError("お申し込みが見つかりません。");
  return row;
}

// TODO(Phase C): createApplication / withdrawApplication。
// - agreedTermsVersion は body の値をそのまま保存せず、**サーバー側の現行版と一致するか検証**する
//   （DEV-04 §6-1）。一致しない送信は古いフォームからの再送なので拒否する
// - status はサーバーが received で決め打ちする
// - 取消はログインを伴わないため、URL のトークンだけが本人性の根拠になる。期限切れ・使用済み・
//   不正はすべて同じ応答にする（存在の推測を与えない）
// - 受付メールは batch() の外、ctx.waitUntil() で送る
