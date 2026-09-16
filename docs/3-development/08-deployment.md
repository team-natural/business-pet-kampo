---
doc-id: DEV-08
title: デプロイ定義・検証完了ゲート
phase: 3
status: draft-ai
owner: Tech Lead
last-updated: 2026-09-16
related-docs:
  - DEV-01: 技術スタック決定書（インフラ選定の正本）
  - DEV-03: 品質方針
  - DEV-06: コンテンツの置き場所（§1-1。コンテンツ更新にデプロイが必要な範囲）
  - OPS-02: 運用ハンドブック（リリース実作業・ロールバック実行手順）
  - GOV-01: 承認記録
---

# 08-deployment.md — デプロイ定義・検証完了ゲート

## このセクションの目的

リリース方式、ロールバック判断基準、環境別ゲート、検証完了ゲートを定義する。**本書は判断基準の定義であり、実作業手順（コマンド・当日のチェックリスト）は OPS-02 に委譲する**。

インフラは DEV-01 §1 の通り Cloudflare Workers を採用している。ホスティング・スケーリング・エッジでの実行は基盤（Cloudflare）に委ねられる。デプロイは Cloudflare Workers Builds（GitHub 連携）が担う（§3）。本書で定義するのは「基盤に何を設定するか」と「何をもってリリース可とするか」。

## 0-H. ハイブリッド編集ガイド（要点）

- 推奨モード: Hybrid（AI 構造化 + Tech Lead 確定）
- 人間確認必須: 本番リスク受容、承認条件、ロールバック判断基準

---

## 1. デプロイ基盤（Cloudflare Workers）

基盤が提供するもの（本プロジェクトでは個別に設計・運用しない）:

| 項目 | 提供方法 |
| --- | --- |
| アプリケーション実行 | Cloudflare Workers。`astro build` の出力自体が Worker（`@astrojs/cloudflare` アダプタ）。デプロイは `wrangler deploy`（`wrangler.jsonc` の設定を使用） |
| DB（Cloudflare D1、SQLite 互換） | マネージド。バックアップ/エクスポートは `wrangler d1 export` 等（実作業は OPS-02） |
| Cache / Queue | Cloudflare KV 採用（認証失敗カウンタ・メンテナンスフラグ用）・Queues 不採用（`Confirmed` — DEV-01 §1）。KV バインディングは `wrangler.jsonc` で環境ごとに定義 |
| Session | Member は D1（`member_sessions`）で確定（DEV-01 §2、DEV-02 §1-2、DEV-07 §3-1）。KV にはセッションを置かない。**AdminUser のセッションは Cloudflare Access が持つ**（GOV-01 D-022） |
| スケジューラ | Cloudflare Cron Triggers（`Confirmed` — DEV-01 §2）。`wrangler.jsonc` の `triggers.crons` + Scheduled Worker で日次バッチ（OPS-02 §4-3）を実行 |
| スケーリング | オートスケール（Cloudflare Workers 標準。エッジ実行のため個別のスケーリング設計は不要） |
| 環境変数・シークレット | 非機密は `wrangler.jsonc` の `vars`、機密は Workers Secrets（`wrangler secret put`）。ローカル専用の機密は `.dev.vars`（gitignore 対象）。`.env` 相当のファイルを git にコミットしない |
| オブジェクトストレージ | **採用しない**（GOV-01 D-020）。R2 バケットも `BUCKET` バインディングも作成しない |
| 管理画面の到達制御 | **Cloudflare Access**（GOV-01 D-022）。管理サブドメインに Access Application を作成し、AUD tag とチームドメインを `apps/admin` の環境変数に設定する |
| メトリクス・ログ | Cloudflare Workers Logs / Analytics（標準、追加設定不要）。エラー監視が必要になった時点で `@sentry/cloudflare`（Workers 専用 SDK）を追加（DEV-01 §2） |

本プロジェクトは **1 リポジトリ内の pnpm workspaces + Turborepo モノレポ**構成で、`apps/public`（公開サイト + Member マイページ）と `apps/admin`（業務管理画面）を独立した Cloudflare Worker として別々にデプロイする（`/admin` パスへの統合ではない。GOV-01 D-001）。**両アプリが共有するのは D1 データベースのみ**（R2 は不採用 — GOV-01 D-020）。作成（`wrangler d1 create`）はどちらか一方のアプリの `wrangler.jsonc` から一度だけ行い、生成された `database_id` をもう一方の `wrangler.jsonc` にそのままコピーする。D1 マイグレーション（`packages/schema/migrations/` ディレクトリ、`wrangler d1 migrations apply`）は**`apps/admin` からのみ**実行する（同一リポジトリ内の app 単位の所有権。`CLAUDE.md` D1 バインディングルール参照）。

