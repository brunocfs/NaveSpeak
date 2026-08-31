// Convites de cadastro (invite-only registration) - ver INVITE_ONLY no .env
// e routes/invites.routes.js (painel admin) / routes/auth.routes.js
// (resgate no /register).
import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '../config/db.js';

// Mesmo padrão do invite_code de sala (rooms.repo.js), só que maior (16
// caracteres em vez de 12) - este código também funciona como um "convite de
// entrada na aplicação inteira", vale a pena mais entropia contra
// adivinhação.
function generateCode() {
  return randomBytes(8).toString('hex').toUpperCase();
}

const INVITE_COLUMNS = `
  i.id,
  i.code,
  i.type,
  i.email,
  i.max_uses AS "maxUses",
  i.uses_count AS "usesCount",
  i.created_at AS "createdAt",
  i.expires_at AS "expiresAt",
  i.revoked_at AS "revokedAt"`;

export async function createInvite({ type, email, maxUses, expiresInDays, createdBy }) {
  const id = randomUUID();
  const code = generateCode();
  const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
  const { rows } = await pool.query(
    `INSERT INTO invites (id, code, type, email, max_uses, created_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, code, type, email, max_uses AS "maxUses", uses_count AS "usesCount",
               created_at AS "createdAt", expires_at AS "expiresAt", revoked_at AS "revokedAt"`,
    [id, code, type, email ?? null, maxUses, createdBy, expiresAt]
  );
  return rows[0];
}

// Lista para o painel admin ("acompanhamento") - já traz quem criou e quem
// resgatou cada convite (json_agg), evitando N+1 queries por convite.
export async function listInvites() {
  const { rows } = await pool.query(
    `SELECT ${INVITE_COLUMNS},
            creator.username AS "createdByUsername",
            creator.discriminator AS "createdByDiscriminator",
            COALESCE(
              (SELECT json_agg(json_build_object(
                 'username', u.username,
                 'discriminator', u.discriminator,
                 'redeemedAt', r.created_at
               ) ORDER BY r.created_at)
               FROM invite_redemptions r
               JOIN users u ON u.id = r.user_id
               WHERE r.invite_id = i.id),
              '[]'
            ) AS redemptions
     FROM invites i
     JOIN users creator ON creator.id = i.created_by
     ORDER BY i.created_at DESC`
  );
  return rows;
}

// Validação SÓ DE LEITURA (não consome) - usada pela checagem pública
// (GET /api/invites/check/:code) para a tela de cadastro mostrar se o link é
// válido antes de o usuário preencher o formulário inteiro.
export async function findInviteByCode(code) {
  const { rows } = await pool.query(`SELECT ${INVITE_COLUMNS} FROM invites i WHERE i.code = $1 LIMIT 1`, [
    code,
  ]);
  return rows[0] ?? null;
}

export function isInviteUsable(invite) {
  if (!invite) return false;
  if (invite.revokedAt) return false;
  if (invite.expiresAt && new Date(invite.expiresAt) <= new Date()) return false;
  return invite.usesCount < invite.maxUses;
}

// Consome UM uso do convite de forma atômica: o WHERE (não revogado, não
// expirado, ainda com uso disponível) e o RETURNING na MESMA query são o que
// impede dois cadastros concorrentes de passarem os dois pelo último uso
// disponível (TOCTOU) - sem isso, duas requisições lendo "1 uso restante" ao
// mesmo tempo poderiam cada uma criar uma conta.
export async function consumeInvite(code) {
  const { rows } = await pool.query(
    `UPDATE invites
     SET uses_count = uses_count + 1
     WHERE code = $1
       AND revoked_at IS NULL
       AND (expires_at IS NULL OR expires_at > NOW())
       AND uses_count < max_uses
     RETURNING id, code, type, email, max_uses AS "maxUses", uses_count AS "usesCount",
               created_at AS "createdAt", expires_at AS "expiresAt", revoked_at AS "revokedAt"`,
    [code]
  );
  return rows[0] ?? null;
}

export async function recordInviteRedemption(inviteId, userId) {
  await pool.query(
    `INSERT INTO invite_redemptions (invite_id, user_id) VALUES ($1, $2)
     ON CONFLICT (invite_id, user_id) DO NOTHING`,
    [inviteId, userId]
  );
}

// Revogação manual pelo admin ("acompanhamento" - desativar um convite antes
// de ele atingir o limite de usos). Só marca revoked_at; nunca apaga a linha
// (o histórico de quem já resgatou continua valendo).
export async function revokeInvite(inviteId) {
  const { rows } = await pool.query(
    `UPDATE invites SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL
     RETURNING id`,
    [inviteId]
  );
  return rows.length > 0;
}

export async function findInviteById(inviteId) {
  const { rows } = await pool.query(`SELECT ${INVITE_COLUMNS} FROM invites i WHERE i.id = $1 LIMIT 1`, [
    inviteId,
  ]);
  return rows[0] ?? null;
}
