---
doc-id: DEV-05
title: バックエンド実装ガイド
phase: 3
status: draft-ai
owner: Tech Lead
last-updated: 2026-09-09
related-docs:
  - DEV-01: 技術スタック決定書・アーキテクチャ原則
  - DEV-04: API 仕様
  - DEV-06: コンテンツの置き場所（§1-1）
  - DEV-07: DB 物理設計
  - DEV-09: 状態遷移
  - DEV-10: 統合・外部 API
  - PRD-01: ドメインモデル
  - OPS-01: 契約ポリシー（付録のデータエクスポート要件）
  - CLAUDE.md: コード例・実装パターンの正本（`.claude/rules/backend.md` のような分割ファイルはこのテンプレートには無い）
---

# 05-backend-guide.md — バックエンド実装ガイド

## このセクションの目的

バックエンド実装のディレクトリ構成、レイヤー責務、トランザクション方針、非同期処理設計方針、
ログ・観測方針、命名規約の「原則」を定義する。

- 技術スタックの選定は本書には書かない（DEV-01 が唯一の正本）。
- **コード例・実装パターンの正本: `CLAUDE.md`**（DEV-01 §9 参照）。
  本書は「何を守るか」を定義し、「どう書くか」は同ファイルに委ねる。

## 0-H. ハイブリッド編集ガイド（要点）

- 推奨モード: Human-first または Hybrid
- 人間確認必須: 責務分離の妥当性、N+1 対策、ログ方針、認可チェックの網羅性

---

## 1. ディレクトリ構成（標準）

このモノレポでは `apps/public`（公開サイト + Member マイページ）と `apps/admin`（管理 CMS）が独立した Cloudflare Worker であり（DEV-01 §1「リポジトリ構成」参照）、**両アプリが同じ構成の `lib/server/` を持つ**。`lib/server/` 以下の内部構成は Inquiry を例にした参照実装で確定済み（Confirmed）。新規リソースはこの構成・命名にそのまま従う（`scaffold` スキルが参照実装を指す — `.claude/skills/scaffold/`）。

```text
apps/admin/src/
├── pages/
│   ├── api/v1/**/*.ts               # API Route（入出力ハンドリングのみ。/api/v1/ でバージョニング — DEV-04 §1）
│   └── **/*.astro                   # 管理画面ページ（src/layouts/Layout.astro）。apps/admin は
│                                     #   サブドメインで丸ごと管理画面のため URL に /admin 接頭辞は
│                                     #   付けない（DEV-01 §1、DEV-04 §1-1、DEV-06 §1）
├── lib/
│   ├── components/                  # Svelte island + shadcn-svelte（$lib エイリアス）
│   ├── server/                      # 確定済み。参照実装: apps/admin/src/lib/server/services/inquiries.ts 等
│   │   ├── services/                #   業務ロジック・トランザクション境界（ドメイン別ファイル。例: products.ts,
│   │   │                             #   applications.ts, organizations.ts, orders.ts, activity-log.ts, media.ts）
│   │   ├── auth/                    #   AdminUser のセッション検証 requireSession（DEV-02 §3-2。例: session.ts）
│   │   └── validation/              #   drizzle-zod で導出した Zod スキーマ（DEV-01 §2）
│   └── utils.ts                     # cn() 等の共通ユーティリティ
└── middleware.ts                    # セキュリティヘッダーのみ（確定。認証はここでは行わない — 下記参照）

# Cloudflare バインディングの型（`Cloudflare.Env` として DB / BUCKET / KV）は `wrangler types` が
# 各アプリ直下に `worker-configuration.d.ts` を生成する（`pnpm typecheck` の第 1 段階）。gitignore
# 済みの生成物なので、手書きの `env.d.ts` は作らない。

apps/public/src/
├── pages/
│   ├── api/v1/**/*.ts               # Member 認証・カート・発注・配送先・お問い合わせ送信・診断結果（DEV-04 §5）
│   └── **/*.astro                   # 公開ページ・マイページ（Layout.astro）
├── lib/
│   ├── components/                  # Svelte island（公開側。shadcn-svelte は使わない — DEV-01 §1）
│   └── server/                      # 公開側の Service / D1。admin 側と認証コードを共有しない
│       ├── services/                #   例: auth.ts, members.ts, cart.ts, orders.ts, inquiries.ts
│       ├── auth/                    #   Member のセッション検証（session.ts）
│       └── validation/
├── content.config.ts                # Content Collections の定義（packages/content を glob() で読む）
└── middleware.ts                    # セキュリティヘッダー + 会員ルートの Cache-Control（§1-2）

packages/schema/
├── src/schema.ts                    # Drizzle スキーマ本体（DEV-07 から生成。両アプリから参照される共有パッケージ）
├── src/client.ts                    # createDb(env.DB)
├── src/ulid.ts                      # public_id 生成
└── migrations/                      # D1 migrations（Drizzle Kit 生成 SQL。apps/admin からのみ適用）

packages/server-kit/src/
├── auth/                            # パスワードハッシュ、ロックアウト、セッション規則（§1-3）
└── http/                            # レスポンス整形・エラークラス・カーソルページネーション（DEV-04 §3・§4・§8）

packages/content/                    # 開発者が更新する Markdown（診断ルール。DEV-06 §1-1）
├── src/schema.ts                    # Zod スキーマ（両アプリが import）
└── **/*.md
```

