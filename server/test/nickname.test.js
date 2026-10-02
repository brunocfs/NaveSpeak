import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { memberNicknameSchema } from '../src/validation/schemas.js';
import { PERMISSIONS, checkPermission } from '../src/utils/permissions.js';

const parse = (nickname) => memberNicknameSchema.safeParse({ nickname });

test('nickname is trimmed, empty/null clears it', () => {
  assert.equal(parse('  Nave  ').data.nickname, 'Nave');
  assert.equal(parse('   ').data.nickname, null);
  assert.equal(parse(null).data.nickname, null);
  assert.equal(parse('Zé 🚀 da Nave').success, true);
  assert.equal(memberNicknameSchema.safeParse({}).success, false);
});

test('nickname rejects overlong and control/format characters', () => {
  assert.equal(parse('a'.repeat(32)).success, true);
  assert.equal(parse('a'.repeat(33)).success, false);
  assert.equal(parse('admin‮evil').success, false); // bidi override
  assert.equal(parse('ad​min').success, false); // zero-width space
  assert.equal(parse('a\nb').success, false);
  assert.equal(parse(123).success, false);
});

test('MANAGE_NICKNAMES is a distinct flag granted by ADMINISTRATOR', () => {
  const room = { created_by: 'owner' };
  const user = { id: 'u1' };
  const flag = PERMISSIONS.MANAGE_NICKNAMES;
  assert.equal(checkPermission({ room, user, bitmask: 0, flag }), false);
  assert.equal(checkPermission({ room, user, bitmask: PERMISSIONS.MUTE_MEMBERS, flag }), false);
  assert.equal(checkPermission({ room, user, bitmask: flag, flag }), true);
  assert.equal(checkPermission({ room, user, bitmask: PERMISSIONS.ADMINISTRATOR, flag }), true);
});
