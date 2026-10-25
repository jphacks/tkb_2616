import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localAppServer } from '../scripts/serve-local.mjs';

test('integrated server serves the main build and callbacks, never source files or foreign origins', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shumitomo-server-'));
  await writeFile(join(directory, 'index.html'), '<html>Main app</html>');
  await writeFile(join(directory, '.env'), 'server-only-secret');
  const server = localAppServer({ directory, steam: async (req, res, url) => { if (url.pathname !== '/__steam/status.json') return false; res.writeHead(200).end('{}'); return true; } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/auth/callback', '/auth/link-callback']) assert.match(await (await fetch(base + path)).text(), /Main app/);
    assert.deepEqual(await (await fetch(base + '/__local/status.json')).json(), { mode: 'local-integrations' });
    assert.equal((await fetch(base + '/__steam/status.json', { headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.equal((await fetch(base + '/__steam/status.json')).status, 200);
    for (const path of ['/.env', '/packages/integrations/.env', '/assets/%2e%2e/.env']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
});

test('profile covers use requested Steam IDs and distinguish missing matches from API failures', async () => {
  const requests = [];
  const cover = { appId: 42, gameId: 9, imageUrl: 'https://images.igdb.com/igdb/image/upload/t_cover_big/example.jpg', sourceUrl: 'https://www.igdb.com/games/example' };
  const server = localAppServer({ directory: '/unused', covers: async ids => {
    requests.push(ids);
    if (ids.includes(500)) throw new Error('IGDB unavailable');
    return ids.includes(42) ? [cover] : [];
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__local/covers`;
  try {
    assert.deepEqual(await (await fetch(base + '?ids=42,43')).json(), { covers: [cover] });
    assert.deepEqual(await (await fetch(base + '?ids=99')).json(), { covers: [] });
    assert.equal((await fetch(base + '?ids=500')).status, 502);
    for (const query of ['', '?ids=0', '?ids=42,NaN', '?ids=' + Array(51).fill('42').join(',')]) assert.equal((await fetch(base + query)).status, 400);
    assert.deepEqual(requests, [[42, 43], [99], [500]]);
    assert.equal((await fetch(base + '?ids=42', { headers: { Origin: 'https://foreign.example' } })).status, 403);
  } finally { await new Promise(resolve => server.close(resolve)); }
});


test('catalog supports non-Steam search and exact IGDB lookup, with explicit failures', async () => {
  const candidate = { id: 900001, name: 'Console game', coverUrl: null, platforms: [{ id: 130, name: 'Nintendo Switch' }] };
  const calls = [];
  const server = localAppServer({ directory: '/unused', games: {
    async search(query, limit) { calls.push([query, limit]); if (query === 'fail') throw Error(); return [candidate]; },
    async get(id) { calls.push(id); return id === candidate.id ? [candidate] : []; },
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/__local/games`;
  try {
    assert.deepEqual(await (await fetch(base + '?query=Console')).json(), { games: [candidate] });
    assert.deepEqual(await (await fetch(base + '?id=900001')).json(), { games: [candidate] });
    assert.deepEqual(await (await fetch(base + '?id=900002')).json(), { games: [] });
    assert.equal((await fetch(base + '?query=fail')).status, 502);
    for (const query of ['', '?id=0', '?id=1.5', '?id=9007199254740992', '?query=' + 'a'.repeat(101)]) assert.equal((await fetch(base + query)).status, 400);
    assert.equal((await fetch(base + '?query=x', { headers: { Origin: 'https://foreign.example' } })).status, 403);
    assert.deepEqual(calls, [['Console', 12], 900001, 900002, ['fail', 12]]);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const unconfigured = localAppServer({ directory: '/unused' });
  await new Promise(resolve => unconfigured.listen(0, '127.0.0.1', resolve));
  try { assert.equal((await fetch(`http://127.0.0.1:${unconfigured.address().port}/__local/games?query=x`)).status, 503); }
  finally { await new Promise(resolve => unconfigured.close(resolve)); }
});