> `database_id` は両アプリの `wrangler.jsonc` で**完全に一致していなければならない**。ローカルの sqlite ファイル名のキーにもなるため、食い違うと各アプリが別々のデータベースを持ち、エラーも出ないまま「管理画面で承認した取引先が公開側でログインできない」症状になる（`CLAUDE.md`）。

### 1-1. コンテンツ更新とデプロイの関係

本プロジェクトは **公開コンテンツをすべて D1 ではなくリポジトリ側に置く**（GOV-01 D-017・D-018、DEV-06 §1-1）。したがって **公開コンテンツの更新はすべて「デプロイ」である**。

| 更新対象 | 反映方法 | リードタイム |
| --- | --- | --- |
| 商品・メーカー・ブランド・取引先別価格・お知らせ・診断ルール・FAQ・法務ページ・商品画像 | PR → マージ → Workers Builds が自動デプロイ | §3 のパイプライン所要時間 |
| 申請の審査・受注対応・問い合わせ対応 | 管理画面から保存（即時） | 即時 |

運営から「商品を直したい」「お知らせを出したい」「文面を変えたい」と依頼を受けた場合、作業単位は「PR 作成 → レビュー → マージ → 反映確認」までを含む（PRD-03 §6-3、OPS-02）。**臨時休業・出荷遅延の告知もこのリードタイムに従う**（GOV-01 D-018）。規約文面と卸価格の変更はレビュー済みの PR のみマージする（DEV-03 §4、DEV-02 §2-3）。

---

## 2. 環境構成

PRD-02 §3 の 3 面構成に対応する。環境分離は `apps/public`/`apps/admin` それぞれの `wrangler.jsonc` の environments 機能（`env.staging` / `env.production`。D1 と KV は環境ごとに別インスタンスを定義）で実現する（`Confirmed` — DEV-01 §1。プロジェクト丸ごと複製方式は不採用）。

| 環境 | 実体 | デプロイトリガー |
| --- | --- | --- |
| local | 開発者ローカル（Dev Container。D1 はローカルエミュレーション。**Cloudflare Access は効かない** — §4） | — |
| staging | Cloudflare Workers（各アプリの `wrangler.jsonc` の environments、テスト用 D1）。管理側は**本番と別の Access Application**（AUD tag が異なる） | `dev` ブランチへの push（Cloudflare Workers Builds が `wrangler deploy --env staging` を実行 — §3） |
| production | Cloudflare Workers（本番 D1） | `main` ブランチへの push（同上、`wrangler deploy`） |

`dev` が統合ブランチ、`main` が本番。

変更されたアプリのみをデプロイするパスフィルタは、Workers Builds の **Build Watch Paths**（Worker ごとに include/exclude を指定）で実現する。`apps/public` の変更で `apps/admin` を再デプロイしない。ただし `packages/**`（`schema` / `server-kit` / `content`）は両方の Worker が参照するため、**両方の Watch Paths に含める**。`packages/content` の更新（商品・お知らせ等）は `apps/public` のみに影響するが、Watch Paths を細分化すると設定が壊れやすいため `packages/**` 一括で許容する。

> **公開コンテンツの更新頻度がそのままデプロイ頻度になる**（GOV-01 D-017・D-018）。商品改訂は半年に 1 回程度の想定だが、お知らせは随時発生する。`packages/content` だけの変更でも `apps/public` のフルビルドが走る点は許容する。

---

## 3. CI/CD パイプライン

CI（検査）と CD（デプロイ）で基盤を分ける（`Confirmed` — GOV-01 D-002）。

| 役割 | 基盤 | 実体 |
| --- | --- | --- |
| CI（PR ゲート） | GitHub Actions | `.github/workflows/ci.yml` |
| CD（デプロイ） | Cloudflare Workers Builds（GitHub 連携） | Cloudflare ダッシュボード側の設定（リポジトリ内にワークフローを持たない） |

CD を GitHub Actions に置かないのは、Workers Builds が GitHub 連携でモノレポに必要な機能（Root directory / Build Watch Paths / Deploy command のカスタマイズ / Worker ごとの GitHub check run）を備えており、API トークンをリポジトリ側で管理せずに済むため。

### 3-1. PR 時（CI — 導入済み）

`main` / `dev` への push と、すべての PR で `.github/workflows/ci.yml` が動く。

