---
doc-id: DEV-06
title: フロントエンド実装ガイド
phase: 3
status: draft-ai
owner: Tech Lead
last-updated: 2026-09-16
related-docs:
  - DEV-01: 技術スタック決定書・アーキテクチャ原則
  - DEV-04: API 仕様
  - DEV-05: バックエンド実装（Service 層の境界）
  - PRD-02: システム構成（§1-4 コンテンツの置き場所）
  - PRD-04: UI/UX 設計（管理画面標準構成・§3-1-1 画面ごとの供給元）
  - CLAUDE.md: コード例・実装パターンの正本
---

# 06-frontend-guide.md — フロントエンド実装ガイド（管理画面パターン含む）

## このセクションの目的

DEV-01 で確定したフロントエンドスタックによる実装の設計原則を定義する。画面パターン 5 種
（ダッシュボード / 一覧 / 詳細 / フォーム / 設定）の「構成の考え方」、UI/UX 原則、状態管理
方針、アクセシビリティ / レスポンシブ方針を扱う。

- 技術スタックの選定は本書には書かない（DEV-01 が唯一の正本）。
- **コード例・実装パターンの正本: `CLAUDE.md`**（DEV-01 §9 参照）。
  コンポーネントの書き方・CSS 記法は同ファイルと `.claude/skills/shadcn-svelte/rules/` に委ねる。
- 画面を実際に組み立てる際の作業チェーンは `.claude/skills/public-design`（公開画面）/
  `.claude/skills/admin-design`（管理画面）を使う。本書 §4 は `admin-design` の Step 1 が
  参照する「標準パターン」の正本にあたる。
- **§1-1（コンテンツの置き場所）は、公開画面に出すデータをどこに置くかの唯一の正本**である。
  PRD-01 §1-5 / PRD-02 §1-4 / PRD-04 §3-1-1 / DEV-07 §3 は本節を参照する。

## 0-H. ハイブリッド編集ガイド（要点）

- 推奨モード: Human-first または Hybrid
- 人間確認必須: 状態の置き場所、コンテンツの置き場所、デザインシステム整合、a11y 基準
- 詳細は 00_README.md §6〜8

---

## 1. ディレクトリ構成

このモノレポでは公開画面と管理画面が別アプリ（DEV-01 §1「リポジトリ構成」参照）。

```text
apps/public/src/
├── pages/
│   ├── index.astro              # 公開トップ（SCR-01）
│   ├── products/                # 商品一覧・詳細（SCR-02, SCR-03）。実体は packages/content（§1-1）
│   ├── diagnosis/               # 商品選び診断（SCR-04）。設問確定まで Coming soon（GOV-01 D-023）
│   ├── apply/                   # 新規取引申請（SCR-05, SCR-06）+ 申請取消（SCR-36）
│   ├── activate/                # アカウント有効化（SCR-09）
│   ├── login.astro              # Member ログイン（SCR-07）。`/` は公開トップのため
│   │                            #   管理画面と違いログインは /login に置く
│   ├── login/                   # パスワード再設定（SCR-10, SCR-11）
│   ├── auth/                    # OAuth 開始・コールバック（SCR-08）。画面を持たない
│   ├── mypage/                  # マイページ配下（SCR-12〜SCR-20）
│   ├── cart.astro               # カート（SCR-21）
│   ├── checkout/                # 発注確認・完了・失敗（SCR-22〜SCR-24）
│   ├── news/                    # お知らせ（SCR-25, SCR-26）。実体は packages/content（§1-1）
│   ├── faq.astro                # よくある質問（SCR-27）。設問データは lib/faq.ts（§1-1）
│   ├── terms.astro              # 利用規約（SCR-28）。文面はこのファイルに直書き（§1-1）
│   ├── privacy.astro            # プライバシーポリシー（SCR-29）。同上
│   ├── contact/                 # お問い合わせ（SCR-30, SCR-31）
│   ├── law.astro                # 特定商取引法に基づく表示（SCR-32）。値は lib/commerce.ts から
│   └── api/v1/**/*.ts           # API ルート（DEV-04 §5）
├── assets/img/                  # 商品画像等の静的アセット（GOV-01 D-020）。astro:assets で最適化
├── lib/
│   ├── commerce.ts              # 送料・税率・最低発注金額・支払方法・ステータス表示メタ（D-024）
│   ├── faq.ts                   # FAQ のカテゴリと項目（D-024）
│   ├── inquiry.ts               # お問い合わせ種別マスタ（D-024）
│   ├── catalog.ts               # Content Collections の商品を読む唯一の入口（§1-1）
│   ├── components/              # 公開画面の Svelte アイランド（client:* で .astro に埋め込む）
│   └── server/                  # Service 層（内部構成は DEV-05 §1 が正本）
├── content.config.ts            # Content Collections の定義（§1-1）
├── layouts/
│   └── Layout.astro             # 公開画面の HTML 骨格・<head>・global.css
└── middleware.ts                # セキュリティヘッダー + 会員ルートの Cache-Control（DEV-05 §1-2）

apps/admin/src/
├── pages/                        # `/admin` 等の接頭辞は付けない。apps/admin はサブドメイン
│   │                             #   （例: admin.example.com）に丸ごとデプロイされるため
│   │                             #   （DEV-01 §1、DEV-04 §1-1、PRD-04 §3-2）
│   ├── index.astro              # 管理ダッシュボード（ADM-01）。ログイン画面は持たない
│   │                             #   （認証は Cloudflare Access — GOV-01 D-022）
│   ├── applications/ 他         # 取引申請・取引先・受注・問い合わせ・監査ログ（ADM-12〜24）
│   └── api/v1/**/*.ts           # API ルート（DEV-04 §5）
├── lib/
│   ├── components/
│   │   ├── ui/                  # shadcn-svelte 生成コンポーネント（DEV-01 §1。編集してよい）
│   │   └── admin/               # 管理画面専用の合成コンポーネント（stat-card 等 — Assumed）
│   ├── server/                  # Service 層（内部構成は DEV-05 §1 が正本。D1 アクセスを集約）
│   └── utils.ts                 # `cn()` 等の共通ユーティリティ
├── layouts/
│   └── Layout.astro             # 管理画面の HTML 骨格・<head>・admin.css
└── middleware.ts                # セキュリティヘッダー + Access JWT の検証（DEV-02 §1-1）

packages/content/                # 開発者が更新する Markdown（§1-1）
├── products/                    # 商品（説明・原材料・卸価格・発注単位）
├── manufacturers/               # メーカー
├── brands/                      # ブランド
├── news/                        # お知らせ
├── prices/                      # 取引先別の個別卸価格（GOV-01 D-019）
└── diagnosis/                   # 商品選び診断のルール（設問確定後に追加 — D-023）
```