> Laravel の `Jobs/` / `Events/` / `Listeners/` / `Notifications/` / `StateMachines/` / `Enums/` に相当する専用ディレクトリは無い。非同期処理は `ctx.waitUntil()` と Cron Triggers（Queues は不採用 — DEV-01 §1/§3）、状態遷移はドメイン別 Service 内の単一関数（DEV-01 §4）、列挙値は TypeScript の string literal union 型で代替する。

> **認証検証は各 API ルートハンドラの冒頭で行う**（DEV-04 §2、決定済み）。フレームワーク提供のミドルウェアスタックが無いため、`middleware.ts` に認証を集約しない — 同ファイルはセキュリティヘッダー専用（CLAUDE.md 参照）。各ルートは `requireSession(cookies, db)` を呼んでセッションを取得する。本プロジェクトの AdminUser はロール区分を持たないため（GOV-01 D-014）、追加のロール検証は不要。Member 側は続けて `requireActiveOrganization(session)` を呼ぶ（DEV-02 §3-1）。

> Cloudflare バインディング（`env.DB` 等）は `Astro.locals.runtime.env` ではなく `import { env } from "cloudflare:workers"` で取得する（`Astro.locals.runtime.env` は Astro v6 で削除済みの旧 API であり、採用バージョンの v7 — DEV-01 §1 — にも存在しない。型は `wrangler types` が生成する `worker-configuration.d.ts` の `Cloudflare.Env` を使う）。

### 1-2. `apps/public` の Cache-Control は middleware に置く

会員向けルート（マイページ・カート・発注）の `Cache-Control: private, no-store` は **`apps/public/src/middleware.ts` で付与する**。ページのフロントマターで `Astro.response.headers` に書いても、ページが `Response` を返す場合（リダイレクト等）はその値が届かず、**未ログインへのリダイレクトがキャッシュ可能な状態で外に出る**。管理側（`apps/admin`）はサブドメイン全体が非公開のため同等の対応は不要。

### 1-3. AdminUser と Member のセッションは分離する / 規則だけ共有する

**AdminUser と Member のセッションは完全に分離する**（DEV-02 §1-1・§1-2）。テーブル（`admin_sessions` / `member_sessions`）、クッキー名（`admin_session` / `member_session`）、照合コード（各アプリの `src/lib/server/auth/session.ts`）を共有しない。両アプリが同じ D1 を読むため、この分離だけが「片方で発行したトークンがもう片方で通らない」ことを保証している。

共有するのは `packages/server-kit` の **規則** だけ：トークン生成、TTL 検証、有効期限と `status` の判定、パスワードハッシュ、ロックアウトのカウンタ操作。ここは 2 つの実装でズレてはいけない部分であり、逆に保管場所は絶対に共有しない。ログインの組み立ては各アプリに残す — Member 側は所属 Organization の状態判定（DEV-02 §1-3）が入るため、共通化すると分岐だらけになる。

