---
doc-id: DEV-04
title: API 仕様
phase: 3
status: draft-ai
owner: Tech Lead
last-updated: 2026-09-09
related-docs:
  - DEV-01: リポジトリ構成・レイヤー構造（§1・§5）
  - DEV-02: 認証認可
  - DEV-05: バックエンド実装
  - DEV-06: フロントエンド実装
  - DEV-10: 統合・外部 API（決済 Webhook）
  - PRD-03: 機能要件
  - 実装規約: `CLAUDE.md`（DEV-01 §9 参照）
---

# 04-api-spec.md — API 仕様

## このセクションの目的

RESTful API の設計規約、認証方式、エラー体系、バージョニング方針、エンドポイント一覧を定義する。Svelte アイランド（`client:*`）からの操作受付と、決済サービスからの Webhook 受信の両方を対象とする（DEV-01 §5 レイヤー構造）。

## 0-H. ハイブリッド編集ガイド（要点）

- 推奨モード: Hybrid（AI 定型化 + Tech Lead 確定）
- 人間確認必須: 認証方式、破壊的変更方針、命名一貫性、セキュリティ影響

---

## 1. API 設計原則

- RESTful 設計を遵守
- 全エンドポイントを `/api/v1/` でバージョニング
- リソース名は複数形（`/products`、`/applications`、`/orders`）
- ネスト 1 段まで（例: `/orders/{id}/items`）。2 段以上は別エンドポイント
- HTTP メソッドの意味を尊重（GET / POST / PUT / PATCH / DELETE）
- レスポンスは共通のレスポンス整形関数/型（`packages/server-kit` の HTTP エンベロープ。Laravel API Resource 相当のフレームワーク機能はないため自前実装、DEV-01 §1 参照）経由のみで生成する
- 権限違反は 403、存在しないリソースは 404 で明確に区別。AdminUser はロール区分を持たないため有効なセッションがあれば常に許可される（未認証は 401 で区別）。403 は主に「Member が自身の所属 Organization 以外のリソースを操作しようとした」場合を指す（DEV-02 §2-3・§3）

### 1-1. URL に `admin` セグメントを付けない

**管理系エンドポイントのパスに `/admin/` を含めない。** `apps/admin` は専用サブドメイン（例: `admin.example.com`）に丸ごとデプロイされる独立した Worker であり、そのアプリ内の全ルートが管理系である（DEV-01 §1、DEV-06 §1、PRD-04 §3-2）。`/api/v1/admin/orders` と書くと `apps/admin/src/pages/api/v1/admin/orders.ts` という冗長な配置になる。

結果として、**同じパスが 2 つのアプリに存在し得る**。これは名前の衝突ではなく、ホストが違う別の API である。

| パス | `apps/admin`（管理サブドメイン）| `apps/public`（メインドメイン）|
| --- | --- | --- |
| `/api/v1/orders` | 受注管理（全取引先分。AdminUser 認証）| 自社の発注履歴（Member 認証 + Organization スコープ）|
| `/api/v1/inquiries` | 問い合わせ一覧・対応（AdminUser 認証）| 問い合わせ送信のみ（認証不要）|
| `/api/v1/products` | 商品の追加・編集（AdminUser 認証）| 商品一覧・詳細の取得（認証不要）|

本書 §5 の各表では、**どちらのアプリに置くかを「アプリ」列で必ず明示する**。実装時にこれを取り違えると、管理系の書き込み API が公開ドメインに露出する。

---

## 2. 認証

本プロジェクトは AdminUser（`apps/admin`）と Member（`apps/public`）の 2 系統の API 認証を持つ（DEV-02 §1-1・§1-2）。