公開画面・管理画面をディレクトリで分離する（Platform 階層は存在しないため分離対象に含まない — PRD-01 §1-2）。`Assumed` と付記した部分は
まだ実例がない規約案であり、最初の画面を作る際に確定させ本書を更新する。

### 1-1. コンテンツの置き場所（D1 か Content Collections か定数か直書きか）

公開画面に出すコンテンツは、**誰が更新するか**で置き場所が決まる（DEV-01 §1）。

| 更新者 | 置き場所 | 画面 |
| --- | --- | --- |
| 運営（納品先の顧客） | D1（`schema-build` → `scaffold`） | 管理画面が必要 |
| 開発者（自社） | `packages/content` の Markdown / TypeScript 定数 / ページ直書き | 管理画面は不要 |

判断に迷う場合は Content Collections を優先する。ビルド時に解決されるため **D1 の読み取りが発生せず**、
管理画面も作らずに済む。Cloudflare の課金は D1 の行読み取りに乗るので、閲覧数の多い公開ページほど
差が出る。

**本プロジェクトの割り当て（確定 — GOV-01 D-015〜D-020・D-023・D-024）**

本プロジェクトは **D1 に取引データしか置かない**。公開コンテンツは 1 件も D1 にない。

| コンテンツ | 置き場所 | 実体 | 更新手段 |
| --- | --- | --- | --- |
| 商品（説明・原材料・使用方法・標準卸価格・発注単位）| **Content Collections** | `packages/content/products/*.md` | コミット + デプロイ |
| メーカー・ブランド | **Content Collections** | `packages/content/{manufacturers,brands}/*.md` | 同上 |
| 取引先別の個別卸価格 | **Content Collections** | `packages/content/prices/*.md` | 同上（GOV-01 D-019）|
| お知らせ | **Content Collections** | `packages/content/news/*.md` | 同上（GOV-01 D-018）|
| 商品選び診断のルールセット | **Content Collections** | `packages/content/diagnosis/*.md` | 同上（設問確定後 — D-023）|
| 商品画像 | **静的アセット** | `apps/public/src/assets/img/` | コミット + デプロイ（GOV-01 D-020）|
| 商品カテゴリー・気になる点の分類 | **TypeScript 定数** | `apps/public/src/lib/catalog.ts` | コミット + デプロイ |
| よくある質問（FAQ）| **TypeScript 定数** | `apps/public/src/lib/faq.ts` | 同上 |
| 送料・税率・最低発注金額・支払方法・ステータス表示メタ | **TypeScript 定数** | `apps/public/src/lib/commerce.ts` | 同上 |
| お問い合わせ種別マスタ | **TypeScript 定数** | `apps/public/src/lib/inquiry.ts` | 同上 |
| サイト名・ロゴ・OGP 既定値・ナビ・フッター | **コード固定** | レイアウト / コンポーネント | 同上 |
| 利用規約・プライバシーポリシー・特商法表示 | **ページ直書き** | `terms.astro` / `privacy.astro` / `law.astro` | コミット + デプロイ（法務レビュー必須）|

