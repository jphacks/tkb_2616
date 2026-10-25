-- 継続して遊ぶフレンドの募集。一回のゲーム募集・本人プロフィールには書き込まない。
create table public.friend_recruitments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check (btrim(nickname) <> ''),
  game_id bigint not null references public.games(id),
  platform text not null check (btrim(platform) <> ''),
  skill smallint not null check (skill between 1 and 9),
  enthusiasm smallint not null check (enthusiasm between 0 and 4),
  available_from text not null check (available_from ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  available_to text not null check (available_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or available_to = '24:00'),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index friend_recruitments_created_idx on public.friend_recruitments(created_at desc);
create index friend_recruitments_owner_idx on public.friend_recruitments(owner_id);

create table public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  recruitment_id uuid not null references public.friend_recruitments(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  nickname text not null check (btrim(nickname) <> ''),
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
-- 同じ二人の未承認申請を、募集や方向を変えて重複させない。
create unique index friend_requests_pending_pair_idx on public.friend_requests
  (least(sender_id, recipient_id), greatest(sender_id, recipient_id)) where status = 'pending';
create index friend_requests_recipient_idx on public.friend_requests(recipient_id, created_at desc);
create index friend_requests_sender_idx on public.friend_requests(sender_id, created_at desc);
create index friend_requests_recruitment_idx on public.friend_requests(recruitment_id);

create table public.friendships (
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  a_nickname text not null,
  b_nickname text not null,
  game_id bigint not null references public.games(id),
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);
create index friendships_user_b_idx on public.friendships(user_b);

alter table public.friend_recruitments enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
revoke all on public.friend_recruitments, public.friend_requests, public.friendships from public, anon, authenticated;
grant select on public.friend_recruitments to anon, authenticated;
grant select on public.friend_requests, public.friendships to authenticated;
create policy "フレンド募集は読める" on public.friend_recruitments for select to anon, authenticated using (true);
create policy "申請の当事者" on public.friend_requests for select to authenticated
  using ((select auth.uid()) in (sender_id, recipient_id));
create policy "フレンドの当事者" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
alter publication supabase_realtime add table public.friend_recruitments, public.friend_requests, public.friendships;

-- 新しいフレンド機能は匿名アカウントでは操作しない。旧ゲーム募集の認証条件は変えない。
create function private.require_friend_user()
returns uuid language plpgsql stable set search_path = '' as $$
declare v_uid uuid := private.require_user();
begin
  if (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'is_anonymous') = 'true' then
    raise exception 'ログインが要る' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function private.require_friend_user() from public, anon, authenticated;

-- 既存の操作記録を使い、同じIDを別の操作・対象・入力へ使い回した場合も区別する。
create function private.friend_operation(p_user uuid, p_op_id uuid, p_action text, p_input jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_name text := p_action || ':' || md5(p_input::text);
  v_done jsonb := private.begin_operation(p_user, p_op_id, v_name);
begin
  if (select name from private.operations where user_id = p_user and op_id = p_op_id) <> v_name then
    return jsonb_build_object('ok', false, 'reason', 'operation_conflict');
  end if;
  return v_done;
end;
$$;
revoke all on function private.friend_operation(uuid, uuid, text, jsonb) from public, anon, authenticated;

create function public.publish_friend_recruitment(
  p_op_id uuid, p_game_id bigint, p_nickname text, p_platform text,
  p_skill integer, p_enthusiasm integer, p_available_from text, p_available_to text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_friend_user();
  v_done jsonb := private.friend_operation(v_uid, p_op_id, 'publish_friend_recruitment',
    jsonb_build_array(p_game_id, p_nickname, p_platform, p_skill, p_enthusiasm, p_available_from, p_available_to));
  v_id uuid;
begin
  if v_done is not null then return v_done; end if;
  if p_nickname is null or btrim(p_nickname) = '' or p_platform is null or btrim(p_platform) = ''
    or p_skill is null or p_skill not between 1 and 9 or p_enthusiasm is null or p_enthusiasm not between 0 and 4
    or p_available_from is null or p_available_from !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    or p_available_to is null or not (p_available_to ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or p_available_to = '24:00') then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'invalid_input'));
  end if;
  if not exists (select 1 from public.games where id = p_game_id) then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'unknown_game'));
  end if;
  insert into public.friend_recruitments(owner_id, nickname, game_id, platform, skill, enthusiasm, available_from, available_to)
    values (v_uid, btrim(p_nickname), p_game_id, btrim(p_platform), p_skill, p_enthusiasm, p_available_from, p_available_to)
    returning id into v_id;
  return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true, 'recruitment_id', v_id));
end;
$$;

