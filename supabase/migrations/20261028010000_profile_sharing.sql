-- プロフィールを DB に保存し、プロフィールのリンク（アプリID）から他の人が見られるようにする。
-- profile-1、profile-10、profile-11、profile-13、profile-18、server-17、server-73
--
-- 守り方（仕様のリポジトリの docs/決定/）
--   ADR-63 書くのは関数だけ。画面には表への書き込みの権限を与えない
--   ADR-64 見える人が違う項目（鍵をかけた好きなもの）は表を分け、行の権限で守る
-- Steam のプレイ時間は保存しない。画面から送られた値では、信頼の目安を偽れるため。

-- ---------------------------------------------------------------------------
-- 表
-- ---------------------------------------------------------------------------

-- アプリIDは英小文字・数字・_ の3〜20文字（Q-25 を決めた形）。大文字は関数で小文字にしてから入れる
alter table public.profiles
  add column color text check (color ~ '^#[0-9a-f]{6}$'),
  add constraint profiles_app_id_format check (app_id ~ '^[a-z0-9_]{3,20}$');

-- E-2 プロフィールのゲーム。IGDB のゲーム（game_id）か、IGDB に無い Steam のゲーム（steam_app_id）を持つ
-- name は表示用の名前。IGDB のゲームでも、保存したときの名前を持つ
create table public.profile_games (
  user_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 0 and 49),
  game_id bigint references public.games (id),
  steam_app_id integer check (steam_app_id > 0),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  platform text not null check (platform in ('Switch', 'Switch 2', 'PlayStation', 'PC（Steam）', 'スマホ', 'その他')),
  heat smallint not null check (heat between 1 and 5),     -- ゆるい=1 … ガチ=5（ADR-33）
  skill smallint not null check (skill between 1 and 9),   -- ADR-75
  primary key (user_id, position)
);

-- E-3 プロフィールの趣味（ゲーム以外）
create table public.profile_hobbies (
  user_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 0 and 19),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  heat smallint not null check (heat between 1 and 5),
  primary key (user_id, position)
);

-- E-4 好きなもの。鍵をかけていないもの（だれでも）と、鍵をかけたもの（本人とフレンドだけ）で表を分ける（ADR-64）
-- position は、鍵の有無をまたいだ並び順。2つの表で同じ position は使わない
create table public.profile_likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 0 and 29),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  primary key (user_id, position)
);

create table public.profile_locked_likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  position smallint not null check (position between 0 and 29),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  primary key (user_id, position)
);

-- ---------------------------------------------------------------------------
-- 行の権限（ADR-64）。書き込みの権限は誰にも与えない（ADR-63）
-- ---------------------------------------------------------------------------

-- 見ている人が、その人のフレンドか（自分自身は含まない）
create function private.is_friend(p_user uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_a = least(p_user, (select auth.uid()))
      and f.user_b = greatest(p_user, (select auth.uid()))
  )
$$;
grant execute on function private.is_friend (uuid) to anon, authenticated;

alter table public.profile_games enable row level security;
alter table public.profile_hobbies enable row level security;
alter table public.profile_likes enable row level security;
alter table public.profile_locked_likes enable row level security;

revoke insert, update, delete, truncate on public.profile_games, public.profile_hobbies,
  public.profile_likes, public.profile_locked_likes from anon, authenticated;
revoke all on public.profile_locked_likes from anon;

create policy "だれでも読める" on public.profile_games for select to anon, authenticated using (true);
create policy "だれでも読める" on public.profile_hobbies for select to anon, authenticated using (true);
create policy "だれでも読める" on public.profile_likes for select to anon, authenticated using (true);
create policy "本人とフレンド" on public.profile_locked_likes for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_friend(user_id)));

-- ---------------------------------------------------------------------------
-- プロフィールを1つの JSON にする。鍵をかけた好きなものは、見ている人が本人かフレンドのときだけ入れる
-- ---------------------------------------------------------------------------

