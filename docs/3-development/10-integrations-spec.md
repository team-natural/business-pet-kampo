---
doc-id: DEV-10
title: 統合・外部 API 仕様
phase: 3
status: draft-ai
owner: Tech Lead
last-updated: 2026-09-15
related-docs:
  - DEV-01: 技術スタック決定書
  - DEV-02: セキュリティ
  - DEV-04: API 仕様（エンドポイントの配置 — §1-1）
  - DEV-05: バックエンド実装
  - DEV-08: デプロイ定義
  - PRD-05: AI 機能仕様（不採用）
---

# 10-integrations-spec.md — 統合・外部 API 仕様

## このセクションの目的

外部サービス（決済 / メール / ストレージ / OAuth 等）との統合パターン、Webhook、冪等性確保、認証方式、エラーハンドリングを集約する。使用するサービス・ライブラリの選定は DEV-01（§1 確定スタック・§2 機能別標準ライブラリ）で一意化済みであり、本書では選定・代替比較は行わない。本プロジェクトは LLM・リアルタイム通信を採用しないため（PRD-05）、それらの節はテンプレート標準から除外している。

---

## 1. 統合の標準パターン

### 1-1. 統合方式の分類

| 方式 | 用途 | 実装パターン |
| --- | --- | --- |
| 同期 API 呼び出し | 即座にレスポンスが必要（郵便番号検索等） | `fetch()`、タイムアウト 5〜10 秒 |
| 非同期 API 呼び出し | レスポンス待ち不要 | `ctx.waitUntil()` による後処理（Queues 不採用 — DEV-01 §1。DEV-05 §4） |
| Webhook 受信 | 決済サービスからの通知 | 署名検証 + 冪等性 |
| バッチ連携 | 定期同期（データ保管期限バッチ等） | Cloudflare Cron Triggers（`Confirmed` — DEV-01 §2） |

### 1-2. 共通実装ルール

| ルール | 内容 |
| --- | --- |
| HTTP Client | Workers 標準の `fetch()` を使用（追加の HTTP クライアントライブラリは導入しない） |
| タイムアウト | 同期：5〜10 秒、非同期：30 秒 |
| リトライ | 指数バックオフ（10s / 30s / 60s）、3 回まで |
| エラーハンドリング | 4xx は記録のみ、5xx はリトライ、ネットワークエラーはリトライ |
| ログ | request_id を必ず付与、レスポンスは最初の 500 文字のみ |
| 監視 | 失敗を構造化ログに出力。エラー監視ツール導入後（DEV-01 §2: `@sentry/cloudflare`）は同ツールにも送信し成功率を確認 |

### 1-3. シークレット管理

| 区分 | 管理場所 |
| --- | --- |
| API キー | `.dev.vars`（local、gitignore 対象）/ Cloudflare Workers シークレット（本番。`wrangler secret put`。DEV-01 §1・DEV-08 参照） |
| Webhook 署名キー | 同上 |
| OAuth Client Secret | 同上 |

コードからは `import { env } from "cloudflare:workers"` 経由で `env.XXX` としてアクセスする。

---

## 2. 決済（カード決済 + 銀行振込）

### 2-1. 採用機能

本プロジェクトは発注ごとの都度決済であり、サブスクリプション課金は採用しない（DEV-01 §2、BIZ-03 §1）。

| 機能 | 採用 |
| --- | --- |
| Checkout Session（ホスト型決済ページ、単発の一回払い） | ○ |
| 銀行振込 | ○（運営が入金確認して手動でステータス更新。§2-2） |
| Subscription（継続課金） | ✕（GOV-01 D-010「掛売り不採用」の通り、本サービスは都度決済のみ） |
| Customer Portal | ✕（サブスクリプションを扱わないため不要） |

### 2-2. 標準フロー

