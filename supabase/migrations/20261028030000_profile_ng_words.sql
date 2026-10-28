-- 名前に入れられない言葉（app-24）を、画面だけでなくプロフィールの保存の関数でも確かめる。
-- 画面を通さずに関数を呼んでも、連絡先（LINE・Instagram・URL・メールなど）を書き込めないようにする。
--
-- 確かめるのは、本人が自分で入れる名前だけ：ニックネーム、アプリID、趣味・好きなもの、自分で足したゲーム。
-- IGDB や Steam から来たゲームの名前（「Hotline Miami」など）は確かめない。Steam から取り込んだゲームで保存が止まらないように。

-- 言葉は、画面の NG_WORDS（app/src/data.ts）と同じにする。変えるときは両方を変える
create function private.has_ng_word(p_text text)
returns boolean
language sql immutable set search_path = ''
as $$
  select p_text is not null and exists (
    select 1 from unnest(array['line', '@', 'http', 'discord.gg', 'insta']) as w (word)
    where position(w.word in lower(p_text)) > 0
  )
$$;
revoke execute on function private.has_ng_word (text) from public, anon, authenticated;

-- 20261028010000_profile_sharing.sql の関数に、入れられない言葉の確かめ（ng_word）を足す
create or replace function public.save_profile(p_op_id uuid, p_profile jsonb)
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
  -- 本人が入れる名前に、入れられない言葉が無いか（app-24）
  if private.has_ng_word(v_nickname)
    or exists (select 1 from jsonb_array_elements(v_hobbies) e (v) where private.has_ng_word(e.v ->> 'name'))
    or exists (select 1 from jsonb_array_elements(v_likes) e (v) where private.has_ng_word(e.v ->> 'name'))
    or exists (select 1 from jsonb_array_elements(v_games) e (v)
      where e.v ->> 'game_id' is null and e.v ->> 'steam_app_id' is null and private.has_ng_word(e.v ->> 'name')) then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'ng_word'));
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

create or replace function public.set_app_id(p_op_id uuid, p_app_id text)
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
  if private.has_ng_word(v_app_id) then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'ng_word'));
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
