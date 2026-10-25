import test from 'node:test';
import assert from 'node:assert/strict';
import { createProfileCoverReader } from '../app/src/profile-game-covers.ts';

test('all games beyond the first batch are resolved and repeat requests share cached results', async () => {
  const batches: number[][] = [];
  let now = 1;
  const read = createProfileCoverReader(async ids => { batches.push(ids); return ids.map(appId => ({ appId, gameId: appId, imageUrl: `https://images.igdb.com/${appId}.jpg`, sourceUrl: 'https://www.igdb.com/' })); }, () => now);
  const ids = Array.from({ length: 121 }, (_, i) => i + 1);
  const [a, b] = await Promise.all([read(ids), read(ids)]);
  assert.equal(a.length, 121); assert.deepEqual(a, b);
  assert.deepEqual(batches.map(x => x.length), [50, 50, 21]);
  now += 3_600_001;
  await read([1]);
  assert.equal(batches.length, 4);
});
test('failed lookup can retry; missing images are cached without inventing a cover', async () => {
  let calls = 0;
  const read = createProfileCoverReader(async () => { if (++calls === 1) throw new Error('offline'); return []; });
  await assert.rejects(read([99]), /offline/);
  assert.deepEqual(await read([99]), []);
  assert.deepEqual(await read([99]), []);
  assert.equal(calls, 2);
});