商品カタログとお知らせを Content Collections にしたのは、**更新するのが運営ではなく開発者であり、頻度も
半年に 1 回程度だから**である（GOV-01 D-017・D-018）。結果として商品カタログ系 8 テーブルと ADM-02〜11・
ADM-19〜21 の 13 画面が不要になった。**運営はお知らせも自分では出せない** — 臨時休業や出荷遅延の告知も
デプロイを伴う。これは確認のうえで選んだ構成であり、運用が回らないと判明した場合の戻し方は D-018 の
再評価条件に書いてある。

FAQ・分類ラベル・商取引条件を Markdown にしないのは、これらが散文ではなく**カテゴリで絞る構造化データ**
だからである。frontmatter だけのファイルが並ぶより定数配列の方が扱いやすく、型も付く（GOV-01 D-024）。

**実装**

`apps/public/src/content.config.ts` が `packages/content/` を `glob()` ローダーで読み、
スキーマは `@app/content` から import する（両アプリが同じ定義を見るため）。

```typescript
// apps/public/src/content.config.ts
const products = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "../../packages/content/products" }),
  schema: productSchema,
});
```

**Content Collections の読み取りは `lib/catalog.ts` に集約する。** 商品の公開状態（`draft`）・
取扱終了（`discontinued`）の除外をページごとに書くと、いずれか 1 画面で漏れる。

**外部キーが張れない参照が 3 か所ある**（参照先が D1 に無いため）。Service 層での存在検証だけが歯止めになる：

| 参照 | 参照元 → 参照先 | 検証方法 |
| --- | --- | --- |
| 商品 | `order_items.product_slug` → `products/*.md` | 発注確定時に解決し、**注文には商品名・単価をスナップショット保存**する（DEV-07 §6）|
| 取引先別価格 | `prices/*.md` の取引先コード → `organizations.org_code` | Service 層で検証し、Vitest で「全エントリが実在する取引先を指す」ことを固定（D-019）|
| 診断の推奨商品 | `diagnosis/*.md` の `slug` → `products/*.md` | 単体テストで解決可能性を検証（DEV-03 §3-5）|

**商品 `slug` は不変として扱う。** 注文履歴・診断ルール・公開 URL の 3 か所から参照されるため、
リネームが必要な場合は旧 slug からのリダイレクトを追加する（DEV-01 §8）。

> **商品一覧・詳細とお知らせ詳細に `prerender = true` を付けてはならない**（GOV-01 D-021）。
> 卸価格と取引先限定お知らせが静的 HTML に焼き込まれ、未ログインの訪問者に配信される。
> これらは `getStaticPaths()` を使わず、リクエスト時に `getEntry()` で slug から引く。
> `output: "server"` では `getStaticPaths()` が**黙って無視される**ため、静的化したいページ
> （FAQ・法務・会社案内）には `export const prerender = true` を明示的に書く — 書き忘れると
> 一覧は出るのに個別ページだけ 500 になり、原因が分かりにくい（`apps/public/tests/e2e/` で検証している）。

**直書きページ・定数の注意点**

- FAQ・法務ページは**ログイン状態に依存しない**ため `export const prerender = true` を付けてビルド時に確定させる（PRD-02 §9）
- **特定商取引法に基づく表示（SCR-32）の送料・税・支払方法は `lib/commerce.ts` から描画する。**
  ページに直接書くと、カート計算と法定表示で金額が食い違う（GOV-01 D-024）
- 利用規約の**現行バージョン文字列は定数 1 箇所**（例 `apps/public/src/lib/terms-version.ts`）で持ち、
  規約ページと申請フォームの両方がそれを参照する。申請時に `applications.agreed_terms_version` へ記録し、
  サーバー側で現行バージョンとの一致を検証する（DEV-04 §6-1、DEV-07 §5-1）。規約本文を書き換えたら
  この定数も必ず更新する — **文面だけ変えてバージョンを据え置くと、誰がどの版に同意したのか追跡できなくなる**
