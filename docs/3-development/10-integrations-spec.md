---
doc-id: DEV-10
title: 統合・外部 API 仕様
phase: 3
status: draft-ai
owner: Tech Lead
last-updated: 2026-09-16
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

## 4. ファイルストレージ — 不採用

**Cloudflare R2 を採用しない**（GOV-01 D-020）。`r2_buckets` の設定も `BUCKET` バインディングも持たない。

| 用途 | 置き換え後 |
| --- | --- |
| 商品画像・メーカーロゴ | `apps/public/src/assets/img/` にコミットし、`astro:assets` がビルド時に最適化する（WebP 変換・リサイズ・`width`/`height` 付与）。参照は Markdown frontmatter の相対パス |
| お知らせ添付 | 添付機能を持たない（お知らせは Markdown — GOV-01 D-018）|
| アップロード機能 | **存在しない。** アップロードを受けるエンドポイントを追加しないこと（DEV-02 §4・§6）|

R2 が有利になるのは「運営がアップロードする」「点数が多くリポジトリに載せられない」「動画・PDF など大きい」場合で、本プロジェクトはいずれにも当たらない（商品の更新は開発者が半年に 1 回程度）。

> 将来 R2 を追加する場合は、frontmatter の相対パスを URL に差し替えるだけで済む。その時点で D1 側に `media` 相当のテーブルが必要かを改めて判断する（GOV-01 D-020）。バックアップ対象も増えるため OPS-02 §4 を更新すること。

---

## 5. OAuth（ソーシャルログイン。Member 向け）

### 5-1. 採用判断

INTAKE §4-4 のとおり、以下を採用する。AdminUser（管理画面）は OAuth を採用せずメール認証のみ（DEV-02 §1-1）。

| プロバイダ | 採用 |
| --- | --- |
| LINE | ○（日本国内 BtoB のため。**Arctic に `Line` プリセットがあり、それを使う** — 「自前実装」としていた記述は S12 で訂正）|
| Google | ○（Arctic の専用プリセットクラスを使用）|
| Facebook | ○（Arctic の専用プリセットクラスを使用。**PKCE を使わない**ため、URL 生成・コード交換の引数が他 2 つより 1 つ少ない）|
| メールアドレス・パスワード | ○（標準認証として併存）|

### 5-2. 標準実装

Arctic を使用（`pnpm --filter public add arctic`。DEV-01 §2）。3 プロバイダとも専用プリセットクラス（`Google` / `Facebook` / `Line`）がある。

**Arctic への依存は `apps/public/src/lib/server/auth/oauth.ts` 1 ファイルに閉じる。** 他のファイルは `SocialIdentity`（`providerUserId` / `email` / `name`）だけを受け取り、プロバイダのエンドポイントもトークンの形も知らない。理由は 2 つ:

- Arctic 3.7.0 は**非推奨として公開されている**（最新リリースかつ動作するが、今後の修正は入らない。GOV-02 TBD-36）。差し替えが必要になったとき、書き直す範囲をこの 1 ファイルに限定する
- プロバイダごとの差異（Facebook は PKCE 無し、ユーザー情報の取得先とフィールド名が 3 者 3 様）を 1 か所に集める

エンドポイントは `apps/public` に置き、パスは **`/auth/{provider}` と `/auth/{provider}/callback`**（DEV-04 §5-1）。**`/api/v1/` には置かない** — これらは常にリダイレクトだけを返すページルートであり、DEV-04 §3 のレスポンスエンベロープを持たない（DEV-06 §1-2）。登録する redirect URI もこのパスになる。

| 環境変数 | 用途 |
| --- | --- |
| `{LINE,GOOGLE,FACEBOOK}_CLIENT_ID` | プロバイダのクライアント ID |
| `{LINE,GOOGLE,FACEBOOK}_CLIENT_SECRET` | 同シークレット |
| `{LINE,GOOGLE,FACEBOOK}_REDIRECT_URI` | プロバイダ側に登録した値と 1 バイトも違わないこと |

