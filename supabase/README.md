# バックエンド（Supabase）

データと、状態を変える処理は Supabase に置く。作り方の決定は ADR-63〜67。文中の ADR-・server- などの ID は、チームの非公開の仕様（決定と受け入れ条件）の番号。表・関数・型の正本は `migrations/` の SQL と、そこから作った `database.types.ts`。この README には、コードから読み取りにくい約束だけを書く。

## 手元で動かす

Docker Desktop を起動してから、リポジトリの直下で流す。

```bash
npx supabase start
```

```bash
npx supabase test db
```

- ポートは 553xx（API は `http://127.0.0.1:55321`、Studio は `http://127.0.0.1:55323`）。初期の 543xx は、ほかのプロジェクトの Supabase とぶつかるのでずらした
- 表や関数を変えたら `npx supabase db reset` で作り直し、`npx supabase gen types typescript --local > supabase/database.types.ts` で型を作り直す
- `seed.sql` のゲームは手元だけの仮のもの。クラウドには入らない

既存データを持つ環境を更新するときは、未適用の追加マイグレーションを順番に適用する。上の `db reset` は作り直してよい手元の環境向けで、共有DBの更新には使わない。2026-10-25のレビュー修正は既存関数の更新だけで、表・既存行・RPCの引数と戻り値・権限を保持する。旧環境からの保持検証は `tests/database-review-regressions.test.ts`。

## 画面からの使い方

### フレンド募集を有効にする

新しいフレンド欄は、フレンド募集を出す・申請する・承認する・フレンド一覧へ残す操作を扱う。既存のゲーム募集とは別に保存する。SQL・RPCの正本は `migrations/`、画面との契約は `src/live/friends-types.ts`。

接続先へフレンド募集の追加マイグレーションを適用してから、Webビルドで `EXPO_PUBLIC_ENABLE_FRIEND_RECRUITMENT=true` を渡す。GitHub Actionsでは同名のRepository variableを使う。未設定の本番ビルドは現在のフレンド欄を維持するため、Webだけが先に更新されても未適用の表を呼ばない。

Supabaseを設定しないローカル版では、新画面を「ローカル実演」として使える。データはこのPC内に保存し、クラウドへ送らない。`?friendDemoUser=sora#/connections` で別の実演利用者として同じPC内の募集へ申請できる。本番DBへの書き込み失敗を、この実演モードに切り替えて成功と扱うことはしない。

画面に入れてよいのは、Supabase の URL と公開用の鍵（`sb_publishable_`）だけ。

### 読む

表をそのまま読む。行の権限で、読める行だけが返る。状態は列ではなく、計算した列で読む。

| 表 | 読める人 | 計算した列 |
| --- | --- | --- |
| `recruitments` 募集 | だれでも（ログインしていない人も） | `status`（募集の状態）、`matched_count`（成立人数） |
| `recruitment_meetings` 入る場所・招待URL | 募集する人と成立した相手。開催中止・遊び終了の後は誰も読めない | |
| `applications` 参加希望 | 参加する本人と、その募集の募集する人 | `state`（参加希望の状態） |
| `application_game_ids` 参加者のゲーム内ID | 本人と、募集する人。募集する人に見えるのは、成立した人の分と、承認待ちの人の分（承認の前にIDを確かめられるように。server-28、ADR-90）。開催中止・遊び終了の後は誰も読めない | |
| `notifications` 知らせ | 宛先の本人 | |
| `profiles`・`games` | だれでも。`games` の `modes`（そのゲームでよく使う条件）と `needs_participant_id_default`（参加する人のIDが要るかの初期値）は、中身を作ったゲームだけが持つ（server-10）。null なら、モードの欄を出さない（recruit-15） | |
| `profile_games`・`profile_hobbies`・`profile_likes` プロフィールのゲーム・趣味・好きなもの | だれでも | |
| `profile_locked_likes` 鍵をかけた好きなもの | 本人と、フレンドだけ（server-17、profile-18） | |