- 規約文面を含む変更は法務レビューを経た PR でのみマージする（管理画面が無いため、この確認は PR レビューにしか置けない — DEV-03 §4、OPS-01 §5）
- `inquiries.type` には**定数の id だけを保存し、表示ラベルを保存しない**。ラベルを保存すると文言を直した瞬間に過去データと食い違う（D-024）

### 1-2. 画面 ID とルートの対応（確定）

Astro のルーティングはファイルパスがそのまま URL になるため、ルート登録ファイルを別に持たない。
**本表が画面 ID と実装パスの対応の正本**であり、PRD-04 §3 の画面一覧と 1 対 1 で対応する。

| 画面 ID | ルート | 実装パス | 配信 |
| --- | --- | --- | :---: |
| SCR-01 | `/` | `pages/index.astro` | SSR |
| SCR-02 | `/products` | `pages/products/index.astro` | SSR（D-021）|
| SCR-03 | `/products/[slug]` | `pages/products/[slug].astro` | SSR（D-021）|
| SCR-04 | `/diagnosis` | `pages/diagnosis/index.astro` | SSG（Coming soon — D-023）|
| SCR-05 | `/apply` | `pages/apply/index.astro` | SSR |
| SCR-06 | `/apply/complete` | `pages/apply/complete.astro` | SSR |
| SCR-07 | `/login` | `pages/login.astro` | SSR |
| SCR-08 | `/auth/[provider]` · `/auth/[provider]/callback` | `pages/auth/[provider]/{index,callback}.ts` | SSR（画面なし）|
| SCR-09 | `/activate/[token]` | `pages/activate/[token].astro` | SSR |
| SCR-10 | `/login/forgot` | `pages/login/forgot.astro` | SSR |
| SCR-11 | `/login/reset/[token]` | `pages/login/reset/[token].astro` | SSR |
| SCR-12 | `/mypage` | `pages/mypage/index.astro` | SSR（要ログイン）|
| SCR-13 | `/mypage/profile` | `pages/mypage/profile.astro` | SSR（要ログイン）|
| SCR-14 | `/mypage/company` | `pages/mypage/company.astro` | SSR（要ログイン）|
| SCR-15 | `/mypage/addresses` | `pages/mypage/addresses/index.astro` | SSR（要ログイン）|
| SCR-16 | `/mypage/addresses/new` | `pages/mypage/addresses/new.astro` | SSR（要ログイン）|
| SCR-17 | `/mypage/addresses/[public_id]/edit` | `pages/mypage/addresses/[public_id]/edit.astro` | SSR（要ログイン）|
| SCR-18 | `/mypage/orders` | `pages/mypage/orders/index.astro` | SSR（要ログイン）|
| SCR-19 | `/mypage/orders/[public_id]` | `pages/mypage/orders/[public_id].astro` | SSR（要ログイン）|
| SCR-20 | `/mypage/withdrawal` | `pages/mypage/withdrawal.astro` | SSR（要ログイン）|
| SCR-21 | `/cart` | `pages/cart.astro` | SSR（要ログイン）|
| SCR-22 | `/checkout` | `pages/checkout/index.astro` | SSR（要ログイン）|
| SCR-23 | `/checkout/thanks` | `pages/checkout/thanks.astro` | SSR（要ログイン）|
| SCR-24 | `/checkout/failed` | `pages/checkout/failed.astro` | SSR（要ログイン）|
| SCR-25 | `/news` | `pages/news/index.astro` | SSR（D-021）|
| SCR-26 | `/news/[slug]` | `pages/news/[slug].astro` | SSR（D-021）|
| SCR-27 | `/faq` | `pages/faq.astro` | **SSG** |
| SCR-28 | `/terms` | `pages/terms.astro` | **SSG** |
| SCR-29 | `/privacy` | `pages/privacy.astro` | **SSG** |
| SCR-30 | `/contact` | `pages/contact/index.astro` | SSR |
| SCR-31 | `/contact/complete` | `pages/contact/complete.astro` | SSR |
| SCR-32 | `/law` | `pages/law.astro` | **SSG** |
| SCR-33 | `/404` | `pages/404.astro` | SSR |
| SCR-34 | `/500` | `pages/500.astro` | SSR |
| SCR-35 | — | `pages/api/v1/auth/logout.ts` | API（画面なし）|
| SCR-36 | `/apply/cancel/[token]` | `pages/apply/cancel/[token].astro` | SSR |