**3 つのうち 1 つでも欠けるプロバイダは「無効」として扱う**（GOV-01 D-036）。ログイン画面にボタンを出さず、`/auth/{provider}` は 404 を返す。`SESSION_TTL_DAYS` 等と違って例外を投げないのは、クライアント ID の欠落はログインを止めるだけで**セキュリティ制御を無効化しないため**であり、かつプロバイダ登録にリードタイムがあるため。

ラウンドトリップ中の 3 つの Cookie（`oauth_state` / `oauth_code_verifier` / `oauth_link_intent`）は **`SameSite=Lax`** で発行する。`Strict` にすると、プロバイダがブラウザを本サイトへ戻すナビゲーションでちょうど落ちる。

```bash
# .dev.vars（local）/ Cloudflare Workers シークレット（本番）
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://example.com/auth/google/callback

FACEBOOK_CLIENT_ID=
FACEBOOK_CLIENT_SECRET=
FACEBOOK_REDIRECT_URI=https://example.com/auth/facebook/callback

LINE_CLIENT_ID=
LINE_CLIENT_SECRET=
LINE_REDIRECT_URI=https://example.com/auth/line/callback
```

実装は `apps/public/src/pages/auth/[provider]/index.ts`（開始）と `.../callback.ts`（コールバック）の
2 ファイル。どちらもプロバイダを allow-list で受け、Arctic は `lib/server/auth/oauth.ts` 越しにしか触らない。

```typescript
// apps/public/src/pages/auth/[provider]/callback.ts（要点のみ）
const state = cookies.get(OAUTH_STATE_COOKIE)?.value;
const codeVerifier = cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
cookies.delete(OAUTH_STATE_COOKIE, { path: "/" });
cookies.delete(OAUTH_VERIFIER_COOKIE, { path: "/" });

// code 欠落・state 不一致・同意拒否を区別しない。区別は「偽造したコールバックのどちらが間違いか」を教える
const code = url.searchParams.get("code");
if (!code || !state || url.searchParams.get("state") !== state) return redirect("/login?error=oauth", 302);

const identity = await exchangeCode(secrets, provider, code, codeVerifier ?? "");

// 既存の Member にのみログインさせる。該当が無ければアカウントを作らず申請導線へ送る（§5-3）
const result = await loginWithSocialIdentity(createDb(env.DB), provider, identity, Number(env.SESSION_TTL_DAYS));
```

### 5-3. OAuth で Member を新規作成してはならない

**ソーシャルログインはログイン手段の追加であり、アカウントの作成契機ではない。** Member レコードが作られるのは新規取引申請（Application）の承認時だけである（DEV-09 §2-1-4、PRD-03 F-02-06）。

INTAKE §7 審査制の「OAuth 認証成功のみでは取引先として承認しない」は、UI で発注ボタンを隠すという話ではなく、**そもそも Member を作らない**という意味に落とす。`findOrCreate` 型の実装にすると、Google でログインしただけの第三者に Member レコードとセッションが発行され、審査制の前提が崩れる。

| ケース | 挙動 |
| --- | --- |
| `social_accounts` に該当があり、Member が `active` | ログイン成功 |
| `social_accounts` に該当があり、Member が `suspended` / `deactivated` | ログイン拒否（DEV-02 §1-3） |
| `social_accounts` に該当が無いが、同じメールアドレスの Member が存在 | 既存 Member への紐付けを**提案**（自動紐付けはしない — 第三者が同じメールで OAuth アカウントを作れるため）。実装: 署名付き Cookie `oauth_link_intent`（`provider\|providerUserId\|email`、TTL 15 分）を発行して `/login?link={provider}` へ送り、**パスワードログインが成功した直後に**`POST /api/v1/auth/login` が連携を作る。Cookie の email と認証できた Member の email が一致しない場合は連携しない（Cookie を盗まれても他人に紐付かない）。連携に失敗してもログイン自体は成功させる — パスワードは正しかったのだから |
| 該当が無く、同じメールアドレスの Member も存在しない | **アカウントを作らず**、新規取引申請フォーム（SCR-05）へ誘導 |
| プロバイダが email を返さない（LINE で email スコープ未許可 等）| 突き合わせる材料が無いため、上記「該当が無い」と同じ扱い |