| 項目 | AdminUser 向け | Member 向け |
| --- | --- | --- |
| 方式 | D1 セッション + httpOnly クッキー（`admin_session`。値は無署名の CSPRNG トークン — クッキー属性・署名方針の正本は DEV-02 §1-1）。`jose`/JWT は不採用 | D1 セッション + httpOnly クッキー（`member_session`）。`jose`/JWT は不採用。OAuth（Arctic、LINE/Google/Facebook）併用可 |
| セッション発行 | `POST /api/v1/auth/login`（admin） | `POST /api/v1/auth/login`（public）、または OAuth コールバック |
| セッション失効 | `POST /api/v1/auth/logout`（admin） | `POST /api/v1/auth/logout`（public） |
| 認証必須範囲 | `apps/admin` の全エンドポイント。認証不要の除外: `/api/v1/auth/login`、`/api/v1/auth/password/forgot`、`/api/v1/auth/password/reset`、ヘルスチェック（`/health`・`/health/db`・`/health/kv` — DEV-08 参照） | `apps/public` の `/api/v1/me/**`、`/api/v1/cart/**`、`/api/v1/checkout`、`/api/v1/orders/**`、`/api/v1/addresses/**`。認証不要: 商品・お知らせ・診断・申請・問い合わせ・認証系 |
| 検証の実施箇所 | 各 API ルートハンドラ（`apps/admin/src/pages/api/**/*.ts`）の冒頭で `admin_session` クッキーを検証（`apps/admin/src/middleware.ts` はセキュリティヘッダー専用で認証は行わない — DEV-05 参照） | 各 API ルートハンドラ（`apps/public/src/pages/api/**/*.ts`）の冒頭で `member_session` クッキーを検証し、所属 Organization の状態（`active`）も併せて検証する（DEV-02 §1-3） |
| 認可判定 | ロール区分を持たない（GOV-01 D-014）。Service 層の入口で `requireSession(cookies, db)`（DEV-02 §3-2）によりセッションの有効性のみを検証 | ログイン時に所属 Organization ID・`memberships.role`（`client_user` 固定）をセッションへ埋め込み、Service 層の入口で Organization スコープを検証（DEV-02 §3-1） |

商品カタログ（`/api/v1/products` の GET）・新規取引申請フォーム（`/api/v1/applications` の POST）・お知らせ・お問い合わせ・診断は認証不要（一般公開。PRD-03 FG-02〜03・FG-09）。

> 認証系のパス（`/api/v1/auth/login` 等）は両アプリに同名で存在するが、別テーブル・別クッキーの完全に独立した実装である（DEV-02 §1-2）。片方のコードをもう片方から import してはならない。

---

## 3. レスポンス形式

### 3-1. 成功（単一リソース）

```json
{
  "data": {
    "id": "01HXXXX...",
    "name": "サンプル",
    ...
  }
}
```

### 3-2. 成功（コレクション）

ページ番号方式（件数が少なく安定しているリスト。例: 取引先一覧）とカーソル方式（大規模リスト。例: 商品一覧・監査ログ）で envelope の形が異なる。

**ページ番号方式**

```json
{
  "data": [{ "id": "01HXXXX..." }, { "id": "01HYYYY..." }],
  "meta": {
    "current_page": 1,
    "per_page": 20,
    "total": 100,
    "last_page": 5
  },
  "links": {
    "first": "...",
    "last": "...",
    "prev": null,
    "next": "..."
  }
}
```

**カーソル方式**（`total`/`last_page` は持たない — カーソル走査では総件数を数えない）

```json
{
  "data": [{ "id": "01HXXXX..." }, { "id": "01HYYYY..." }],
  "meta": {
    "per_page": 20,
    "next_cursor": "eyJpZCI6MTAwfQ"
  }
}
```

> エンベロープの実装は `packages/server-kit`（HTTP エンベロープ）に集約し、両アプリが同じ関数を使う（DEV-01 §5-3、DEV-05 参照）。アプリごとに整形関数を再実装しない。

### 3-3. エラー

```json
{
  "message": "The given data was invalid.",
  "errors": {
    "email": ["The email field is required."]
  },
  "error_code": "VALIDATION_FAILED"
}
```

> バリデーション実装ライブラリは Zod に決定済み（DEV-01 §2）。Drizzle スキーマから `drizzle-zod` で自動導出することを優先する。API ルートは Service が投げた `AppError` を共通の変換関数（`toErrorResponse`）で本形式に変換する（`CLAUDE.md`、DEV-05 参照）。

---

## 4. エラーコード体系（標準）

