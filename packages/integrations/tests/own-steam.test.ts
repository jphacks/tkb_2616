import test from 'node:test';
import assert from 'node:assert/strict';
import { readOwnSteamLibrary, type OwnSteamPort } from '../src/own-steam.js';
import type { SteamLibrary } from '../src/steam.js';

const principal = { userId: 'user-a', sessionId: 'session-a', kind: 'registered' as const };
const ownId = '76561198000000001';
const otherId = '76561198000000002';
const library: SteamLibrary = { status: 'available', source: 'steam', fetchedAt: '2026-10-25T04:00:00Z', games: [
  { appId: 268910, name: 'Cuphead', playtimeMinutes: 630, recentPlaytimeMinutes: null },
] };
const port = (overrides: Partial<OwnSteamPort> = {}): OwnSteamPort => ({
  identities: async userId => { assert.equal(userId, principal.userId); return [{ provider: 'custom:steam', identity_data: { sub: ownId } }]; },
  linkedSteamId: async () => { throw new Error('Login identity must take precedence'); },
  ownedGames: async id => { assert.equal(id, ownId); return library; },
  ...overrides,
});

test('Steam library is selected by the server Auth identity for the verified principal', async () => {
  assert.deepEqual(await readOwnSteamLibrary(principal, port()), library);
});

test('a non-Steam identity cannot claim a SteamID; linked lookup remains scoped to the principal', async () => {
  const result = await readOwnSteamLibrary(principal, port({
    identities: async () => [{ provider: 'google', identity_data: { sub: otherId } }],
    linkedSteamId: async userId => { assert.equal(userId, principal.userId); return ownId; },
  }));
  assert.deepEqual(result, library);
});

test('users without a Steam identity or link do not trigger a Steam request', async () => {
  assert.equal(await readOwnSteamLibrary(principal, port({
    identities: async () => [], linkedSteamId: async () => null,
    ownedGames: async () => { throw new Error('Must not fetch'); },
  })), null);
});

test('ambiguous Steam identities and invalid linked IDs cannot select an arbitrary library', async () => {
  await assert.rejects(readOwnSteamLibrary(principal, port({ identities: async () => [ownId, otherId].map(sub => ({ provider: 'custom:steam', identity_data: { sub } })) })), /invalid_payload/);
  await assert.rejects(readOwnSteamLibrary(principal, port({ identities: async () => [], linkedSteamId: async () => 'bad' })), /invalid_payload/);
});

test('unregistered callers cannot resolve identities and API failures are not fabricated as empty libraries', async () => {
  await assert.rejects(readOwnSteamLibrary({ ...principal, sessionId: '' }, port({ identities: async () => { throw new Error('Must not read Auth'); } })), /unauthorized/);
  await assert.rejects(readOwnSteamLibrary(principal, port({ ownedGames: async () => { throw new Error('Steam unavailable'); } })), /Steam unavailable/);
});

test('private Steam data remains unavailable instead of becoming an empty successful library', async () => {
  const unavailable: SteamLibrary = { status: 'unavailable', source: 'steam', reason: 'not_visible_or_missing' };
  assert.deepEqual(await readOwnSteamLibrary(principal, port({ ownedGames: async () => unavailable })), unavailable);
});

