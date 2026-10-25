import { IntegrationError } from './http.ts';
import type { Principal } from './linking.ts';
import type { SteamLibrary } from './steam.ts';

export type SteamAuthIdentity = { provider: string; identity_data?: Record<string, unknown> };
export interface OwnSteamPort {
  identities(userId: string): Promise<SteamAuthIdentity[]>;
  linkedSteamId(userId: string): Promise<string | null>;
  ownedGames(steamId: string): Promise<SteamLibrary>;
}

// The caller supplies only the server-verified principal, never a requested SteamID.
// identity_data is read from Auth on the server; editable user_metadata is not used.
export async function readOwnSteamLibrary(principal: Principal, port: OwnSteamPort): Promise<SteamLibrary | null> {
  if (principal.kind !== 'registered' || !principal.userId || !principal.sessionId) throw new IntegrationError('unauthorized');
  const identities = await port.identities(principal.userId);
  const ids = [...new Set(identities.filter(identity => identity.provider === 'custom:steam')
    .map(identity => identity.identity_data?.sub).filter((id): id is string => typeof id === 'string' && /^[0-9]{17}$/.test(id)))];
  if (ids.length > 1) throw new IntegrationError('invalid_payload');
  const id = ids[0] ?? await port.linkedSteamId(principal.userId);
  if (id === null) return null;
  if (!/^[0-9]{17}$/.test(id)) throw new IntegrationError('invalid_payload');
  return port.ownedGames(id);
}