| HTTP | error_code | 意味 |
| --- | --- | --- |
| 400 | `BAD_REQUEST` | 一般的なリクエスト不正 |
| 401 | `UNAUTHENTICATED` | 未認証 |
| 403 | `FORBIDDEN` | 認証済みだが権限不足（Organization スコープ外へのアクセス。AdminUser はロール区分を持たないため対象外）|
| 404 | `NOT_FOUND` | リソース不存在 |
| 409 | `CONFLICT` | リソースの状態と操作が矛盾（例: 取引停止中の Organization からの発注）|
| 409 | `INVALID_STATE_TRANSITION` | 状態遷移関数（DEV-09）の不正遷移 |
| 422 | `VALIDATION_FAILED` | バリデーションエラー |
| 429 | `RATE_LIMIT_EXCEEDED` | レート制限超過 |
| 500 | `INTERNAL_ERROR` | サーバー内部エラー |
| 503 | `SERVICE_UNAVAILABLE` | 外部サービス全滅（決済等）|

---

## 5. エンドポイント一覧

「アプリ」列は §1-1 のとおり、そのエンドポイントを配置する Worker を示す（`admin` = `apps/admin`、`public` = `apps/public`）。

### 5-1. 認証

AdminUser・Member ともにセルフサーブの新規登録を持たない（AdminUser は招待/シード、Member は新規取引申請の承認により生成 — §5-3）。

| アプリ | メソッド | パス | 用途 | 認証 |
| --- | --- | --- | --- | --- |
| admin | POST | `/api/v1/auth/login` | AdminUser ログイン | 不要 |
| admin | POST | `/api/v1/auth/logout` | ログアウト | 必須 |
| admin | GET | `/api/v1/auth/me` | 現在の AdminUser | 必須 |
| admin | POST | `/api/v1/auth/password/forgot` | パスワードリセット要求 | 不要 |
| admin | POST | `/api/v1/auth/password/reset` | パスワードリセット実行 | 不要 |
| public | POST | `/api/v1/auth/activate` | アカウント有効化（承認後の初回パスワード設定） | 不要（有効化トークン検証） |
| public | POST | `/api/v1/auth/login` | Member ログイン | 不要 |
| public | GET | `/api/v1/auth/callback/{provider}` | OAuth コールバック（LINE/Google/Facebook） | 不要 |
| public | POST | `/api/v1/auth/logout` | ログアウト | 必須 |
| public | GET | `/api/v1/auth/me` | 現在の Member（所属 Organization を含む） | 必須 |
| public | POST | `/api/v1/auth/password/forgot` | パスワードリセット要求 | 不要 |
| public | POST | `/api/v1/auth/password/reset` | パスワードリセット実行 | 不要 |

### 5-2. 商品カタログ（閲覧は公開、書き込みは AdminUser 限定）

| アプリ | メソッド | パス | 用途 | 認証 |
| --- | --- | --- | --- | --- |
| public | GET | `/api/v1/products` | 商品一覧・検索・絞り込み（キーワード・対象動物・メーカー・ブランド・カテゴリー・気になる点） | 不要（PRD-03 F-03-01〜09） |
| public | GET | `/api/v1/products/{public_id}` | 商品詳細（卸価格・発注単位は Member かつ Organization `active` の場合のみ含める） | 不要（応答内容がセッションで変わる） |
| public | GET | `/api/v1/manufacturers`, `/api/v1/brands`, `/api/v1/product-categories`, `/api/v1/concerns` | 絞り込み用のマスタ一覧 | 不要 |
| admin | GET / POST | `/api/v1/products` | 商品一覧（下書き含む）/ 商品追加 | AdminUser |
| admin | GET / PATCH | `/api/v1/products/{public_id}` | 商品詳細 / 編集・公開状態・取扱状態・表示順変更 | AdminUser |
| admin | POST | `/api/v1/products/{public_id}/images` | 商品画像アップロード（R2。MIME/拡張子/サイズ/実バイトの 4 重検証 — DEV-02 §4） | AdminUser |
| admin | PATCH / DELETE | `/api/v1/products/{public_id}/images/{id}` | 表示順変更 / 画像削除 | AdminUser |
| admin | GET / POST | `/api/v1/manufacturers`, `/api/v1/brands`, `/api/v1/product-categories`, `/api/v1/concerns` | 一覧 / 追加 | AdminUser |
| admin | PATCH | `/api/v1/manufacturers/{id}` 他 | 編集 | AdminUser |

