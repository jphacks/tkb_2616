import { getSupabase } from './supabase';
import { isSteamLibrary } from '../local/steam-library';
import type { SteamLibrary } from '../../packages/integrations/src/steam';

export async function ownSteamLibrary(signal?: AbortSignal): Promise<SteamLibrary | null> {
  const client = getSupabase();
  if (!client) return null;
  const { data, error } = await client.functions.invoke('integration-api', { body: { action: 'steam-library' }, signal });
  if (error) throw new Error('Steamのゲーム情報を取得できませんでした。');
  if (data?.library === null) return null;
  if (!isSteamLibrary(data?.library)) throw new Error('Steamの取得データを確認できませんでした。');
  return data.library;
}
