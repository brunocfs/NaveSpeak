// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { randomUUID } from 'node:crypto';
import { pool } from '../config/db.js';
import { turboBenefitSql } from './users.repo.js';

// Som pessoal (owner_user_id) é PRIVADO do dono ($2 = quem consulta/toca) e
// só vale enquanto ele tem o benefício personalSounds: sem isso fica oculto e
// mudo.
const VISIBLE = `(s.owner_user_id IS NULL OR (s.owner_user_id = $2 AND ${turboBenefitSql('o', 'personalSounds')}))`;
const FROM = 'soundboard_sounds s LEFT JOIN users o ON o.id = s.owner_user_id';
const COLUMNS = `s.id, s.server_id AS "serverId", s.name, s.file_path AS "filePath", s.duration_ms AS "durationMs",
            o.public_id AS "ownerId", s.created_at AS "createdAt"`;

// Cota do servidor: só sons do servidor (os pessoais têm cota própria).
export async function countSoundsForServer(serverId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM soundboard_sounds WHERE server_id = $1 AND owner_user_id IS NULL',
    [serverId]
  );
  return rows[0]?.count ?? 0;
}

export async function countPersonalSounds(serverId, userId) {
  const { rows } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM soundboard_sounds WHERE server_id = $1 AND owner_user_id = $2',
    [serverId, userId]
  );
  return rows[0]?.count ?? 0;
}

export async function listSoundsForServer(serverId, viewerId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE s.server_id = $1 AND ${VISIBLE} ORDER BY s.created_at ASC`,
    [serverId, viewerId]
  );
  return rows;
}

// Confere que o som pertence a ESTE servidor antes de tocar/apagar - mesma
// motivação de assertRolesBelongToServer em roles.repo.js: sem isso, alguém
// poderia adivinhar o UUID de um som de outro servidor. Som pessoal de dono
// sem benefício não é achado (mudo).
export async function findSoundInServer(serverId, soundId, viewerId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE s.server_id = $1 AND s.id = $3 AND ${VISIBLE} LIMIT 1`,
    [serverId, viewerId, soundId]
  );
  return rows[0] ?? null;
}

// Para apagar: acha mesmo se o dono perdeu o benefício (senão ficaria órfão).
export async function findSoundForDelete(serverId, soundId) {
  const { rows } = await pool.query(
    `SELECT ${COLUMNS} FROM ${FROM} WHERE s.server_id = $1 AND s.id = $2 LIMIT 1`,
    [serverId, soundId]
  );
  return rows[0] ?? null;
}

export async function createSound({ serverId, uploadedBy, name, filePath, durationMs, personal = false }) {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO soundboard_sounds (id, server_id, uploaded_by, owner_user_id, name, file_path, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, serverId, uploadedBy, personal ? uploadedBy : null, name, filePath, durationMs]
  );
  return findSoundForDelete(serverId, id);
}

export async function deleteSound(soundId) {
  await pool.query('DELETE FROM soundboard_sounds WHERE id = $1', [soundId]);
}

// Som candidato a som de entrada de $1 (PK interna). Traz o que joinSoundCheck
// precisa: dono, se é o próprio, se é membro do servidor e o benefício personalSounds.
export async function findSoundForJoin(userId, soundId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.server_id AS "serverId", s.duration_ms AS "durationMs", s.owner_user_id AS "ownerUserId",
            (s.owner_user_id = $1) AS "isOwn",
            EXISTS (SELECT 1 FROM room_members rm WHERE rm.room_id = s.server_id AND rm.user_id = $1) AS "isMember",
            ${turboBenefitSql('u', 'personalSounds')} AS "hasPersonal"
     FROM soundboard_sounds s JOIN users u ON u.id = $1
     WHERE s.id = $2`,
    [userId, soundId]
  );
  return rows[0] ?? null;
}

// Opções do seletor: sons dos servidores DO usuário (sons de servidor + os
// pessoais DELE, estes só com o benefício; pessoais de outros nunca).
export async function listJoinSoundOptions(userId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.file_path AS "filePath", s.duration_ms AS "durationMs", s.server_id AS "serverId",
            r.name AS "serverName", (s.owner_user_id IS NOT NULL) AS personal
     FROM soundboard_sounds s
     JOIN rooms r ON r.id = s.server_id
     JOIN room_members rm ON rm.room_id = s.server_id AND rm.user_id = $1
     JOIN users u ON u.id = $1
     WHERE s.owner_user_id IS NULL OR (s.owner_user_id = $1 AND ${turboBenefitSql('u', 'personalSounds')})
     ORDER BY LOWER(r.name), r.id, s.created_at ASC`,
    [userId]
  );
  return rows;
}
