import type { GameCatalog } from '../../app/src/game-catalog';
import { searchGames, getGameCandidate } from './games';
import type { GameCandidate } from '../../packages/integrations/src/igdb';

export const cloudGameCatalog: GameCatalog = {
  search: async query => (await searchGames(query, 12)).games,
  get: async id => (await getGameCandidate(id)).games,
};
async function localGames(params: string): Promise<GameCandidate[]> {
  const response = await fetch(`/__local/games?${params}`);
  if (!response.ok) throw new Error('ゲーム情報を取得できませんでした');
  const data = await response.json();
  if (!Array.isArray(data.games)) throw new Error('ゲーム情報を確認できませんでした');
  return data.games;
}
export const localGameCatalog: GameCatalog = {
  search: query => localGames(`query=${encodeURIComponent(query)}`),
  get: id => localGames(`id=${id}`),
};