### 1-4. Content Collections は Service 層を経由しない

診断ルール（`packages/content`）の読み込みは **Astro Page から `astro:content` の API で直接行う**。`lib/server/services/` にラッパーを作らない — Service 層は D1 アクセスと認可の境界であり、ビルド時に解決される静的データはその境界の外側にある。

推奨商品の解決（`Product.slug` → 商品情報）だけが D1 アクセスであり、そこは Service 層に置く（`products.ts` の「slug 配列から公開商品を引く」関数）。ルールの評価そのものは純粋関数として `packages/content` 側かページ側に置き、D1 に触らせない（DEV-04 §5-8）。

---

## 2. レイヤー責務と実装原則

各レイヤーの配置と責務の一覧は DEV-01 §5-3 を正とする。実装時の原則：

| レイヤー | 原則 |
| --- | --- |
| Astro Page / Svelte Island | 表示状態管理・ユーザー操作受付・Service または API Route への委譲のみ。D1 に直接アクセスしない |
| API Route | 入出力ハンドリングのみ。業務ロジックを書かない。Service が投げた `AppError` を `toErrorResponse` で変換する（DEV-04 §3-3） |
| 入力検証 | Service 層の入口（または API Route）で実施。検証は Zod で統一する（DEV-01 §2「リクエストバリデーション」、決定済み）。Drizzle スキーマから `drizzle-zod` で自動導出することを優先し、手書きの重複定義は避ける |
| Service | 業務ロジック・トランザクション境界・後処理の起動（`ctx.waitUntil()`）・認可チェック関数の呼び出し |
| 認可チェック | Policy クラスに相当する仕組みは無い。セッションを検証するエクスポート関数 `requireSession(cookies, db)`（DEV-02 §3-2）を Service の入口で呼ぶ。AdminUser はロール区分を持たないため（GOV-01 D-014）これ以上の権限検証は行わない。Member 側は `requireActiveOrganization(session)` を続けて呼び、操作対象の `organization_id` 一致まで検証する |
| D1 アクセス | Drizzle のクエリビルダ（`drizzle-orm`、D1/SQLite dialect。DEV-01 §1、決定済み）経由。`@app/schema/client` の `createDb(env.DB)` で得たハンドルを Service 内で使う。Drizzle 自体は内部でプリペアドステートメントにコンパイルされるため、SQL Injection 対策（文字列連結禁止）の原則は変わらない（DEV-01 §3） |
| 状態遷移 | 単一の遷移関数/モジュールに集約（DEV-01 §4）。status の直接更新禁止 |

- 依存方向は Astro Page/Svelte Island/API Route → Service → D1 の一方向のみ。
- ページ / API Route は `@app/schema/client`（db ハンドル）を持ってよいが、テーブル定義（`@app/schema`）の import は ESLint（`no-restricted-imports`）で禁止されている。クエリは Service 層に閉じる（DEV-03 §3-3）。
- URL キーは `public_id`（ULID）。内部 `INTEGER PRIMARY KEY AUTOINCREMENT` を外部に出さない（DEV-07 §1）。

---

## 3. トランザクション方針

