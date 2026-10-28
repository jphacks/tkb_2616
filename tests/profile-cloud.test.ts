import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAMES } from '../app/src/data.ts';
import {
  ProfileSaveError, createCloudProfileRepository, fromCloudProfile, toCloudProfile, type CloudProfile, type CloudProfileDeps,
} from '../src/lib/profile-cloud.ts';

const cloud: CloudProfile = {
  app_id: 'yu_7', nickname: 'ゆう', region: '関東', usual_time_start: '21:00', usual_time_end: '24:00', color: '#6c5cf0',
  games: [
    { game_id: 1905, steam_app_id: null, name: 'Fortnite', platform: 'PC（Steam）', heat: 5, skill: 7, cover_image_id: 'abc' },
    { game_id: null, steam_app_id: 570, name: 'Dota 2', platform: 'PC（Steam）', heat: 1, skill: 3 },
    { game_id: null, steam_app_id: null, name: '自作のゲーム', platform: 'その他', heat: 3, skill: 5 },
  ],
  hobbies: [{ name: 'カフェ巡り', heat: 4 }],
  likes: [{ name: 'ボカロ', locked: false }, { name: '推し', locked: true }],
};

test('database profiles become screen profiles: heat 1..5 to 0..4, tags registered, locks kept', () => {
  const p = fromCloudProfile(cloud);
  assert.deepEqual(p.games.map(g => [g.tag, g.heat]), [['igdb:1905', 4], ['steam:570', 0], ['custom:自作のゲーム', 2]]);
  assert.equal(GAMES['igdb:1905']?.name, 'Fortnite');
  assert.equal(GAMES['steam:570']?.name, 'Dota 2');
  assert.deepEqual(p.games[1]!.steam, { appId: 570, name: 'Dota 2', hours: null, updated: '' });
  assert.deepEqual(p.likes, [{ name: 'ボカロ' }, { name: '推し', locked: true }]);
  assert.deepEqual(p.times, { start: '21:00', end: '24:00' });
});

test('an empty account starts with an empty profile, not the demo person', () => {
  const p = fromCloudProfile({ app_id: null, nickname: null, region: null, usual_time_start: null, usual_time_end: null, color: null, games: [], hobbies: [], likes: [] });
  assert.equal(p.nickname, '');
  assert.equal(p.appId, '');
  assert.equal(p.region, '選択しない');
  assert.deepEqual([p.games, p.hobbies, p.likes], [[], [], []]);
});

test('screen profiles are sent back in the database shape without Steam playtime', () => {
  const p = fromCloudProfile(cloud);
  p.games[1]!.steam!.hours = 1234;
  p.region = '選択しない';
  p.times = { start: '', end: '' };
  const sent = toCloudProfile(p);
  assert.deepEqual(sent.games, [
    { game_id: 1905, steam_app_id: null, name: 'Fortnite', platform: 'PC（Steam）', heat: 5, skill: 7 },
    { game_id: null, steam_app_id: 570, name: 'Dota 2', platform: 'PC（Steam）', heat: 1, skill: 3 },
    { game_id: null, steam_app_id: null, name: '自作のゲーム', platform: 'その他', heat: 3, skill: 5 },
  ]);
  assert.equal(JSON.stringify(sent).includes('1234'), false);
  assert.equal(sent.region, null);
  assert.equal(sent.usual_time_start, null);
  assert.deepEqual(sent.likes, [{ name: 'ボカロ', locked: false }, { name: '推し', locked: true }]);
});

function fake(responses: Record<string, unknown[]>) {
  const calls: { name: string; args?: Record<string, unknown> }[] = [];
  const saved: number[] = [];
  const store = new Map<string, string>();
  let op = 0;
  const deps: CloudProfileDeps = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      const queue = responses[name] ?? [];
      return { data: queue.length > 1 ? queue.shift() : queue[0], error: null, status: 200 };
    },
    storage: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } },
    saveGame: async id => { saved.push(id); },
    newOpId: () => `op-${++op}`,
  };
  return { deps, calls, saved, store };
}

test('saving stores new IGDB games first, then the whole profile, and keeps the assigned app ID', async () => {
  const f = fake({ my_profile: [{ ...cloud, app_id: null }], save_profile: [{ ok: true, app_id: 'a1b2c3d4' }] });
  const repo = createCloudProfileRepository('user-1', f.deps);
  assert.equal(repo.target, 'account');
  await repo.load();
  const after = await repo.edit(p => {
    p.games.push({ tag: 'igdb:7346', igdb: { id: 7346, name: 'ゼルダの伝説' }, platform: 'Switch', heat: 2, skill: 4 });
  });
  assert.deepEqual(f.saved, [7346], 'only the game that is not yet in the database is saved');
  assert.deepEqual(f.calls.map(c => c.name), ['my_profile', 'save_profile'], 'no app ID change, so no set_app_id');
  assert.equal(after.appId, 'a1b2c3d4');
  assert.equal((f.calls[1]!.args!.p_profile as { games: unknown[] }).games.length, 4);
});

test('a changed app ID is checked first; a taken ID saves nothing and explains why', async () => {
  const f = fake({ my_profile: [cloud], set_app_id: [{ ok: false, reason: 'app_id_taken' }] });
  const repo = createCloudProfileRepository('user-1', f.deps);
  await repo.load();
  await assert.rejects(repo.edit(p => { p.appId = 'Taken_ID'; p.nickname = '変えた名前'; }),
    (e: unknown) => e instanceof ProfileSaveError && e.userMessage === 'そのアプリIDは、ほかの人が使っています');
  assert.deepEqual(f.calls.map(c => c.name), ['my_profile', 'set_app_id']);
  assert.equal(f.calls[1]!.args!.p_app_id, 'taken_id', 'app IDs are sent in lower case');
  const again = await repo.load();
  assert.equal(again.nickname, 'ゆう');
});

test('Steam playtime survives a reload on this device even though the database does not keep it', async () => {
  const f = fake({ my_profile: [cloud], save_profile: [{ ok: true, app_id: 'yu_7' }] });
  const repo = createCloudProfileRepository('user-1', f.deps);
  await repo.load();
  await repo.edit(p => { p.games[1]!.steam = { appId: 570, name: 'Dota 2', hours: 88.5, updated: '今日 9:00' }; p.steamImportedAppIds = [570]; });
  const reloaded = await createCloudProfileRepository('user-1', f.deps).load();
  assert.equal(reloaded.games[1]!.steam!.hours, 88.5);
  assert.deepEqual(reloaded.steamImportedAppIds, [570]);
  const other = await createCloudProfileRepository('user-2', f.deps).load();
  assert.equal(other.games[1]!.steam!.hours, null, "another account's playtime is not mixed in");
});

test('a refused save keeps the last saved profile', async () => {
  const f = fake({ my_profile: [cloud], save_profile: [{ ok: false, reason: 'profile_invalid' }] });
  const repo = createCloudProfileRepository('user-1', f.deps);
  await repo.load();
  await assert.rejects(repo.edit(p => { p.games[0]!.skill = 99; }), ProfileSaveError);
  const next = await repo.edit(p => { p.nickname = 'もう一度'; }).catch(() => null);
  assert.equal(next, null);
  assert.equal((f.calls.at(-1)!.args!.p_profile as { games: { skill: number }[] }).games[0]!.skill, 7, 'the refused change was not kept');
});
