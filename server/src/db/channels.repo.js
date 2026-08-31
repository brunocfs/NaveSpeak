// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

const CHANNEL_COLUMNS = `
  id, server_id, type, name, topic, position,
  view_role_id AS "viewRoleId", send_role_id AS "sendRoleId", share_role_id AS "shareRoleId",
  created_at`;

export async function createChannel({
  serverId,
  type,
  name,
  topic = null,
  position = 0,
  viewRoleId = null,
  sendRoleId = null,
  shareRoleId = null,
}) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO channels (id, server_id, type, name, topic, position, view_role_id, send_role_id, share_role_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [id, serverId, type, name, topic, position, viewRoleId, sendRoleId, shareRoleId]
  );
  return findChannelById(id);
}

export async function listChannelsForServer(serverId) {
  const { rows } = await pool.query(
    `SELECT ${CHANNEL_COLUMNS}
     FROM channels
     WHERE server_id = $1
     ORDER BY position ASC, created_at ASC`,
    [serverId]
  );
  return rows;
}

export async function findChannelById(channelId) {
  const { rows } = await pool.query(
    `SELECT ${CHANNEL_COLUMNS}
     FROM channels
     WHERE id = $1
     LIMIT 1`,
    [channelId]
  );
  return rows[0] ?? null;
}

// PATCH parcial - só os campos presentes (!== undefined) são alterados;
// viewRoleId/sendRoleId/shareRoleId podem ser null explicitamente ("sem
// restrição"), distinto de undefined ("não mexe").
export async function updateChannel(channelId, { name, topic, position, viewRoleId, sendRoleId, shareRoleId } = {}) {
  const fields = [];
  const values = [];
  let i = 1;
  const set = (column, value) => { fields.push(`${column} = $${i++}`); values.push(value); };
  if (name !== undefined) set('name', name);
  if (topic !== undefined) set('topic', topic);
  if (position !== undefined) set('position', position);
  if (viewRoleId !== undefined) set('view_role_id', viewRoleId);
  if (sendRoleId !== undefined) set('send_role_id', sendRoleId);
  if (shareRoleId !== undefined) set('share_role_id', shareRoleId);
  if (fields.length === 0) return findChannelById(channelId);

  values.push(channelId);
  await pool.query(`UPDATE channels SET ${fields.join(', ')} WHERE id = $${i}`, values);
  return findChannelById(channelId);
}

export async function deleteChannel(channelId) {
  await pool.query('DELETE FROM channels WHERE id = $1', [channelId]);
}

// Canais padrão de um servidor recém-criado: um de texto "geral" e um de voz
// "Voz". Sem eles a UI abriria o servidor sem nenhum canal para escolher.
export async function addDefaultChannelsForServer(serverId) {
  await createChannel({ serverId, type: 'text', name: 'geral', position: 0 });
  await createChannel({ serverId, type: 'voice', name: 'Voz', position: 1 });
}