```
【カード決済】
1. Member が発注内容確認画面（PRD-04 SCR-22）で「カード決済」を選択し発注確定
2. apps/public: Order（payment_status: unpaid）を作成し、Stripe Checkout Session を作成（success_url / cancel_url 指定、Order の public_id をメタデータに付与）
3. Member を Stripe Checkout にリダイレクト
4. 決済成功 → success_url（/checkout/complete）にリダイレクト
5. 並行して Stripe → Webhook → apps/public に通知
6. Webhook ハンドラで Payment を paid に更新、Order は received のまま維持（出荷フローは別軸。DEV-09 §2-5・§2-6）

【銀行振込】
1. Member が発注内容確認画面で「銀行振込」を選択し発注確定
2. apps/public: Order（payment_status: awaiting_transfer）を作成、振込先情報をメールで案内
3. 取引先が振込を実施
4. AdminUser が入金を確認し、管理画面から Payment を paid に手動更新（PRD-03 F-08-03）
```

> success_url へのリダイレクトと Webhook は**順序が保証されない**。完了画面（SCR-23）は「決済完了」を断定せず、Order の現在の `payment_status` を読んで表示する。Webhook がまだ届いていない場合は「確認中」を出す。

### 2-3. 必須環境変数

`STRIPE_*` のキー一覧は §10（環境変数まとめ）を参照。

### 2-4. Webhook ハンドリング

エンドポイント: `POST /api/v1/payments/webhook`（Astro API Route、`apps/public/src/pages/api/v1/payments/webhook.ts`）。決済サービスに登録する URL はこの 1 本のみとし、`apps/admin` 側に同名のエンドポイントを作らない（DEV-04 §5-6）。`stripe` npm パッケージの SDK は Node 依存を含むため、`wrangler.jsonc` に `nodejs_compat` フラグが必要（DEV-01 §2）。

```typescript
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import Stripe from "stripe";

export async function POST({ request }: APIContext): Promise<Response> {
  const stripe = new Stripe(env.STRIPE_SECRET);

  // 1. 署名検証
  const body = await request.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, request.headers.get("stripe-signature") ?? "", env.STRIPE_WEBHOOK_SECRET);
  } catch {
    return new Response("Invalid signature", { status: 401 });
  }

  // 2. 冪等性チェック（payment_event_logs テーブル、DEV-07 §6-12）
  const existing = await findPaymentEventLog(db, event.id);
  if (existing) {
    return new Response("Already processed", { status: 200 });
  }

  // 3. ログ記録
  await recordPaymentEventLog(db, { providerEventId: event.id, eventType: event.type, payload: event.data });

  // 4. 処理
  switch (event.type) {
    case "checkout.session.completed":
      await markPaymentPaidFromCheckoutSession(db, event.data.object);
      break;
    case "checkout.session.expired":
      await markPaymentFailed(db, event.data.object);
      break;
    case "charge.refunded":
      await recordPaymentRefund(db, event.data.object); // DEV-09 §2-6-2
      break;
    default:
      break;
  }

  // 5. 処理完了マーク
  await markPaymentEventProcessed(db, event.id);

  return new Response("OK", { status: 200 });
}
```

> 上記は Webhook 処理の**考え方**を示す簡略例。実際の D1 アクセスは Drizzle 経由の Service 関数に集約する（DEV-05 §2、DEV-07 §11）。API Route に SQL を書かない。
>
> **冪等性チェック（手順 2）を省略できない理由**: 決済サービスは同じイベントを再送する。`payments.status` の遷移マトリクスは `paid → paid` を許可しないため（DEV-09 §2-6-2）、冪等化を忘れると再送のたびに `InvalidTransitionError` になり、決済サービス側から見て Webhook が延々と失敗し続ける。冪等性の実体は `payment_event_logs.provider_event_id` の UNIQUE 制約である（DEV-07 §6-12）。
>
> 署名検証の失敗は 401 を返し、リトライさせない。攻撃の可能性があるためエラー監視へ送る（§8-2）。

### 2-5. 監視すべきイベント

| イベント | 処理 |
| --- | --- |
| `checkout.session.completed` | Payment を `paid` に更新（DEV-09 §2-6-2） |
| `checkout.session.expired` | Payment を `failed` に更新、取引先へ再決済を案内 |
| `charge.refunded` | Payment を `refunded` / `partially_refunded` に更新 |

