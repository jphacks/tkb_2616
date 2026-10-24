import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

test('Recruiters see submitted IDs before approval, while other users and finished recruitments cannot', async () => {
  const db = new PGlite();
  const owner = randomUUID(), named = randomUUID(), unnamed = randomUUID(), stranger = randomUUID();
  const asUser = async (id: string | null) => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify(id ? { sub: id, role: 'authenticated' } : { role: 'anon' })]);
    await db.exec(`set role ${id ? 'authenticated' : 'anon'}`);
  };
  const ids = async () => (await db.query<{ game_account_id: string }>('select game_account_id from public.application_game_ids order by game_account_id')).rows.map(row => row.game_account_id);
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$
        select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      create publication supabase_realtime;`);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(file, dir), 'utf8'));
    }
    await db.exec(await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
    await db.query('insert into auth.users(id) values ($1),($2),($3),($4)', [owner, named, unnamed, stranger]);
    await asUser(named);
    await db.query("select public.update_profile($1, '名前あり')", [randomUUID()]);
    await asUser(owner);
    const publish = async () => (await db.query<{ result: { recruitment_id: string } }>(
      "select public.publish_recruitment($1, -1, true, p_capacity => 1) as result", [randomUUID()])).rows[0]!.result.recruitment_id;
    const recruitment = await publish();
    await asUser(named);
    await db.query("select public.apply_to_recruitment($1, $2, 'NAMED01')", [randomUUID(), recruitment]);
    await asUser(unnamed);
    await db.query("select public.apply_to_recruitment($1, $2, 'UNNAMED01')", [randomUUID(), recruitment]);
    assert.deepEqual(await ids(), ['UNNAMED01']);
    await asUser(named);
    assert.deepEqual(await ids(), ['NAMED01']);
    await asUser(stranger);
    assert.deepEqual(await ids(), []);
    await asUser(null);
    assert.deepEqual(await ids(), []);
    await asUser(owner);
    assert.deepEqual(await ids(), ['NAMED01', 'UNNAMED01']);
    const application = (await db.query<{ id: string }>('select id from public.applications where applicant_id = $1', [named])).rows[0]!.id;
    await db.query('select public.approve_application($1, $2)', [randomUUID(), application]);
    assert.deepEqual(await ids(), ['NAMED01']); // full: the other pending application has ended
    await db.query("select public.change_recruitment($1, $2, 'end_play')", [randomUUID(), recruitment]);
    assert.deepEqual(await ids(), []);
    await asUser(named);
    assert.deepEqual(await ids(), []);

    await asUser(owner);
    const canceled = await publish();
    await asUser(named);
    await db.query("select public.apply_to_recruitment($1, $2, 'CANCELED01')", [randomUUID(), canceled]);
    await asUser(owner);
    assert.deepEqual(await ids(), ['CANCELED01']);
    await db.query("select public.change_recruitment($1, $2, 'cancel')", [randomUUID(), canceled]);
    assert.deepEqual(await ids(), []);
    await asUser(named);
    assert.deepEqual(await ids(), []);
  } finally { await db.close(); }
});