| 画面 ID | ルート | 実装パス |
| --- | --- | --- |
| ADM-01 | `/` | `pages/index.astro` |
| ADM-12 | `/applications` | `pages/applications/index.astro` |
| ADM-13 | `/applications/[public_id]` | `pages/applications/[public_id].astro` |
| ADM-14 | `/organizations` | `pages/organizations/index.astro` |
| ADM-15 | `/organizations/[public_id]` | `pages/organizations/[public_id].astro` |
| ADM-16 | `/organizations/[public_id]/members` | `pages/organizations/[public_id]/members.astro` |
| ADM-17 | `/orders` | `pages/orders/index.astro` |
| ADM-18 | `/orders/[public_id]` | `pages/orders/[public_id].astro` |
| ADM-22 | `/inquiries` | `pages/inquiries/index.astro` |
| ADM-23 | `/inquiries/[public_id]` | `pages/inquiries/[public_id].astro` |
| ADM-24 | `/audit-logs` | `pages/audit-logs/index.astro` |
| ADM-25 | `/404` · `/500` | `pages/404.astro` / `pages/500.astro` |

**URL の規約**

- 可変部は連番 ID を使わない（DEV-01 §8）。**D1 のリソースは `public_id`（ULID）、Content Collections のリソースは `slug`**
- 管理画面に `/admin` 接頭辞を付けない。`apps/admin` はサブドメインに丸ごとデプロイされる（DEV-04 §1-1）
- `apps/admin` の `/` は**ダッシュボード**（ADM-01）。ログイン画面は持たない（Cloudflare Access — GOV-01 D-022）
- 一覧の絞り込み条件は URL クエリに持つ（`/products?concern=…&animal=…`）。リロード・共有可能にするため

---

## 2. 状態管理方針

Astro は各リクエストごとに SSR するだけで、Livewire のようにサーバー側にコンポーネント状態を
保持し続ける仕組みは持たない。真実の源は常に D1（Service 経由）で、クライアント側の状態は
「表示・入力中の一時的な写し」に限定する。

| 状態の種類 | 配置 | 理由 |
| --- | --- | --- |
| ユーザー入力のフォーム | Svelte アイランドのローカル state（`$state`） | 送信時に API ルートへ渡し、サーバー側 D1 が正本 |
| ビジネスデータ（申請・受注・カート等）のステータス | API ルートから取得し Svelte state に反映 | サーバー側（D1）が正本。ミューテーション後は再取得または楽観的更新（管理画面では楽観的更新を避ける — PRD-04 §4-4） |
| 診断の回答途中の選択状態 | Svelte アイランドのローカル state | 質問・選択肢はビルド時に埋め込まれており、回答途中はサーバーに保持しない（§1-1） |
| カートの内容 | D1（`cart_items`）が正本。表示はサーバーから取得 | ブラウザを変えても同じカートが見える必要があるため、localStorage に持たない |
| モーダル開閉・ドロップダウン | クライアント側（shadcn-svelte の `Dialog` / `DropdownMenu` が内部で管理） | クライアントローカルで完結。Alpine.js 相当の自前実装は不要 |
| アニメーション・トランジション | クライアント側（Svelte の `transition:` + CSS） | サーバー往復不要 |
| 一時的な UI フィードバック（トースト） | shadcn-svelte の Toast/Sonner 相当 + API レスポンス | サーバーから通知 |

**禁止**: クライアント側 JS に業務ロジックを書く、サーバー側とクライアント側で同じ状態を
二重管理する。**卸価格の出し分けをクライアント側の分岐で行うことも禁止**（HTML に卸価格を出力してから
JS で隠す実装は、未承認の利用者にソース上で見えてしまう — PRD-02 §2-3）。

---

## 3. Astro / Svelte 実装の設計原則

構文レベルの必須規約（`client:*` ディレクティブの使い分け、Svelte 5 runes の書き方）は
`CLAUDE.md` を正本とする。設計上の原則：

- 認可は Astro ページのフロントマター（サーバー側で実行される先頭のスクリプト）の冒頭で必ず
  実行し、Member の Organization スコープを取得して Service に渡す。API ルートもハンドラの先頭で
  同様に認可を行う。**ページは 401 を返さずリダイレクトする**（API ルートとの違い）。
  `apps/public` の `middleware.ts` はセキュリティヘッダーと会員ルートの `Cache-Control` 専用で
  認証・認可は行わない（DEV-05 §1 が正本）。**`apps/admin` は例外**で、Cloudflare Access の JWT 検証のみ
  middleware で行う（全ルートが管理系であり、ページごとに書くと 1 枚でも書き漏らせば素通りするため — GOV-01 D-022、DEV-02 §1-1）。
  AdminUser はロール区分を持たないため、それ以上の認可分岐はない（GOV-01 D-014）。
- Svelte アイランドの `onMount()` はデータ読み込みと初期化のみ。状態遷移・外部 API・メール
  送信等の副作用はユーザー操作のイベントハンドラ内で行う（DEV-01 §8）。
