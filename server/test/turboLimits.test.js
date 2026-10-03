import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLimits, normalizeCatalog, TURBO_KEYS, exceedsScreenBitrate, messageTooLong, soundboardLimits, TURBO_LIMITS, isSpeakingRingOn, joinSoundCheck } from '../src/utils/turbo.js';

const hd = (mode, has) => {
  const l = resolveLimits(normalizeCatalog({ hdScreen: mode }), { hdScreen: has });
  return [l.screenMaxResolution, l.screenMaxFps, l.screenMaxBitrateKbps].join('/');
};

test('hdScreen limits follow the contract table', () => {
  assert.equal(hd('off', false), '1080p/30/4000');
  assert.equal(hd('off', true), '1080p/30/4000');
  assert.equal(hd('turboBitrate', false), '1440p/60/4000');
  assert.equal(hd('turboBitrate', true), '1440p/60/6000');
  assert.equal(hd('turbo', false), '1080p/30/4000');
  assert.equal(hd('turbo', true), '1440p/60/6000');
  assert.equal(hd('free', false), '1440p/60/6000');
});

test('other limits double/raise only with the benefit', () => {
  const c = normalizeCatalog({});
  const base = resolveLimits(c, {}, 10);
  assert.deepEqual([base.attachmentMaxBytes, base.messageMaxChars, base.backgroundsMax], [20 * 1024 * 1024, 2000, 10]);
  const t = resolveLimits(c, { bigUploads: true, longMessages: true, extraBackgrounds: true }, 10);
  assert.deepEqual([t.attachmentMaxBytes, t.messageMaxChars, t.backgroundsMax], [50 * 1024 * 1024, 4000, 20]);
});

test('normalizeCatalog applies defaults and migrates legacy booleans', () => {
  const c = normalizeCatalog({ nameStyle: false, ghostVoice: true, bigUploads: 'bogus', hdScreen: 'free' });
  assert.equal(c.nameStyle, 'off');
  assert.equal(c.ghostVoice, 'turbo');
  assert.equal(c.bigUploads, 'turbo');
  assert.equal(c.hdScreen, 'free');
  assert.equal(Object.keys(c).length, TURBO_KEYS.length);
});

test('screen bitrate cap rejects only encodings above the user cap', () => {
  const free = resolveLimits(normalizeCatalog({}), {}); // turboBitrate sem TURBO: 4000 kbps
  const turbo = resolveLimits(normalizeCatalog({}), { hdScreen: true }); // 6000 kbps
  const enc = (bps) => ({ encodings: [{ maxBitrate: 1_000_000 }, { maxBitrate: bps }] });
  assert.equal(exceedsScreenBitrate(enc(4_000_000), free), false);
  assert.equal(exceedsScreenBitrate(enc(6_000_000), free), true);
  assert.equal(exceedsScreenBitrate(enc(6_000_000), turbo), false);
  assert.equal(exceedsScreenBitrate({ encodings: [{}] }, free), false);
  assert.equal(exceedsScreenBitrate(undefined, free), false);
});

test('messageTooLong follows the per-user limit with a stable code', () => {
  const free = resolveLimits(normalizeCatalog({}), {});
  const turbo = resolveLimits(normalizeCatalog({}), { longMessages: true });
  const text = 'a'.repeat(3000);
  assert.equal(messageTooLong('a'.repeat(2000), free), null);
  assert.deepEqual(messageTooLong(text, free), { error: 'Mensagem muito longa (máx. 2000 caracteres).', code: 'message_too_long', max: 2000 });
  assert.equal(messageTooLong(text, turbo), null);
  assert.equal(messageTooLong('a'.repeat(4001), turbo)?.code, 'message_too_long');
});

test('serverPerks doubles the server soundboard quota/duration (duration capped at 60s)', () => {
  const base = { soundboardMaxSounds: 20, soundboardMaxDurationMs: 10_000, soundboardMaxBytes: 2_097_152 };
  assert.deepEqual(soundboardLimits(base, false), { maxSounds: 20, maxDurationMs: 10_000, maxBytes: 2_097_152, personalPerUser: 3 });
  const perks = soundboardLimits(base, true);
  assert.equal(perks.maxSounds, 40);
  assert.equal(perks.maxDurationMs, 20_000);
  assert.equal(soundboardLimits({ ...base, soundboardMaxDurationMs: 50_000 }, true).maxDurationMs, 60_000);
  assert.equal(TURBO_LIMITS.joinSoundMaxMs, 5000);
});

test('speaking ring needs benefit AND preference', () => {
  assert.equal(isSpeakingRingOn({ hasBenefit: true, pref: true }), true);
  assert.equal(isSpeakingRingOn({ hasBenefit: true, pref: false }), false);
  assert.equal(isSpeakingRingOn({ hasBenefit: false, pref: true }), false);
  assert.equal(isSpeakingRingOn({ hasBenefit: false, pref: false }), false);
});

test('joinSoundCheck: server sound needs membership, personal only own + benefit, max 5s', () => {
  const server = { ownerUserId: null, isMember: true, durationMs: 5000 };
  assert.equal(joinSoundCheck(server), null);
  assert.equal(joinSoundCheck({ ...server, isMember: false }), 'join_sound_forbidden');
  assert.equal(joinSoundCheck({ ...server, durationMs: 5001 }), 'join_sound_too_long');
  const mine = { ownerUserId: 7, isOwn: true, hasPersonal: true, isMember: false, durationMs: 1000 };
  assert.equal(joinSoundCheck(mine), null); // pessoal dele vale mesmo fora do servidor
  assert.equal(joinSoundCheck({ ...mine, hasPersonal: false }), 'join_sound_forbidden');
  assert.equal(joinSoundCheck({ ...mine, isOwn: false }), 'join_sound_forbidden'); // pessoal de outro
});