プロフィールは、表を1つずつ読むより、1つの JSON で返す関数を使う。鍵をかけた好きなものは、見ている人が本人かフレンドのときだけ `likes` に入る（`locked: true`）。

```ts
// プロフィールのリンク・「IDで探す」（profile-13）。ログインなしでも読める。無ければ null
const { data: profile } = await supabase.rpc('profile_by_app_id', { p_app_id: appId });
// 自分のプロフィール（ログインしている本人だけ）。アプリIDをまだ持たなくても読める
const { data: mine } = await supabase.rpc('my_profile');
// どちらも次の形：{ app_id, nickname, region, usual_time_start, usual_time_end, color, is_self, is_friend,
//   games: [{ game_id, steam_app_id, name, platform, heat, skill, cover_image_id }],
//   hobbies: [{ name, heat }], likes: [{ name, locked }] }
```

状態の名前は、仕様の「募集」「参加希望と成立」の表の状態と同じ文字列（`出ている`、`満員で終了`、`待っている`、`成立` など）。

```ts
// 募集リンクを開いたとき：その募集を先頭に、同じゲームの募集を並べる
const { data } = await supabase
  .rpc('recruitments_for_game', { p_game_id: gameId, p_first: recruitmentId })
  .select('*, status, matched_count, games(*), profiles(nickname, region)');

// 自分の参加希望と、成立していれば入る場所
const { data: mine } = await supabase
  .from('applications')
  .select('*, state, recruitments(*, status, recruitment_meetings(*))')
  .eq('recruitment_id', recruitmentId);
```

### 変える

状態を変えるのは、関数（`supabase.rpc`）だけ。表には書けない。

| 関数 | すること |
| --- | --- |
| `publish_recruitment` | 募集を公開する |
| `apply_to_recruitment` | 参加希望を送る |
| `approve_application` | 参加希望を承認する（募集する人だけ） |
| `update_meeting` | 入る場所・招待URLを入れる・変える（募集する人だけ）。`null` は変えない、空文字は消す |
| `change_recruitment` | `p_action` が `close`（受付を終える）・`cancel`（開催を中止する）・`start_play`（遊び始める）・`end_play`（遊び終える） |
| `reopen_with_more_capacity` | 受付が終わった募集を、人数を増やして再開する（募集する人だけ。recruit-23）。開始時刻を過ぎていれば `追加受付中` になる（requests-26） |
| `update_profile` | 自分のニックネーム・住んでいる地方・いつも遊ぶ時間帯だけを保存する。渡した値でそのまま置き換え、`null` は消す。画面が `save_profile` に移ったら使わない |
| `save_profile` | 自分のプロフィールを丸ごと保存する（`p_profile` に `nickname`・`region`・`usual_time_start`・`usual_time_end`・`color`・`games`・`hobbies`・`likes`）。ゲーム・趣味・好きなものは、渡した配列の順で入れ替わる。熱量は 1〜5（ゆるい〜ガチ）、実力は 1〜9。IGDB のゲームは、先に `games` に入れておく。アプリIDがまだ無ければ8文字を付け、`app_id` で返す。匿名のログインでは使えない。Steam のプレイ時間は送らない（保存しない） |
| `set_app_id` | 自分のアプリIDを変える。英小文字・数字・`_` の3〜20文字で、大文字は小文字にする。古いアプリIDのリンクは開けなくなる。匿名のログインでは使えない |

約束：

- どの関数も、第1引数に `p_op_id`（画面が操作ごとに作る UUID。`crypto.randomUUID()`）を渡す。同じ利用者・操作・対象・入力を通信切断後に送り直すときだけ同じ ID を使い、どれかが変わったら新しい ID を作る。再送で募集や成立を重ねない。`update_meeting` は再送でも現在の閲覧可否を確かめ、終了後の部屋情報を返さない
- ログインしていないと、エラー（HTTP 401）になる
- 受け付けなかったときは、エラーではなく `{ ok: false, reason, status? }` が返る。`status` は、そのときの募集の状態。画面は理由と最新の状態を出す