- Astro/Svelte にはフレームワーク標準の DI コンテナはない。Service 関数は明示的に import して
  呼ぶ。
- 一覧の検索・フィルタ条件は URL クエリ（`Astro.url.searchParams` / クライアント側は
  `URLSearchParams`）に保持し、リロード・共有可能にする。商品一覧の絞り込み（F-03-04〜09）は
  この方式が必須（取引先が絞り込み結果を共有する運用があるため）。
- ループ描画には必ず一意キーを付与する（`{#each items as item (item.id)}`）。
- Astro ページ / API ルートから D1 を直接叩かない。必ず Service 経由（DEV-01 §4・§5）。
- Content Collections（`astro:content`）はページから直接読む。Service 層でラップしない（DEV-05 §1-4）。

---

## 4. 画面パターン 5 種の構成の考え方

PRD-04 §4 の標準構成に対応する。管理画面は shadcn-svelte のプリミティブ（DEV-01 §1）を
組み合わせて構成し、独自コンポーネントは不足分のみ追加する。

### 4-1. ダッシュボード

- 構成: KPI カード群（4 枚目安、shadcn `Card`）→ 推移グラフ → 直近イベント一覧、の縦積み。
- 本プロジェクトの ADM-01 は「未審査申請 / 要確認注文 / 入金待ち / 出荷待ち」の 4 枚（PRD-04 §4-3-1）。
- KPI カードは「値 + 前週比等のデルタ + アイコン（Lucide）」をセットで表示する。
- グラフ・イベント一覧は個別の Svelte アイランドに分割し、遅延読み込み可能にする。
- グラフ描画は DEV-01 §2 のグラフ描画ライブラリ（LayerChart）のみ使用する（別チャート
  ライブラリの導入禁止）。

### 4-2. 一覧画面

- 構成: ヘッダー（件数 + 主要アクション）→ フィルタバー → 一括操作バー → テーブル。
- 検索 + フィルタ + ソート + ページネーション + 一括操作を標準装備とする（テーブル自体は
  `npx shadcn-svelte add table` 等で必要になった時点で追加する）。
- 一括操作バーは選択がある時のみ表示し、破壊的操作には shadcn `AlertDialog` 等の確認ダイアログ
  を必須とする。
- フィルタ状態は URL クエリに反映する（§3）。
- 監査ログ（ADM-24）はカーソルページネーション（DEV-04 §3-2）を使うため、「総件数」「最終ページ」を
  UI に出さない設計にする（カーソル走査では総件数を数えない）。他の一覧はページ番号方式。

### 4-3. 詳細画面

- 構成: ヘッダー（対象名 + アクション）→ 情報表示（項目が多い場合は shadcn `Tabs` で分割）→
  関連情報。
- 監査履歴（変更履歴）を詳細画面から参照できるようにする。
- 一覧への戻り導線を必ず用意する。
- 状態遷移を伴うアクション（申請の承認 / 否認、取引停止、受注ステータス変更）は、
  遷移可能な状態のときだけボタンを活性化する（不正遷移は API 側でも 409 で拒否される — DEV-04 §4、DEV-09）。

### 4-4. フォーム画面

- 構成: ヘッダーに「保存 / キャンセル」を固定配置 → 入力セクション（shadcn `Field` /
  `FieldGroup` を使用、段階入力はタブ / ステップで分割）→ 危険操作は最下部に隔離。
- バリデーションエラーは項目ごとにインライン表示（`FieldError` 相当）。保存中はスピナー等で
  多重送信を防止。
- 削除等の危険操作は視覚的に区別し（警告色 + 枠）、確認ダイアログを必須とする。
- 構成の基本形は `apps/admin/src/lib/components/ui/` の Card + FieldGroup + Field の組み合わせ。
  最初に実装するフォームは ADM-13（申請の審査・承認と取引先コードの採番）であり、そこで確定した
  構成を以降の画面が踏襲する。**管理画面にログインフォームは存在しない**（GOV-01 D-022）。
- 新規取引申請フォーム（SCR-05）は入力項目が多い（DEV-07 §5-1 の列を参照）ため、
  「会社情報 / 担当者情報 / 取引希望条件 / 同意」の 4 ステップに分割する。規約同意のステップでは
  現行バージョン定数を hidden で送る（§1-1）。

### 4-5. 設定画面

- 構成: セクションタブ（shadcn `Tabs`）で分割。
- 本プロジェクトで設定画面パターンに当たるのは ADM-15（取引先詳細・編集）。「基本情報 / 個別卸価格 /
  所属担当者 / 危険操作（取引停止・取引終了）」のタブ構成とし、**危険操作は独立タブに隔離する**。

