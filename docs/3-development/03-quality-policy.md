---
doc-id: DEV-03
title: 品質方針
phase: 3
status: draft-ai
owner: Tech Lead / PdM（兼務前提）
last-updated: 2026-09-09
related-docs:
  - BIZ-02: 品質目標 KPI
  - DEV-01: アーキテクチャ原則
  - DEV-06: コンテンツの置き場所（§1-1）
  - DEV-08: デプロイ判断
  - OPS-02: 運用ハンドブック
  - 実装規約: `CLAUDE.md`（DEV-01 §9 参照）
---

# 03-quality-policy.md — 品質方針

## このセクションの目的

品質目標、完了定義、テスト戦略、レビュー基準、技術的負債の管理方法を定義する。**品質目標の参照源は BIZ-02**。

## 0-H. ハイブリッド編集ガイド（要点）

- 推奨モード: Hybrid（AI 整理 + Tech Lead / PdM（兼務前提）レビュー）
- 人間確認必須: 品質目標の現実性、DoD の厳しさ、運用できるテスト戦略

---

## 1. 品質方針

- **品質の定義**: 顧客が安心して継続利用でき、サービス価値を損なわない状態
- **優先する品質特性**: 信頼性、パフォーマンス、使いやすさ、変更容易性
- **妥協しない最低基準**:
  - 認証・認可（AdminUser のセッション境界、Organization スコープ境界）の欠陥はリリースしない
  - 決済の整合性問題はリリースしない
  - データ損失（特に決済済みデータ）はリリースしない
  - 卸価格が未承認の利用者に漏れる欠陥はリリースしない（PRD-02 §2-3）
- **KPI との接続**: BIZ-02 §2-2 の正本マップ経由で KPI-10〜13 に接続（KPI-14 は廃止 — インシデント解決目安は OPS-02 §2）

---

## 2. 完了定義（DoD）チェックリスト

機能 PR が Merge されるための条件：

- [ ] 要件（PRD-03 機能 ID）に対応する受け入れ条件を満たす
- [ ] テストが追加 / 更新されている（正常系・バリデーション異常系・権限異常系。Vitest — DEV-01 §1）
- [ ] 型チェック（`pnpm typecheck` = 各アプリで `wrangler types` → `astro check`）でエラー 0 件（DEV-01 §1「型チェック」参照。`tsc` 単体では `.astro`/`.svelte` を解析できない）
- [ ] Prettier + ESLint（`pnpm check`。レイヤー境界ルール `eslint-plugin-boundaries` 含む — §3-3）で整形・Lint 済み
- [ ] 関連 Service（`apps/*/src/lib/server/services/`）/ D1 アクセス関数の Unit テスト（Vitest）がある
- [ ] AdminUser セッション検証・Organization スコープのテストが含まれる（AdminUser 側にロール差分は無い — GOV-01 D-014）
- [ ] 診断・記事等の Content Collections から生成する個別ページに `export const prerender = true` がある（§3-5）
- [ ] ログ出力（request_id / admin_user_id / member_id）が適切
- [ ] セキュリティ観点（DEV-02 §10）の自己確認完了
- [ ] コメントが CLAUDE.md「Comments」の基準を満たす（**そのコメントが防ぐ具体的なミスを言えるか**。言えなければ削除。理由の説明はコミットメッセージか docs へ）
- [ ] DEV ドキュメントへの影響があれば更新済み

---

## 3. テスト戦略

### 3-1. テスト種別

| 種別 | 目的 | 対象 | ツール | 必ず検証すること | タイミング |
| --- | --- | --- | --- | --- | --- |
| Unit Test | 業務ロジック検証 | Service（`apps/*/src/lib/server/services/`）/ 状態遷移関数 / `packages/server-kit` | Vitest + `@cloudflare/vitest-plugin`（**workerd 上で実行**。DEV-01 §1） | E2E で到達できない条件（§3-5） | PR 時 |
| Feature / Integration Test | エンドポイント動作 | Astro API Route（`apps/*/src/pages/api/**/*.ts`） | Vitest（同上）または Playwright の `request` | 認証が必要なルートは全て | PR 時 |
| Architecture Test | レイヤー境界遵守（DEV-01 §4/§5） | Astro Page/API Route → Service → D1 の依存方向 | `eslint-plugin-boundaries`（確定済み。詳細は §3-3） | エラー 0 件 | PR 時（Lint 自動） |
| Integration Test | 外部 API 連携 | Stripe / R2 / メール配信 | Vitest + モック（DEV-10 §9 のモック方針参照） | 主要連携 100% | PR 時 |
| E2E Test（**導入済み**・CI で実行） | 主要フロー | 管理画面ログイン / Member 認証 / 新規取引申請 / 診断 / カート・発注 / お問い合わせ送信 | Playwright（`playwright` MCP は design-review 用、テストランナーとしても同ツール） | ハイドレーション（`client:*` 忘れ）は E2E でしか捕まらない（§3-5） | PR 時 |
| Static Analysis | 型安全性 | 全 `.ts` / `.astro` / `.svelte` コード | ESLint + TypeScript strict（`astro/tsconfigs/strict`）。`pnpm typecheck`（各アプリで `wrangler types` → `astro check`） | エラー 0 件 | PR 時 |
| Style Check | コードスタイル | 全コード | Prettier + ESLint。`pnpm check` は format:check + lint + typecheck + **単体テスト**をまとめて実行する | 100% Pass | PR 時（Hook 自動 — `.claude/hooks/format-and-check.sh`） |
| Security Test | 脆弱性検知 | 依存関係 / コード | Dependabot / `security-review` スキル | High 以上 0 件 | 自動検知 / リリース前 |

