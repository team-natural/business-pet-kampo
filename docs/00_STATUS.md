---
doc-id: STATUS
title: 実装状況スナップショット（一時文書）
phase: cross
status: temporary
owner: Tech Lead
last-updated: 2026-09-24
related-docs:
  - 00_DEV_GUIDE: §3-3a が実装ステージの正本
  - GOV-01: 判断の正本
  - GOV-02: 未決事項の正本
---

# 実装状況スナップショット

## ⚠️ この文書は一時的なものです

**役割を終えたら削除してください。** 具体的には、次のいずれかの時点で削除します。

- 全ステージ（S1〜S16）が完了し、S16 のリリース準備に入ったとき
- 本書の内容が各正本（下表）に吸収され、ここを読む理由が無くなったとき

**本書は正本ではありません。** 2026-09-24 時点の状況を 1 枚にまとめただけの派生物で、
下表の文書と食い違った場合は**常に下表が正しい**。本書を更新する代わりに正本を更新してください。

| 知りたいこと | 正本 |
| --- | --- |
| ステージの範囲・依存・完了条件・**進捗** | `00_DEV_GUIDE.md` §3-3a |
| なぜその設計・仕様にしたか | `5-governance/01-decision-log.md`（D-001〜D-042） |
| 未決事項・ブロッカー | `5-governance/02-open-questions.md`（未解決 37 件） |
| 環境変数・外部サービスのキー | `3-development/10-integrations-spec.md` §10（外部連携）、`3-development/08-deployment.md` §8（アプリ基本） |
| 実装規約 | `CLAUDE.md` |

---

## 1. 全体状況

**実装ステージ 16 本のうち 13 本が完了。** 残り 3 本のうち着手できるのは 1 本。

| 区分 | 本数 | ステージ |
| --- | :---: | --- |
| 完了（`dev` にマージ済み） | 12 | S1・S2・S3・S4・S5・S6・S7・S8・S9・S12・S13・S14 |
| 完了（コミット済み・`dev` 未マージ） | 1 | S15（`feat/retention-batch` の `9a54457`） |
| 未着手 | 3 | S10・S11・S16 |

現在の `dev` は `a854370`。判断は **D-001〜D-042**、未決事項は **37 件**（うち P0 が 7 件）。

**注意**: 「ステージ完了」は「その機能が全部ある」ではありません。意図的に残した未実装部分が
§3 にあります。

### 検証の状態

最後に全ステージを通した時点（S15 完了時）の結果。

| 種別 | 件数 | 状態 |
| --- | --- | --- |
| ユニット（`pnpm check`） | 282 | 全通過（public 117 / admin 100 / schema 15 / server-kit 50） |
| E2E（`pnpm test:e2e`） | 105 | 全通過（public 84 / admin 21） |
| 型チェック・Lint・整形 | — | 全通過 |
| ビルド | — | 両アプリ成功 |
| マイグレーション | 5 本 | `0000`〜`0004`。すべて forward-only |

---

## 2. ステージ別の状況

| ID | ブランチ | 状態 | 残っていること |
| --- | --- | --- | --- |
| S1 | `feat/mail-and-health` | ✅ 完了 | 本番のメール到達確認は TBD-17（ドメイン認証）後 |
| S2 | `feat/public-design-baseline` | ✅ 完了 | 375px でヘッダーがやや間延びする（polish のみ） |
| S3 | `feat/application-submit` | ✅ 完了 | — |
| S4 | `feat/application-review` | ✅ 完了 | — |
| S5 | `feat/member-auth` | ✅ 完了 | — |
| S6 | `feat/organization-admin` | ✅ 完了 | — |
| S7 | `feat/mypage-addresses` | ✅ 完了 | — |
| S8 | `feat/cart` | ✅ 完了 | — |
| S9 | `feat/checkout-bank-transfer` | ✅ 完了 | 営業日計算が土日のみ除外（祝日未対応 — TBD-04d）。口座の実値が未設定 |
| S10 | `feat/order-admin` | ⬜ 未着手 | **着手可**。ただし配送情報登録（F-08-05）は TBD-07、期限超過の扱いは TBD-04c 待ち |
| S11 | `feat/payment-stripe` | ⬜ 未着手 | **TBD-18（決済アカウント契約）待ち** |
| S12 | `feat/oauth-login` | ✅ 完了 | 3 プロバイダのアプリ登録が未了。ライブラリ Arctic の非推奨（TBD-36） |
| S13 | `feat/withdrawal` | ✅ 完了 | F-12-04（担当者個人の無効化）未実装（TBD-36b） |
| S14 | `feat/news-and-seo` | ✅ 完了 | — |
| S15 | `feat/retention-batch` | ✅ 完了（未マージ） | 段階通知未実装（TBD-38）。**`dev` へのマージ待ち** |
| S16 | `chore/release-readiness` | ⬜ 未着手 | 全ステージ完了後。TBD-11・ドメイン・口座実値が前提 |

