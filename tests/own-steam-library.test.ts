import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileRepository, type ProfileStorage } from '../app/src/profile-storage.ts';
import { importSteamGames } from '../app/src/steam-profile-import.ts';
import type { SteamLibrary } from '../packages/integrations/src/steam.ts';
const library: SteamLibrary = { status: 'available', source: 'steam', fetchedAt: '2026-10-25T04:00:00Z', games: [
  { appId: 268910, name: 'Cuphead', playtimeMinutes: 630, recentPlaytimeMinutes: null },
] };

test('profile libraries, choices and reset stay separate for accounts on the same browser', async () => {
  const values = new Map<string, string>();
  const storage: ProfileStorage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async key => { values.delete(key); } };
  const a = createProfileRepository(storage, 'profile:user-a');
  const b = createProfileRepository(storage, 'profile:user-b');
  await a.load(); await b.load();
  await a.edit(profile => { importSteamGames(profile, library); profile.games[0]!.skill = 9; });
  await b.edit(profile => { profile.nickname = 'B'; });
  const restoredA = await createProfileRepository(storage, 'profile:user-a').load();
  const restoredB = await createProfileRepository(storage, 'profile:user-b').load();
  assert.equal(restoredA.games[0]?.steam?.appId, 268910);
  assert.equal(restoredA.games[0]?.skill, 9);
  assert.equal(restoredB.games.some(game => game.steam?.appId), false);
  await a.reset();
  assert.equal((await createProfileRepository(storage, 'profile:user-b').load()).nickname, 'B');
});
