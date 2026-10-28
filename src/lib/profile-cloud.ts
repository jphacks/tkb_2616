// Profile saved in the database (save_profile / my_profile / set_app_id). Contracts: supabase/README.md.
// Same interface as the device repository in app/src/profile-storage.ts, so the screens do not change.
// Steam playtime is never sent: the server does not trust it. It stays on this device with the import bookkeeping.
import { GAMES, NO_REGION, addCustomGame, registerIgdbGame, type MyGame, type Profile } from '../../app/src/data.ts';
import type { ProfileRepository } from '../../app/src/profile-storage.ts';

export type CloudGame = {
  game_id: number | null; steam_app_id: number | null; name: string;
  platform: string; heat: number; skill: number; cover_image_id?: string | null;
};
export type CloudProfile = {
  app_id: string | null; nickname: string | null; region: string | null;
  usual_time_start: string | null; usual_time_end: string | null; color: string | null;
  is_self?: boolean; is_friend?: boolean;
  games: CloudGame[]; hobbies: { name: string; heat: number }[]; likes: { name: string; locked: boolean }[];
};
type Steam = NonNullable<MyGame['steam']>;
// Only what the database does not keep
export type LocalExtras = Pick<Profile, 'steamImportedAppIds' | 'steamImportDisabled' | 'steamDemoGamesCleared'> & {
  steam?: Record<string, Pick<Steam, 'hours' | 'updated'>>;
};

export const DEFAULT_COLOR = '#6c5cf0';
export const IGDB_COVER = (imageId: string) => `https://images.igdb.com/igdb/image/upload/t_cover_big/${imageId}.jpg`;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const steamIdOf = (g: MyGame) => g.steam?.appId ?? (/^steam:([1-9][0-9]*)$/.exec(g.tag) ? Number(g.tag.slice(6)) : undefined);

/* ---------- Shape: the screens keep heat 0..4, the database keeps 1..5 (ADR-33) ---------- */

export function toCloudProfile(p: Profile) {
  return {
    nickname: p.nickname.trim() || null,
    region: p.region === NO_REGION ? null : p.region,
    usual_time_start: p.times.start || null,
    usual_time_end: p.times.end || null,
    color: p.color || null,
    games: p.games.map(g => {
      const steamId = steamIdOf(g);
      return {
        game_id: g.igdb?.id ?? null,
        steam_app_id: steamId ?? null,
        name: g.igdb?.name ?? g.steam?.name ?? GAMES[g.tag]?.name ?? g.tag.replace(/^custom:/, ''),
        platform: g.platform, heat: g.heat + 1, skill: g.skill,
      };
    }),
    hobbies: p.hobbies.map(h => ({ name: h.name, heat: h.heat + 1 })),
    likes: p.likes.map(l => ({ name: l.name, locked: !!l.locked })),
  };
}

// Registers each game name for the screens (GAMES), as loading from the device does
export function fromCloudProfile(c: CloudProfile | null): Profile {
  return {
    nickname: c?.nickname ?? '',
    appId: c?.app_id ?? '',
    color: c?.color ?? DEFAULT_COLOR,
    region: c?.region ?? NO_REGION,
    times: { start: c?.usual_time_start ?? '', end: c?.usual_time_end ?? '' },
    games: (c?.games ?? []).map((g): MyGame => {
      const base = { platform: g.platform, heat: g.heat - 1, skill: g.skill };
      const steam = g.steam_app_id ? { steam: { appId: g.steam_app_id, name: g.name, hours: null, updated: '' } } : {};
      if (g.game_id) return { tag: registerIgdbGame({ id: g.game_id, name: g.name }), igdb: { id: g.game_id, name: g.name }, ...base, ...steam };
      if (g.steam_app_id) {
        const tag = `steam:${g.steam_app_id}`;
        GAMES[tag] = { name: g.name, join: 'room', colors: ['#5b6b7a', '#273747'] };
        return { tag, ...base, ...steam };
      }
      return { tag: addCustomGame(g.name), ...base };
    }),
    hobbies: (c?.hobbies ?? []).map(h => ({ name: h.name, heat: h.heat - 1 })),
    likes: (c?.likes ?? []).map(l => (l.locked ? { name: l.name, locked: true } : { name: l.name })),
  };
}

export function localExtrasOf(p: Profile): LocalExtras {
  const steam: NonNullable<LocalExtras['steam']> = {};
  for (const g of p.games) {
    const id = steamIdOf(g);
    if (id && g.steam) steam[id] = { hours: g.steam.hours, updated: g.steam.updated };
  }
  return { steamImportedAppIds: p.steamImportedAppIds, steamImportDisabled: p.steamImportDisabled, steamDemoGamesCleared: p.steamDemoGamesCleared, steam };
}