| 項目 | 方針 |
| --- | --- |
| 境界 | Service 層に置く。Astro Page / Svelte Island / API Route では直接 D1 の書き込みをまとめない |
| 単位 | 1 業務操作 = 1 トランザクション。複数ステートメントの原子性は Drizzle の `db.batch([...])`（内部で D1 の `env.DB.batch()` を呼び、単一トランザクションとして実行される。DEV-01 §1）でまとめる。逐次に `.run()` を個別実行すると原子性が保証されない |
| 状態遷移関数での適用 | 状態遷移関数（DEV-09）が本体の UPDATE と付随する INSERT（`activity_log` への記録等）のように複数テーブルを更新する場合も、必ず `batch()` で 1 トランザクションにまとめる（遷移だけ成功しログだけ失敗する不整合を防ぐ） |
| 申請の承認 | `applications.status` の更新 + `organizations` の INSERT + `members` の INSERT + `memberships` の INSERT + `activity_log` の INSERT を 1 つの `batch()` にまとめる（DEV-09 §2 Application）。途中で失敗して「Organization はできたが Member がいない」状態を作らない |
| 発注確定 | `orders` + `order_items` + `payments` の INSERT と `cart_items` の DELETE を 1 つの `batch()` にまとめる。商品情報のスナップショット（DEV-07 §6-10）はこの中で確定させる |
| 外部 I/O | 外部 API・メール送信・決済 API をトランザクション（`batch()`）内で同期実行しない。DB 書き込み完了後に `ctx.waitUntil()` で起動する（§4） |
| R2 との組み合わせ | 商品画像の追加は **R2 へ書き込んでから行を INSERT**、削除は **R2 を消してから行を DELETE**。行が存在しないバイトは無害だが、バイトの無い行は画面が壊れる（DEV-04 §5-2） |

---

## 4. 非同期処理設計方針

Cloudflare Queues は不採用（`Confirmed` — DEV-01 §1/§3）。重い処理はレスポンスをブロックしない形で以下の 2 手段に振り分ける（DEV-01 §4「レスポンスをブロックしない」）。

| 手段 | 用途 |
| --- | --- |
| `ctx.waitUntil()` | リクエスト起点の後処理（メール送信、監査ログ以外の付随処理）。レスポンス返却後も Worker の実行を継続させる |
| Cron Triggers（Scheduled Worker） | 定期処理（データ保管期限の自動削除 — OPS-02 §4-3、期限切れセッションの削除、集計バッチ等） |

| 区分 | 方針 |
| --- | --- |
| リトライ | Queues のような自動リトライ基盤は無い。外部 API 呼び出しは DEV-10 §1 の共通パターン（指数バックオフで最大 3 回）を呼び出し関数内で実装する |
| 失敗時 | `failed_jobs` 相当のテーブルは持たない。関連エンティティの状態を `failed` へ更新し（例: 決済失敗時の `payments.status` — DEV-09 §2-6）、構造化ログ（§9）にエラーを出力する |
| ユーザー通知 | リトライ失敗が利用者影響を持つ場合はメール通知（Resend、DEV-01 §1） |
| 実装漏れの検出 | 失敗処理の実装漏れを静的解析で強制する仕組みは無いため、コードレビュー必須観点とする（DEV-03 §4） |

### 4-1. 通知はメール一律（PRD-03 FG-10）

アプリ内通知（ベル・バッジ・WebSocket 配信）の基盤は持たず、通知はメール一律（Resend、DEV-01 §1）で送信する。永続化する通知履歴テーブル（`notifications` 等）は無い — 送信結果は必要に応じて `activity_log`（DEV-07 §4-4）に記録する。マイページ内のお知らせ表示（F-10-03）は News テーブル（DEV-07 §7-1）の参照であり、個人宛の通知履歴ではない。

| 宛先 | 機構 |
| --- | --- |
| 運営（AdminUser）向けアラート | Resend（`resend` npm）で直接メール送信（F-10-01: 申請関連、F-10-02: 発注関連） |
| 取引先（Member）向け | Resend で自動返信・状況通知メール送信（F-10-01, F-10-02） |

- 本番はいずれも `ctx.waitUntil()` 経由で送信し、レスポンスをブロックしない（§4）。実装パターンの正本は `CLAUDE.md`。

---

## 5. 認可チェックの多層防御

管理系操作（`apps/admin`）は有効な AdminUser セッションかを（ロール区分は持たない — GOV-01 D-014）、発注関連操作（`apps/public`）は Member が所属する Organization のスコープ内かを、それぞれ Service 層で確実に検証する（DEV-01 §4「認可チェックの徹底」、DEV-02 §2〜§3）。単層に頼らず重ねる：

