// 同じ相手への誘いを、入口やゲームに関係なくまとめて制限する。
export const INVITE_COOLDOWN_MS = 30_000;
export type InviteTimes = Record<string, number | undefined>;

export function inviteRemainingSeconds(sentAt: number | undefined, now: number): number {
  if (typeof sentAt !== 'number' || !Number.isFinite(sentAt)) return 0;
  return Math.ceil(Math.max(0, Math.min(INVITE_COOLDOWN_MS, sentAt + INVITE_COOLDOWN_MS - now)) / 1000);
}

export function createFriendInviteGuard(initial: InviteTimes = {}) {
  let sent = { ...initial };
  return {
    // Reactの再描画前に来た2回目も、同期的に拒否する。
    tryInvite(person: string, now: number) {
      if (inviteRemainingSeconds(sent[person], now) > 0) return false;
      sent[person] = now;
      return true;
    },
    reset() { sent = {}; },
  };
}
