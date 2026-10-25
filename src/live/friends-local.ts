// A separate, explicitly local operation demo. Never used as a fallback for a failed DB call.
import type { GameRow, Result } from './api';
import type { FriendConnection, FriendInput, FriendRecruitment, FriendRequest, FriendService } from './friends-types';

type Link = { a: string; b: string; aName: string; bName: string; gameId: number; createdAt: string };
type State = { version: 1; recruits: FriendRecruitment[]; requests: FriendRequest[]; links: Link[]; operations: Record<string, unknown> };
export type FriendLocalStorage = { read(): string | null; write(value: string): void; subscribe(fn: () => void): () => void };
export const FRIEND_LOCAL_KEY = 'shumitomo:friend-demo:v1';
const fresh = (): State => ({ version: 1, recruits: [], requests: [], links: [], operations: {} });
const validTime = (s: string, end = false) => /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(s) || (end && s === '24:00');
const validName = (s: string) => s.trim().length > 0;
const fail = (reason: string) => ({ ok: false as const, reason });

export function createLocalFriendService(userId: string | null, storage: FriendLocalStorage, games: GameRow[]): FriendService {
  const load = (): State => {
    const raw = storage.read();
    if (!raw) return fresh();
    const parsed = JSON.parse(raw) as State;
    if (parsed.version !== 1 || !Array.isArray(parsed.recruits) || !Array.isArray(parsed.requests) || !Array.isArray(parsed.links) || typeof parsed.operations !== 'object') throw new Error('端末のフレンド募集を読み込めませんでした');
    return parsed;
  };
  const displayName = (name: string) => userId === 'local-sora' ? 'そら' : userId === 'local-mei' ? 'めい' : name.trim();
  const join = (s: State, request: FriendRequest): FriendRequest => {
    const r=s.recruits.find(r=>r.id===request.recruitment_id);
    return {...request,friend_recruitments:r?{...r,games:games.find(g=>g.id===r.game_id)}:null};
  };
  const operate = async <T extends object>(id: string, action: string, payload: unknown, fn: (s: State) => Result<T>): Promise<Result<T>> => {
    if (!userId) return fail('login_required');
    const s = load(); const key = `${userId}:${id}`; const intent = JSON.stringify([action, payload]);
    const previous = s.operations[key] as { intent: string; result: Result<T> } | undefined;
    if (previous) return previous.intent === intent ? previous.result : fail('operation_conflict');
    const result = fn(s);
    s.operations[key] = { intent, result };
    storage.write(JSON.stringify(s));
    return result;
  };
  return {
    async list() { return load().recruits.map(r => ({ ...r, games: games.find(g => g.id === r.game_id) })); },
    async requests() { const s = load(); return s.requests.filter(r => r.recipient_id === userId).map(r => join(s, r)); },
    async sent() { const s = load(); return s.requests.filter(r => r.sender_id === userId).map(r => join(s, r)); },
    async connections() {
      return load().links.filter(l => l.a === userId || l.b === userId).map(l => ({
        peer_id: l.a === userId ? l.b : l.a, nickname: l.a === userId ? l.bName : l.aName,
        game_id: l.gameId, game_name: games.find(g => g.id === l.gameId)?.name ?? 'ゲーム', created_at: l.createdAt,
      } satisfies FriendConnection));
    },
    async games(query) { return games.filter(g => g.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())); },
    publish: (id, input: FriendInput) => operate<{ recruitment_id: string }>(id, 'publish', input, s => {
      const name = displayName(input.nickname);
      if (!validName(name) || !input.platform.trim() || !Number.isInteger(input.skill) || input.skill < 1 || input.skill > 9 || !Number.isInteger(input.enthusiasm) || input.enthusiasm < 0 || input.enthusiasm > 4 || !validTime(input.availableFrom) || !validTime(input.availableTo,true)) return fail('invalid_input');
      if (!games.some(g => g.id === input.gameId)) return fail('unknown_game');
      const recruitment_id = `friend-${id}`;
      s.recruits.unshift({ id: recruitment_id, owner_id: userId!, nickname: name, game_id: input.gameId, platform: input.platform.trim(), skill: input.skill, enthusiasm: input.enthusiasm, available_from: input.availableFrom, available_to: input.availableTo, created_at: new Date().toISOString(), closed_at: null });
      return { ok: true, recruitment_id };
    }),
    apply: (id, recruitmentId, nickname) => operate<{ request_id: string }>(id, 'request', [recruitmentId, nickname], s => {
      const r = s.recruits.find(r => r.id === recruitmentId);
      if (!r) return fail('not_found');
      if (r.owner_id === userId) return fail('own_recruitment');
      if (r.closed_at) return fail('not_accepting');
      const name = displayName(nickname);
      if (!validName(name)) return fail('invalid_input');
      if (s.links.some(l => [l.a, l.b].includes(userId!) && [l.a, l.b].includes(r.owner_id))) return fail('already_friends');
      const old = s.requests.find(q => q.sender_id === userId && q.recipient_id === r.owner_id && q.status === 'pending');
      if (old) return { ok: true, request_id: old.id };
      const request_id = `request-${id}`;
      s.requests.unshift({ id: request_id, recruitment_id: r.id, sender_id: userId!, recipient_id: r.owner_id, nickname: name, status: 'pending', created_at: new Date().toISOString() });
      return { ok: true, request_id };
    }),
    accept: (id, requestId) => operate<object>(id, 'accept', requestId, s => {
      const q = s.requests.find(q => q.id === requestId);
      if (!q) return fail('not_found');
      if (q.recipient_id !== userId) return fail('not_recipient');
      if (q.status === 'accepted') return { ok: true };
      const r = s.recruits.find(r => r.id === q.recruitment_id);
      if (!r) return fail('not_found');
      if (!s.links.some(l => [l.a,l.b].includes(q.sender_id) && [l.a,l.b].includes(q.recipient_id))) s.links.push({ a: q.recipient_id, b: q.sender_id, aName: r.nickname, bName: q.nickname, gameId: r.game_id, createdAt: new Date().toISOString() });
      s.requests.filter(x => [x.sender_id,x.recipient_id].includes(q.sender_id) && [x.sender_id,x.recipient_id].includes(q.recipient_id)).forEach(x => { x.status = 'accepted'; });
      return { ok: true };
    }),
    close: (id, recruitmentId) => operate<object>(id, 'close', recruitmentId, s => {
      const r = s.recruits.find(r => r.id === recruitmentId);
      if (!r) return fail('not_found');
      if (r.owner_id !== userId) return fail('not_owner');
      r.closed_at ??= new Date().toISOString(); return { ok: true };
    }),
    remove: (id, peerId) => operate<object>(id, 'remove', peerId, s => {
      if(peerId===userId)return fail('invalid_input');
      s.links = s.links.filter(l => !([l.a,l.b].includes(userId!) && [l.a,l.b].includes(peerId)));
      return { ok: true };
    }),
    subscribe: fn => storage.subscribe(fn),
  };
}