**`suspended` / `deactivated` と「未登録」は同じ応答にする。** 文面を分けると、あるメールアドレスが取引先のものかどうかを外部に教えることになる（DEV-02 §7）。いずれも `/apply?reason=not_registered` へ送る。

### 5-4. S12 時点で実装していないこと

| 項目 | 状況 |
| --- | --- |
| 3 プロバイダのアプリ登録 | **未了**。登録が済むまで `.dev.vars` / Workers Secrets が空のため、各プロバイダは無効のまま（D-036）。00_DEV_GUIDE §3-3a の「外部手配」に含まれる |
| 連携の**解除** | 未実装。マイページは連携済み一覧を表示するだけで、外す導線は無い。実装するなら「パスワード未設定（`password_hash IS NULL`）の Member が最後の連携を外すと二度とログインできなくなる」ため、最後の 1 件の解除は拒否するか、先にパスワード設定を要求する必要がある |
| プロバイダとの往復の E2E | **不可能**。認証情報は gitignore 対象のシークレットで、プロバイダの同意画面は自動化できない。E2E が見るのは allow-list・`state` 検証・画面文言まで（`tests/e2e/social-login.spec.ts`）で、突き合わせ規則・連携規則・URL 生成はすべて Vitest 側に置く（`tests/unit/social-auth.test.ts`）。この分担は DEV-03 §2 の「E2E が届かない範囲は Vitest」の一例 |

---

## 6. SAML / OIDC・LLM（本プロジェクトでは不採用）

**本プロジェクトの標準対象外**。

- SAML / OIDC（エンタープライズ SSO）: テンプレート標準対象外。要件発生時は派生テンプレートで対応。
- LLM（Vercel AI SDK）: PRD-05 参照（AI 機能不採用）。商品選び診断はルールベースで、外部 API 呼び出しを伴わない（DEV-06 §1-1）。

---

## 7. その他の頻出統合

### 7-1. 全文検索 — 対象が D1 に無い

商品カタログは Content Collections にあるため（GOV-01 D-017）、D1 の FTS5 は**そもそも適用先が無い**。商品数十〜百点の規模では、全件をサーバー側でフィルタする方式で足りる（DEV-06 §1-1、DEV-07 §8）。外部検索サービスも MVP では不採用（GOV-01 D-012）。

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
| Cloudflare 基盤（Workers / D1 / KV / Access）| Cloudflare Status Page を購読（DEV-01 §1）。**Access の障害は管理画面全体の停止と同義**である（GOV-01 D-022） |

---

## 9. テスト戦略

テストツールは Vitest + Playwright（DEV-01 §1）。

| 対象 | 方法 |
| --- | --- |
| Stripe | `stripe-cli` で Webhook をローカル受信、Mock も使う。**同一イベントの二重送信で冪等性を検証する**（DEV-09 §5-3） |
| Resend | テスト時は送信関数をモックし、実際の Resend API を呼ばない |
| Cloudflare Access | テスト時は JWT 検証をローカルのフォールバックで代替する。**そのフォールバックが `APP_ENV=production` で無効になることを単体テストで固定する**（GOV-01 D-022、DEV-03 §3-5） |
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

# ファイルストレージは不採用（GOV-01 D-020）。R2 関連の環境変数・バインディングは無い

# OAuth（Member 向け。§5）。3 つ揃っていないプロバイダは無効扱いで、例外は投げない（D-036）。
# REDIRECT_URI はプロバイダ側の登録値と完全一致させる（末尾は /auth/{provider}/callback）
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
