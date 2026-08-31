// Queries parametrizadas ($1, $2, ...) - nunca concatenar entrada do usuário na string SQL.
import { pool } from '../config/db.js';

const DEFAULTS = { memberListMode: 'grouped' };

function toClient(row) {
  if (!row) return { ...DEFAULTS };
  return { memberListMode: row.member_list_mode };
}

// Criada sob demanda: server_settings só ganha uma linha na primeira leitura
// (ou escrita) de um servidor, então servidores criados antes desta tabela
// existir não precisam de backfill/migração à parte.
export async function getServerSettings(serverId) {
  const { rows } = await pool.query(
    'SELECT member_list_mode FROM server_settings WHERE server_id = $1 LIMIT 1',
    [serverId]
  );
  if (rows[0]) return toClient(rows[0]);

  await pool.query(
    `INSERT INTO server_settings (server_id, member_list_mode) VALUES ($1, $2)
     ON CONFLICT (server_id) DO NOTHING`,
    [serverId, DEFAULTS.memberListMode]
  );
  return { ...DEFAULTS };
}

export async function updateServerSettings(serverId, { memberListMode } = {}) {
  await getServerSettings(serverId); // garante que a linha existe antes do UPDATE
  if (memberListMode === undefined) return getServerSettings(serverId);

  const { rows } = await pool.query(
    `UPDATE server_settings SET member_list_mode = $2, updated_at = NOW()
     WHERE server_id = $1
     RETURNING member_list_mode`,
    [serverId, memberListMode]
  );
  return toClient(rows[0]);
}
