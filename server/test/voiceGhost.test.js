import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { isEffectiveGhost, splitRoster } from '../src/utils/voiceGhost.js';
import { isVoiceModerator, PERMISSIONS } from '../src/utils/permissions.js';

test('ghost needs benefit AND preference AND invisible status', () => {
  const on = { hasBenefit: true, ghostPref: true, status: 'invisible' };
  assert.equal(isEffectiveGhost(on), true);
  assert.equal(isEffectiveGhost({ ...on, hasBenefit: false }), false);
  assert.equal(isEffectiveGhost({ ...on, ghostPref: false }), false);
  assert.equal(isEffectiveGhost({ ...on, status: 'online' }), false);
});

test('splitRoster hides ghosts from the filtered list and flags them in the full one', () => {
  const roster = [{ userId: 'a' }, { userId: 'g' }, { userId: 'b' }];
  const r = splitRoster(roster, ['g']);
  assert.deepEqual(r.filtered.map((p) => p.userId), ['a', 'b']);
  assert.deepEqual(r.full.find((p) => p.userId === 'g'), { userId: 'g', ghost: true });
  assert.equal(r.full.find((p) => p.userId === 'a').ghost, undefined);
  assert.equal(r.hasGhosts, true);
  assert.equal(splitRoster(roster, []).hasGhosts, false);
  assert.equal(JSON.stringify(r.filtered).includes('ghost'), false);
});

test('isVoiceModerator: owner, ADMINISTRATOR, any voice mod flag, platform admin', () => {
  const room = { created_by: 'owner' };
  const m = (user, bitmask = 0) => isVoiceModerator({ room, user, bitmask });
  assert.equal(m({ id: 'owner' }), true);
  assert.equal(m({ id: 'x', isAdmin: true }), true);
  assert.equal(m({ id: 'x' }, PERMISSIONS.ADMINISTRATOR), true);
  for (const f of ['MOVE_MEMBERS', 'MUTE_MEMBERS', 'DISCONNECT_MEMBERS', 'DISABLE_MEDIA']) {
    assert.equal(m({ id: 'x' }, PERMISSIONS[f]), true, f);
  }
  assert.equal(m({ id: 'x' }, PERMISSIONS.BAN_MEMBERS | PERMISSIONS.MANAGE_CHANNELS | PERMISSIONS.USE_SOUNDBOARD), false);
  assert.equal(m({ id: 'x' }), false);
});
