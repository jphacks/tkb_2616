import { createContext, useContext, useEffect, useReducer, useState } from 'react';
import type { SteamCover } from '../../packages/integrations/src/igdb';
import type { ReadProfileCovers } from './profile-game-covers';
import type { MyGame } from './data';

export const ProfileCoverReader = createContext<ReadProfileCovers | undefined>(undefined);
export function useProfileCovers(games: MyGame[]) {
  const read = useContext(ProfileCoverReader);
  const ids = JSON.stringify([...new Set(games.flatMap(game => game.steam?.appId ? [game.steam.appId] : []))].sort((a, b) => a - b));
  const [attempt, retry] = useReducer(value => value + 1, 0);
  const [result, setResult] = useState<{ ids: string; read: typeof read; attempt: number; covers: SteamCover[]; failed: boolean } | null>(null);
  useEffect(() => {
    let active = true;
    if (read && ids !== '[]') void read(JSON.parse(ids)).then(
      covers => { if (active) setResult({ ids, read, attempt, covers, failed: false }); },
      () => { if (active) setResult({ ids, read, attempt, covers: [], failed: true }); },
    );
    return () => { active = false; };
  }, [read, ids, attempt]);
  // Results from an old profile or reader must not render while a new request is pending.
  const current = result?.ids === ids && result.read === read && result.attempt === attempt ? result : null;
  return { covers: current?.covers ?? [], failed: current?.failed ?? false, retry };
}
