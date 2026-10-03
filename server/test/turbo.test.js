import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  turboGrantSchema,
  turboOverrideSchema,
  turboCatalogSchema,
  profileUpdateSchema,
} from '../src/validation/schemas.js';
import { publicNameStyleSql, turboBenefitSql } from '../src/db/users.repo.js';

const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

test('turbo grant accepts days or null (permanent) and caps the batch', () => {
  assert.equal(turboGrantSchema.safeParse({ userIds: [id], days: 30 }).success, true);
  assert.equal(turboGrantSchema.safeParse({ userIds: [id], days: null }).success, true);
  assert.equal(turboGrantSchema.safeParse({ userIds: [id], days: 0 }).success, false);
  assert.equal(turboGrantSchema.safeParse({ userIds: [], days: 30 }).success, false);
  assert.equal(turboGrantSchema.safeParse({ userIds: ['not-a-uuid'], days: 30 }).success, false);
  assert.equal(turboGrantSchema.safeParse({ userIds: Array(501).fill(id), days: 30 }).success, false);
});

test('turbo benefits only accept known keys', () => {
  assert.equal(turboOverrideSchema.safeParse({ nameStyle: false, ghostVoice: true }).success, true);
  assert.equal(turboOverrideSchema.safeParse({ nameStyle: true, unknown: true }).success, false);
  assert.equal(turboOverrideSchema.safeParse({ nameStyle: 'turbo' }).success, false);
});

test('turbo catalog takes modes, migrates legacy booleans, hdScreen-only turboBitrate', () => {
  assert.equal(turboCatalogSchema.safeParse({ nameStyle: 'free', hdScreen: 'turboBitrate' }).success, true);
  assert.deepEqual(turboCatalogSchema.parse({ nameStyle: false, ghostVoice: true }), { nameStyle: 'off', ghostVoice: 'turbo' });
  assert.equal(turboCatalogSchema.safeParse({ nameStyle: 'turboBitrate' }).success, false);
  assert.equal(turboCatalogSchema.safeParse({ nope: 'turbo' }).success, false);
});

test('turboBenefitSql rejects keys outside the catalog', () => {
  assert.throws(() => turboBenefitSql('u', "x'; DROP TABLE users;--"));
  const sql = turboBenefitSql('u', 'ghostVoice'); // default turbo: free/off explícitos, resto = turbo
  assert.match(sql, /WHEN m IN \('free'\) THEN TRUE WHEN m IN \('off', 'false'\) THEN FALSE ELSE/);
  assert.match(sql, /jsonb_typeof\(u\.turbo_benefits->'ghostVoice'\) = 'boolean'/);
  // default free/off: o grupo do default vira o ELSE (valor desconhecido = default)
  assert.match(turboBenefitSql('u', 'mediaPopout'), /ELSE TRUE END/);
  assert.match(turboBenefitSql('u', 'serverPerks'), /ELSE FALSE END/);
});

test('profile nameStyle is validated strictly', () => {
  assert.equal(profileUpdateSchema.safeParse({ nameStyle: { color: '#ff00aa', effect: 'shine' } }).success, true);
  assert.equal(profileUpdateSchema.safeParse({ nameStyle: { color: 'red' } }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ nameStyle: { showInVoice: false } }).success, true);
  assert.equal(profileUpdateSchema.safeParse({ nameStyle: { showInVoice: 'no' } }).success, false);
  assert.equal(profileUpdateSchema.safeParse({ nameStyle: { color: '#ff00aa', css: 'x' } }).success, false);
});

test('public name style is gated by system flag or active turbo benefit', () => {
  const sql = publicNameStyleSql('u');
  assert.match(sql, /u\.is_system/);
  assert.match(sql, /u\.turbo_until > NOW\(\)/);
  assert.match(sql, /ELSE '\{\}'::jsonb/);
});