```
1. pnpm/setup（Node + pnpm + 依存インストール。require-lockfile で lockfile 必須）
2. pnpm db:generate      ← check より前。migrations/ は同梱しないため、
                            check 内の単体テストも e2e もこれ無しでは動かない
3. pnpm check（format:check + lint + typecheck + 単体テストを Turborepo が fan out）
4. playwright install chromium（キャッシュあり）
5. pnpm test:e2e（--concurrency=1。両スイートが同じローカル D1 を使うため）
6. pnpm build（両 Worker のビルド成否）
7. 失敗時のみ test-results/ をアーティファクト化（trace: on-first-retry の回収）
```

> `corepack enable` ではなく `pnpm/setup` を使う。corepack は pnpm のダウンロード前に確認プロンプトを出し、ランナーには応答する手段がない。

すべて Pass で Merge 可能とする。編集ごとの hooks（`.claude/hooks/format-and-check.sh`）は Claude Code のセッション内でしか動かないため、CI がチーム全体に対する唯一の強制力となる。

依存パッケージのセキュリティスキャン（Dependabot 等）は未導入 — 必要になった時点で GOV-01 に記録して追加する。

### 3-2. マージ後（CD — Workers Builds 側の設定）

Worker を 2 つ作成し、どちらも同じリポジトリに接続する。設定はダッシュボードの **Settings > Builds**。

| 設定 | `apps/public` の Worker | `apps/admin` の Worker |
| --- | --- | --- |
| Root directory | `apps/public` | `apps/admin` |
| Build Watch Paths | `apps/public/**`, `packages/**` | `apps/admin/**`, `packages/**` |
| Deploy command（production branch） | `npx wrangler deploy` | `npx wrangler d1 migrations apply DB --remote && npx wrangler deploy` |

**D1 マイグレーションは Workers Builds が自動では実行しない。** 実行されるのは build と deploy のコマンドのみのため、上表のとおり `apps/admin` 側の Deploy command に前置する。これを怠ると、新しいカラムを前提としたコードが未適用の DB に対してデプロイされる。`wrangler d1 migrations apply` は適用済みを記録して冪等なので再実行は安全。`apps/public` 側には設定しない（マイグレーションは `apps/admin` からのみ — DEV-01 §1、`CLAUDE.md`）。API トークンには D1 の編集権限が必要。

**両アプリは同時にデプロイされない。** 片方だけが新しい状態が必ず発生するため、共有する `packages/*` の変更は前方互換を保つ（API のバージョニングもこのためにある — DEV-04 §9）。特に `packages/schema` のカラム削除は、両アプリのデプロイ完了を待ってから別リリースで行う（§4）。

ビルドには `NODE_OPTIONS=--dns-result-order=ipv4first` が必要（各アプリの `build` スクリプトに設定済み）。Node は `localhost` を `::1` に解決するが、プリレンダー時の fetch は `127.0.0.1` で待ち受けるため、これが無いとビルドが失敗する。

破壊的変更を含むマイグレーションは自動適用の対象外とし、手動で段階適用する（§7）。デプロイ後の Health check（§9）と通知は OPS-02 の監視系に委ねる。

Cloudflare Workers のデプロイはエッジでアトミックに切り替わるため、無停止デプロイのための特別な仕組み（グレースフルな再起動、ロングランニングプロセスのドレイン等）は不要。

---

## 4. デプロイ戦略

| 項目 | 方針 |
| --- | --- |
| 本番配備 | Cloudflare Workers の標準デプロイ（アトミック・即時反映。ドレインすべき常駐プロセスが無いため、無停止性は基盤の性質として担保される） |
| DB 変更 | 前方互換優先（カラム追加 → コード反映 → カラム使用）。D1 マイグレーションは forward-only（自動 `down()` はない）。破壊的変更は分割リリースとし、問題が起きた場合は新しい forward migration で修正する |
| 2 アプリ間の順序 | スキーマ変更を伴うリリースは「migration 適用（admin 側 deploy）→ public 側 deploy」の順になる。public 側が古いコードで新しいスキーマを読む状態を許容できる変更に限る（カラム追加は可、リネーム・削除は不可） |
| 機能フラグ | **Open**（案件実装時に確定）。暫定: 環境変数（`wrangler.jsonc` の `vars`）による ON-OFF フラグで開始 [Assumed]。動的切替が必要になったら KV フラグを検討 |
| 大規模変更 | 機能フラグで限定公開 → 全公開（機能フラグ方式決定後に運用開始） |

---

## 5. ロールバック条件（正本）

ロールバックの判断基準は本表を正本とし、OPS-02 は実行手順のみを持つ。

