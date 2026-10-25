import { getSupabase } from './supabase';
import { createProfileCoverReader } from '../../app/src/profile-game-covers';

export const cloudProfileCovers = createProfileCoverReader(async steamAppIds => {
  const client = getSupabase();
  if (!client) return [];
  const { data, error } = await client.functions.invoke('igdb-search', { body: { steamAppIds } });
  if (error || !Array.isArray(data?.covers)) throw new Error('ゲーム画像を取得できませんでした');
  return data.covers;
});
export const localProfileCovers = createProfileCoverReader(async steamAppIds => {
  const response = await fetch(`/__local/covers?ids=${steamAppIds.join(',')}`);
  if (!response.ok) throw new Error('ゲーム画像を取得できませんでした');
  const data = await response.json();
  if (!Array.isArray(data?.covers)) throw new Error('ゲーム画像を確認できませんでした');
  return data.covers;
});