---

## 3. 完了済みステージに残っている未実装部分

**動くが、仕様の一部が欠けているもの。** すべて意図的で、理由と再評価条件は GOV-02 にあります。

| 機能 | 何が無いか | 影響 | TBD |
| --- | --- | --- | --- |
| OAuth ログイン（S12） | LINE / Google / Facebook のアプリ登録 | 設定が欠けるプロバイダはボタンが出ず `/auth/{provider}` が 404。**パスワードログインは動く** | — |
| OAuth 連携の解除（S12） | 連携を外す導線 | マイページは一覧表示のみ。パスワード未設定の会員が最後の連携を外すとログイン不能になるため、実装時は最後の 1 件の解除を拒否する必要がある | — |
| 担当者の無効化（S13） | 1 人だけ退職したときの Membership 停止 | 運営が対応できない。会社全体の取引終了では一括停止される | TBD-36b |
| 保管期限の事前通知（S15） | 90/30/7 日前の段階通知 | 予告なく削除される。送信済みを記録する列が無く、宛先も未定 | TBD-38 |
| 振込期限の営業日計算（S9） | 日本の祝日の除外 | 祝日の多い週は案内より実質的に短い猶予になる。**画面とメールの日付は一致する** | TBD-04d |
| 取引先の物理削除（S15） | 発注実績のある取引先の削除 | 外部キーと 5 年保管が両立しないため、**個人情報が最長 5 年残る** | TBD-37 |
| 商品選び診断 | 機能そのもの | `/diagnosis` は Coming soon 表示（D-023） | TBD-09 |

---

## 4. 外部手配が必要なもの

**コードで解決できないもの。** すべて未設定でもアプリは壊れないように作ってあります
（口座未設定なら口座欄を出さない、プロバイダ未設定ならボタンを出さない）。

### 4-1. Cloudflare（本番デプロイ前に必須）

| 項目 | 取得方法 | 入れる場所 |
| --- | --- | --- |
| D1 データベース（dev / staging / production） | `wrangler d1 create <name>` | 両アプリの `wrangler.jsonc`。**`database_id` は両アプリで同一の値**（違うと各アプリが別の DB を見る。エラーは出ない） |
| KV 名前空間 | `wrangler kv namespace create KV` | `apps/public/wrangler.jsonc` のみ（ロックアウト用） |
| カスタムドメインの割り当て | Cloudflare ダッシュボード | — |
| Cloudflare Access Application | ダッシュボードで作成 | `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD`（環境ごとに異なる）。**TBD-32** |

> D1 と KV の ID は作成しないと分からないため、`wrangler` の出力をそのまま共有してください。

### 4-2. Workers Secrets（`wrangler secret put`。`wrangler.jsonc` に書かない）

| キー | 用途 | 状態 |
| --- | --- | --- |
| `RESEND_API_KEY` | メール送信 | Resend アカウント要。未設定でも送信失敗をログに残すだけでリクエストは成功する |
| `SESSION_SIGNING_KEY` | 単発トークンの HMAC 署名（パスワード再設定・有効化・申請取消・メール変更・OAuth 連携） | `openssl rand -base64 32` で生成。**環境ごとに別の値** |
| `LINE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | LINE ログイン | LINE Developers でチャネル作成。**TBD** |
| `GOOGLE_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Google ログイン | Google Cloud Console。**TBD** |
| `FACEBOOK_CLIENT_ID` / `_SECRET` / `_REDIRECT_URI` | Facebook ログイン | Meta for Developers。**TBD** |
| `STRIPE_KEY` / `STRIPE_SECRET` / `STRIPE_WEBHOOK_SECRET` | カード決済 | **S11 未着手。TBD-18** |