> カバレッジ計測ツールは未導入のため、数値目標は置かない。代わりに「何を必ず検証するか」を上表と §3-5 で定める。
>
> D1 を使うテストは `tests/setup.ts` がマイグレーションを適用する。`packages/schema/migrations/` はリポジトリに同梱されない生成物なので、**`pnpm db:generate` を先に実行する必要がある**（`pnpm test:e2e` も同様）。

### 3-2. AI 機能のテスト戦略

本プロジェクトは AI 機能を採用しないため対象外（PRD-05）。商品選び診断はルールベースであり、非決定性を扱うテスト設計は不要 — 通常の Unit Test（入力の組み合わせ → 期待する推奨商品）で担保する（§3-5）。

### 3-3. レイヤー境界の検証（eslint-plugin-boundaries）

DEV-01 §4/§5 が定めるレイヤー境界（Astro Page / API Route → Service → D1）は `eslint-plugin-boundaries` で機械検証する（`Confirmed`・導入済み — `eslint.config.js` の `boundaries/dependencies` ルール）。ページ / API Route は `@app/schema/client`（db ハンドル）を持ってよいが、テーブル定義（`@app/schema`）の import は `no-restricted-imports` で禁止する — クエリは Service 層に閉じる。あわせて PR レビュー（§4）で以下を人間が確認する（import 検査では捕捉できない観点）：

- `.astro` ページ内で直接 `env.DB.prepare()` を呼んでいないか（DEV-01 §8 アンチパターン）
- Svelte アイランドの `onMount` 内で状態遷移を実行していないか
- API Route が Service を経由せず D1 に直接アクセスしていないか
- 認可チェック（AdminUser のセッション検証、または Member の Organization スコープ検証）が Service / D1 アクセスの境界で強制されているか（DEV-01 §4「認可チェックの徹底」）

設定の実体は `eslint.config.js`（`boundaries/elements` + `boundaries/files` + `boundaries/dependencies`）を参照。

### 3-4. テストデータ生成

- ORM は Drizzle（DEV-01 §1、決定済み）。テストデータ生成のヘルパー（Factory 相当）は Drizzle スキーマの型（`typeof table.$inferInsert`）を使った INSERT ヘルパー関数、またはテスト用シード SQL として用意する
- 本プロジェクトは発注関連データに Organization 単位のテナント境界を持つ（PRD-02 §2）。複数 Organization・複数 Member を用意し、他 Organization のデータにアクセスできないことを検証するテストデータ生成ヘルパーを用意する（例: `asMemberOf(organization)`）。AdminUser 側はロール区分を持たないため（GOV-01 D-014）、ロール差分のテストは不要
- Organization スコープ × 操作のマトリクステスト（Vitest のパラメータ化テスト `test.each`）を用意する
- E2E は `globalSetup` で自身のアカウントをシードする（環境変数の受け渡しは不要）

### 3-5. 単体テストと E2E の役割分担（どちらでしか守れないか）

**単体テストと E2E は役割が違う。** 単体テストは workerd 上で動くため D1 も KV も本物で、E2E から到達できない条件を担当する。以下は単体テストでしか守れない：

- ロックアウト閾値・セッション TTL の環境変数が未設定のときに例外を投げること（`NaN` 比較で黙って無効化されるのを防ぐ — DEV-02 §7）。**ロックアウトが無効化されていても E2E は全件通る**ため、ここは単体でしか守れない
- セッションの期限切れ、停止済みアカウント・取引停止中 Organization の即時失効
- 未知のメールアドレスとパスワード誤りで応答時間が桁違いにならないこと（列挙オラクル対策 — DEV-02 §7）
- 発注時の価格解決（`organization_product_prices` があればそちら、無ければ `products.wholesale_price`）
- 診断ルール（`packages/content`）の推奨商品 slug が、公開済み・取扱中の商品にのみ解決されること。**slug 参照は D1 の外部キー制約で守られない**ため、テストが唯一の防御線（PRD-02 §7、DEV-02 §3-1）
- 税額・送料の端数処理（BIZ-03 §2-3・§3-2）

逆に以下は E2E でしか捕まらない：