| 区分 | 条件 | 対応 |
| --- | --- | --- |
| 即時ロールバック | エラー率 > 5% / 5 分連続 | 前デプロイメントへ戻す（Wrangler の Deployments 履歴から直前ビルドを再デプロイ） |
| 即時ロールバック | 認証・決済の致命的不具合（発注金額・卸価格の誤計算等） | 同上 |
| 即時ロールバック | 卸価格が未承認の利用者に表示される | 同上（DEV-03 §1 の「妥協しない最低基準」） |
| 計画ロールバック | パフォーマンス悪化（p95 がベースラインの 2 倍） | 監視後判断 |
| DB 変更 | マイグレーション適用後に問題が判明 | D1 マイグレーションは forward-only のため DB 自体は戻さず、修正用の新しい forward migration を書いて対応する。Worker のコードのみ前デプロイに戻すことは可能 |

承認: Tech Lead（兼務可）。

---

## 6. デプロイゲート（環境別）

### 6-1. staging への昇格

- 全テスト Pass（CI グリーン — DEV-03 §3）
- 主要画面の手動確認

### 6-2. staging → production への昇格

- staging で 24 時間以上の問題なし
- セキュリティレビュー完了（DEV-02 §10）
- リリースノート作成
- D1 マイグレーションが forward-only の制約内で安全に適用できることを確認（`apps/admin` 側で事前検証）
- 規約文面の変更を含む場合、法務レビューと `agreed_terms_version` 定数の更新が済んでいること（DEV-06 §1-1）

破壊的変更（API バージョン変更等）は GOV-01 で事前承認必須。

---

## 7. 検証完了ゲート（リリース前 1 回）

AI コーディング → 人間レビュー → 自動テスト の後、**何が通れば「完了」とみなすか**。

### 7-1. 機能単位の完了条件

| カテゴリ | 確認項目 | 判定基準 |
| --- | --- | --- |
| 仕様適合 | PRD-03 の受け入れ条件を全件テスト | 全件グリーン |
| API 仕様 | DEV-04 のエンドポイント定義と実装の一致（アプリの割り当てを含む — DEV-04 §1-1） | 差異ゼロ |
| 権限境界 | 別 Organization（取引先）・未承認利用者からのアクセスが拒否される | テストで証明 |
| 決済整合性 | カード決済・銀行振込の状態遷移が正しいこと | テストで証明（DEV-09）|
| 診断 | 推奨商品が公開済み・取扱中の商品にのみ解決される | テストで証明（DEV-03 §3-5）|
| セキュリティ | 認証なし / 権限外 / 不正入力が適切に処理される | 手動 + SAST |
| 自動テスト | DEV-03 §3-5 の「必ず検証すること」を全て満たす（Vitest / Playwright） | CI グリーン |

### 7-2. MVP 全体の完了条件

```mermaid
flowchart TD
    A[機能単位ゲート<br/>全機能通過] --> B[統合テスト<br/>E2E 主要導線]
    B --> C[負荷テスト<br/>p95 NFR 達成]
    C --> D[セキュリティテスト<br/>High 脆弱性 0 件]
    D --> E[ステージング動作確認<br/>本番相当データ]
    E --> F{全項目通過?}
    F -->|Yes| G[GOV-01 に検証完了記録<br/>本番リリース承認申請]
    F -->|No| H[未通過項目を GOV-02 に登録<br/>修正後に再検証]
```

### 7-3. 検証完了チェックリスト

**機能・品質**

- [ ] MVP 全機能（PRD-03）が動作確認済み
- [ ] 受け入れ条件が自動テストで全件証明
- [ ] E2E テストが主要導線（新規取引申請〜承認、診断、カート〜発注完了）を通過
- [ ] 負荷テストで NFR（DEV-01 §6）を満たす
- [ ] Content Collections から生成する個別ページが 200 を返す（`prerender` 忘れの確認 — DEV-06 §1-1）

**セキュリティ・権限**

- [ ] 認証なしでの操作が全て拒否される
- [ ] 権限境界（DEV-02 §2-3）が正しく動作（Organization スコープ）
- [ ] セッション TTL・ロックアウト閾値の env が本番に設定されている（未設定なら起動時に例外 — DEV-02 §7）
- [ ] SAST / 依存スキャンで High 以上 0 件

**運用準備**

- [ ] ログ・アラートの本番設定確認（OPS-02）
- [ ] ロールバック手順の実行方法確認（OPS-02）
- [ ] リリースノート準備済み
- [ ] 初期マスタ（商品カテゴリー・気になる点分類）の投入済み（DEV-07 §9 のシーダー）
- [ ] 初期 AdminUser の作成済み（DEV-07 §9）

