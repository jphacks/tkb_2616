import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFriendInviteGuard, inviteRemainingSeconds, INVITE_COOLDOWN_MS } from '../app/src/friend-invites.ts';

test('Rapid clicks through different entry points invite a person only once', () => {
  const gate = createFriendInviteGuard();
  const now = 100_000;
  let invitations = 0;
  const fromFriends = () => { if (gate.tryInvite('ken', now)) invitations++; };
  const fromNotice = () => { if (gate.tryInvite('ken', now)) invitations++; };
  fromFriends(); fromFriends(); fromNotice();
  assert.equal(invitations, 1);
  assert.equal(gate.tryInvite('mei', now), true);
});

test('A person can be invited again exactly when their cooldown ends', () => {
  const gate = createFriendInviteGuard();
  assert.equal(gate.tryInvite('ken', 0), true);
  assert.equal(gate.tryInvite('ken', INVITE_COOLDOWN_MS - 1), false);
  assert.equal(gate.tryInvite('ken', INVITE_COOLDOWN_MS), true);
  assert.equal(gate.tryInvite('ken', INVITE_COOLDOWN_MS), false);
});

test('Restoring saved invitation times preserves the cooldown after reload', () => {
  const saved = JSON.parse(JSON.stringify({ ken: 100_000 }));
  const gate = createFriendInviteGuard(saved);
  assert.equal(gate.tryInvite('ken', 101_000), false);
  assert.equal(gate.tryInvite('ken', 130_000), true);
  assert.deepEqual(saved, { ken: 100_000 });
});

test('Countdown rounds up, handles older data and stays bounded if the clock moves back', () => {
  assert.equal(inviteRemainingSeconds(undefined, 0), 0);
  assert.equal(inviteRemainingSeconds(Number.NaN, 0), 0);
  assert.equal(inviteRemainingSeconds(0, 29_999), 1);
  assert.equal(inviteRemainingSeconds(0, 30_000), 0);
  assert.equal(inviteRemainingSeconds(100_000, 0), 30);
});

test('Reset permits inviting again', () => {
  const gate = createFriendInviteGuard({ ken: 100_000 });
  assert.equal(gate.tryInvite('ken', 100_001), false);
  gate.reset();
  assert.equal(gate.tryInvite('ken', 100_001), true);
});