create function public.request_friendship(p_op_id uuid, p_recruitment_id uuid, p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_friend_user();
  v_done jsonb := private.friend_operation(v_uid, p_op_id, 'request_friendship', jsonb_build_array(p_recruitment_id, p_nickname));
  v_r public.friend_recruitments;
  v_id uuid;
begin
  if v_done is not null then return v_done; end if;
  select * into v_r from public.friend_recruitments where id = p_recruitment_id;
  if not found then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'not_found')); end if;
  if v_r.owner_id = v_uid then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'own_recruitment')); end if;
  -- 申請・承認・解除は同じ二人を同じ順にロックする。並行操作でもペアは一件だけ。
  perform id from public.profiles where id in (v_uid, v_r.owner_id) order by id for update;
  select * into v_r from public.friend_recruitments where id = p_recruitment_id for update;
  if v_r.closed_at is not null then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'not_accepting')); end if;
  if p_nickname is null or btrim(p_nickname) = '' then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'invalid_input')); end if;
  if exists (select 1 from public.friendships where user_a = least(v_uid, v_r.owner_id) and user_b = greatest(v_uid, v_r.owner_id)) then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'already_friends'));
  end if;
  select id into v_id from public.friend_requests
    where least(sender_id, recipient_id) = least(v_uid, v_r.owner_id)
      and greatest(sender_id, recipient_id) = greatest(v_uid, v_r.owner_id) and status = 'pending';
  if v_id is not null then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true, 'request_id', v_id, 'already', true));
  end if;
  insert into public.friend_requests(recruitment_id, sender_id, recipient_id, nickname)
    values (v_r.id, v_uid, v_r.owner_id, btrim(p_nickname)) returning id into v_id;
  return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true, 'request_id', v_id));
end;
$$;

create function public.accept_friend_request(p_op_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_friend_user();
  v_done jsonb := private.friend_operation(v_uid, p_op_id, 'accept_friend_request', jsonb_build_array(p_request_id));
  v_q public.friend_requests;
  v_r public.friend_recruitments;
begin
  if v_done is not null then return v_done; end if;
  select * into v_q from public.friend_requests where id = p_request_id;
  if not found then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'not_found')); end if;
  if v_q.recipient_id <> v_uid then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'not_recipient')); end if;
  perform id from public.profiles where id in (v_q.sender_id, v_q.recipient_id) order by id for update;
  select * into v_q from public.friend_requests where id = p_request_id for update;
  -- 解除後に古い承認を押し直しても関係を復活させない。再申請は新しいpendingを作る。
  if v_q.status = 'accepted' then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true, 'already', true));
  end if;
  select * into v_r from public.friend_recruitments where id = v_q.recruitment_id;
  insert into public.friendships(user_a, user_b, a_nickname, b_nickname, game_id)
    values (least(v_q.sender_id, v_q.recipient_id), greatest(v_q.sender_id, v_q.recipient_id),
      case when v_q.sender_id < v_q.recipient_id then v_q.nickname else v_r.nickname end,
      case when v_q.sender_id < v_q.recipient_id then v_r.nickname else v_q.nickname end, v_r.game_id)
    on conflict (user_a, user_b) do nothing;
  update public.friend_requests set status = 'accepted'
    where least(sender_id, recipient_id) = least(v_q.sender_id, v_q.recipient_id)
      and greatest(sender_id, recipient_id) = greatest(v_q.sender_id, v_q.recipient_id) and status = 'pending';
  return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true));
end;
$$;

create function public.close_friend_recruitment(p_op_id uuid, p_recruitment_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_friend_user();
  v_done jsonb := private.friend_operation(v_uid, p_op_id, 'close_friend_recruitment', jsonb_build_array(p_recruitment_id));
  v_r public.friend_recruitments;
begin
  if v_done is not null then return v_done; end if;
  select * into v_r from public.friend_recruitments where id = p_recruitment_id for update;
  if not found then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'not_found')); end if;
  if v_r.owner_id <> v_uid then return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'not_owner')); end if;
  update public.friend_recruitments set closed_at = coalesce(closed_at, now()) where id = v_r.id;
  return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true));
end;
$$;

create function public.remove_friendship(p_op_id uuid, p_peer_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_friend_user();
  v_done jsonb := private.friend_operation(v_uid, p_op_id, 'remove_friendship', jsonb_build_array(p_peer_id));
begin
  if v_done is not null then return v_done; end if;
  if p_peer_id is null or p_peer_id = v_uid then
    return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', false, 'reason', 'invalid_input'));
  end if;
  perform id from public.profiles where id in (v_uid, p_peer_id) order by id for update;
  delete from public.friendships where user_a = least(v_uid, p_peer_id) and user_b = greatest(v_uid, p_peer_id);
  return private.finish_operation(v_uid, p_op_id, jsonb_build_object('ok', true));
end;
$$;

create function public.friend_connections()
returns table(peer_id uuid, nickname text, game_id bigint, game_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := private.require_friend_user();
begin
  return query select
    case when f.user_a = v_uid then f.user_b else f.user_a end,
    case when f.user_a = v_uid then f.b_nickname else f.a_nickname end,
    f.game_id, g.name, f.created_at
    from public.friendships f join public.games g on g.id = f.game_id
    where v_uid in (f.user_a, f.user_b) order by f.created_at desc, f.user_a, f.user_b;
end;
$$;

revoke all on function public.publish_friend_recruitment(uuid, bigint, text, text, integer, integer, text, text) from public, anon;
revoke all on function public.request_friendship(uuid, uuid, text) from public, anon;
revoke all on function public.accept_friend_request(uuid, uuid) from public, anon;
revoke all on function public.close_friend_recruitment(uuid, uuid) from public, anon;
revoke all on function public.remove_friendship(uuid, uuid) from public, anon;
revoke all on function public.friend_connections() from public, anon;
grant execute on function public.publish_friend_recruitment(uuid, bigint, text, text, integer, integer, text, text) to authenticated;
grant execute on function public.request_friendship(uuid, uuid, text) to authenticated;
grant execute on function public.accept_friend_request(uuid, uuid) to authenticated;
grant execute on function public.close_friend_recruitment(uuid, uuid) to authenticated;
grant execute on function public.remove_friendship(uuid, uuid) to authenticated;
grant execute on function public.friend_connections() to authenticated;