**承認**

- [ ] GOV-01 の承認記録に検証完了が記録されている

---

## 8. 環境変数（主要）

Cloudflare のバインディング（D1 / KV）は `wrangler.jsonc` で設定するため本節には記載しない（R2 は不採用 — GOV-01 D-020）。本節に記載するのは、非機密の環境変数（`wrangler.jsonc` の `vars`）と、Workers Secrets（`wrangler secret put`）または `.dev.vars`（ローカルのみ、gitignore 対象）で管理する機密値のみ。

```bash
# アプリケーション（wrangler.jsonc の vars、非機密）
APP_NAME=
APP_URL=
APP_ENV=production

# --- apps/admin: Cloudflare Access（GOV-01 D-022、DEV-02 §1-1）---
# JWT 検証に必須。未設定なら例外を投げる（検証を素通りさせない）
CF_ACCESS_TEAM_DOMAIN=       # 例: example.cloudflareaccess.com
CF_ACCESS_AUD=               # Access Application の AUD tag（環境ごとに異なる）
# ローカル開発・E2E 用のフォールバック。APP_ENV=production では無視されることを
# Vitest で固定する（fail-closed。DEV-03 §3-5、GOV-02 TBD-32）
DEV_ADMIN_EMAIL=

# --- apps/public: Member 認証（DEV-01 §2、DEV-02 §1-2・§7）---
# JWT は不採用 — セッションは D1 に保存する
# ↓ 未設定なら例外を投げる（Number(undefined) は NaN で、比較が全て false になり
#   ロックアウトが黙って無効化されるため。DEV-02 §7、DEV-03 §3-5）
SESSION_TTL_DAYS=
AUTH_LOCKOUT_MAX_ATTEMPTS=
AUTH_LOCKOUT_WINDOW_MINUTES=
AUTH_LOCKOUT_DURATION_MINUTES=
# パスワードリセットトークンの HMAC 署名鍵（Web Crypto。Workers Secrets）
SESSION_SIGNING_KEY=

# 業務閾値（DEV-05 §10。デプロイなしに調整できるよう vars で持つ）
MIN_ORDER_AMOUNT=            # 税抜 10000（BIZ-03 §3-1）
SHIPPING_FEE=                # 税抜 1000（BIZ-03 §3-2）
FREE_SHIPPING_THRESHOLD=     # 税抜 30000（同上）

# 外部サービス連携のキー（決済 / メール / OAuth / エラー監視）は
# DEV-10 §10 が正本。同じキーを本書に再掲しない
#
# 本プロジェクトは LLM（Vercel AI SDK）を採用しないため、AI 関連の環境変数は持たない（PRD-05）
```

> 利用規約の現行バージョンは環境変数ではなくコード内の定数で持つ（規約本文と同じコミットで変わるべき値のため — DEV-06 §1-1）。

---

## 9. ヘルスチェック

| エンドポイント | 目的 |
| --- | --- |
| `GET /api/v1/health` | 死活監視 |
| `GET /api/v1/health/db` | D1 接続確認 |
| `GET /api/v1/health/kv` | KV 接続確認（`apps/public` のみ。`apps/admin` は KV を持たない — GOV-01 D-022） |
| `GET /api/v1/health/queue` | 不要（Queues 不採用。将来 Queues を採用した場合のみ追加） |

両アプリにそれぞれ配置する（別 Worker のため、片方の死活は他方を保証しない）。日常の監視・障害対応は OPS-02 を参照。

> **`apps/admin` のヘルスチェックは Cloudflare Access のバイパスポリシーで到達可能にする**（GOV-01 D-022）。設定を忘れると外形監視が Access のログイン画面を受け取り、常時異常として検知される。バイパスするのは `/api/v1/health*` のみで、**それ以外のパスをバイパス対象に含めない**。

---

## 10. 記入時チェックポイント

- 環境（local / staging / production）の構成差分が明確か
- 2 アプリが同時にデプロイされない前提が DB 変更方針に反映されているか（§4）
- ロールバック条件が即時 / 計画で分かれているか
- 検証完了ゲートが本番リリース判断に使えるか
- 環境変数一覧がプロジェクトの採用機能（DEV-01 §2）と整合しているか
- フェイルクローズが必要な env（§8）が本番設定チェックリストに入っているか
- コンテンツ更新のうちデプロイを伴うもの（§1-1）が運用側（OPS-02）に伝わっているか
- 実作業手順が本書に紛れ込んでいないか（OPS-02 へ委譲されているか）
