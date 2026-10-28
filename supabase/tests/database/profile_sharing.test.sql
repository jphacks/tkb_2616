-- 20261028010000_profile_sharing.sql を確かめる。
-- プロフィールの保存（profile-1、server-73）、アプリIDとリンク（profile-11、profile-13）、
-- 見える人（server-17、profile-18）、書き込みは関数だけ（ADR-63）。
-- 流し方：npx supabase test db
begin;
select plan(28);

create function pg_temp.as_user(p uuid, p_anonymous boolean default false) returns void language plpgsql as $$
begin
  if p is null then
    perform set_config('role', 'anon', true);
    perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  else
    perform set_config('role', 'authenticated', true);
    perform set_config('request.jwt.claims',
      json_build_object('sub', p, 'role', 'authenticated', 'is_anonymous', p_anonymous)::text, true);
  end if;
end $$;

-- 本人（a）、a のフレンド（b）、ほかの人（c）、匿名のログイン（d）
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'b@example.test'),
  ('00000000-0000-0000-0000-0000000000c1', 'c@example.test'),
  ('00000000-0000-0000-0000-0000000000d1', null);
-- 絵のあるゲーム（9101）と、ゲーム会社に求められて絵を出さないゲーム（9102）
insert into public.games (id, name, cover_image_id, hide_cover) values
  (9101, '絵のあるゲーム', 'cover9101', false),
  (9102, '絵を出さないゲーム', 'cover9102', true);
insert into public.friendships (user_a, user_b, a_nickname, b_nickname, game_id) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'エー', 'ビー', 9101);

create temp table op (name text primary key, id uuid not null);
insert into op values ('first', gen_random_uuid());
grant select on op to anon, authenticated;

-- 保存できる人 -----------------------------------------------------------------

select pg_temp.as_user(null);
select throws_ok($$ select public.save_profile(gen_random_uuid(), '{}') $$,
  '42501', null, 'ログインしていない人はプロフィールを保存できない');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1', true);
select throws_ok($$ select public.save_profile(gen_random_uuid(), '{}') $$,
  '42501', null, '匿名のログインではプロフィールを保存できない');

