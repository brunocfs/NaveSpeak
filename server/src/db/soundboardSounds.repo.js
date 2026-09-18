// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';

export async function countSoundsForServer(serverId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS count FROM soundboard_sounds WHERE server_id = $1', [serverId]);
  return rows[0]?.count ?? 0;
}

export async function listSoundsForServer(serverId) {
  const { rows } = await pool.query(
    `SELECT id, server_id AS "serverId", name, file_path AS "filePath", duration_ms AS "durationMs",
            uploaded_by AS "uploadedBy", created_at AS "createdAt"
     FROM soundboard_sounds WHERE server_id = $1 ORDER BY created_at ASC`,
    [serverId]
  );
  return rows;
}

// Confere que o som pertence a ESTE servidor antes de tocar/apagar - mesma
// motivação de assertRolesBelongToServer em roles.repo.js: sem isso, alguém
// poderia adivinhar o UUID de um som de outro servidor.
export async function findSoundInServer(serverId, soundId) {
  const { rows } = await pool.query(
    `SELECT id, server_id AS "serverId", name, file_path AS "filePath", duration_ms AS "durationMs"
     FROM soundboard_sounds WHERE server_id = $1 AND id = $2 LIMIT 1`,
    [serverId, soundId]
  );
  return rows[0] ?? null;
}

export async function createSound({ serverId, uploadedBy, name, filePath, durationMs }) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO soundboard_sounds (id, server_id, uploaded_by, name, file_path, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, serverId, uploadedBy, name, filePath, durationMs]
  );
  return findSoundInServer(serverId, id);
}

export async function deleteSound(soundId) {
  await pool.query('DELETE FROM soundboard_sounds WHERE id = $1', [soundId]);
}