> `*_REDIRECT_URI` はプロバイダ側の登録値と 1 バイトも違わないこと。末尾は
> `/auth/{provider}/callback`（`/api/v1/` ではない）。

### 4-3. `wrangler.jsonc` の `vars`（機密でない。私が置き換え可能）

| キー | 現在の値 | 必要な情報 |
| --- | --- | --- |
| `APP_NAME` / `MAIL_FROM_NAME` | `ペット漢方 卸売`（仮） | **サービス名の確定（TBD-01）** |
| `APP_URL` / `ADMIN_URL` | `replace-with-domain.example` | **ドメインの確定（TBD-16）**。管理画面のサブドメイン名も |
| `MAIL_FROM_ADDRESS` / `MAIL_ADMIN_ALERTS` | `noreply@` / `ops@` + 同上 | ドメイン + ローカル部の確認 |
| `BANK_NAME` / `BANK_BRANCH` / `BANK_ACCOUNT_TYPE` / `BANK_ACCOUNT_NUMBER` / `BANK_ACCOUNT_HOLDER` | dev/staging はダミー、**production は空** | **振込先口座の実値 5 項目**。5 つ揃わないと口座欄を出さない仕様 |

### 4-4. DNS・外部サービス

| 項目 | 期限目安 | TBD |
| --- | --- | --- |
| ドメイン取得 | リリース 60 日前 | TBD-16 |
| メール送信ドメイン認証（SPF / DKIM / DMARC） | リリース 30 日前 | TBD-17 |
| 決済サービス本番契約・Webhook 登録 | リリース 60 日前 | TBD-18 |

---

## 5. 判断待ちの未決事項

### 5-1. P0（リリース前に必ず必要）— 7 件

| TBD | 内容 | 確認先 |
| --- | --- | --- |
| TBD-01 | サービス名・運営会社名 | 事業責任者 |
| TBD-11 | 利用規約・プライバシーポリシー・特商法表示の**文面** | 法務 |
| TBD-12 | 他社商品の画像・資料の掲載許諾プロセス | 事業責任者 |
| TBD-16 | 確定ドメイン取得 | 事業責任者 |
| TBD-17 | メール送信ドメイン認証 | Tech Lead |
| TBD-18 | 決済アカウント本番契約 | 事業責任者 |
| TBD-32 | Cloudflare Access の設定 | Tech Lead |

> 実装側はすべて完了しています。**残っているのは手配と文面のみ**です。

### 5-2. P1（実装に影響しうる）— 主なもの

| TBD | 内容 | 影響 |
| --- | --- | --- |
| TBD-37 | 取引終了 1 年時点で個人情報を匿名化するか | 採ると S15 の削除処理が「スクラブ」に置き換わる |
| TBD-33 | 1 Member が複数 Organization に所属しうるか | 採ると取引先切替 UI とカート・発注のスコープ選択が要る |
| TBD-36 | Arctic（OAuth ライブラリ）が非推奨公開されている件 | 差し替える場合の対象は `lib/server/auth/oauth.ts` 1 ファイル |
| TBD-28 | 発注・決済履歴の保存期間 5 年でよいか | TBD-37 と連動 |
| TBD-22 | 想定規模（取引先数・月間発注件数） | スケール方針の前提 |

### 5-3. S10 着手前に決めたいもの（P2・迂回可能）

| TBD | 内容 | 迂回方法 |
| --- | --- | --- |
| TBD-07 | 配送会社・配送方法・配送地域・日時指定・追跡番号 | 状態遷移だけ先に作り、項目は後から `orders` に列追加 |
| TBD-04c | 振込期限を過ぎた未入金注文の扱い | S10 では扱わず、自動キャンセルを採るなら S15 の Cron に載せる |

---

## 6. 次にできること

1. **S15 を `dev` にマージ**（コミット済み・未マージ）
2. **S10 に着手** — 受注管理の本体（状態遷移 4 ルート・入金確認・キャンセル）は TBD 待ちなしで作れる
3. **ドメインとサービス名が決まれば** `wrangler.jsonc` と `.dev.vars.example` を一括で更新できる
4. **S11・S16 は外部手配待ち**

S10 を終えると、発注 → 入金確認 → 出荷 → 完了 → 取引終了までが一周し、
**残るのはカード決済（S11）とリリース準備（S16）だけ**になります。
