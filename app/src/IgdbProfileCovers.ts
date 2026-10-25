import { useContext, useEffect, useReducer, useState } from 'react';
import { GameCatalogContext } from './GameCatalog';
import type { MyGame } from './data';

export function useIgdbProfileCovers(games: MyGame[]) {
  const catalog = useContext(GameCatalogContext);
  const ids = JSON.stringify([...new Set(games.flatMap(g => g.igdb ? [g.igdb.id] : []))].sort((a, b) => a - b));
  const [attempt, retry] = useReducer(n => n + 1, 0);
  const [result, setResult] = useState<{ ids: string; catalog: typeof catalog; attempt: number; covers: Record<number, string>; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if (catalog && ids !== '[]') void (async () => {
      const covers: Record<number, string> = {};
      let failed = false;
      for (const id of JSON.parse(ids) as number[]) {
        if (!active) return;
        try {
          const game = (await catalog.get(id)).find(game => game.id === id);
          if (game?.coverUrl) covers[id] = game.coverUrl.replace('/t_thumb/', '/t_cover_big/');
        } catch { failed = true; }
        if (active) setResult({ ids, catalog, attempt, covers: { ...covers }, failed });
      }
    })();
    return () => { active = false; };
  }, [ids, catalog, attempt]);
  const current = result?.ids === ids && result.catalog === catalog && result.attempt === attempt ? result : null;
  return { covers: current?.covers ?? {}, failed: current?.failed ?? false, retry };
}