- ハイドレーション（`client:*` の書き忘れ）。サーバー側で描画されてしまうため、操作しないと気付けない — 診断のような対話型 UI は特に該当する
- Content Collections から生成する個別ページの `export const prerender = true` 忘れ（一覧は出るのに個別ページだけ 500 になる — DEV-06 §1-1）
- 卸価格の出し分け（未ログイン / ログイン済み・active / ログイン済み・suspended の 3 状態で表示が変わること）

---

## 4. コードレビュー基準

PR レビュー観点：

- 要件の意図に沿っているか（PRD-03 機能 ID 対応）
- レイヤー責務（DEV-01 §5-3）が守られているか
- 命名がユビキタス言語（PRD-01）と整合しているか
- セキュリティ観点（DEV-02 §10）が満たされているか
- N+1 クエリ相当の非効率な D1 アクセスが発生していないか
- 重い処理がレスポンスをブロックしていないか（`ctx.waitUntil()` / Cron バッチ — DEV-01 §4/§8）
- 状態遷移は単一の遷移関数経由か（DEV-01 §4「状態遷移の集約」）
- 認可チェック（AdminUser のセッション検証、または Member の Organization スコープ検証）が強制されているか
- 状態を変更する Service メソッドが監査ログを記録しているか（監査ログは自前の D1 テーブル `activity_log` — DEV-01 §2。記録呼び出しの **欠落** は Arch テスト・静的解析で検出できないため、レビューが唯一の防御線）
- エンドユーザー向け通知（メール等）が共通の送信関数経由か、スタッフ向けアラートと実装を分けているか（DEV-05 参照）
- 業務閾値・外部サービス ID がハードコードされていないか（DEV-05 §10）
- 新しいテーブルに更新経路（管理画面 or seed）があるか、逆に運営が更新しないコンテンツを D1 に入れていないか（DEV-01 §3 最終行、DEV-06 §1-1）
- **利用規約・プライバシーポリシー・特商法表示の文面変更を含む PR は、法務レビュー済みか**（管理画面を持たないため、この確認は PR レビューにしか置けない — DEV-02 §2-3、OPS-01 §5）
- テストが境界条件・例外系も含むか
- 過剰抽象化していないか

AI による自動レビュー（実装規約の正本: `CLAUDE.md`、DEV-01 §9 参照）の後、人間レビュー必須。

---

## 5. 技術的負債の管理

| 区分 | 方針 |
| --- | --- |
| 識別 | PR レビューで「TODO（負債）」コメント、GitHub Issues に転記 |
| 返済比率 | 開発工数の一定割合（目安 20%）を負債返済に割り当て |
| 可視化 | GitHub Project の `tech-debt` ラベル |
| 優先順位 | セキュリティ > 性能 > 保守性 > スタイル |

---

## 6. テスト実行コマンド

テストツールは Vitest（単体）+ Playwright（E2E）で導入済み（DEV-01 §1）。

```bash
# 単体テスト（全パッケージ）。migrations/ が未生成なら先に pnpm db:generate
pnpm test

# 特定パッケージのみ
pnpm --filter admin test

# 特定テストのみ
pnpm --filter admin exec vitest run orders

# E2E（両アプリ。--concurrency=1 で直列実行される）
pnpm test:e2e
```

> `@cloudflare/vitest-plugin` の peer は `vitest ^4.1.0`。vitest 5 を入れると miniflare が
> 素の `SyntaxError` で起動しなくなるため、バージョンを固定している（DEV-01 §1）。
>
> `pnpm test:e2e` が `--concurrency=1` なのは、両アプリの E2E が同一のローカル D1 に対して
> 実サーバーを立てるため。並列実行すると D1 が壊れる。

---

## 7. KPI 接続

| KPI ID | 内容 | テストでの担保 |
| --- | --- | --- |
| KPI-10 | Core Web Vitals（LCP/CLS/INP。定義の正本は BIZ-02 §2-2） | Performance Test（Lighthouse 等）、リリース前にレポート確認 |
| KPI-11 | 商品検索・診断応答時間 p95（定義の正本は BIZ-02 §2-2） | Performance Test、リリース前にレポート確認 |
| KPI-12a / KPI-12b | 稼働率 | 数値の正本は PRD-02 §5-2。死活監視・デプロイゲートは OPS-02（運用ハンドブック）参照 |

> 主要 API p95（500ms 以内。DEV-01 §6）は KPI-ID を持たない内部の性能目標としても扱うが、定義は BIZ-02 §2-2 の KPI-10 に接続する。テストでの担保方法は上表と同じ（Performance / Integration Test）。

---

## 8. 記入時チェックポイント

- 品質方針が KPI（BIZ-02）と接続されているか
- DoD が実行可能か（理想論で終わっていないか）
- テスト戦略がプロジェクトのリソースに合うか
- 単体テストと E2E の役割分担（§3-5）が「どちらでしか守れないか」で説明されているか
- レビュー基準が PR 時のチェック項目として運用可能か
