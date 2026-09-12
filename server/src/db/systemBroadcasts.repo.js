// Histórico de auditoria dos comunicados oficiais (routes/adminBroadcasts.routes.js)
// - não participa da entrega nem da leitura da conversa (isso é
// privateMessages.repo.js), só registra o que foi mandado.
import { pool } from '../config/db.js';

export async function createBroadcastRecord({ content, target, recipientPublicId = null, recipientCount, attachments = [], createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO system_broadcasts (content, target, recipient_public_id, recipient_count, attachments, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, content, target, recipient_public_id AS "recipientPublicId",
               recipient_count AS "recipientCount", attachments, created_at AS "createdAt"`,
    [content, target, recipientPublicId, recipientCount, JSON.stringify(attachments), createdBy]
  );
  return rows[0];
}

// createdByTag junto (mesmo padrão de invites.repo.js) - poupa o client de
// resolver quem disparou cada comunicado.
export async function listBroadcasts({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT sb.id, sb.content, sb.target, sb.recipient_public_id AS "recipientPublicId",
            sb.recipient_count AS "recipientCount", sb.attachments, sb.created_at AS "createdAt",
            u.username AS "createdByUsername", u.discriminator AS "createdByDiscriminator"
     FROM system_broadcasts sb
     INNER JOIN users u ON u.id = sb.created_by
     ORDER BY sb.id DESC
     LIMIT $1`,
    [Math.min(Math.max(Number(limit) || 50, 1), 200)]
  );
  return rows;
}
