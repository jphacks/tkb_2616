import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

type Result = { ok: boolean; reason?: string; recruitment_id?: string; request_id?: string; already?: boolean };
type Connection = { peer_id: string; nickname: string; game_id: number; game_name: string; created_at: string };
const migrations = new URL('../supabase/migrations/', import.meta.url);

// SQL/RLS only, in memory. Does not connect to a team project or claim to test Realtime transport.
async function fixture(withFriends = true) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create function auth.uid() returns uuid language sql stable as $$
      select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    create publication supabase_realtime;`);
  const files = (await readdir(migrations)).filter(f => f.endsWith('.sql')).sort();
  const friendMigration = files.find(f => f.endsWith('_friend_recruitment.sql'))!;
  for (const f of files) if (withFriends || f !== friendMigration) await db.exec(await readFile(new URL(f, migrations), 'utf8'));
  await db.exec(await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
  const owner = randomUUID(), sender = randomUUID(), other = randomUUID();
  await db.query('insert into auth.users(id) values ($1),($2),($3)', [owner, sender, other]);
  await db.query(`update public.profiles set nickname='original profile', app_id='untouched' where id=$1`, [owner]);
  const asUser = async (id: string | null) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(id ? { sub: id, role: 'authenticated' } : { role: 'anon' })]);
    await db.exec(`set role ${id ? 'authenticated' : 'anon'}`);
  };
  const rpc = async (sql: string, args: unknown[] = []) => (await db.query<{ result: Result }>(`select ${sql} as result`, args)).rows[0]!.result;
  const publish = (name = '募集者', op = randomUUID(), from = '21:00', to = '24:00') =>
    rpc('public.publish_friend_recruitment($1,-1,$2,$3,6,3,$4,$5)', [op, name, 'PC（Steam）', from, to]);
  const connections = async () => (await db.query<Connection>('select * from public.friend_connections()')).rows;
  return { db, owner, sender, other, asUser, rpc, publish, connections, friendMigration };
}

test('Friend recruitment persists both sides, deduplicates requests/acceptance and isolates RLS', async () => {
  const f = await fixture();
  const { db, owner, sender, other, asUser, rpc, publish, connections } = f;
  try {
    await asUser(owner);
    const publishOp = randomUUID();
    const recruit = await publish('公開名', publishOp);
    assert.equal(recruit.ok, true);
    assert.deepEqual(await publish('公開名', publishOp), recruit);
    assert.equal((await publish('別の入力', publishOp)).reason, 'operation_conflict');
    const r = recruit.recruitment_id!;
    assert.equal((await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), r, '本人'])).reason, 'own_recruitment');
    await asUser(null);
    assert.equal((await db.query('select * from public.friend_recruitments')).rows.length, 1);
    await assert.rejects(db.query('select * from public.friend_requests'));
    await asUser(sender);
    const op = randomUUID();
    const request = await rpc('public.request_friendship($1,$2,$3)', [op, r, '申請した名前']);
    assert.equal(request.ok, true);
    assert.deepEqual(await rpc('public.request_friendship($1,$2,$3)', [op, r, '申請した名前']), request);
    assert.equal((await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), r, '二重申請'])).request_id, request.request_id);
    assert.equal((await db.query('select * from public.friend_requests')).rows.length, 1);
    assert.equal((await rpc('public.accept_friend_request($1,$2)', [randomUUID(), request.request_id])).reason, 'not_recipient');
    assert.equal((await rpc('public.close_friend_recruitment($1,$2)', [randomUUID(), r])).reason, 'not_owner');
    assert.deepEqual(await connections(), []);
    await asUser(other);
    assert.deepEqual((await db.query('select * from public.friend_requests')).rows, []);
    assert.equal((await rpc('public.accept_friend_request($1,$2)', [randomUUID(), request.request_id])).reason, 'not_recipient');
    await asUser(owner);
    assert.equal((await db.query('select * from public.friend_requests')).rows.length, 1);
    const acceptOp = randomUUID();
    assert.equal((await rpc('public.accept_friend_request($1,$2)', [acceptOp, request.request_id])).ok, true);
    assert.equal((await rpc('public.accept_friend_request($1,$2)', [acceptOp, request.request_id])).ok, true);
    assert.equal((await rpc('public.accept_friend_request($1,$2)', [randomUUID(), request.request_id])).already, true);
    const ownConnections = await connections();
    assert.equal(ownConnections.length, 1);
    assert.equal(ownConnections[0]!.peer_id, sender);
    assert.equal(ownConnections[0]!.nickname, '申請した名前');
    assert.deepEqual(Object.keys(ownConnections[0]!).sort(), ['created_at','game_id','game_name','nickname','peer_id']);
    await asUser(sender); // A fresh user/session reads the shared DB, never local profile state.
    const senderConnections = await connections();
    assert.equal(senderConnections[0]!.peer_id, owner);
    assert.equal(senderConnections[0]!.nickname, '公開名');
    assert.deepEqual(senderConnections[0]!.created_at, ownConnections[0]!.created_at);
    assert.equal((await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), r, '申請者'])).reason, 'already_friends');
    await asUser(other);
    assert.deepEqual(await connections(), []);
    assert.deepEqual((await db.query('select * from public.friendships')).rows, []);
    await rpc('public.remove_friendship($1,$2)', [randomUUID(), owner]);
    await asUser(sender);
    assert.equal((await connections()).length, 1, 'A third party cannot remove someone else’s pair');
    const p = (await db.query<{ nickname: string; app_id: string }>('select nickname,app_id from public.profiles where id=$1', [owner])).rows[0]!;
    assert.deepEqual(p, { nickname: 'original profile', app_id: 'untouched' });
  } finally { await db.close(); }
});

test('Closed recruitment accepts existing requests; removing a pair allows a new request without reviving old approvals', async () => {
  const { db, owner, sender, other, asUser, rpc, publish, connections } = await fixture();
  try {
    await asUser(owner);
    const r = (await publish()).recruitment_id!;
    await asUser(sender);
    const q = (await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), r, '相手'])).request_id!;
    // The other direction finds the same pending request instead of auto-accepting it.
    const reverseR = (await publish('逆方向の募集')).recruitment_id!;
    await asUser(owner);
    const reverse = await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), reverseR, '本人']);
    assert.equal(reverse.request_id, q);
    assert.deepEqual(await connections(), []);
    const closeOp = randomUUID();
    assert.equal((await rpc('public.close_friend_recruitment($1,$2)', [closeOp, r])).ok, true);
    const closed = (await db.query<{ closed_at: string }>('select closed_at from public.friend_recruitments where id=$1', [r])).rows[0]!.closed_at;
    await rpc('public.close_friend_recruitment($1,$2)', [randomUUID(), r]);
    assert.deepEqual((await db.query<{ closed_at: string }>('select closed_at from public.friend_recruitments where id=$1', [r])).rows[0]!.closed_at, closed);
    await asUser(other);
    assert.equal((await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), r, '新しい申請'])).reason, 'not_accepting');
    await asUser(owner);
    assert.equal((await rpc('public.accept_friend_request($1,$2)', [randomUUID(), q])).ok, true);
    assert.equal((await connections()).length, 1);
    const removeOp = randomUUID();
    await rpc('public.remove_friendship($1,$2)', [removeOp, sender]);
    await rpc('public.remove_friendship($1,$2)', [removeOp, sender]);
    assert.deepEqual(await connections(), []);
    await rpc('public.accept_friend_request($1,$2)', [randomUUID(), q]);
    assert.deepEqual(await connections(), [], 'A historical accepted request must not re-add a removed friend');
    const newR = (await publish('新しい募集')).recruitment_id!;
    await asUser(sender);
    assert.deepEqual(await connections(), []);
    const newQ = (await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), newR, '申請し直す名前'])).request_id!;
    assert.notEqual(newQ, q);
    await asUser(owner);
    await rpc('public.accept_friend_request($1,$2)', [randomUUID(), newQ]);
    assert.equal((await connections())[0]!.nickname, '申請し直す名前');
    assert.equal((await db.query('select * from public.friendships')).rows.length, 1);
  } finally { await db.close(); }
});

test('Friend RPC validation, public permissions and fixed search_path hold at the database boundary', async () => {
  const { db, owner, asUser, rpc, publish } = await fixture();
  try {
    await asUser(owner);
    for (const args of [
      [-1,'','PC',6,3,'21:00','24:00'], [-1,'名前','',6,3,'21:00','24:00'],
      [-1,'名前','PC',0,3,'21:00','24:00'], [-1,'名前','PC',10,3,'21:00','24:00'],
      [-1,'名前','PC',6,-1,'21:00','24:00'], [-1,'名前','PC',6,5,'21:00','24:00'],
      [-1,'名前','PC',6,3,'24:00','01:00'], [-1,'名前','PC',6,3,'21:60','24:00'],
      [-1,'名前','PC',6,3,'21:00','24:01'], [-1,'名前','PC',null,3,'21:00','24:00'],
    ]) assert.equal((await rpc('public.publish_friend_recruitment($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), ...args])).reason, 'invalid_input');
    assert.equal((await rpc('public.publish_friend_recruitment($1,$2,$3,$4,$5,$6,$7,$8)', [randomUUID(), 9999999,'名前','PC',6,3,'21:00','24:00'])).reason, 'unknown_game');
    assert.equal((await publish('またぎ', randomUUID(), '23:00', '02:00')).ok, true);
    const op = randomUUID();
    const first = await publish('再送', op);
    assert.equal((await rpc('public.close_friend_recruitment($1,$2)', [op, first.recruitment_id])).reason, 'operation_conflict');
    await assert.rejects(db.query("insert into public.friend_recruitments(owner_id,nickname,game_id,platform,skill,enthusiasm,available_from,available_to) values ($1,'bypass',-1,'PC',6,3,'21:00','24:00')", [owner]));
    for (const table of ['friend_recruitments','friend_requests','friendships']) {
      await assert.rejects(db.query(`delete from public.${table}`));
      await assert.rejects(db.query(`update public.${table} set created_at=now()`));
    }
    await db.exec('reset role');
    const functions = (await db.query<{ proname: string; proconfig: string[]; anon: boolean; authenticated: boolean }>(`
      select p.proname,p.proconfig,has_function_privilege('anon',p.oid,'execute') as anon,
        has_function_privilege('authenticated',p.oid,'execute') as authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname in ('publish_friend_recruitment','request_friendship','accept_friend_request','close_friend_recruitment','remove_friendship','friend_connections')`)).rows;
    assert.equal(functions.length, 6);
    for (const fn of functions) {
      assert.equal(fn.anon, false, fn.proname);
      assert.equal(fn.authenticated, true, fn.proname);
      assert.ok(fn.proconfig.some(c => c === 'search_path=""'), fn.proname);
    }
    assert.equal((await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','private.friend_operation(uuid,uuid,text,jsonb)','execute') as allowed")).rows[0]!.allowed, false);
    await asUser(null);
    await assert.rejects(db.query('select * from public.friend_connections()'));
    await assert.rejects(db.query("select public.publish_friend_recruitment($1,-1,'名前','PC',6,3,'21:00','24:00')", [randomUUID()]));
    await db.exec('reset role; set role authenticated');
    await assert.rejects(db.query('select public.remove_friendship($1,$2)', [randomUUID(), owner]), /ログインが要る/);
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: owner, role: 'authenticated', is_anonymous: true })]);
    for (const [sql, args] of [
      ["select public.publish_friend_recruitment($1,-1,'名前','PC',6,3,'21:00','24:00')", [randomUUID()]],
      ["select public.request_friendship($1,$2,'名前')", [randomUUID(), first.recruitment_id]],
      ['select public.accept_friend_request($1,$2)', [randomUUID(), randomUUID()]],
      ['select public.close_friend_recruitment($1,$2)', [randomUUID(), first.recruitment_id]],
      ['select public.remove_friendship($1,$2)', [randomUUID(), owner]],
      ['select * from public.friend_connections()', []],
    ] as [string, unknown[]][]) await assert.rejects(db.query(sql, args), /ログインが要る/);
  } finally { await db.close(); }
});

test('Adding friend recruitment preserves existing profiles, game recruitment, applications and integration data', async () => {
  const { db, owner, sender, asUser, rpc, publish, friendMigration } = await fixture(false);
  const tables = ['profiles','games','recruitments','recruitment_meetings','applications','application_game_ids','notifications'];
  const snapshot = async () => {
    await db.exec('reset role');
    const rows: Record<string, unknown> = {};
    for (const table of tables) rows[table] = (await db.query(`select to_jsonb(t) as row from public.${table} t order by to_jsonb(t)::text`)).rows;
    return rows;
  };
  try {
    await asUser(owner);
    const gameR = (await rpc("public.publish_recruitment($1,-1,true,p_capacity=>1,p_room_code=>'KEEP')", [randomUUID()])).recruitment_id!;
    await asUser(sender);
    const applied = (await db.query<{ result: { application_id: string } }>("select public.apply_to_recruitment($1,$2,'PLAYER') as result", [randomUUID(), gameR])).rows[0]!.result;
    await asUser(owner);
    await rpc('public.approve_application($1,$2)', [randomUUID(), applied.application_id]);
    const before = await snapshot();
    await db.exec(await readFile(new URL(friendMigration, migrations), 'utf8'));
    assert.deepEqual(await snapshot(), before);
    await asUser(owner);
    const fr = (await publish()).recruitment_id!;
    await asUser(sender);
    const fq = (await rpc('public.request_friendship($1,$2,$3)', [randomUUID(), fr, 'フレンド申請'])).request_id!;
    await asUser(owner);
    await rpc('public.accept_friend_request($1,$2)', [randomUUID(), fq]);
    await rpc('public.remove_friendship($1,$2)', [randomUUID(), sender]);
    await rpc('public.close_friend_recruitment($1,$2)', [randomUUID(), fr]);
    assert.deepEqual(await snapshot(), before, 'Friend operations never change game recruitment or profile rows');
    await asUser(sender);
    assert.equal((await db.query<{ room_code: string }>('select room_code from public.recruitment_meetings')).rows[0]!.room_code, 'KEEP');
  } finally { await db.close(); }
});