-- 保存と、アプリIDの自動の付与 ---------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select is(public.save_profile((select id from op where name = 'first'), '{
  "nickname": " エー ", "region": "関東", "usual_time_start": "21:00", "usual_time_end": "24:00", "color": "#6C5CF0",
  "games": [
    {"game_id": 9101, "name": "絵のあるゲーム", "platform": "PC（Steam）", "heat": 5, "skill": 7},
    {"game_id": 9102, "name": "絵を出さないゲーム", "platform": "Switch", "heat": 2, "skill": 3},
    {"steam_app_id": 570, "name": "IGDBに無いSteamのゲーム", "platform": "PC（Steam）", "heat": 3, "skill": 5}
  ],
  "hobbies": [{"name": "カフェ巡り", "heat": 4}],
  "likes": [{"name": "ボカロ"}, {"name": "推しのアイドル", "locked": true}, {"name": "少年漫画", "locked": false}]
}')->>'ok', 'true', '本人はゲーム・趣味・好きなものをまとめて保存できる');
select matches((select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'),
  '^[a-z0-9_]{8}$', 'アプリIDが無ければ、8文字のアプリIDが付く');
select is(public.my_profile()->>'nickname', 'エー', '自分のプロフィールを読める（前後の空白は除く）');
select is(public.my_profile()->>'usual_time_end', '24:00', 'いつも遊ぶ時間帯の終わりに 24:00 を入れられる');
select is(public.my_profile()->>'color', '#6c5cf0', '色は小文字にそろえる');
select is(jsonb_array_length(public.my_profile()->'likes'), 3, '本人には鍵をかけた好きなものも見える');

-- アプリIDから開く（profile-13）と、見える人（server-17） -----------------------------

select pg_temp.as_user(null);
select is(public.profile_by_app_id(
    (select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'))->>'nickname',
  'エー', 'ログインしていない人も、アプリIDからプロフィールを開ける');
select is(public.profile_by_app_id(
    (select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'))->'games'->0->>'cover_image_id',
  'cover9101', 'ゲームの絵の ID が付く');
select is(public.profile_by_app_id(
    (select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'))->'games'->1->>'cover_image_id',
  null, '絵を出さないゲームには、絵の ID を付けない（app-13）');
select is(public.profile_by_app_id(
    (select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'))->'games'->2->>'name',
  'IGDBに無いSteamのゲーム', 'IGDB に無い Steam のゲームも、名前で並ぶ');
select is(jsonb_array_length(public.profile_by_app_id(
    (select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'))->'likes'),
  2, 'ログインしていない人には、鍵をかけた好きなものが見えない');
select throws_ok($$ select * from public.profile_locked_likes $$,
  '42501', null, 'ログインしていない人は、鍵をかけた好きなものの表を読めない');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(jsonb_array_length(public.profile_by_app_id(
    (select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'))->'likes'),
  2, 'フレンドでない人には、鍵をかけた好きなものが見えない');
select is((select count(*)::int from public.profile_locked_likes), 0,
  'フレンドでない人は、鍵をかけた好きなものの行を読めない');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1');
select is(public.profile_by_app_id(
    (select app_id from public.profiles where id = '00000000-0000-0000-0000-0000000000a1'))->'likes'->1->>'name',
  '推しのアイドル', 'フレンドには、鍵をかけた好きなものも並び順どおりに見える');
select is((select count(*)::int from public.profile_locked_likes), 1,
  'フレンドは、鍵をかけた好きなものの行を読める');

-- 書けるのは関数だけ（ADR-63） ----------------------------------------------------

select pg_temp.as_user('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ insert into public.profile_games (user_id, position, name, platform, heat, skill)
    values ('00000000-0000-0000-0000-0000000000a1', 9, 'のっとり', 'Switch', 1, 1) $$,
  '42501', null, 'プロフィールのゲームの表には直接書けない');

-- 入れ替えと、受け付けない入力 ------------------------------------------------------

select is(public.save_profile(gen_random_uuid(), '{
  "nickname": "エー", "games": [{"game_id": 9101, "name": "絵のあるゲーム", "platform": "Switch", "heat": 1, "skill": 1}]
}')->>'ok', 'true', '保存し直せる');
select is(jsonb_array_length(public.my_profile()->'games'), 1, '保存し直すと、ゲームは渡したものだけに入れ替わる');
select is(public.save_profile(gen_random_uuid(), '{
  "games": [{"game_id": 9101, "name": "絵のあるゲーム", "platform": "Switch", "heat": 6, "skill": 1}]
}')->>'reason', 'profile_invalid', '熱量は 1〜5 だけ');
select is(jsonb_array_length(public.my_profile()->'games'), 1, '受け付けなかった保存では、何も変わらない');
select is(public.save_profile(gen_random_uuid(), '{
  "games": [{"game_id": 424242, "name": "取り込んでいないゲーム", "platform": "Switch", "heat": 1, "skill": 1}]
}')->>'reason', 'profile_invalid', '取り込んでいない IGDB のゲームは入れられない');

-- アプリIDを変える（profile-11） ---------------------------------------------------

select is(public.set_app_id(gen_random_uuid(), ' Yu_7 ')->>'app_id', 'yu_7', 'アプリIDを変えられる（小文字にそろえる）');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1');
select is(public.set_app_id(gen_random_uuid(), 'yu_7')->>'reason', 'app_id_taken', 'ほかの人のアプリIDは使えない');
select is(public.set_app_id(gen_random_uuid(), 'ab')->>'reason', 'app_id_invalid', 'アプリIDは3文字以上');

select pg_temp.as_user(null);
select is(public.profile_by_app_id('YU_7')->>'nickname', 'エー', 'アプリIDは、大文字で入れても開ける');

select * from finish();
rollback;
