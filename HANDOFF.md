# 作業引き継ぎメモ（2026-09-16 時点）

別環境で作業を再開するための一時メモ。**Step 4 まで終わったらこのファイルは削除する** — 恒久的な情報は
`CLAUDE.md` と `docs/` にあり、ここに残すと二重管理になる。

## 1. 現在地

- ブランチ `dev`、最新コミット `ab3a508`（docs 一式 + `CLAUDE.md` + `README.md` の改訂）
- **仕様の改訂は完了している。** 公開コンテンツの全面 Content Collections 化と管理画面の
  Cloudflare Access 化が docs に反映済み（GOV-01 D-017〜D-024）
- **コードは未着手。** テンプレートのまま（商品カタログ系のテーブルも無ければ、消すべき `media` も
  admin 認証も残っている）
- 未生成・未作成: `packages/schema/migrations/`、`.wrangler-state/`、`apps/*/.dev.vars`
- Cloudflare リソースは未作成（両 `wrangler.jsonc` に `replace-with-*` が 12 箇所ずつ残っている）

## 2. 最初に読むもの（この順番）

1. `CLAUDE.md` — 「About this project」「What this project adopts and drops」「Content lives outside D1」
2. `docs/5-governance/01-decision-log.md` の **D-017〜D-024**（今回の決定。背景と再評価条件つき）
3. `docs/3-development/06-frontend-guide.md` **§1-1**（置き場所の正本）と **§1-2**（画面 ID → ルートの対応表）
4. `docs/3-development/07-database-schema.md` — 残す 17 テーブルの定義

## 3. 次の作業（`pnpm db:generate` より前に 1〜3 を終える）

### Step 1: 削除と Cloudflare Access の導入（必ず同じ変更でやる）

**削除だけ先に流さないこと。** admin の認証を消した時点で `apps/admin` は誰でも到達できる状態になる。

削除するもの:

- `media` 関連 — `packages/schema` の `media`、`apps/admin/src/lib/server/services/media.ts`、
  `validation/media.ts`、`pages/api/v1/media/`、`tests/unit/media.test.ts`
- R2 — 両 `wrangler.jsonc` の `r2_buckets`（既定 + staging + production の 3 箇所ずつ）、
  `apps/admin/vitest.config.ts` の `r2Buckets`
- admin 認証 — `admin_sessions` / `password_reset_tokens`、`admin_users.password_hash`、
  `apps/admin/src/lib/server/auth/`、`services/auth.ts`、`validation/auth.ts`、`pages/api/v1/auth/`、
  `lib/components/{login-form,logout-button}.svelte`、`tests/unit/auth.test.ts`、
  `tests/e2e/login.spec.ts`、admin の KV binding と `SESSION_TTL_DAYS` / `AUTH_LOCKOUT_*`

同時に入れるもの:

- `apps/admin/src/middleware.ts` に Access JWT の検証（team の公開鍵 + **AUD tag** で署名・`aud`・`exp`）。
  結果は `Astro.locals` に載せ、ハンドラが `Cf-Access-Jwt-Assertion` を直接読まない
- `DEV_ADMIN_EMAIL` フォールバック（ローカルと E2E は Access を通過できないため）。
  **`APP_ENV=production` で無効になることを Vitest で固定する**
- `apps/admin/src/pages/index.astro` をログインからダッシュボード（ADM-01）に置き換える
- `requireAdminUser(context)`（JWT の email で `admin_users` を引き、無ければ作成。`status=inactive` は拒否）

`packages/server-kit` の auth は残す（`apps/public` が使う）。ただし利用者は public だけになる。

### Step 2: スキーマ確定（`schema-build` スキル）

`docs/3-development/07-database-schema.md` が正本。`packages/schema/src/schema.ts` を 17 テーブルへ。
テンプレートとの差分で見落としやすいのは:

- `organizations.org_code`（UNIQUE）を追加 — 取引先別価格ファイルからの参照キー
- `inquiries` の列合わせ — `message` → `content`、`handled_by` → `assignee_id`、`company_name` / `phone` / `memo` を追加
- `cart_items` / `order_items` は `product_id` ではなく **`product_slug`**（外部キーなし）
- `order_items` のスナップショット列（`product_name_snapshot` / `unit_price_snapshot` / `tax_rate_snapshot`）
- `activity_log.organization_id` を追加
- 商品カタログ系 8 テーブルと `news` は**作らない**

