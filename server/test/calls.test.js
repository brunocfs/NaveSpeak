import './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { redis } from '../src/config/redis.js';
import { isCallParticipant } from '../src/sockets/callsStore.js';

// Só quem está tocando, dentro ou voltando pode entrar na voz da chamada -
// recusou/expirou (ou status desconhecido) fica de fora.
test('isCallParticipant only allows invited/accepted/left', async () => {
  const original = redis.hget;
  const statuses = { a: 'invited', b: 'accepted', c: 'left', d: 'declined', e: 'missed', f: 'weird' };
  redis.hget = async (_key, userId) => (statuses[userId] ? JSON.stringify({ status: statuses[userId] }) : null);
  try {
    const result = {};
    for (const id of [...Object.keys(statuses), 'nobody']) result[id] = await isCallParticipant('call:x', id);
    assert.deepEqual(result, { a: true, b: true, c: true, d: false, e: false, f: false, nobody: false });
  } finally {
    redis.hget = original;
  }
});