---

## 3. メール（Resend）

メールは **Resend（`resend` npm パッケージ）で確定**（DEV-01 §1。オプションではなく確定スタック）。プロジェクト開始時に導入する。

### 3-1. 設定

```bash
# apps/public・apps/admin 双方にメール送信の関心事があるため、両方に導入する
pnpm --filter public add resend
pnpm --filter admin add resend

# .dev.vars（local）/ Cloudflare Workers シークレット（本番）
RESEND_API_KEY=re_xxxxxxxxxx
MAIL_FROM_ADDRESS=noreply@example.com
MAIL_FROM_NAME="${APP_NAME}"
```

```typescript
// apps/public/src/lib/server/mail/client.ts（apps/admin 側にも同等のファイルを用意）
import { Resend } from "resend";

export function createResendClient(env: Env): Resend {
  return new Resend(env.RESEND_API_KEY);
}
```

### 3-2. ドメイン認証（必須）

| 項目 | 設定先 |
| --- | --- |
| SPF | DNS TXT レコード |
| DKIM | Resend 提供の DNS レコード |
| DMARC | DNS TXT レコード（`v=DMARC1; p=quarantine; rua=mailto:dmarc@...;`） |

Resend Dashboard で検証ステータスを確認、すべて緑になってから本番運用。ドメイン取得・認証設定は未着手（`[Open: TBD-01, GOV-02]`）。

### 3-3. 送信の標準パターン

宛先による送信経路の使い分けは **DEV-05 §4-1 を正本** とする。専用の Notification/Mailable クラス分けの仕組みは存在しないため、Member アカウント未作成の宛先（新規取引申請者等）も同じ送信関数を使う：

```typescript
// apps/public/src/lib/server/mail/applications.ts
import { createResendClient } from "./client";

// アカウント未作成の申請者への送信（承認時のアカウント有効化案内）
export async function sendApplicationApprovedEmail(env: Env, application: Application, activationUrl: string): Promise<void> {
  const resend = createResendClient(env);

  await resend.emails.send({
    from: env.MAIL_FROM_ADDRESS,
    to: application.email,
    subject: `【${env.APP_NAME}】新規取引申請が承認されました`,
    html: renderApplicationApprovedEmail({ application, activationUrl }),
  });
}
```

```typescript
// 例: 入金待ちが一定日数経過したアラート（運営宛。apps/admin 側の Cron ジョブから呼び出す）
await sendAwaitingTransferOverdueAlertEmail(env, order);
```

### 3-4. ルール

- 宛先による送信経路の使い分けは DEV-05 §4-1 参照（取引先宛の通知を一時実装で済ませない）
- 送信は `ctx.waitUntil()` で後処理化してレスポンスをブロックしない（DEV-05。Queues は不採用）。大量一括送信は Cron バッチに寄せる
- **トランザクション（`batch()`）の中で送信しない。** 申請承認のようにメール送信を伴う操作は、DB のコミット完了後に送る（DEV-05 §3）。先に送ると、DB がロールバックしたのに「承認されました」のメールだけが届く
- テンプレートを介さない、都度組み立てた生の HTML/テキストの直接送信は禁止（テンプレート関数を経由する）
- Subject は `【サービス名】` で始める統一スタイル（サービス名は `[Open: TBD-01]`）
- 配信エラーは Resend Webhook で受信

---

## 4. ファイルストレージ（Cloudflare R2）

ファイルストレージは **Cloudflare R2** で確定（DEV-01 §1。バインディング名は必ず `BUCKET`）。商品画像・メーカーロゴ・お知らせ添付等に使用する。

### 4-1. 設定（R2 バインディング）

```jsonc
// wrangler.jsonc
{
  "r2_buckets": [{ "binding": "BUCKET", "bucket_name": "<project>-bucket" }],
}
```

