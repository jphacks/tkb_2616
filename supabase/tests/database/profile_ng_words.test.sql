-- 20261028030000_profile_ng_words.sql を確かめる。名前に入れられない言葉（app-24）を、保存の関数でも断る。
-- 流し方：npx supabase test db
begin;
select plan(9);

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true);
end $$;

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e1', 'e@example.test');
insert into public.games (id, name) values (9201, 'Hotline Miami');

select pg_temp.as_user('00000000-0000-0000-0000-0000000000e1');
select is(public.save_profile(gen_random_uuid(), '{"nickname": "イー"}')->>'ok', 'true', '入れられない言葉の無い名前は保存できる');

select is(public.save_profile(gen_random_uuid(), '{"nickname": "LINEはこちら"}')->>'reason', 'ng_word',
  'ニックネームに入れられない言葉があれば断る（大文字でも）');
select is(public.save_profile(gen_random_uuid(), '{"nickname": "イー", "hobbies": [{"name": "連絡は@まで", "heat": 3}]}')->>'reason', 'ng_word',
  '趣味の名前も確かめる');
select is(public.save_profile(gen_random_uuid(), '{"nickname": "イー", "likes": [{"name": "http://example.test", "locked": true}]}')->>'reason', 'ng_word',
  '鍵をかけた好きなものの名前も確かめる');
select is(public.save_profile(gen_random_uuid(), '{"nickname": "イー", "games": [{"name": "insta仲間", "platform": "その他", "heat": 1, "skill": 1}]}')->>'reason', 'ng_word',
  '自分で足したゲームの名前も確かめる');
select is((select nickname from public.profiles where id = '00000000-0000-0000-0000-0000000000e1'), 'イー',
  '断ったときは、何も保存しない');

select is(public.save_profile(gen_random_uuid(), '{"nickname": "イー", "games": [
  {"game_id": 9201, "name": "Hotline Miami", "platform": "PC（Steam）", "heat": 3, "skill": 5},
  {"steam_app_id": 4000, "name": "Online Party", "platform": "PC（Steam）", "heat": 3, "skill": 5}
]}')->>'ok', 'true', 'IGDB や Steam から来たゲームの名前は確かめない');

select is(public.set_app_id(gen_random_uuid(), 'line_me')->>'reason', 'ng_word', 'アプリIDも確かめる');
select is(public.set_app_id(gen_random_uuid(), 'e_san')->>'ok', 'true', '入れられない言葉の無いアプリIDは使える');

select * from finish();
rollback;
