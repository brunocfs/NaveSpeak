// Convites de servidor (múltiplos por servidor, cada um com criador,
// validade e histórico de uso próprios) - substitui o invite_code único que
// vivia em `rooms` (ver migrateLegacyRoomInvites em server/migrate.js).
// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário
// na string SQL.
import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';

// Todo convite expira 30 dias após ser criado - regra de negócio pedida
// explicitamente, não é renovável: gerar um novo não mexe nos existentes
// (ver createServerInvite, chamado de novo a cada clique em "Gerar novo
// link" - nunca UPDATE num convite já criado).
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function generateCode() {
  return randomBytes(6).toString('hex').toUpperCase(); // 12 caracteres, mesmo formato do antigo invite_code
}

export async function createServerInvite({ serverId, createdBy }) {
  const id = randomUUID();
  const code = generateCode();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  await pool.query(
    `INSERT INTO server_invites (id, server_id, code, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, serverId, code, createdBy, expiresAt]
  );
  return findInviteById(id);
}

// created_by/revoked_by expostos como public_id (nunca a PK interna) - mesmo
// cuidado de rooms.repo.js#ROOM_WITH_CREATOR.
const INVITE_SELECT = `
  SELECT si.id, si.server_id AS "serverId", si.code,
         si.created_at AS "createdAt", si.expires_at AS "expiresAt", si.revoked_at AS "revokedAt",
         cu.public_id AS "createdById", cu.username AS "createdByUsername",
         cu.discriminator AS "createdByDiscriminator",
         ru.public_id AS "revokedById"
  FROM server_invites si
  INNER JOIN users cu ON cu.id = si.created_by
  LEFT JOIN users ru ON ru.id = si.revoked_by`;

export async function findInviteById(id) {
  const { rows } = await pool.query(`${INVITE_SELECT} WHERE si.id = $1`, [id]);
  return rows[0] ?? null;
}

// Usado por POST /rooms/join e GET /rooms/invite/:code (preview) - só o
// mínimo pra validar/entrar, sem os dados de criador (não é exibido nessas
// telas, ver ServerInvitePage.jsx).
export async function findInviteByCode(code) {
  const { rows } = await pool.query(
    `SELECT id, server_id AS "serverId", code, expires_at AS "expiresAt", revoked_at AS "revokedAt"
     FROM server_invites WHERE code = $1`,
    [code]
  );
  return rows[0] ?? null;
}

// Só confirma que o convite pertence a ESTE servidor antes de revogar/
// deletar - impede um admin de servidor A mexer num convite de servidor B
// adivinhando o UUID.
export async function findInviteInServer(serverId, inviteId) {
  const { rows } = await pool.query(
    `SELECT id FROM server_invites WHERE id = $1 AND server_id = $2`,
    [inviteId, serverId]
  );
  return rows[0] ?? null;
}

export function isInviteUsable(invite) {
  if (!invite || invite.revokedAt) return false;
  return new Date(invite.expiresAt).getTime() > Date.now();
}

// Histórico auditado: quem usou cada convite pra entrar (server_invite_uses,
// preenchido em POST /rooms/join via recordInviteUse). Uma query só pra
// todos os convites do servidor - lista é sempre pequena o bastante (um
// servidor não tem centenas de convites) pra não valer a pena paginar.
async function listUsesForServer(serverId) {
  const { rows } = await pool.query(
    `SELECT siu.invite_id AS "inviteId", siu.used_at AS "usedAt",
            u.public_id AS "userId", u.username, u.discriminator, u.avatar_path AS "avatarPath"
     FROM server_invite_uses siu
     INNER JOIN server_invites si ON si.id = siu.invite_id
     INNER JOIN users u ON u.id = siu.user_id
     WHERE si.server_id = $1
     ORDER BY siu.used_at DESC`,
    [serverId]
  );
  return rows;
}

export async function listInvitesForServer(serverId) {
  const [{ rows: invites }, uses] = await Promise.all([
    pool.query(`${INVITE_SELECT} WHERE si.server_id = $1 ORDER BY si.created_at DESC`, [serverId]),
    listUsesForServer(serverId),
  ]);

  const usesByInvite = new Map();
  for (const use of uses) {
    if (!usesByInvite.has(use.inviteId)) usesByInvite.set(use.inviteId, []);
    usesByInvite.get(use.inviteId).push(use);
  }

  return invites.map((invite) => ({ ...invite, usedBy: usesByInvite.get(invite.id) ?? [] }));
}

export async function recordInviteUse(inviteId, userId) {
  await pool.query(
    `INSERT INTO server_invite_uses (invite_id, user_id) VALUES ($1, $2)`,
    [inviteId, userId]
  );
}

// Revogar é reversível na intenção (o convite continua existindo, só marcado
// como inválido) - distinto de deleteInvite, que apaga a linha (e, por
// cascade, o histórico de uso dela) de vez.
export async function revokeInvite(inviteId, revokedBy) {
  const { rowCount } = await pool.query(
    `UPDATE server_invites SET revoked_at = NOW(), revoked_by = $2
     WHERE id = $1 AND revoked_at IS NULL`,
    [inviteId, revokedBy]
  );
  return rowCount > 0;
}

export async function deleteInvite(inviteId) {
  const { rowCount } = await pool.query('DELETE FROM server_invites WHERE id = $1', [inviteId]);
  return rowCount > 0;
}