> 商品画像の削除は **R2 のオブジェクト削除 → `product_images` の行削除** の順で行う（逆順にすると行だけ消えて R2 に孤児オブジェクトが残る）。公開 URL は署名付きで発行し、R2 のキーをそのまま返さない（DEV-01 §8）。
>
> `products.slug` は診断ルール（`packages/content`）からの参照キーである。PATCH で slug を変更すると診断の推奨商品が解決できなくなるため、変更を禁止するか警告を出す（PRD-03 F-06-01 の注記、DEV-06 §1-1）。

### 5-3. 新規取引申請・審査（PRD-03 FG-02）

| アプリ | メソッド | パス | 用途 | 認証 |
| --- | --- | --- | --- | --- |
| public | POST | `/api/v1/applications` | 新規取引申請の送信（`agreedTermsVersion` を必ず記録 — §6-1） | 不要 |
| public | DELETE | `/api/v1/applications/{public_id}` | 申請取消（申請者本人。ログイン不要の取消トークン方式） | 不要 |
| admin | GET | `/api/v1/applications` | 申請一覧・検索 | AdminUser |
| admin | GET | `/api/v1/applications/{public_id}` | 申請詳細・審査履歴 | AdminUser |
| admin | PATCH | `/api/v1/applications/{public_id}` | 審査担当者記録・管理メモ更新・確認/差し戻し | AdminUser |
| admin | POST | `/api/v1/applications/{public_id}/approve` | 承認（Organization + 初期 Member 生成、状態遷移は DEV-09） | AdminUser |
| admin | POST | `/api/v1/applications/{public_id}/reject` | 否認 | AdminUser |

### 5-4. 取引先（Organization）管理（AdminUser 限定）

| アプリ | メソッド | パス | 用途 |
| --- | --- | --- | --- |
| admin | GET | `/api/v1/organizations` | 取引先一覧・検索 |
| admin | GET | `/api/v1/organizations/{public_id}` | 取引先詳細 |
| admin | PATCH | `/api/v1/organizations/{public_id}` | 取引先情報編集・管理メモ・発注可否設定 |
| admin | POST | `/api/v1/organizations/{public_id}/suspend` | 取引停止（状態遷移。DEV-09） |
| admin | POST | `/api/v1/organizations/{public_id}/resume` | 取引再開 |
| admin | POST | `/api/v1/organizations/{public_id}/terminate` | 取引終了処理 |
| admin | GET | `/api/v1/organizations/{public_id}/members` | 所属 Member 一覧（参照専用 — PRD-04 §3-2） |
| admin | PUT | `/api/v1/organizations/{public_id}/product-prices/{product_id}` | 取引先別卸価格の設定 |
| admin | DELETE | `/api/v1/organizations/{public_id}/product-prices/{product_id}` | 取引先別卸価格の解除（標準卸価格へ戻す） |

### 5-5. マイページ（Member。PRD-03 FG-05）

| アプリ | メソッド | パス | 用途 | 認証 |
| --- | --- | --- | --- | --- |
| public | GET / PATCH | `/api/v1/me` | アカウント情報の確認・編集 | 必須 |
| public | GET | `/api/v1/me/company` | 所属 Organization 情報 | 必須 |
| public | PATCH | `/api/v1/me/company` | 会社情報変更申請（運営確認が必要な項目あり。F-05-03） | 必須 |
| public | GET / POST | `/api/v1/addresses` | 配送先一覧・追加 | 必須 |
| public | PATCH / DELETE | `/api/v1/addresses/{public_id}` | 配送先編集・削除 | 必須（自 Organization のみ） |
| public | POST | `/api/v1/me/withdrawal` | 退会・取引終了申請 | 必須 |

### 5-6. カート・発注（PRD-03 FG-04）