```typescript
// Service 内での操作例
await env.BUCKET.put(key, fileBody, { httpMetadata: { contentType } });
const object = await env.BUCKET.get(key);
await env.BUCKET.delete(key);
```

> D1/R2 は 1 サービスにつき 1 回だけ作成し、`apps/public`・`apps/admin` の両方の `wrangler.jsonc` で同じ `bucket_name` を使う（CLAUDE.md「D1/R2 バインディングルール」参照）。

### 4-2. バケット構造

商品カタログは運営が一元管理する共有データであり、Organization 単位のプレフィックス階層は持たない（PRD-02 §2）。

```
/manufacturers/{manufacturer_id}/logo/         # メーカーロゴ
/products/{product_id}/images/                 # 商品画像
/news/{news_id}/attachments/                   # お知らせ添付
```

### 4-3. アクセス制御

| ファイル種別 | アクセス方式 |
| --- | --- |
| 商品画像・メーカーロゴ（公開情報） | 公開 URL |
| お知らせ添付（取引先限定公開の場合） | 署名付き URL（15 分有効） |

R2 のオブジェクトキーをそのまま公開 URL として返さない（DEV-01 §8）。行と実バイトの整合は「追加は R2 → 行、削除は行 → R2 の逆順」で保つ（DEV-05 §3）。

### 4-4. バックアップ

バックアップ範囲・頻度の正本は OPS-02 §4（初期は商品画像等の重要ファイルのみ）。本書では範囲・頻度を定めない。

---

## 5. OAuth（ソーシャルログイン。Member 向け）

### 5-1. 採用判断

INTAKE §4-4 のとおり、以下を採用する。AdminUser（管理画面）は OAuth を採用せずメール認証のみ（DEV-02 §1-1）。

| プロバイダ | 採用 |
| --- | --- |
| LINE | ○（日本国内 BtoB のため。Arctic に専用プリセットが無いため自前実装。§5-2）|
| Google | ○（Arctic の専用プリセットクラスを使用）|
| Facebook | ○（Arctic の専用プリセットクラスを使用）|
| メールアドレス・パスワード | ○（標準認証として併存）|

### 5-2. 標準実装

Arctic を使用（`pnpm --filter public add arctic`。DEV-01 §2）。Google / Facebook は Arctic の専用プリセットクラスを使う。LINE ログインは専用プリセットが無いため、Arctic の汎用 OAuth2 プリミティブの上に自前実装する。

エンドポイントは `apps/public` に置き、パスは `/api/v1/auth/**`（DEV-04 §5-1。`apps/public` 内の `auth` は Member 認証を意味するため `members/` セグメントは付けない）。

```bash
# .dev.vars（local）/ Cloudflare Workers シークレット（本番）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://example.com/api/v1/auth/callback/google

FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
FACEBOOK_REDIRECT_URI=https://example.com/api/v1/auth/callback/facebook

LINE_CLIENT_ID=
LINE_CLIENT_SECRET=
LINE_REDIRECT_URI=https://example.com/api/v1/auth/callback/line
```

```typescript
// apps/public/src/pages/api/v1/auth/google/redirect.ts
import { Google, generateCodeVerifier, generateState } from "arctic";
import type { APIContext } from "astro";
import { env } from "cloudflare:workers";

export async function GET({ cookies, redirect }: APIContext): Promise<Response> {
  const google = new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);

  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, codeVerifier, ["openid", "email", "profile"]);

  cookies.set("oauth_state", state, { httpOnly: true, secure: true, path: "/" });
  cookies.set("oauth_code_verifier", codeVerifier, { httpOnly: true, secure: true, path: "/" });

  return redirect(url.toString());
}
```

