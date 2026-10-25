import type { GameCandidate } from '../../packages/integrations/src/igdb';
export type GameCatalog = {
  search: (query: string) => Promise<GameCandidate[]>;
  get: (id: number) => Promise<GameCandidate[]>;
};
