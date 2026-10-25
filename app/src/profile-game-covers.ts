import type { SteamCover } from '../../packages/integrations/src/igdb';
export type ReadProfileCovers = (appIds: number[]) => Promise<SteamCover[]>;

// A reader-scoped cache coalesces requests across remounts. Failures are never cached.
export function createProfileCoverReader(fetchBatch: ReadProfileCovers, now = Date.now): ReadProfileCovers {
  const cache = new Map<number, { value: SteamCover | null; expires: number }>();
  let queue: Promise<unknown> = Promise.resolve();
  return ids => {
    const run = queue.then(async () => {
      const unique = [...new Set(ids)];
      const missing = unique.filter(id => (cache.get(id)?.expires ?? 0) <= now());
      for (let offset = 0; offset < missing.length; offset += 50) {
        const batch = missing.slice(offset, offset + 50);
        const covers = await fetchBatch(batch);
        for (const id of batch) cache.set(id, { value: covers.find(c => c.appId === id) ?? null, expires: now() + 60 * 60 * 1000 });
      }
      return unique.flatMap(id => cache.get(id)?.value ? [cache.get(id)!.value!] : []);
    });
    queue = run.catch(() => {});
    return run;
  };
}