```typescript
// apps/public/src/pages/api/v1/auth/callback/google.ts
import { env } from "cloudflare:workers";
import { loginMemberBySocial } from "../../../../../lib/server/services/auth";

export async function GET({ url, cookies, redirect }: APIContext): Promise<Response> {
  const google = new Google(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, env.GOOGLE_REDIRECT_URI);

  const tokens = await google.validateAuthorizationCode(url.searchParams.get("code")!, cookies.get("oauth_code_verifier")!.value);
  const googleUser = await fetchGoogleUserInfo(tokens.accessToken());

  // 既存の Member にのみログインさせる。該当が無ければアカウントを作らず申請導線へ送る（§5-3）
  const member = await loginMemberBySocial(db, "google", googleUser);
  if (!member) return redirect("/apply?reason=not_registered");

  // セッション確立処理は DEV-02 §1-2 参照
  return redirect("/mypage");
}
```

### 5-3. OAuth で Member を新規作成してはならない

**ソーシャルログインはログイン手段の追加であり、アカウントの作成契機ではない。** Member レコードが作られるのは新規取引申請（Application）の承認時だけである（DEV-09 §2-1-4、PRD-03 F-02-06）。

INTAKE §7 審査制の「OAuth 認証成功のみでは取引先として承認しない」は、UI で発注ボタンを隠すという話ではなく、**そもそも Member を作らない**という意味に落とす。`findOrCreate` 型の実装にすると、Google でログインしただけの第三者に Member レコードとセッションが発行され、審査制の前提が崩れる。

| ケース | 挙動 |
| --- | --- |
| `social_accounts` に該当があり、Member が `active` | ログイン成功 |
| `social_accounts` に該当があり、Member が `suspended` / `deactivated` | ログイン拒否（DEV-02 §1-3） |
| `social_accounts` に該当が無いが、同じメールアドレスの Member が存在 | 既存 Member への紐付けを提案（本人確認としてパスワード入力またはメール確認を要求。自動紐付けはしない — 第三者が同じメールで OAuth アカウントを作れる可能性があるため） |
| 該当が無く、同じメールアドレスの Member も存在しない | **アカウントを作らず**、新規取引申請フォーム（SCR-05）へ誘導 |

---

## 6. SAML / OIDC・LLM（本プロジェクトでは不採用）

**本プロジェクトの標準対象外**。

- SAML / OIDC（エンタープライズ SSO）: テンプレート標準対象外。要件発生時は派生テンプレートで対応。
- LLM（Vercel AI SDK）: PRD-05 参照（AI 機能不採用）。商品選び診断はルールベースで、外部 API 呼び出しを伴わない（DEV-06 §1-1）。

---

## 7. その他の頻出統合

### 7-1. 全文検索（D1 FTS5、採用時）

商品カタログの規模（PRD-02 §5-1）では MVP では不採用。導入する場合は本節に連携仕様を追記する。

### 7-2. 配送・配送追跡連携（未確定）

配送会社・配送方法・追跡番号連携の要否は未確定（`[Open: TBD-07, GOV-02]`）。決定後、以下のフォーマットで追記する。

| 項目 | 内容 |
| --- | --- |
| 用途 | 配送状況の追跡・通知 |
| 認証方式 | 未確定 |
| 呼び出し方式 | 未確定（バッチ連携 or Webhook）|

### 7-3. 郵便番号検索（住所自動入力）

新規取引申請フォーム・配送先登録の入力補助として、郵便番号 API（例: zipcloud 等の無料 API）の利用を検討する。採用時は GOV-01 で決定し DEV-01 §2 に追記する。`fetch()` による同期呼び出しで実装し、専用 SDK は導入しない（§1-1）。外部 API が落ちても手入力で申請・配送先登録を完了できる形にする（入力補助を必須依存にしない）。

---

## 8. エラーハンドリング・観測

### 8-1. ログ標準

フレームワーク提供のログコンテキスト機構はないため、構造化した JSON を `console.log` に出力する（DEV-01 §4「可観測性優先」）：

```typescript
const logContext = { requestId, service: "stripe", action: "create_checkout_session", orderId: order.publicId, organizationId: order.organizationId };

console.log(JSON.stringify({ level: "info", message: "Stripe checkout session created", ...logContext, stripeSessionId: session.id }));
```

### 8-2. エラー監視ツールへの送信

エラー監視は Cloudflare Workers 標準のログ/メトリクスで開始し、必要になった時点で `@sentry/cloudflare` を導入する（DEV-01 §2）。