export function withLocalExtras(p: Profile, extras: LocalExtras | null): Profile {
  if (!extras) return p;
  const next = copy(p);
  if (extras.steamImportedAppIds) next.steamImportedAppIds = extras.steamImportedAppIds;
  if (extras.steamImportDisabled !== undefined) next.steamImportDisabled = extras.steamImportDisabled;
  if (extras.steamDemoGamesCleared !== undefined) next.steamDemoGamesCleared = extras.steamDemoGamesCleared;
  for (const g of next.games) {
    const kept = g.steam?.appId ? extras.steam?.[g.steam.appId] : undefined;
    if (g.steam && kept) Object.assign(g.steam, kept);
  }
  return next;
}

/* ---------- Repository ---------- */

export class ProfileSaveError extends Error {
  readonly userMessage: string;
  constructor(userMessage: string) { super(userMessage); this.name = 'ProfileSaveError'; this.userMessage = userMessage; }
}
const REASONS: Record<string, string> = {
  login_required: 'ログインしてください',
  nickname_invalid: 'ニックネームは20文字までで、改行は入れられません',
  region_invalid: '地方を選び直してください',
  usual_time_incomplete: '遊ぶ時間帯は、始まりと終わりの両方を入れてください',
  usual_time_invalid: '時間帯は 21:00 のように入れてください',
  color_invalid: '色を選び直してください',
  too_many_items: 'ゲームは50件、趣味は20件、好きなものは30件までです',
  profile_invalid: '入れられない内容があります。名前の長さや、熱量・実力を確かめてください',
  app_id_invalid: 'アプリIDは英数字と _ の3〜20文字で入れてください',
  app_id_taken: 'そのアプリIDは、ほかの人が使っています',
};
const failed = (reason: string) => new ProfileSaveError(REASONS[reason] ?? 'プロフィールを保存できませんでした');

type RpcResult = { data: unknown; error: { code?: string } | null; status?: number };
export type CloudProfileDeps = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<RpcResult>;
  storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
  saveGame: (id: number) => Promise<unknown>;
  newOpId: () => string;
};

export function createCloudProfileRepository(userId: string, deps: CloudProfileDeps): ProfileRepository {
  const key = `shumitomo.profile.local.v1:${userId}`;
  let current: Profile | null = null;
  // IGDB games already in public.games (save_profile refuses the others)
  const knownGames = new Set<number>();
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(run: () => Promise<T>): Promise<T> {
    const result = queue.then(run);
    queue = result.catch(() => undefined);
    return result;
  }
  async function call(name: string, args: Record<string, unknown>) {
    const { data, error, status } = await deps.rpc(name, args);
    if (error) throw failed(status === 401 || status === 403 || error.code === '42501' ? 'login_required' : 'unknown');
    return data as { ok: boolean; reason?: string; app_id?: string };
  }
  async function readExtras(): Promise<LocalExtras | null> {
    try { const raw = await deps.storage.getItem(key); return raw ? JSON.parse(raw) as LocalExtras : null; } catch { return null; }
  }
  async function writeExtras(p: Profile) {
    try { await deps.storage.setItem(key, JSON.stringify(localExtrasOf(p))); } catch { /* playtime is fetched again from Steam */ }
  }
  async function load() {
    const { data, error } = await deps.rpc('my_profile');
    if (error) throw new Error('Profile could not be read');
    const cloud = data as CloudProfile | null;
    for (const g of cloud?.games ?? []) if (g.game_id) knownGames.add(g.game_id);
    current = withLocalExtras(fromCloudProfile(cloud), await readExtras());
    return copy(current);
  }
  return {
    target: 'account',
    load: () => serial(load),
    edit: (change: (profile: Profile) => void) => serial(async () => {
      if (!current) throw new Error('Profile has not loaded');
      const next = copy(current);
      change(next);
      for (const g of next.games) {
        if (!g.igdb || knownGames.has(g.igdb.id)) continue;
        try { await deps.saveGame(g.igdb.id); } catch { throw new ProfileSaveError(`「${g.igdb.name}」を保存できませんでした。もう一度お試しください`); }
        knownGames.add(g.igdb.id);
      }
      // Change the app ID first: if it is taken, nothing else is saved and the edit can be retried
      const wanted = next.appId.trim().toLowerCase();
      if (wanted && wanted !== current.appId) {
        const changed = await call('set_app_id', { p_op_id: deps.newOpId(), p_app_id: wanted });
        if (!changed.ok) throw failed(changed.reason ?? 'unknown');
        current = { ...current, appId: changed.app_id ?? wanted };
      }
      const saved = await call('save_profile', { p_op_id: deps.newOpId(), p_profile: toCloudProfile(next) });
      if (!saved.ok) throw failed(saved.reason ?? 'unknown');
      next.appId = saved.app_id ?? next.appId;
      current = next;
      await writeExtras(next);
      return copy(current);
    }),
    // The account's profile is not deleted here; this reads it again
    reset: () => serial(load),
  };
}