### Step 3: コンテンツ基盤

- `packages/content/src/schema.ts` に Zod を定義 — 商品 / メーカー / ブランド / 取引先別価格 / お知らせ
  （`draft`、`discontinued`、`visibility`、`order` を忘れない）
- `apps/public/src/content.config.ts` を差し替え（`products` / `manufacturers` / `brands` / `prices` / `news`）
- テンプレートの `articles` コレクション、`packages/content/articles/`、`apps/public/src/pages/articles/` を削除
- `apps/public/src/lib/catalog.ts` を作り、**コレクションの読み取りはすべてここを経由**させる

### Step 4: マイグレーション

```bash
pnpm db:generate    # → packages/schema/migrations/（コミットする）
pnpm db:migrate
```

以降、テーブルの削除は「削除」ではなく「マイグレーション」になる。

## 4. 新しい環境の立ち上げ

`README.md` の手順 1〜9 が正本。移行先で特に効くのは:

- **Claude Code の認証は名前付きボリュームにあり、ホストと共有されない。** 新しいコンテナでは
  `claude` を実行して**そのプロジェクト専用にログインし直す**（`CLAUDE.md` の Container 節）
- `.devcontainer/.env` の `COMPOSE_PROJECT_NAME` と `APP_PORT_DEV_PUBLIC` / `APP_PORT_DEV_ADMIN` を
  他プロジェクトと衝突しない値にする。ポートはリポジトリ直下の `.env` では**なく**ここを読む
- `.dev.vars` は gitignore されているので移行先で作り直す（`.dev.vars.example` からコピー）。
  Step 1 以降は `apps/admin/.dev.vars` に `DEV_ADMIN_EMAIL` が要る
- Cloudflare リソースは未作成。作るときは `database_id` を**両アプリで完全に一致**させる
  （食い違うと各アプリが別々のローカル DB を持ち、エラーも出ない）

## 5. 踏みやすい地雷

- **商品・お知らせのページに `prerender = true` を付けない**（D-021）。全取引先の卸価格が静的 HTML に
  焼き込まれ、未ログインの訪問者に配信される。卸価格を Svelte アイランドの props に渡すのも同じ結果になる
- **`apps/admin` にアプリ側のログインを再導入しない**（D-022）。認証の入口が 2 つある状態が最も危険
- **管理画面にコンテンツ編集機能を足さない**（D-017 / D-018）。欲しくなった時に必要なのは画面ではなく
  D-017・D-018 の再評価
- **注文の表示は `order_items` のスナップショット列から**。Markdown を読み直すと価格改定で過去の注文金額が変わる
- `draft` と `visibility: client_only` は **一覧・詳細・サイトマップの 3 か所**で除外する

## 6. 未決のまま残っているもの（GOV-02）

| TBD | 内容 | 優先 |
| --- | --- | :---: |
| TBD-32 | Access のバイパス方式（ローカル / E2E）と Access Application の作成手順・AUD tag の取得 | **P0** |
| TBD-11 | 利用規約・プライバシー・特商法の文面（法務） | **P0** |
| TBD-01 / TBD-16 | サービス名・運営会社名・確定ドメイン | **P0** |
| TBD-09 | 商品選び診断の設問・判定ルール（確定するまで `/diagnosis` は Coming soon） | P1 |
| TBD-20 | 運営が自分でコンテンツを編集したい要望が出た場合の対応（運用開始 3 ヶ月で再評価） | P1 |

## 7. 参考にした実装

`https://github.com/team-natural/pet-kampo` — 同じテンプレート由来の姉妹プロジェクト（B2C）。
「コンテンツは Content Collections、取引データのみ D1」という方針の実例で、公開画面 36 ルートが実装済み。
`packages/content/src/schema.ts`、`apps/public/src/lib/{commerce,faq,content}.ts`、決定ログの書き方が参考になる。
ただし **Cloudflare Access は使っておらず、管理画面は `admin_users` ログイン**なので、認証まわりは倣わないこと。
