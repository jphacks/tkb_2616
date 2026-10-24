-- 募集者は、承認前でも参加希望に入力されたゲーム内IDを確認できる。
-- 既存の本人・成立者の閲覧条件に、受付中の参加希望の分だけを加える。
-- 既存の can_see_game_id の定義順序に依存させないため、別のSELECTポリシーとする。
create policy owner_reads_pending_application_game_ids
on public.application_game_ids
for select to authenticated
using (
  exists (
    select 1 from public.applications a
    join public.recruitments r on r.id = a.recruitment_id
    where a.id = application_game_ids.application_id
      and r.owner_id = (select auth.uid())
      and r.cancelled_at is null
      and r.play_ended_at is null
      and a.matched_at is null
      and a.ended_at is null
      and a.declined_at is null
  )
);
