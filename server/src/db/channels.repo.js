// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

export async function createChannel({ serverId, type, name, topic = null, position = 0 }) {
  const id = randomUUID();
  await pool.query(
    'INSERT INTO channels (id, server_id, type, name, topic, position) VALUES ($1, $2, $3, $4, $5, $6)',
    [id, serverId, type, name, topic, position]
  );
  return { id, server_id: serverId, type, name, topic, position };
}

export async function listChannelsForServer(serverId) {
  const { rows } = await pool.query(
    `SELECT id, server_id, type, name, topic, position, created_at
     FROM channels
     WHERE server_id = $1
     ORDER BY position ASC, created_at ASC`,
    [serverId]
  );
  return rows;
}

export async function findChannelById(channelId) {
  const { rows } = await pool.query(
    `SELECT id, server_id, type, name, topic, position, created_at
     FROM channels
     WHERE id = $1
     LIMIT 1`,
    [channelId]
  );
  return rows[0] ?? null;
}

// Canais padrão de um servidor recém-criado: um de texto "geral" e um de voz
// "Voz". Sem eles a UI abriria o servidor sem nenhum canal para escolher.
export async function addDefaultChannelsForServer(serverId) {
  await createChannel({ serverId, type: 'text', name: 'geral', position: 0 });
  await createChannel({ serverId, type: 'voice', name: 'Voz', position: 1 });
}