| 層 | 強制方法 |
| --- | --- |
| D1 アクセス | `@app/schema/client` の `createDb(env.DB)` とスキーマ（`packages/schema/src/schema.ts`、DEV-07 生成）経由でアクセスし、文字列連結の Raw SQL を禁止する（DEV-01 §1・§3） |
| Service | AdminUser 系メソッドの入口で `requireSession(cookies, db)`（DEV-02 §3-2）を、発注関連 Member 系メソッドの入口で Organization スコープ検証関数（`requireActiveOrganization(session)` 等、DEV-02 §3-1）を必ず通す |
| 認可チェック関数 | AdminUser は有効なセッションの存在のみを確認する（ロールカラムは持たない — GOV-01 D-014）。Member のセッションに埋め込んだ `organizationId`（DEV-07 §5-5）を確認する |
| クエリ | 発注関連の SELECT / UPDATE は必ず `WHERE organization_id = ?` を含める。「取得してからアプリ側で比較する」形にしない（比較を書き忘れても動いてしまうため） |
| API Route / Astro Page | 操作前に認可チェック関数を必ず呼ぶ。ページは 401 を返さずリダイレクトする（認証ミドルウェアが無いため、ページ側で自分を守る — CLAUDE.md） |

---

## 6. AI 機能の実装方針

本プロジェクトは AI 機能を採用しない（PRD-05）。LLM 呼び出し・`ai_jobs` テーブル・Vector DB は実装対象外であり、DEV-07 にも対応テーブルを持たない。将来採用する場合は PRD-05 §2 以降を記入し、本節に実装方針を追記する。

商品選び診断（F-03-10）は LLM を使わないルールベース機能である。実装方針は §1-4 を参照。

---

## 7. 決済連携（PRD-03 FG-04）

詳細は DEV-10 §2 参照（決済プロバイダの選定は DEV-01 §2、Stripe）。本プロジェクトは Organization 単位のサブスク課金を持たないため（BIZ-03 §1）、決済は発注ごとの都度払いチェックアウトのみ（DEV-07 §6-9〜§6-11）。要点：

- ホスト型チェックアウト（Stripe Checkout Session）によるカード決済、または銀行振込（運営の手動入金確認）
- Webhook は `payment_event_logs` テーブル（DEV-07 §6-12）に記録し、冪等性を保証。登録先 URL は `apps/public` の 1 本のみ（DEV-04 §5-6）
- 決済状態は決済プロバイダ → D1（`payments` テーブル、DEV-07 §6-11）へ同期（unpaid/awaiting_transfer/processing/paid/failed/refunded/partially_refunded。DEV-09 §2-6）

---

## 8. パフォーマンスガイドライン

| 項目 | 方針 |
| --- | --- |
| N+1 防止 | Drizzle の `with`（リレーション先の一括取得）を使い、ループ内で `.get()` / `.first()` 相当を N 回呼ばない。JOIN またはまとめて取得するクエリに書き換える。複数 ID の一括取得は `inArray(...)` や `db.batch()` を使う（DEV-01 §1） |
| 診断結果の商品取得 | 推奨商品の slug 配列を `inArray(products.slug, slugs)` で 1 クエリにまとめる。slug ごとにループで引かない（§1-4） |
| インデックス | 外部キー全カラム、`status`、`public_id`、発注関連テーブルの `organization_id` は必須（DEV-07 §8） |
| キャッシュ | リクエスト内で繰り返し参照するデータは Service 層でリクエスト単位に memoize。リクエストを跨いだキャッシュが必要な場合は Cloudflare KV（採用済み — DEV-01 §1）を使えるが、D1 が十分高速なため導入は実測で必要が確認できた箇所に限る |
| D1 読み取りの削減 | 運営が更新しないコンテンツは Content Collections に置き、そもそも読み取りを発生させない（DEV-06 §1-1）。Cloudflare の課金は行読み取りに乗るため、閲覧数の多い公開ページほど差が出る |
| 集計クエリ | ダッシュボードの件数表示（ADM-01）は毎回 `COUNT(*)` で足りる規模を想定する（PRD-02 §5-1）。実測で問題が出たら集計テーブル + Cron の日次バッチへ移す |
| 重い処理 | `ctx.waitUntil()` で後処理化、定期処理は Cron Triggers（§4）。レスポンスを同期ブロックしない |

---

## 9. ログ・観測方針