create function private.profile_json(p_user uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'app_id', p.app_id,
    'nickname', p.nickname,
    'region', p.region,
    'usual_time_start', left(p.usual_time_start::text, 5),
    'usual_time_end', left(p.usual_time_end::text, 5),
    'color', p.color,
    'is_self', p.id = (select auth.uid()),
    'is_friend', private.is_friend(p.id),
    'games', coalesce((
      select jsonb_agg(jsonb_build_object(
        'game_id', g.game_id, 'steam_app_id', g.steam_app_id, 'name', g.name,
        'platform', g.platform, 'heat', g.heat, 'skill', g.skill,
        -- ゲーム会社に求められたゲームは、絵を出さない（app-13）
        'cover_image_id', case when t.hide_cover then null else t.cover_image_id end
      ) order by g.position)
      from public.profile_games g left join public.games t on t.id = g.game_id
      where g.user_id = p.id), '[]'::jsonb),
    'hobbies', coalesce((
      select jsonb_agg(jsonb_build_object('name', h.name, 'heat', h.heat) order by h.position)
      from public.profile_hobbies h where h.user_id = p.id), '[]'::jsonb),
    'likes', coalesce((
      select jsonb_agg(jsonb_build_object('name', l.name, 'locked', l.locked) order by l.position)
      from (
        select position, name, false as locked from public.profile_likes where user_id = p.id
        union all
        select position, name, true from public.profile_locked_likes
        where user_id = p.id and (p.id = (select auth.uid()) or private.is_friend(p.id))
      ) l), '[]'::jsonb)
  )
  from public.profiles p
  where p.id = p_user
$$;

-- アプリIDから、そのプロフィールを返す。無ければ null（profile-13）
create function public.profile_by_app_id(p_app_id text)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select private.profile_json(p.id) from public.profiles p where p.app_id = lower(btrim(p_app_id))
$$;

-- ログインしている本人のプロフィール。アプリIDをまだ持たない人も読める
create function public.my_profile()
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select private.profile_json(private.require_friend_user())
$$;

-- ---------------------------------------------------------------------------
-- プロフィールを保存する（profile-1、profile-20、server-73）。本人だけ。匿名のログインは不可
-- 渡した内容で、ゲーム・趣味・好きなものを丸ごと入れ替える。アプリIDがまだ無ければ、ランダムな8文字を付ける
-- p_profile の形：
--   {nickname, region, usual_time_start, usual_time_end, color,
--    games: [{game_id?, steam_app_id?, name, platform, heat, skill}],
--    hobbies: [{name, heat}], likes: [{name, locked?}]}
-- 受け付けなかったときは {ok:false, reason}。どの部分も保存しない
-- ---------------------------------------------------------------------------