| `reason` | 意味 |
| --- | --- |
| `not_found` | 募集・参加希望が無い |
| `not_owner` | 募集する人でない |
| `own_recruitment` | 自分の募集に参加しようとした |
| `not_accepting` | 受け付けていない状態（`status` を見る） |
| `unknown_game` | 用意していないゲーム（選んだゲームは、先に Edge Function `igdb-search` の保存で `games` に入れる。`src/lib/games.ts` の `saveGame`） |
| `game_account_id_required` | IDが要る募集で、ゲーム内IDが空 |
| `game_account_id_invalid` | ゲーム内IDが英数字だけでない |
| `unknown_mode` | そのゲームの選択肢に無いモード（中身の無いゲームでは、モードを入れられない） |
| `not_reopenable` | 再開できない（受付中、人数指定が無い、人数が増えていない、成立人数以下、開催中止・遊び終了の後） |
| `usual_time_incomplete` | いつも遊ぶ時間帯の、始まりか終わりの片方だけ |
| `nickname_invalid` | ニックネームに改行が入っている（`save_profile` では、21文字以上も） |
| `region_invalid` | 住んでいる地方の区分に無い値 |
| `usual_time_invalid` | いつも遊ぶ時間帯が `HH:MM` の形でない（終わりだけ `24:00` を使える） |
| `color_invalid` | 色が `#` と16進6桁でない |
| `too_many_items` | ゲーム50件・趣味20件・好きなもの30件を超えている |
| `profile_invalid` | ゲーム・趣味・好きなものの中身が決まりに合わない（名前が空か41文字以上、熱量・実力の範囲外、機種が選択肢に無い、`games` に無い IGDB のゲームなど）。どの部分も保存しない |
| `app_id_invalid` | アプリIDの形が違う |
| `app_id_taken` | アプリIDが、ほかの人に使われている |

### 画面の更新を受ける

`recruitments`・`recruitment_meetings`・`applications`・`notifications` の変更は、Realtime（Postgres Changes）で届く。届くのは、読める行の変更だけ。つながっていなかった間の分は、つなぎ直したときと画面に戻ったときに読み直す（ADR-66）。

```ts
supabase
  .channel('my-application')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'applications', filter: `id=eq.${applicationId}` }, reload)
  .subscribe();
```

## データベースで守っていること

画面の側ではなく、データベースの表・関数・行の権限で守っている約束。

- 状態の名前と、満員・締め切り・手動終了のどれが先に効くか
- 合流情報は成立した相手との間だけに、ゲーム内IDは承認待ちの間から募集する人に渡す
- 開催中止・遊び終了の後は、合流情報とゲーム内IDを双方に渡さない
- 入る場所と招待URLは、開催中止・遊び終了まで変えられ、受付の状態は変えない
- 成立した人（辞退した人を除く）だけを枠に数え、同時に承認しても超えない
- 承認・受付終了・中止・進行・再開の操作は、募集する人だけ
- 同じ操作の送り直しと、同じ募集への2回目の参加希望を重ねない
- 受付の判定は、操作を受け付けた時点の状態とデータベースの時刻で決める。開始時刻と同時か後は締め切りで終了
- 満員・受付終了で、承認待ちの参加希望は知らせずに終わる
- 増員して再開できる条件と、開始後の追加受付中
- 開催中止・遊び終了の後は、受付終了・進行の操作で何も変えない
- 募集は、ログインしていない人も読める
- 募集人数は、空欄か1以上の整数

## クラウドに当てる

プロジェクトは開発用とデモ用の2つ（ADR-81）。手元で `npx supabase db reset` と `npx supabase test db` が通ることを確かめてから、開発用に当てる。デモ用には、開発用で確かめた後に当てる。

```bash
npx supabase link --project-ref <開発用のプロジェクトのref>
```

```bash
npx supabase db push
```