| アプリ | メソッド | パス | 用途 | 認証 |
| --- | --- | --- | --- | --- |
| public | GET | `/api/v1/cart` | カート内容取得（卸単価・小計・税額・送料・合計を含む） | 必須（`client_user`、Organization `active`） |
| public | POST | `/api/v1/cart/items` | カートへ追加 | 必須 |
| public | PATCH | `/api/v1/cart/items/{id}` | 数量変更 | 必須 |
| public | DELETE | `/api/v1/cart/items/{id}` | カートから削除 | 必須 |
| public | POST | `/api/v1/checkout` | 発注確定（配送先・支払方法を含む。最低発注金額の検証を含む — BIZ-03 §3-1） | 必須 |
| public | GET | `/api/v1/orders` | 発注履歴一覧 | 必須（自 Organization のみ） |
| public | GET | `/api/v1/orders/{public_id}` | 発注詳細 | 必須（自 Organization のみ） |
| public | POST | `/api/v1/payments/webhook` | カード決済サービスからの決済結果通知（署名検証必須。DEV-10 §2） | 署名検証（セッション不要） |

> Webhook を `apps/public` に置くのは、決済を開始するのが公開側の発注フローだからである。決済サービスに登録する URL は 1 つだけにし、`apps/admin` 側に同名のエンドポイントを作らない（二重処理の原因になる）。冪等性は `payment_event_logs` の `provider_event_id` UNIQUE で担保する（DEV-07 §6-12）。

### 5-7. 受注管理（AdminUser 限定）

| アプリ | メソッド | パス | 用途 |
| --- | --- | --- | --- |
| admin | GET | `/api/v1/orders` | 受注一覧・検索（注文番号・取引先・注文日・ステータス） |
| admin | GET | `/api/v1/orders/{public_id}` | 受注詳細 |
| admin | PATCH | `/api/v1/orders/{public_id}` | ステータス変更（状態遷移。DEV-09）・配送情報登録・管理メモ |
| admin | POST | `/api/v1/orders/{public_id}/confirm-payment` | 銀行振込の入金確認（消込） |
| admin | POST | `/api/v1/orders/{public_id}/cancel` | キャンセル処理・返金状況更新 |

### 5-8. お知らせ・お問い合わせ・診断（PRD-03 FG-03・FG-09）

| アプリ | メソッド | パス | 用途 | 認証 |
| --- | --- | --- | --- | --- |
| public | GET | `/api/v1/news` | お知らせ一覧（`visibility` を考慮） | 不要（取引先限定分は Member ログインで出し分け） |
| public | GET | `/api/v1/news/{slug}` | お知らせ詳細 | 同上 |
| public | POST | `/api/v1/inquiries` | お問い合わせ送信 | 不要 |
| public | POST | `/api/v1/diagnosis/result` | 診断回答の送信 → 推奨商品の解決 | 不要（PRD-03 F-03-10） |
| admin | GET / POST | `/api/v1/news` | お知らせ一覧（下書き含む）/ 追加 | AdminUser |
| admin | GET / PATCH | `/api/v1/news/{public_id}` | 詳細 / 編集・公開状態変更 | AdminUser |
| admin | GET | `/api/v1/inquiries` | お問い合わせ一覧・検索 | AdminUser |
| admin | GET / PATCH | `/api/v1/inquiries/{public_id}` | 詳細 / 対応状況・担当者・メモ更新 | AdminUser |

> **診断に「質問セット取得」の API は存在しない。** 質問・選択肢は `packages/content` にあり、診断ページのビルド時に解決されて HTML に含まれる（DEV-06 §1-1、PRD-02 §1-4）。API が必要なのは回答から推奨商品を解決する部分だけで、`POST /api/v1/diagnosis/result` はバンドル済みのルールを評価し、該当する `Product.slug` を D1 で引いて商品情報を返す。返す商品は公開済み・取扱中のものに限る（DEV-02 §3-1）。診断結果に卸価格を含めてはならない（PRD-02 §2-3）。

### 5-9. 管理ダッシュボード・監査ログ（AdminUser 限定）

| アプリ | メソッド | パス | 用途 |
| --- | --- | --- | --- |
| admin | GET | `/api/v1/dashboard` | 未審査申請・要確認注文・入金/出荷待ち件数等の概要 |
| admin | GET | `/api/v1/audit-logs` | 監査ログ一覧・検索（カーソル方式 — §3-2） |

---

## 6. リクエスト・レスポンス例

### 6-1. 新規取引申請の送信

**Request**

