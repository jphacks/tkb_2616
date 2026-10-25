# 趣味トモ

https://github.com/user-attachments/assets/caa63c27-0d29-4076-8d9e-dcddb73fb0aa

- **本番環境**：https://tkb2616.expo.app
- **モック版**（ログイン不要で全画面を体験できます）：https://ichi-choken.github.io/tkb_2616/

ローカルで動かす場合（Node.js 24.3 以上）：

```sh
npm run setup
npm run start:local
```

## 製品概要

**SNSに散らばる募集と、機種ごとに散らばる「好き」を、ひとつに。**

趣味トモは、ゲームを中心とした趣味仲間の募集アプリです。

### 背景（製品開発のきっかけ、課題等）

誰かと遊びたいゲームがあっても、そのために必要な情報は、各SNSやプラットフォームで分断されています。私たちはこの点に着目しました。

1. ゲームの募集はSNSごとに散らばり、DMでのやり取りも煩わしい。熱量が合わない相手と組むこともある
2. 自分がハマっているものを「表現する場」がない
3. 一度遊んでも、次につながらない

### 製品説明（具体的な製品の説明）

これらの課題に対して、趣味トモは3つの機能で解決します。SNSの境界をまたいで募集を見つけやすくする「募集」、好きなものをまとめられる「プロフィール」、つながりを残す「フレンド」です。DMはなく、参加希望と承認だけで合流まで進みます。

1. **募集**：ゲームと条件（日時・人数・熱量・VCなど）を選ぶと、リンク付きの招待状ができます。X・Discord・LINEなど、どこに貼られたリンクを開いても、その募集を先頭に同じゲームの募集が並びます。閲覧はログイン不要で、参加は Discord / Google / Steam でログインして申し込みます。募集者が承認すると、部屋番号や招待URLが成立した相手にだけ表示されます。
2. **プロフィール**：遊んでいるゲーム（機種・熱量・実力）と、ゲーム以外の趣味や好きなものを、1つにまとめて見せられます。
3. **フレンド**：継続して一緒に遊ぶ仲間を募集できます。ゲーム・機種・実力・熱量・いつも遊ぶ時間を選んでフレンド募集を出し、届いた申請を承認するとフレンドになります。フレンドの一覧から、そのゲームの募集をすぐに出せます。

### 特長

#### 1. どの募集リンクからも、同じゲームの募集が全部見える

募集はどこに共有されても、ゲームごとの一覧に集約されます。1本のリンクが入口になり、自分の投稿を見ていない人にも、ほかの人のリンク経由で募集が届きます。

#### 2. ゲームや機種をまたいで、「いまの遊び方」が伝わる

複数のゲーム（機種・熱量・実力）とゲーム以外の趣味を、1つのプロフィールにまとめられます。Steamでログインすれば、所持ゲームとプレイ時間を自動で取り込み、カバー画像も自動で付きます。参加希望には、Steamのアカウント年数やプレイ時間を「信頼の目安」として表示します。

#### 3. 一度遊んだ相手を、別のゲームにも誘いやすい

フレンドが遊んでいるゲーム・熱量・遊べる時間が分かるので、遊ぶゲームが変わっても関係が続きます。

### 解決出来ること

| これまで | 趣味トモなら |
| --- | --- |
| 募集がSNSやサーバーごとに分かれ、探しきれない | どのリンクからでも、同じゲームの募集をまとめて比べられる |
| 熱量・時間・VCが合うかは、聞くまで分からない | 選択式の条件で、参加前に確かめられる |
| 募集文の作成、DMでの条件確認、ID交換が面倒 | 条件を選ぶ → 参加希望 → 承認だけで合流できる |
| 一度遊んでも、次に誘うきっかけがない | プロフィールとフレンドから、次の遊びにつながる |

### 今後の展望

- 合う理由の表示（「同じくゆるめ」「遊ぶ時間が近い」など）
- フレンドが新しい募集を出したときの通知
- 条件変更時の参加の再確認
- アプリ版のプッシュ通知（配信の仕組みは実装済み）
- YouTubeの同時視聴など、ゲーム以外の募集への拡張

### 注力したこと（こだわり等）

- **合流情報は、成立した相手にだけ**：部屋番号・招待URL・ゲーム内IDは、PostgreSQLの行レベルセキュリティ（RLS）で、募集者と成立した相手だけに公開します。遊び終了や開催中止で、双方から自動的に見えなくなります。
- **同時操作や再送でも壊れない**：状態の変更はすべてDB関数で行い、行ロックで定員の超過を防ぎます。操作IDによる冪等化で、通信が切れて再送しても二重に処理されません。
- **「取得失敗」と「0時間」を区別**：Steamの非公開や取得失敗を0時間として扱わず、誤った信頼の目安を出しません。
- **日本語でゲームを検索**：英語中心のIGDBを、日本語のタイトルや別名の部分一致でも検索できるようにしました。
- **カバー画像は推測しない**：SteamのアプリIDとIGDBの外部IDを照合して取得し、一致しなければ似た名前の画像で代用せず「画像なし」にします。

