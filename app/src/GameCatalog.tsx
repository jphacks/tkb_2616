import { createContext } from 'react';
import type { GameCatalog } from './game-catalog';
export const GameCatalogContext = createContext<GameCatalog | undefined>(undefined);