create function public.save_profile(p_op_id uuid, p_profile jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_friend_user();
  v_done jsonb := private.begin_operation(v_uid, p_op_id, 'save_profile');
  v_nickname text := nullif(btrim(p_profile ->> 'nickname'), '');
  v_region text := nullif(p_profile ->> 'region', '');
  v_start text := nullif(p_profile ->> 'usual_time_start', '');
  v_end text := nullif(p_profile ->> 'usual_time_end', '');
  v_color text := lower(nullif(p_profile ->> 'color', ''));
  v_games jsonb := coalesce(p_profile -> 'games', '[]'::jsonb);
  v_hobbies jsonb := coalesce(p_profile -> 'hobbies', '[]'::jsonb);
  v_likes jsonb := coalesce(p_profile -> 'likes', '[]'::jsonb);
  v_app_id text;
begin
  if v_done is not null then
    return v_done;
  end if;

  if jsonb_typeof(v_games) <> 'array' or jsonb_typeof(v_hobbies) <> 'array' or jsonb_typeof(v_likes) <> 'array' then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'profile_invalid'));
  end if;
  if jsonb_array_length(v_games) > 50 or jsonb_array_length(v_hobbies) > 20 or jsonb_array_length(v_likes) > 30 then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'too_many_items'));
  end if;
  if v_nickname ~ '[\r\n]' or char_length(v_nickname) > 20 then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'nickname_invalid'));
  end if;
  if v_region is not null and not (v_region = any (enum_range(null::public.region)::text[])) then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'region_invalid'));
  end if;
  if (v_start is null) <> (v_end is null) then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'usual_time_incomplete'));
  end if;
  if v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or v_end !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$' then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'usual_time_invalid'));
  end if;
  if v_color !~ '^#[0-9a-f]{6}$' then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'color_invalid'));
  end if;

  -- 行の決まり（名前の長さ、熱量・実力の範囲、機種、ゲームの有無）に1つでも合わなければ、全部を戻す
  begin
    insert into public.profiles (id) values (v_uid) on conflict do nothing;
    update public.profiles set
      nickname = v_nickname, region = v_region::public.region,
      usual_time_start = v_start::time, usual_time_end = v_end::time,
      color = v_color, updated_at = now()
    where id = v_uid
    returning app_id into v_app_id;

    delete from public.profile_games where user_id = v_uid;
    delete from public.profile_hobbies where user_id = v_uid;
    delete from public.profile_likes where user_id = v_uid;
    delete from public.profile_locked_likes where user_id = v_uid;

    insert into public.profile_games (user_id, position, game_id, steam_app_id, name, platform, heat, skill)
    select v_uid, (e.i - 1)::smallint, (e.v ->> 'game_id')::bigint, (e.v ->> 'steam_app_id')::integer,
      btrim(e.v ->> 'name'), e.v ->> 'platform', (e.v ->> 'heat')::smallint, (e.v ->> 'skill')::smallint
    from jsonb_array_elements(v_games) with ordinality as e (v, i);

    insert into public.profile_hobbies (user_id, position, name, heat)
    select v_uid, (e.i - 1)::smallint, btrim(e.v ->> 'name'), (e.v ->> 'heat')::smallint
    from jsonb_array_elements(v_hobbies) with ordinality as e (v, i);

    insert into public.profile_likes (user_id, position, name)
    select v_uid, (e.i - 1)::smallint, btrim(e.v ->> 'name')
    from jsonb_array_elements(v_likes) with ordinality as e (v, i)
    where coalesce((e.v ->> 'locked')::boolean, false) = false;

    insert into public.profile_locked_likes (user_id, position, name)
    select v_uid, (e.i - 1)::smallint, btrim(e.v ->> 'name')
    from jsonb_array_elements(v_likes) with ordinality as e (v, i)
    where coalesce((e.v ->> 'locked')::boolean, false) = true;
  exception
    when check_violation or not_null_violation or foreign_key_violation
      or invalid_text_representation or numeric_value_out_of_range or datatype_mismatch then
      return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'profile_invalid'));
  end;

  -- アプリIDがまだ無ければ、使われていない8文字を付ける。あとで set_app_id で変えられる
  while v_app_id is null loop
    v_app_id := substr(md5(random()::text || clock_timestamp()::text), 1, 8);
    begin
      update public.profiles set app_id = v_app_id where id = v_uid;
    exception when unique_violation then
      v_app_id := null;
    end;
  end loop;

  return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true, 'app_id', v_app_id));
end;
$$;

-- アプリIDを変える（profile-11）。英小文字・数字・_ の3〜20文字。大文字は小文字にする
-- 古いアプリIDのリンクは開けなくなる
create function public.set_app_id(p_op_id uuid, p_app_id text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := private.require_friend_user();
  v_done jsonb := private.begin_operation(v_uid, p_op_id, 'set_app_id');
  v_app_id text := lower(btrim(p_app_id));
begin
  if v_done is not null then
    return v_done;
  end if;
  if v_app_id is null or v_app_id !~ '^[a-z0-9_]{3,20}$' then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'app_id_invalid'));
  end if;
  begin
    insert into public.profiles (id) values (v_uid) on conflict do nothing;
    update public.profiles set app_id = v_app_id, updated_at = now() where id = v_uid;
  exception when unique_violation then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'app_id_taken'));
  end;
  return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true, 'app_id', v_app_id));
end;
$$;

revoke execute on function private.profile_json from public, anon, authenticated;
revoke execute on function public.profile_by_app_id from public;
revoke execute on function public.my_profile from public, anon;
revoke execute on function public.save_profile from public, anon;
revoke execute on function public.set_app_id from public, anon;
grant execute on function public.profile_by_app_id to anon, authenticated;
grant execute on function public.my_profile to authenticated;
grant execute on function public.save_profile to authenticated;
grant execute on function public.set_app_id to authenticated;