| シナリオ | 送信するか |
| --- | --- |
| 4xx エラー（クライアントエラー） | 記録のみ、エラー監視ツールには送らない |
| 5xx エラー（サーバーエラー） | エラー監視ツールへ送信 |
| タイムアウト | エラー監視ツールへ送信 |
| Webhook 署名検証失敗 | エラー監視ツールへ送信（潜在的攻撃の可能性） |

### 8-3. 連携先死活監視

| 項目 | 監視方法 |
| --- | --- |
| Stripe | Stripe Dashboard で API 成功率 |
| Resend | Resend Dashboard で配信成功率 |
| R2 / 基盤 | Cloudflare Status Page を購読（DEV-01 §1） |

---

## 9. テスト戦略

テストツールは Vitest + Playwright（DEV-01 §1）。

| 対象 | 方法 |
| --- | --- |
| Stripe | `stripe-cli` で Webhook をローカル受信、Mock も使う。**同一イベントの二重送信で冪等性を検証する**（DEV-09 §5-3） |
| Resend | テスト時は送信関数をモックし、実際の Resend API を呼ばない |
| R2 | テスト時は R2 バインディングのローカルエミュレーション（Wrangler/Miniflare） |
| OAuth | テスト時は Arctic のレスポンスをモックする。**未登録ユーザーで Member が作られないこと**を必ず検証する（§5-3） |
| Webhook | ローカルで `ngrok` 等でトンネル |

---

## 10. 環境変数まとめ（外部サービス連携の正本）

**外部サービス連携のキー一覧は本節を正本**とする。アプリ基本変数（`APP_*`）・認証パラメータ（`SESSION_*` / `AUTH_LOCKOUT_*`）・業務閾値は DEV-08 §8 が正本であり、同じキーを両方に書かない。

```bash
# 決済（stripe npm パッケージ直接利用）
STRIPE_KEY=
STRIPE_SECRET=
STRIPE_WEBHOOK_SECRET=

# Resend（Mail — 確定スタック）
RESEND_API_KEY=
MAIL_FROM_ADDRESS=
MAIL_FROM_NAME=
MAIL_ADMIN_ALERTS=

# ファイルストレージ（Cloudflare R2、DEV-01 §1）
# 通常の読み書きは env.BUCKET バインディング経由のため環境変数は不要（wrangler.jsonc の r2_buckets で設定）

# OAuth（Member 向け。§5）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
FACEBOOK_REDIRECT_URI=
LINE_CLIENT_ID=
LINE_CLIENT_SECRET=
LINE_REDIRECT_URI=

# エラー監視（@sentry/cloudflare — 採用時）
SENTRY_DSN=
SENTRY_TRACES_SAMPLE_RATE=0.2
```

> 本プロジェクトは LLM（Vercel AI SDK）を採用しないため、これらの環境変数は持たない（PRD-05）。

---

## 11. 記入時チェックポイント

- 各統合の採否が明確か（採用ライブラリが DEV-01 §1 / §2 と一致しているか。本書内で独自選定をしていないか）
- 決済 Webhook の冪等性（`payment_event_logs`）が実装されているか（§2-4）
- Webhook の登録先 URL が 1 本に絞られているか（DEV-04 §5-6）
- メール送信がトランザクションの外で行われているか（§3-4）
- メールのドメイン認証（SPF/DKIM/DMARC）が設定されているか（ドメイン確定後）
- オブジェクトストレージのバックアップ方針が OPS-02（運用ハンドブック）と整合しているか
- OAuth プロバイダ（LINE / Google / Facebook）が INTAKE §4-4 と一致しているか
- **OAuth 経由で Member レコードが新規作成されない実装になっているか**（§5-3。審査制の前提）
- すべての API キーが Secrets で管理されているか
- 環境変数キーが本書 §10 と DEV-08 §8 で二重管理になっていないか
- 監視・観測の方針が OPS-02（運用ハンドブック）と整合しているか