全処理・API に request_id + 操作者 ID（admin_user_id / member_id）を構造化ログ出力する（DEV-01 §4）。

| ログ種別 | 出力先 | 必須コンテキスト |
| --- | --- | --- |
| アプリケーション | Cloudflare Workers 標準ログ（DEV-01 §6。保持: Paid 7 日 / Free 3 日） | request_id, admin_user_id または member_id |
| 監査（重要操作） | `activity_log` テーブル（自前実装 — DEV-01 §2、DEV-07 §4-4。永続。発注関連操作は `organization_id` を記録、商品カタログ操作等では NULL） | causer（actor）, subject（target）, event, properties（before/after） |
| 決済 Webhook | `payment_event_logs` テーブル（DEV-07 §6-12） | event_id, type, processed_at |
| エラー監視 | Cloudflare Workers 標準ログ/メトリクスで開始 → 必要時 `@sentry/cloudflare`（DEV-01 §2、導入時） | 5xx / タイムアウト |

ログに個人情報・セッショントークン・パスワードハッシュを出力しない（DEV-02 §10）。

### 9-1. 監査ログの必須記録操作（`activity_log` テーブル — DEV-01 §2、DEV-07 §4-4。発注関連操作は `organization_id` を記録する）

- 意味のある状態遷移を行う Service の関数 — 申請の承認 / 否認 / 差し戻し、取引停止 / 再開 / 終了、
  受注のステータス変更・入金確認・キャンセル、取引先別卸価格の設定 / 解除、商品の公開 / 非公開・取扱終了 —
  は必ず `activity_log` へ 1 件記録する。専用パッケージ（spatie/laravel-activitylog 等）は
  使わないため、共通の薄い記録用ヘルパー関数（`logActivity(...)`、`apps/admin/src/lib/server/services/activity-log.ts`）を
  経由して INSERT する。免除する場合は理由をコメントで明記する。
- 記録は Service 内にインラインで行う（ヘルパー関数の呼び出し程度は可）。横断的な単一の「AuditLogService」に
  判定ロジックそのものを持たせない。コード例は `CLAUDE.md` 参照。
- **テストや静的解析では「呼び出しの欠落」を検出しにくい**（Vitest / `eslint-plugin-boundaries` でも記録漏れ自体は捕捉できない）。状態を変更する
  Service の関数の新設・レビュー時に「`activity_log` への記録はどこか」を必ず確認するコードレビュー
  必須観点とする（DEV-03 §4）。手本にした兄弟 Service にログがないと漏れが連鎖するため、
  最初の 1 件から徹底する。
- 人間の actor が存在しないシステム処理（定期バッチ・自動削除・決済 Webhook 等）では、「system ユーザー」の
  レコードを発明して causer に据えない。`causer_id` を NULL のまま記録し、発生源は
  `log_name` / `properties`（例: `source: system`）で示す（OPS-02 の自動削除記録もこの方式）。
  呼び出し元が未実装で actor が確定しない段階では、コメントを残して記録を保留し、
  呼び出し元の実装時に再訪する。

---

## 10. 命名・コーディング規約の原則

- 全関数・変数に型を明示する（`any` 禁止。`tsconfig.json` は `astro/tsconfigs/strict` を継承）。列挙値は
  TypeScript の string literal union 型（`"active" | "suspended" | "terminated"` 等）で表現する
- 早期 return でネストを浅く。1 関数 20 行以下を目安。ただし**認証の失敗パスで早期 return してはならない**
  （処理時間の差が列挙オラクルになる — DEV-02 §7）
- ファイル生成のスキャフォールディング CLI は使わない（`npm create astro@latest` 等の再実行は
  `.devcontainer/` / `.claude/` / `.mcp.json` を破壊するため禁止 — DEV-01 §3）。既存のディレクトリ構成に
  手動でファイルを追加する
- デバッグ用の一時的な `console.log` / `debugger` を残さない（構造化ログ出力のための `console.log`
  呼び出しは対象外 — DEV-01 §4「可観測性優先」）
