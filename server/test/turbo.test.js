import './env.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  turboGrantSchema,
  turboBenefitsSchema,
  profileUpdateSchema,
} from '../src/validation/schemas.js';
import { publicNameStyleSql } from '../src/db/users.repo.js';

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
  assert.equal(turboBenefitsSchema.safeParse({ nameStyle: false }).success, true);
  assert.equal(turboBenefitsSchema.safeParse({ nameStyle: true, unknown: true }).success, false);
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