### 実装の状況

| 機能 | 状況 |
| --- | --- |
| 募集作成（招待状・コピー・X共有）、募集一覧、参加希望、承認、成立・合流情報 | 本番環境で稼働 |
| Discord / Google / Steam ログイン、Steamライブラリの取り込み、信頼の目安、カバー画像、ゲーム検索 | 本番環境で稼働 |
| プロフィール | 本番環境で稼働（端末に保存） |
| フレンド募集・申請・承認・フレンド一覧 | 実装済み。本番環境ではDB変更の適用後に有効化（[手順](supabase/README.md#フレンド募集を有効にする)） |
| フレンドの通知、共通点の表示、合う理由 | モック版のみ |
| 条件変更の再確認、プッシュ通知 | 未実装 |

## 開発技術

### 活用した技術

#### API・データ
* Supabase（PostgreSQL・Auth・Edge Functions・Realtime・pg_cron / pg_net）
* Steam Web API（所持ゲーム・プレイ時間・レベル）、Steam OpenID（ログイン・連携）
* Discord OAuth2 / Google ログイン（Supabase Auth）
* IGDB API（Twitch OAuth）：ゲーム検索・カバー画像
* Expo Push API（配信の仕組みのみ実装、未稼働）

#### フレームワーク・ライブラリ・モジュール
* TypeScript
* Expo SDK 58 / React Native 0.88 / React 19 / react-native-web
* Expo Router、expo-auth-session、expo-notifications、expo-sqlite、AsyncStorage
* @supabase/supabase-js
* Deno（Supabase Edge Functions）
* PGlite（DBテスト）、Node.js Test Runner、GitHub Actions
* EAS Hosting（本番環境）、GitHub Pages（モック版）

#### デバイス
* PC・スマートフォンのWebブラウザ
* スマートフォン（iOS / Android、ビルドまで確認）

### 独自技術

#### ハッカソンで開発した独自機能・技術
* **募集から合流までを、PostgreSQL関数とRLSで実装**：公開・参加希望・承認・合流情報の更新・受付終了をDB関数（RPC）に集約し、承認の前後で見せる情報（部屋番号・招待URL・ゲーム内ID）をRLSで出し分けています。
  * [supabase/migrations/20261024043000_first_flow.sql](supabase/migrations/20261024043000_first_flow.sql)（commit `17925a9`）
  * [supabase/migrations/20261024150000_approved_screens.sql](supabase/migrations/20261024150000_approved_screens.sql)（commit `77d0ba4`）
* **Steam連携による「信頼の目安」と自動更新**：SteamIDやライブラリ全体は公開せず、アカウント年数・レベル・所持の有無・プレイ時間だけを表示します。pg_cronで定期的に更新します。
  * [packages/integrations/src/trust.ts](packages/integrations/src/trust.ts)、[packages/integrations/src/steam.ts](packages/integrations/src/steam.ts)、[supabase/functions/steam-trust/index.ts](supabase/functions/steam-trust/index.ts)（commit `6214404`、`0f78a61`）
* **日本語対応のゲーム検索**：IGDBを、日本語のタイトルや別名の部分一致でも検索できるようにし、選んだゲームを保存します。
  * [packages/integrations/src/igdb.ts](packages/integrations/src/igdb.ts)、[supabase/functions/igdb-search/index.ts](supabase/functions/igdb-search/index.ts)（commit `b98d27f`）
* **SteamのアプリIDからカバー画像を自動取得**：固定の対応表を使わず、IGDBの外部IDとの照合で画像を取得します。
  * [packages/integrations/src/igdb.ts](packages/integrations/src/igdb.ts)、[app/src/profile-game-covers.ts](app/src/profile-game-covers.ts)（commit `39d6368`、`6d76672`）
* **Steam OpenID 2.0を、Supabase Authのカスタムプロバイダとして統合**：Steam OpenIDをOAuth2の形に包み、Discord / Googleと合わせて3方式でログインできるようにしました（Appleは準備中）。
  * [src/auth/flow.ts](src/auth/flow.ts)、[packages/integrations/src/steam-login.ts](packages/integrations/src/steam-login.ts)、[packages/integrations/src/linking.ts](packages/integrations/src/linking.ts)（commit `4d7c101`）
* **Expoで、Web・iOS・Androidを1つのコードに**：募集・一覧・参加希望・承認・成立の画面をDBにつなぎ、本番のWebはEAS Hostingで公開しています。mainへのpushで自動デプロイされます。
  * [app/src/screens](app/src/screens)、[src/live](src/live)（commit `d391edc`、`9d7e57d`）

### 事前に準備したもの

Hack Dayの前に、仕様（受け入れ条件）と設計判断の記録を、チームの非公開リポジトリで文書として準備しました。チーム内での企画共有用にモックの画面も作成しましたが、本リポジトリのコードには使用していません。

本リポジトリのコードは、JPHACKSが用意した最初のコミットを除き、すべてHack Day開始（2026年10月24日）以降に書いたものです。