```http
POST /api/v1/applications
Content-Type: application/json

{
  "companyName": "A 株式会社",
  "businessType": "pet_shop",
  "address": "東京都〇〇区...",
  "representativeName": "山田 太郎",
  "contactName": "佐藤 花子",
  "email": "sato@example.com",
  "desiredProducts": "犬用サプリメント全般",
  "agreedToTerms": true,
  "agreedTermsVersion": "2026-09-01"
}
```

**Response 201**

```json
{
  "data": {
    "id": "01HZZZZ...",
    "companyName": "A 株式会社",
    "status": "received",
    "appliedAt": "2026-08-18T10:00:00Z"
  }
}
```

> `agreedTermsVersion` はクライアントの申告値をそのまま信用せず、**サーバー側が保持する現行バージョン定数と一致するかを検証する**（不一致なら 409 `CONFLICT` を返し、規約を読み直させる）。利用規約はページ直書きでレコードが存在しないため、この定数がバージョンの唯一の出所になる（DEV-06 §1-1、OPS-01 §5）。

### 6-2. Organization スコープ外へのアクセス（Member が他社の発注を参照しようとした）

本プロジェクトの権限不足は「Member の Organization スコープ外アクセス」で表現する（AdminUser はロール区分を持たないため、有効なセッションがあれば常に許可される。DEV-02 §2-3・§3、DEV-01 §4「認可チェックの徹底」）。

**Response 403**

```json
{
  "message": "この発注情報にアクセスする権限がありません。",
  "error_code": "FORBIDDEN"
}
```

> 他社のリソースに対して 404 ではなく 403 を返すのは、`public_id` が ULID で推測困難であり、存在の有無が実質的に漏れないためである。ただし列挙の足がかりを与えないよう、メッセージに取引先名・商品名等を含めない。

---

## 7. Webhook

| 提供元 | エンドポイント | アプリ | 用途 |
| --- | --- | --- | --- |
| Stripe | `POST /api/v1/payments/webhook` | public | 決済完了 / 失敗 / 返金通知 |

すべて署名検証必須。詳細は DEV-10 §2。

---

## 8. ページネーション

- デフォルト 20 件 / ページ
- 最大 100 件 / ページ
- クエリパラメータ: `?page=2&per_page=50`
- 大規模リスト（商品・監査ログ等）はカーソルベース：`?cursor=eyJpZCI6MTAwfQ`
- 実装: D1 への `LIMIT`/`OFFSET`（または cursor ベースは `WHERE id > ?` 等）クエリと、§3-2 の `meta`/`links` envelope をアプリ側（Service 層）で組み立てる（DEV-01 参照）

---

## 9. バージョニング・破壊的変更方針

- バージョンは URL パスに含める（`/api/v1/`、`/api/v2/`）
- v1 は最低 12 ヶ月サポート
- 破壊的変更は v2 として新規バージョンで提供
- フィールド追加は非破壊変更（既存クライアント無視）
- フィールド削除・型変更は破壊変更

> 本 API の利用者は自社のフロントエンド（Svelte アイランド）のみで、外部公開クライアントは存在しない。それでもバージョンを付けるのは、`apps/public` と `apps/admin` が別々にデプロイされ、**片方だけが新しい状態が必ず発生する**ため（DEV-08 §3）。

---

## 10. レート制限

レート制限値の正本: DEV-02 §7 参照（本書では値を再掲しない）。

認証エンドポイント（ログイン / パスワードリセット等）・新規取引申請・発注確定にはブルートフォース対策・二重実行対策として特に厳しい制限を適用すること（DEV-02 §7）。

---

## 11. 記入時チェックポイント

- 全エンドポイントに「アプリ」列があり、管理系が `apps/public` に混入していないか（§1-1）
- パスに `/admin/` セグメントを付けていないか（§1-1）
- 全エンドポイントが認証要否・Organization スコープ要否で分類されているか（AdminUser 側はロール要否ではなくセッション要否のみ）
- エラーコード体系が網羅的か
- リクエスト / レスポンス例が型レベルまで具体化されているか
- Webhook の署名検証パターンが明示されているか、登録先 URL が 1 つに絞られているか（§5-6）
- 破壊的変更時のバージョニング方針が明確か
- Member 系エンドポイントが `member_session` を使い、AdminUser 系（`admin_session`）と混同されていないか
- Content Collections で解決できるデータに対して不要な API を作っていないか（§5-8 の診断）