- 業務上の可変パラメータ（最低発注金額・送料・送料無料条件・セッション TTL・ロックアウト閾値等）は Service に
  ハードコードしない。非機密の値は `wrangler.jsonc` の `vars`、機密の値は Cloudflare Workers Secrets
  （`wrangler secret put`）で管理し、ローカル開発は `.dev.vars`（gitignored）に記載する
  （デプロイなしに環境ごとの再調整を可能にするため）。外部サービスの ID・認証情報も同様の
  方式とし、`.astro` / `.svelte` / `.ts` への直書きを禁止する
- **セッション TTL・ロックアウト閾値の env は未設定なら例外を投げる。** `Number(undefined)` は `NaN` で、
  `NaN` との比較はすべて false になるため、ロックアウトが黙って無効化される（DEV-02 §7、DEV-03 §3-5）
- 利用規約の現行バージョン文字列も同様に定数 1 箇所で持ち、申請時に検証する（DEV-04 §6-1）
- 詳細な規約とコード例は `CLAUDE.md` を正本とする

---

## 11. 付録（任意機能）: データエクスポート

**OPS-01 §4-2（解約時のデータ取扱い）の契約条項が確定してから着手する任意機能。**
契約上の義務が発生しないプロジェクトでは実装しない。要件概要：

| 項目 | 要件 |
| --- | --- |
| 内容 | 取引終了後 90 日以内に取引先データ（会社情報・配送先・発注履歴）を CSV / JSON で一括エクスポート |
| 実行方式 | `ctx.waitUntil()` による非同期処理（§4。Workers の実行時間上限に注意し、大規模データは分割処理する） |
| 配信方式 | Cloudflare R2（DEV-01 §1）上の一時ファイルを署名付き URL（72 時間）でメール通知。署名付き URL の発行方式（R2 presigned URL か API Route 経由のトークン検証か）は **Open**（案件実装時に確定。DEV-10 §4 と合わせて商品画像の配信方式と揃える） |
| 実行権限 | AdminUser のみ。1 日 1 回まで |
| 保管期限 | 一時ファイルは 72 時間後に自動削除。実行は監査ログ（`activity_log`）に記録 |

エクスポート対象テーブルは `organizations` / `members` / `memberships` / `shipping_addresses` / `orders` / `order_items` / `payments` を基本とする（DEV-07 と整合させる）。
実装スケルトン・API エンドポイントは `CLAUDE.md` 参照。
運用手順（実施フロー・問い合わせ対応）は OPS-02（運用ハンドブック）参照。

---

## 12. 記入時チェックポイント

- ディレクトリ構成が §1 の確定済み参照実装（Inquiry を例にした構成）に従っているか
- Service / D1 アクセスの責務が明確か（Astro Page / API Route から D1 を直接呼び出していないか）
- 認可チェック（D1 アクセス層 + Service + 認可チェック関数 + API Route/Astro Page における AdminUser のセッション検証・Organization スコープ検証）が多層で網羅されているか
- 発注関連クエリの `WHERE organization_id = ?` が漏れていないか（§5）
- トランザクション境界が Service 層（`batch()`）に統一されているか。申請承認・発注確定が 1 バッチになっているか（§3）
- Content Collections を Service 層でラップしていないか（§1-4）
- N+1 対策・キャッシュ戦略が PRD-02 と整合しているか
- 状態を変更する Service の関数に監査ログ記録（§9-1）が漏れていないか
- 通知がメール一律（§4-1）になっており、アプリ内通知の基盤を作り込んでいないか
- 業務閾値・外部サービス ID が `vars` / Secrets 化（§10）されているか。未設定時に例外を投げるか
- DEV-04 のエンドポイントと API Route が対応しているか（アプリの割り当てを含む — DEV-04 §1-1）
- 技術名の選定を本書に書いていないか（DEV-01 参照になっているか）
- D1 アクセスが Drizzle のクエリビルダ経由になっているか（`env.DB.prepare()` の直呼びが Service に残っていないか。§2・§5）
- AdminUser 用と Member 用の auth を共通化していないか（§1-3、DEV-02 §1-2）
- 付録のデータエクスポートは OPS-01 の契約条項確定前に着手していないか