---

## 5. UI コンポーネント方針

- 管理画面は shadcn-svelte の標準コンポーネント（DEV-01 §1、`apps/admin/src/lib/components/ui`）を
  最優先で使う。独自スタイルの乱立を防ぎ、`admin.css` のテーマ変数の一括変更を効かせる。
- 新規コンポーネントを書く前に、`apps/admin/src/lib/components/ui/` に同等品がないか、無ければ
  `npx shadcn-svelte add <component>` で追加できないかを必ず確認する（`shadcn-svelte` スキル
  参照）。CLI はタブインデントで書き出すため、追加後に `pnpm format` を実行する（`CLAUDE.md`）。
- **ブラウザ標準の UI を管理画面に持ち込まない。** 確認ダイアログ・アラート・日付選択の
  ようにブラウザが独自の見た目で描画するものは、shadcn-svelte の同等品に置き換える。見た目が
  OS ごとに変わり、テーマ変数も i18n も効かないため。確認ダイアログは画面ごとに自作せず、
  共通コンポーネントの 1 実装に集約する。

適用範囲：

| 画面種別 | UI ライブラリ | 理由 |
| --- | :---: | --- |
| ダッシュボード・管理画面（ADM-01〜25） | ✅ shadcn-svelte | 想定ユースケース（DEV-01 §1） |
| 公開画面・マイページ（SCR-01〜36） | ❌ | プレーン Tailwind + Astro/Svelte で個別実装（`public-design` スキル。DEV-01 §1、PRD-04 §3-1） |

---

## 6. CSS 方針

- 色・余白等はデザイントークンとして定義し、任意値の直書きは最後の手段とする。管理画面は
  `apps/admin/src/styles/admin.css` の CSS 変数（`@theme inline`）、公開画面は `apps/public/src/styles/global.css`
  のプレーン Tailwind を使う（DEV-01 §1）。
- テーマ（色・角丸）はテーマ変数の一元管理で行い、コンポーネント個別の上書きをしない。
- ダークモード対応は `admin.css` の標準テーマ機構に乗る。
- 記法ルール（`@theme` 等の CSS-first 設定）は `CLAUDE.md` の Architecture 節を正本とする。

---

## 7. クライアントサイド JS の利用範囲

- 許可: モーダル開閉・ドロップダウン・トランジション等、クライアントで完結する UI 状態のみ。
- 禁止: 業務ロジック・API 呼び出し結果の判定・バリデーション確定。これらは必ずサーバー側
  （API ルート / Service）に置く。クライアント側の即時フィードバック用バリデーションは
  UX 目的でのみ許可し、確定判定はサーバー側で再度行う。
- 最低発注金額（BIZ-03 §3-1）のチェックはクライアント側でも表示するが、**確定判定は必ず
  `POST /api/v1/checkout` 側で行う**（クライアントの検証だけでは回避される）。
- 診断のルール評価はクライアント側で完結させてよい（ルールは公開情報のため）。ただし MVP では
  診断自体が Coming soon 表示であり、評価ロジックを実装しない（GOV-01 D-023、DEV-04 §5-8）。
- **卸価格をクライアント側に渡さない。** Svelte アイランドの props に入れた時点でクライアントの
  HTML に現れるため、出し分けは必ずサーバー側（`.astro` のフロントマター）で行う（PRD-02 §2-3）。

---

## 8. 画像の扱い（ファイルアップロードは無い）

**アップロード機能を持たない**（GOV-01 D-020）。R2 バケットも `BUCKET` バインディングも無く、
アップロードを受けるフォーム・エンドポイントを追加しないこと。

- 商品画像は `apps/public/src/assets/img/` にコミットし、`astro:assets` の `<Image>` で描画する。
  ビルド時に WebP 変換・リサイズ・`width`/`height` 付与が行われる
- 商品 Markdown の frontmatter は画像への**相対パス**を持つ。複数枚と表示順も frontmatter の配列で表す
- `<img>` の直書きは避ける。`astro:assets` を通さないと最適化も寸法属性も付かず、CLS の原因になる
- 意味を持つ画像には必ず代替テキストを付ける（§9、PRD-04 §7）

---

## 9. アクセシビリティ（a11y）

| 観点 | 方針 |
| --- | --- |
| キーボード操作 | 全インタラクション対応 |
| フォーカスリング | `:focus-visible` で必ず可視化 |
| 色のみで状態表現しない | アイコン + 色 + テキストの 3 要素（受注ステータス・決済状況の表示で特に重要）|
| 画像 alt | 必ず設定（商品画像は商品名を含める）|
| フォーム | `<label>` 紐付け、エラー説明 |
| カラーコントラスト | WCAG AA 以上 |
| ランドマーク | `<main>` は **`Layout.astro` が 1 つだけ持つ**。ページは `<main>` の中身（`<section>` 等）だけを書く |

