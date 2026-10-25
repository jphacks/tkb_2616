import test from 'node:test';
import assert from 'node:assert/strict';
import { IgdbClient, parseSteamCovers } from '../src/igdb.ts';

const row = (uid: string, id: number, name = 'Steam') => ({ uid, external_game_source: { name }, game: { id, name: 'Any title', slug: `game-${id}`, cover: { url: '//images.igdb.com/igdb/image/upload/t_thumb/cover.jpg' } } });
test('covers resolve by Steam ID, exclude other stores and ambiguous editions', () => {
  const covers = parseSteamCovers([row('42', 1), row('42', 1), row('43', 2, 'GOG'), row('44', 3), row('44', 4), row('45', 5)], [42, 43, 44]);
  assert.deepEqual(covers, [{ appId: 42, gameId: 1, imageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover.jpg', sourceUrl: 'https://www.igdb.com/games/game-1' }]);
});
test('missing and untrusted images stay absent', () => {
  assert.deepEqual(parseSteamCovers([{ ...row('42', 1), game: { id: 1, name: 'Demo', slug: 'demo' } }, { ...row('43', 2), game: { id: 2, name: 'Other', slug: 'other', cover: { url: 'https://example.com/x.jpg' } } }], [42, 43]), []);
});
test('Steam lookup uses external IDs, paginates and rejects invalid batches before network', async () => {
  const queries: string[] = [];
  const client = new IgdbClient({ clientId: 'test', clientSecret: 'test' }, { async acquire() { return { async release() {} }; } }, async (url, init) => {
    if (String(url).includes('oauth2')) return Response.json({ access_token: 'token', expires_in: 3600 });
    assert.equal(String(url), 'https://api.igdb.com/v4/external_games');
    queries.push(String(init?.body));
    return Response.json(queries.length === 1 ? Array.from({ length: 500 }, () => row('42', 1)) : [row('43', 2)]);
  });
  assert.equal((await client.steamCovers([42, 43])).length, 2);
  assert.match(queries[0]!, /external_game_source.name = "Steam" & uid = \("42","43"\)/);
  assert.match(queries[1]!, /offset 500/);
  await assert.rejects(client.steamCovers([NaN]), /invalid_payload/);
  await assert.rejects(client.steamCovers(Array(51).fill(42)), /invalid_payload/);
  assert.equal(queries.length, 2);
});