**`<main>` をページ側に書かない。** `apps/public/src/layouts/Layout.astro` はスキップリンクの着地点
として `<main id="main">` を持っており、ページがもう 1 枚置くと `<main>` が入れ子になる。HTML 仕様上
不正で、スクリーンリーダーには「本文」が 2 つあるように見え、`id="main"` を併記すると ID 重複になる。
骨組みの段階で書かれた `<main>` が多数残っているため、**各画面を実装するステージで併せて外す**
（00_DEV_GUIDE §3-3a）。管理画面側は `ConsoleLayout.astro` が同じ役割を担う。

実装時の詳細な監査・修正フローは `.claude/skills/fixing-accessibility` スキルに委ねる
（`public-design` / `admin-design` チェーンの中で必ず通過する）。

---

## 10. レスポンシブ方針

- モバイルファーストで実装し、ブレークポイントは Tailwind 標準のみを使う。
- 管理画面はサイドバーをドロワー化してモバイル対応。テーブルは横スクロールを許容する（PRD-04 §4-5）。
- カード群・フォームのグリッドは 1 列（モバイル）→ 2〜4 列（デスクトップ）を基本とする。
- 公開側の商品一覧・診断は**モバイルでの利用を主要ケースとして扱う**（店舗の仕入れ担当者が
  店頭から発注する想定 — BIZ-01 §3-2）。

---

## 11. パフォーマンス

| 項目 | 方針 |
| --- | --- |
| 初期描画 | 非表示部品は遅延読み込み（Svelte アイランドの `client:visible` 等） |
| 大きなリスト | 一意キー徹底 + ページネーション |
| 画像 | `loading="lazy"` を明示 |
| フォーム入力の同期 | フォーカス喪失時基本、リアルタイム検索は debounce 300ms 以上 |
| アニメーション | compositor 対象プロパティ（`transform` / `opacity`）中心の CSS/Svelte トランジションのみ |
| 静的化 | ログイン状態に依存しないページ（FAQ・法務・診断）は `prerender = true` で D1 読み取りを回避（§1-1） |

アニメーション・パフォーマンスの詳細な監査は `.claude/skills/fixing-motion-performance`
スキルに委ねる（`public-design` チェーンの Step 4）。管理画面は最小限の enter/exit
トランジションに留め、演出目的のモーションは追加しない。

---

## 12. テスト方針

テストフレームワークは Vitest + Playwright（DEV-01 §1、導入済み。配置は `apps/*/tests/`、
実行は `pnpm test` / `pnpm test:e2e` — DEV-03 §6）。フロントエンド側の最低限のテスト観点：

- **認可**：Member が AdminUser 専用操作（`apps/admin`）にアクセスできないこと、他 Organization の発注・会社情報にアクセスできないこと
- **卸価格の出し分け**：未ログイン / ログイン済み・Organization `active` / ログイン済み・`suspended` の 3 状態で表示が変わること（E2E。PRD-02 §2-3）
- **ハイドレーション**：診断・カート等の対話型 UI が実際に操作できること。`client:*` の書き忘れはサーバー側で描画されてしまうため E2E でしか捕まらない（DEV-03 §3-5）
- **`prerender` 忘れ**：Content Collections から生成する個別ページが 200 を返すこと（§1-1）

---

## 13. 記入時チェックポイント

- 公開画面と管理画面が分かれて整理されているか
- **各画面のコンテンツ供給元が §1-1 の 3 層のどれかに割り当てられているか**（PRD-04 §3-1-1 と一致しているか）
- 管理画面の標準パターン 5 種（ダッシュボード / 一覧 / 詳細 / フォーム / 設定）が網羅されているか
- shadcn-svelte の標準コンポーネントを使い倒しているか（独自スタイル乱立していないか）
- 管理画面のページ URL に `/admin` 接頭辞を付けていないか（§1）
- Content Collections から生成する個別ページに `export const prerender = true` があるか（§1-1）
- 規約バージョン定数を更新せずに規約文面だけ変更していないか（§1-1）
- AdminUser のセッション検証・Organization スコープによる認可が Service 層で強制されているか
- 卸価格の出し分けがサーバー側で行われ、クライアント側の表示制御になっていないか（§2）
- PRD-04 の画面 ID と Astro ページ/Svelte アイランドが対応しているか
- a11y チェックリスト（§9）とレスポンシブ方針（§10）が満たされているか
- 技術名の選定を本書に書いていないか（DEV-01 参照になっているか）
